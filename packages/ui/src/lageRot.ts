/**
 * Lage Rot für die Bedienoberfläche: mögliche Aktionen Rot und Kräfte Rot zur Lagezeit (Kern: `computeRedCoas`,
 * `estimateRedForce`, `parseStrength`, `compareStrength`), Beschriftungen und Hervorhebung auf der Karte.
 * Folgt Lagezeit und Zeitfenster: mit Zeitfenster zählen nur Meldungen im Fenster.
 */
import { useMemo } from "react";
import {
  allRedCoas, compareStrength, computeRedCoas, estimateRedForce, formatSince, parseStrength,
  type Exercise, type Hint, type RedCoa, type RedForce, type StrengthCompare, type StrengthEstimate, type StrengthSpec,
} from "@lage/core";
import { hhmm } from "./hintsData";

export interface LageRotState {
  /** höchstens drei: wahrscheinlichste, gefährlichste, weitere */
  coas: RedCoa[];
  /** übrige Möglichkeiten mit genügend Indikatoren (nicht ausgewählt), höchster Score zuerst */
  more: Array<Omit<RedCoa, "label">>;
  force: RedForce;
  /** Feindannahme gelesen (null = keine eingetragen) */
  spec: StrengthSpec | null;
  compare: StrengthCompare[];
  /** Zeitfenster aktiv (Anfang, ISO lokal) */
  from: string | null;
}

const EMPTY: RedForce = { rows: [], notSeen: [] };

/** Lage Rot zur Lagezeit `t`; `hints` = sichtbare Hinweise (Zeitfenster), `from` = Anfang des Zeitfensters */
export function useLageRot(ex: Exercise | null, t: string, hints: Hint[], from: string | null): LageRotState {
  const events = ex?.events;
  const fa = ex?.feindannahme;
  const force = useMemo(() => {
    if (!ex) return EMPTY;
    const x = from ? { ...ex, events: (ex.events ?? []).filter((e) => e.t >= from) } : ex;
    return estimateRedForce(x, t);
  }, [events, ex?.sheets, ex?.areas, ex?.units, t, from]); // eslint-disable-line react-hooks/exhaustive-deps
  const spec = useMemo(() => (fa?.trim() ? parseStrength(fa) : null), [fa]);
  const compare = useMemo(() => compareStrength(force, spec), [force, spec]);
  const { coas, more } = useMemo(() => {
    if (!ex) return { coas: [] as RedCoa[], more: [] as Array<Omit<RedCoa, "label">> };
    const o = { t, hints };
    const sel = computeRedCoas(ex, o);
    const ids = new Set(sel.map((c) => c.id));
    return { coas: sel, more: allRedCoas(ex, o).filter((c) => !ids.has(c.id)) };
  }, [events, ex?.sheets, ex?.areas, ex?.units, t, hints]); // eslint-disable-line react-hooks/exhaustive-deps
  return { coas, more, force, spec, compare, from };
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

/** Hinweise, die Indikatoren einer Möglichkeit sind */
export const coaHintIds = (c: RedCoa): string[] => c.indicators.filter((i) => i.met && i.hintId).map((i) => i.hintId!);

export const COA_LABEL: Record<RedCoa["label"], string> = { wahrscheinlichste: "Wahrscheinlichste", gefaehrlichste: "Gefährlichste", weitere: "Weitere" };
/** Kurzname auf der Karte (Fähnchen am Ziel), mit Fragezeichen: Möglichkeit, keine Tatsache */
export const COA_SHORT: Record<RedCoa["kind"], string> = {
  ueberfall: "Überfall?", hinterhalt: "Hinterhalt?", sperren: "Sperre?", versorgung: "Übergabe?",
  aufklaerung: "Aufklärung?", infiltration: "Infiltration?", absetzen: "Absetzen?",
};

/** Zeitraum «ca. 07:40–08:30» (mit Tag, wenn nicht der Tag der Lagezeit) */
export function windowLabel(c: RedCoa, days: string[], t: string): { text: string; now: boolean; past: boolean } | null {
  if (!c.window) return null;
  const { from, to } = c.window;
  return { text: `${hhmm(from, days, t)}–${hhmm(to, days, t)}`, now: from <= t && t < to, past: to <= t };
}

export const metCount = (c: RedCoa) => c.indicators.filter((i) => i.met).length;

/** Dauer «4 h 15′» bzw. «45′» (Kern) */
export const durLabel = (min: number): string => formatSince(min);

/** Zeile «Elemente»: Schlüssel beginnt mit «elemente» */
export const isElementRow = (r: { key: string }) => r.key.startsWith("elemente");

/** Erkannt: Elementnamen, «2» oder «mind. 11 (bis 17)» */
export function foundLabel(f: StrengthEstimate | undefined): { main: string; sub?: string } {
  if (!f) return { main: "–" };
  if (isElementRow(f) && f.names?.length) return { main: f.names.join(", "), sub: f.names.length < f.max ? `bis ${f.max}` : undefined };
  if (f.min === f.max) return { main: String(f.min) };
  return f.min === 0 ? { main: `bis ${f.max}` } : { main: `mind. ${f.min}`, sub: `bis ${f.max}` };
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
