/**
 * Lage Rot für die Bedienoberfläche: mögliche Aktionen Rot und Kräfte Rot zur Lagezeit (Kern: `analyzeRedCoas`,
 * `estimateRedForce`, `parseStrength`, `compareStrength`), Beschriftungen und Hervorhebung auf der Karte.
 *
 * Zeitfenster (Entscheid): Kräfte, «nicht mehr gesehen» und mögliche Aktionen rechnen immer über das ganze Journal bis
 * zur Lagezeit – ein Fenster soll keine Kräfte «verschwinden» lassen. Bei aktivem Fenster zeigt die Kräfte-Tabelle
 * zusätzlich die Spalte «im Fenster» (Kern: `inWindow`).
 */
import { useMemo } from "react";
import {
  analyzeRedCoas, compareStrength, estimateRedForce, formatSince, parseStrength,
  type CoaIndicator, type Exercise, type Hint, type LageEvent, type LV95, type RedCoa, type RedForce, type StrengthCompare,
  type StrengthEstimate, type StrengthRow, type StrengthSpec,
} from "@lage/core";
import { hhmm } from "./hintsData";
import { useAnalyse } from "./analyseClient";

export interface LageRotState {
  /** höchstens drei: wahrscheinlichste, gefährlichste, weitere */
  coas: RedCoa[];
  /** übrige Möglichkeiten mit genügend Indikatoren (nicht ausgewählt), höchster Score zuerst */
  more: RedCoa[];
  /** Kräfte über das ganze Journal bis zur Lagezeit (mit `inWindow`, wenn ein Zeitfenster aktiv ist) */
  force: RedForce;
  /** Feindannahme gelesen (null = keine eingetragen) */
  spec: StrengthSpec | null;
  compare: StrengthCompare[];
  /** Zeitfenster aktiv (Anfang, ISO lokal) – nur für die Spalte «im Fenster» */
  from: string | null;
  /** alle Hinweise zur Lagezeit (ganzes Journal), aus denen die Möglichkeiten abgeleitet sind */
  hints: Hint[];
}

const EMPTY: RedForce = { rows: [], notSeen: [] };

/**
 * Lage Rot zur Lagezeit `t`; `hints` = alle Hinweise zur Lagezeit (ganzes Journal, nicht nur Zeitfenster),
 * `from` = Anfang des Zeitfensters (nur für «im Fenster»). Entscheide des Zfhr (`ex.hintDecisions`) fliessen ein:
 * verworfene Hinweise zählen nicht, bestätigte stärker.
 * Gerechnet im Web Worker zusammen mit den Hinweisen (analyseClient.ts, Spez. MVP 3 P2), wenn `hints` die Hinweise
 * dieser Rechnung sind und kein Zeitfenster gilt; sonst wie bisher im Hauptfaden.
 */
export function useLageRot(ex: Exercise | null, t: string, hints: Hint[], from: string | null): LageRotState {
  const { res } = useAnalyse(ex, t, null);
  const fromWorker = !!res && res.all === hints && from === null;
  // noch keine Rechnung (Worker läuft): leer statt doppelt im Hauptfaden
  const pending = !res && !!ex;
  const local = !fromWorker && !pending;
  const events = ex?.events;
  const fa = ex?.feindannahme;
  const decisions = ex?.hintDecisions;
  const force = useMemo(() => (ex && local ? estimateRedForce(ex, t, { from: from ?? undefined }) : EMPTY),
    [local, events, ex?.sheets, ex?.areas, ex?.units, t, from]); // eslint-disable-line react-hooks/exhaustive-deps
  const spec = useMemo(() => (fa?.trim() ? parseStrength(fa) : null), [fa]);
  const compare = useMemo(() => (local ? compareStrength(force, spec) : []), [local, force, spec]);
  const { coas, more } = useMemo(() => {
    if (!ex || !local) return { coas: [] as RedCoa[], more: [] as RedCoa[] };
    // einmal rechnen: Auswahl und alle Möglichkeiten
    const r = analyzeRedCoas(ex, { t, hints, decisions });
    const ids = new Set(r.picked.map((c) => c.id));
    return { coas: r.picked, more: r.all.filter((c) => !ids.has(c.id)) };
  }, [local, events, ex?.sheets, ex?.areas, ex?.units, t, hints, decisions]); // eslint-disable-line react-hooks/exhaustive-deps
  const empty = useMemo((): LageRotState => ({ coas: [], more: [], force: EMPTY, spec, compare: compareStrength(EMPTY, spec), from, hints }), [spec, from, hints]);
  if (fromWorker) return res!.lageRot;
  if (pending) return empty;
  return { coas, more, force, spec, compare, from, hints };
}

