/**
 * Ruhige Karte (Spez. MVP 1, Kap. 3.7 und 5.4) – reine Regeln ohne Leaflet, geprüft in test/quiet.test.ts.
 *
 * Beschriftungsregel (Grundansicht, `quiet`):
 * - Feind/Unklar (auch Neutral, UL) beschriftet – Zeit-Fähnchen und Zusatz («2× Det 1») – nur wenn
 *   t ≥ Lagezeit − 30 min oder gewählt; ältere 72 % Deckkraft und entsättigt (`saturate(.55)`, mapoverlays.css) ohne
 *   Fähnchen und ohne Zusatz (MVP 3.5, K3 Variante V4: 55 % ging auf der grauen Karte unter),
 * - eigene Trupps: Name immer (Altersangabe > 60 min macht `situationModel`), volle Deckkraft,
 * - gewählt: immer kräftig und beschriftet; die Stapel-Zahl bleibt immer kräftig (CSS, nicht hier).
 * Experte (`quiet: false`): wie bis MVP 0 (ältere 45 %, Zusatz bleibt).
 */
import { ZEICHEN } from "@lage/core";
import type { ItemKind } from "../journalLayer";

export const QUIET = {
  /** so lange gilt eine Meldung als neu (beschriftet, kräftig) */
  neuMin: 30,
  /** Deckkraft älterer Sichtungen in der Grundansicht (V4: 0.72, dazu entsättigt – `ZEICHEN.altSaettigung`) */
  altDeckkraft: ZEICHEN.altDeckkraft,
  /** Deckkraft älterer Sichtungen im Experten-Modus (wie bisher) */
  altDeckkraftExperte: 0.45,
  /** Flächen/Linien älterer Sichtungen (Experte, wie bisher) */
  altFlaecheExperte: 0.55,
  /** grosse Feldbeschriftung im Raster erst, wenn ein Feld so viele Bildschirmpixel hoch ist (Kap. 5.4) */
  rasterFeldPx: 120,
} as const;

export interface QuietInput {
  kind: ItemKind;
  /** Minuten seit der Meldung bis zur Lagezeit */
  ageMin: number;
  selected: boolean;
}

export interface QuietLook {
  opacity: number;
  /** Zeit-Fähnchen «hh:mm» zeigen (sonst nur aufgefächert) */
  showTime: boolean;
  /** Zusatz am Zeichen («H04», «2× Det 1») zeigen */
  showUd: boolean;
}

export interface QuietOptions {
  /** Grundansicht (ruhige Karte); false = Experte */
  quiet: boolean;
  /** Ebene «Uhrzeit an Zeichen» */
  zeiten: boolean;
  /** Minuten «neu» (Standard 30) */
  neuMin?: number;
}

/** ist die Meldung «neu» (t ≥ Lagezeit − 30 min)? */
export const isNeu = (ageMin: number, neuMin: number = QUIET.neuMin): boolean => ageMin <= neuMin;

/** Deckkraft und Beschriftung eines Zeichens (Kap. 3.7, Beschriftungsregel) */
export function quietLook(it: QuietInput, o: QuietOptions): QuietLook {
  const neu = isNeu(it.ageMin, o.neuMin);
  if (it.selected) return { opacity: 1, showTime: o.zeiten, showUd: true };
  if (it.kind === "eigen") return { opacity: 1, showTime: o.zeiten && neu, showUd: true };
  if (neu) return { opacity: 1, showTime: o.zeiten, showUd: true };
  return o.quiet
    ? { opacity: QUIET.altDeckkraft, showTime: false, showUd: false }
    : { opacity: QUIET.altDeckkraftExperte, showTime: false, showUd: true };
}

/** Deckkraft einer Fläche/Linie (gleiche Regel wie die Zeichen) */
export function quietShapeOpacity(it: QuietInput, o: Pick<QuietOptions, "quiet" | "neuMin">): number {
  if (it.selected || it.kind === "eigen" || isNeu(it.ageMin, o.neuMin)) return 1;
  return o.quiet ? QUIET.altDeckkraft : QUIET.altFlaecheExperte;
}

/** Was zeigen die Ebenen «Hinweise» und «Was Rot tun könnte»? Grundansicht: nur das Gewählte (Kap. 3.6/3.7). */
export function onlySelectedFilter<T extends { id: string }>(list: T[], selectedId: string | null, onlySelected: boolean): T[] {
  if (!onlySelected) return list;
  return selectedId ? list.filter((x) => x.id === selectedId) : [];
}
