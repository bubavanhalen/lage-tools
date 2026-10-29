/**
 * Laufende Nummer der Journaleinträge (Spez. MVP 3, Kap. 3.3; Entscheid 1 des Kunden, `entscheide.ts`).
 *
 * - **Eine gemeinsame Folge, kein Gerätebuchstabe.** Die Nummer wird beim Erfassen vergeben (`nextNr`) und ändert nie.
 * - Fenster desselben Geräts teilen den Zähler (UI: `localStorage`, Schlüssel `NR_KEY` in shell/contracts.ts).
 * - Nach dem Öffnen/Zusammenführen einer Datei zählt jedes Gerät ab der höchsten bekannten Nummer weiter.
 * - Vergeben zwei Geräte offline dieselbe Nummer, bleibt sie; die Anzeige kennzeichnet die Doppelten deterministisch
 *   mit Endung («12a», «12b» – nach `createdAt`, dann ID; auf jedem Gerät gleich). Meldung beim Zusammenführen:
 *   `doppeltText` («2 Nummern doppelt – als 12a/12b gekennzeichnet»).
 * - Alte Einträge ohne `nr` (vor MVP 3): Nummer abgeleitet (Reihenfolge `createdAt ?? updatedAt`, dann ID), nie
 *   geschrieben – keine Migration. Neue Nummern beginnen nach der höchsten (auch abgeleiteten) Nummer.
 *
 * Alles zur Nummer steht hier, damit ein späterer echter Abgleich (Etappe 6) nur diese Datei ersetzt.
 * Kein Import aus journal.ts (kein Kreis).
 */
import { NR_DOPPELT_ENDUNGEN } from "./entscheide";
import type { Exercise, LageEvent } from "./model";

type NrEvent = Pick<LageEvent, "id" | "nr" | "createdAt" | "updatedAt">;