/** Meldungen einer Möglichkeit (für die Karte): Auslöser, Indikator-Meldungen und Auslöser der Indikator-Hinweise */
export function coaEventIds(c: RedCoa, hints: Hint[]): Set<string> {
  const ids = new Set(c.events);
  for (const i of c.indicators) {
    if (!i.met) continue;
    for (const id of i.events ?? []) ids.add(id);
    const h = i.hintId ? hints.find((x) => x.id === i.hintId) : undefined;
    for (const id of h?.events ?? []) ids.add(id);
  }
  return ids;
}

/** Hinweise, die (zutreffende) Indikatoren einer Möglichkeit sind – auch Gegenindikatoren */
export const coaHintIds = (c: RedCoa): string[] => c.indicators.filter((i) => i.met && i.hintId).map((i) => i.hintId!);

export const COA_LABEL: Record<RedCoa["label"], string> = { wahrscheinlichste: "Wahrscheinlichste", gefaehrlichste: "Gefährlichste", weitere: "Weitere" };
/** Kurzname auf der Karte (Fähnchen am Ziel), mit Fragezeichen: Möglichkeit, keine Tatsache */
export const COA_SHORT: Record<RedCoa["kind"], string> = {
  ueberfall: "Überfall?", hinterhalt: "Hinterhalt?", sperren: "Sperre?", versorgung: "Übergabe?",
  aufklaerung: "Aufklärung?", infiltration: "Infiltration?", absetzen: "Absetzen?",
};

export type WindowState = NonNullable<RedCoa["windowState"]>;
export interface WindowLabel {
  /** Anzeige: «jetzt», «ca. 07:45–08:35», «seit 08:35 überfällig», «offen» */
  text: string;
  /** kurz für die Karte: «jetzt», «07:45–08:35», «überfällig», «offen» */
  short: string;
  state: WindowState;
  /** Tooltip */
  title: string;
}

/**
 * Zeitraum einer Möglichkeit nach `windowState` (Kern). Der Zeitraum wird nie an die Lagezeit nachgezogen:
 * vorbei ⇒ «seit 08:35 überfällig»; echte Annäherung ⇒ «jetzt»; ohne Anhaltspunkt ⇒ «offen».
 */
export function windowLabel(c: RedCoa, days: string[], t: string): WindowLabel | null {
  const w = c.window;
  const range = w ? `${hhmm(w.from, days, t)}–${hhmm(w.to, days, t)}` : "";
  const state: WindowState | undefined = c.windowState ?? (w ? (w.to <= t ? "ueberfaellig" : w.from <= t ? "jetzt" : "erwartet") : undefined);
  if (!state) return null;
  switch (state) {
    case "jetzt":
      return { text: "jetzt", short: "jetzt", state, title: range ? `Annäherung gemeldet – Zeitraum ca. ${range}` : "Annäherung gemeldet – jederzeit möglich" };
    case "erwartet":
      return { text: `ca. ${range}`, short: range, state, title: "erwarteter Zeitraum (aus Distanz, Tempo und letztem starkem Indikator)" };
    case "ueberfaellig": {
      const to = w ? hhmm(w.to, days, t) : "";
      return { text: to ? `seit ${to} überfällig` : "überfällig", short: "überfällig", state, title: range ? `erwarteter Zeitraum ca. ${range} ist vorbei – nichts eingetreten` : "erwarteter Zeitraum ist vorbei" };
    }
    default:
      return { text: "offen", short: "offen", state: "offen", title: "Zeitpunkt offen – keine Annäherung, kein Ausgangsraum erkennbar" };
  }
}

/** Indikator ist Gegenindikator (spricht dagegen, Anzeige ✗) */
export const isAgainst = (i: CoaIndicator): boolean => !!i.against;

/** Zähler «4 von 5 ✓ · 1 ✗»: erfüllte Indikatoren (ohne Gegenindikatoren) von allen Indikatoren, zutreffende Gegenindikatoren */
export function indCounts(c: RedCoa): { met: number; of: number; against: number } {
  let met = 0, of = 0, against = 0;
  for (const i of c.indicators) {
    if (isAgainst(i)) { if (i.met) against++; continue; }
    of++;
    if (i.met) met++;
  }
  return { met, of, against };
}
export const countLabel = (c: RedCoa): string => { const n = indCounts(c); return `${n.met} von ${n.of} ✓${n.against ? ` · ${n.against} ✗` : ""}`; };
/** Gegenindikatoren, die nicht zutreffen, werden nicht gezeigt (kein Lärm) */
export const shownIndicators = (c: RedCoa): CoaIndicator[] => c.indicators.filter((i) => !isAgainst(i) || i.met);
/** Zeichen eines Indikators: ✓ erfüllt, ○ offen, ✗ Gegenindikator */
export const indSign = (i: CoaIndicator): string => (isAgainst(i) ? "✗" : i.met ? "✓" : "○");

/** Dauer «4 h 15′» bzw. «45′» (Kern) */
export const durLabel = (min: number): string => formatSince(min);

/** Zeile «Elemente»: Schlüssel beginnt mit «elemente» */
export const isElementRow = (r: { key: string }) => r.key.startsWith("elemente");

/** Erklärung für «mind./bis» (Tooltip) */
export const MIND_BIS_TITLE = "mind. = Sichtungen, die dieselbe Gruppe sein können, zusammengezählt; bis = alle verschieden";

/** Erkannt: Elementnamen, «2» oder «mind. 11 (bis 17)» */
export function foundLabel(f: { min: number; max: number; names?: string[]; key: string } | undefined): { main: string; sub?: string; range: boolean } {
  if (!f) return { main: "–", range: false };
  if (isElementRow(f) && f.names?.length) return { main: f.names.join(", "), sub: f.names.length < f.max ? `bis ${f.max}` : undefined, range: f.names.length < f.max };
  if (f.min === f.max) return { main: String(f.min), range: false };
  return f.min === 0 ? { main: `bis ${f.max}`, range: true } : { main: `mind. ${f.min}`, sub: `bis ${f.max}`, range: true };
}

/** im Zeitfenster gezählt (Kern: `inWindow`), «–» wenn im Fenster nichts */
export function inWindowLabel(f: StrengthEstimate | undefined): { main: string; sub?: string; range: boolean } {
  const w = f?.inWindow;
  if (!f || !w || w.max === 0) return { main: "–", range: false };
  return foundLabel({ key: f.key.startsWith("elemente") ? "fenster" : f.key, min: w.min, max: w.max });
}

/** Einzahl ↔ Mehrzahl der Kürzel (Kern liefert die Mehrzahl bzw. das Kürzel) */
const SINGULAR: Record<string, string> = {
  Drohnen: "Drohne", Elemente: "Element", Personen: "Person", Fahrzeuge: "Fahrzeug", Flugzeuge: "Flugzeug", Busse: "Bus", Motorräder: "Motorrad",
};
const PLURAL: Record<string, string> = Object.fromEntries([
  ...Object.entries(SINGULAR).map(([pl, sg]) => [sg, pl]),
  ["Heli", "Heli"], ["Helikopter", "Helikopter"],
]);

/** Anzahl mit Kürzel in richtiger Zahl: «2 Gr», «1 Drohne», «3 Drohnen», «1 Element», «3 Motorräder» */
export function qtyLabel(n: number, row: Pick<StrengthRow, "abbr" | "name" | "parent">): string {
  let a = row.abbr ?? row.name.replace(/^davon /i, "");
  if (n === 1) a = SINGULAR[a] ?? a;
  else a = PLURAL[a] ?? a;
  return `${n} ${a}`;
}

/** Feindannahme-Vorschau: «2 Det», «davon 2 Kpz», «Det Nord, Det Süd» */
export function specChip(r: StrengthSpec["rows"][number]): string {
  if (r.names?.length) return r.names.join(", ");
  return (r.parent ? "davon " : "") + qtyLabel(r.count, r);
}

/** Erwartet: «14», bei Elementen mit Kürzel «2 Det» */
export function expectedLabel(c: StrengthCompare): string {
  if (c.expected === undefined) return "–";
  if (isElementRow(c.row)) return c.row.abbr ? `${c.expected} ${c.row.abbr}` : String(c.expected);
  return String(c.expected);
}

export const STATE_LABEL: Record<StrengthCompare["state"], string> = {
  vollstaendig: "vollständig", teilweise: "teilweise", fehlt: "fehlt", unerwartet: "nicht erwartet", mehr: "mehr als erwartet", offen: "",
};

/** Zeilenname: Unterzeilen mit «davon» */
export const rowName = (c: StrengthCompare) => (c.row.parent && !/^davon /i.test(c.row.name) ? `davon ${c.row.name}` : c.row.name);

/** Orte einer Möglichkeit für «Auf Karte»: Ziel, Annäherung und Orte der zutreffenden Indikatoren (nahe genug) */
export function coaPlaces(c: RedCoa, ex: Exercise, hints: Hint[]): LV95[] {
  const core: LV95[] = [...(c.approach ?? []), ...(c.target ? [c.target.pos] : [])];
  const byId = new Map((ex.events ?? []).map((e) => [e.id, e] as const));
  const ind: LV95[] = [];
  for (const id of coaEventIds(c, hints)) {
    const e: LageEvent | undefined = byId.get(id);
    if (e?.pos && !e.deleted) ind.push(e.pos);
  }
  if (!core.length) return ind;
  // weit entfernte Indikatoren (z. B. eine frühe Drohne andernorts) nicht einbeziehen: sonst wird der Ausschnitt zu gross
  const near = (p: LV95) => core.some((q) => Math.hypot(p.e - q.e, p.n - q.n) <= COA_PLACE_M);
  return [...core, ...ind.filter(near)];
}
/** Indikator-Orte höchstens so weit (m) von Ziel/Annäherung für «Auf Karte» */
export const COA_PLACE_M = 4000;