const order = (a: NrEvent, b: NrEvent) => {
  const ka = a.createdAt ?? a.updatedAt, kb = b.createdAt ?? b.updatedAt;
  return ka < kb ? -1 : ka > kb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/** Anzeige-Index je Ereignisliste: ID → Nummer (gesetzt oder abgeleitet) und Endung bei Doppelten */
interface NrIndex { nr: Map<string, number>; endung: Map<string, string>; max: number; byLabel: Map<string, string> }
const CACHE = new WeakMap<readonly NrEvent[], NrIndex>();

function endungOf(i: number): string {
  // a … z, danach za, zb … (praktisch nie nötig)
  const n = NR_DOPPELT_ENDUNGEN.length;
  return i < n ? NR_DOPPELT_ENDUNGEN[i]! : NR_DOPPELT_ENDUNGEN[n - 1]! + endungOf(i - n + 1);
}

function indexOf(events: readonly NrEvent[]): NrIndex {
  let idx = CACHE.get(events);
  if (idx) return idx;
  const nr = new Map<string, number>();
  // abgeleitete Nummern für alte Einträge (ohne `nr`), in Erfassungsreihenfolge
  const alt = events.filter((e) => e.nr === undefined).sort(order);
  alt.forEach((e, i) => nr.set(e.id, i + 1));
  let max = alt.length;
  for (const e of events) if (e.nr !== undefined) { nr.set(e.id, e.nr); if (e.nr > max) max = e.nr; }
  // Doppelte: gleiche Nummer, verschiedene IDs → Endung nach `createdAt`, dann ID
  const groups = new Map<number, NrEvent[]>();
  for (const e of events) { const n = nr.get(e.id)!; const g = groups.get(n); if (g) g.push(e); else groups.set(n, [e]); }
  const endung = new Map<string, string>();
  const byLabel = new Map<string, string>();
  for (const [n, g] of groups) {
    const ids = [...new Set(g.map((e) => e.id))];
    if (ids.length < 2) { byLabel.set(String(n), ids[0]!); continue; }
    const sorted = ids.map((id) => g.find((e) => e.id === id)!).sort(order);
    sorted.forEach((e, i) => { const s = endungOf(i); endung.set(e.id, s); byLabel.set(`${n}${s}`, e.id); });
  }
  idx = { nr, endung, max, byLabel };
  CACHE.set(events, idx);
  return idx;
}

/** höchste bekannte Nummer der Übung (gesetzt oder abgeleitet), 0 ohne Einträge */
export function maxNr(ex: Pick<Exercise, "events">): number {
  return indexOf(ex.events ?? []).max;
}

/**
 * Nächste Nummer beim Erfassen: eins über dem Höheren von lokalem Gerätezähler (`zaehler`, geteilt von allen Fenstern
 * des Geräts) und höchster bekannter Nummer der Übung. Die UI schreibt das Ergebnis sofort in den Zähler zurück.
 */
export function nextNr(ex: Pick<Exercise, "events">, zaehler: number): number {
  return Math.max(zaehler || 0, maxNr(ex)) + 1;
}

/** Nummer eines Eintrags (gesetzt oder abgeleitet), ohne Endung */
export function nrOf(e: NrEvent, ex: Pick<Exercise, "events">): number | undefined {
  return e.nr ?? indexOf(ex.events ?? []).nr.get(e.id);
}

/** Anzeige «54» bzw. «12a»/«12b» bei doppelter Nummer; Eintrag nicht in der Übung: eigene Nummer oder «» */
export function nrLabel(e: NrEvent, ex: Pick<Exercise, "events">): string {
  const idx = indexOf(ex.events ?? []);
  const n = e.nr ?? idx.nr.get(e.id);
  if (n === undefined) return "";
  return `${n}${idx.endung.get(e.id) ?? ""}`;
}

/** Nummer «42» bzw. «12a» → Eintrag (für «zu 42»); «12» bei Doppelten → der zuerst erfasste («12a») */
export function findByNr(ex: Pick<Exercise, "events">, label: string): LageEvent | undefined {
  const idx = indexOf(ex.events ?? []);
  const l = label.trim().toLowerCase().replace(/^nr\.?\s*/, "");
  const id = idx.byLabel.get(l) ?? (/^\d+$/.test(l) ? idx.byLabel.get(`${l}a`) : undefined);
  return id ? (ex.events ?? []).find((e) => e.id === id) : undefined;
}

export interface NrDoppelt {
  nr: number;
  /** Einträge mit dieser Nummer, in Endungs-Reihenfolge */
  ids: string[];
  /** «12a», «12b» */
  labels: string[];
}

/** alle doppelt vergebenen Nummern (aufsteigend) */
export function nrDoppelte(ex: Pick<Exercise, "events">): NrDoppelt[] {
  const idx = indexOf(ex.events ?? []);
  const out = new Map<number, NrDoppelt>();
  for (const [id, s] of idx.endung) {
    const n = idx.nr.get(id)!;
    const d = out.get(n) ?? { nr: n, ids: [], labels: [] };
    d.ids.push(id);
    d.labels.push(`${n}${s}`);
    out.set(n, d);
  }
  for (const d of out.values()) {
    const pairs = d.ids.map((id, i) => [id, d.labels[i]!] as const).sort((a, b) => (a[1] < b[1] ? -1 : 1));
    d.ids = pairs.map((p) => p[0]);
    d.labels = pairs.map((p) => p[1]);
  }
  return [...out.values()].sort((a, b) => a.nr - b.nr);
}

/** Nummern, die durch ein Zusammenführen neu doppelt sind (vorher `vorher`, nachher `nachher`) */
export function neueDoppelte(vorher: Pick<Exercise, "events">, nachher: Pick<Exercise, "events">): NrDoppelt[] {
  const alt = new Set(nrDoppelte(vorher).map((d) => `${d.nr}:${d.ids.join(",")}`));
  return nrDoppelte(nachher).filter((d) => !alt.has(`${d.nr}:${d.ids.join(",")}`));
}

/** «2 Nummern doppelt – als 12a/12b gekennzeichnet» (leer ohne Doppelte) */
export function doppeltText(d: NrDoppelt[]): string {
  if (!d.length) return "";
  const n = d.reduce((s, x) => s + x.ids.length, 0);
  return `${n} Nummern doppelt – als ${d.map((x) => x.labels.join("/")).join(", ")} gekennzeichnet`;
}
