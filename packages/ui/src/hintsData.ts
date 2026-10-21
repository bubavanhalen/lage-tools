/**
 * Hinweise zu Rot für die Bedienoberfläche: Berechnung zur Lagezeit (Kern), Zeitfenster, Entscheide, Beschriftungen.
 * Das Lagejournal gibt Hinweise, keine Fakten – der Zfhr entscheidet (bestätigen / verwerfen, jederzeit rückgängig).
 */
import { useMemo } from "react";
import {
  compareHints, computeHints, eventQuality, hintRule,
  type EventQuality, type Exercise, type Hint, type HintDecision, type HintGroup, type HintLevel, type HintRule,
} from "@lage/core";

export const GROUPS: Array<[HintGroup, string]> = [
  ["absicht", "Absicht Rot"],
  ["rotsiehtblau", "Rot sieht Blau"],
  ["normallage", "Normallage"],
  ["praesenz", "Präsenz"],
  ["qualitaet", "Qualität"],
];
export const GROUP_LABEL = Object.fromEntries(GROUPS) as Record<HintGroup, string>;
export const LEVEL_LABEL: Record<HintLevel, string> = { hoch: "Hoch", mittel: "Mittel", info: "Referenz" };

/** Regel zu einer Hinweis-Regel-ID */
export const ruleOf = (id: string): HintRule | undefined => hintRule(id);
export const groupOf = (h: Hint): HintGroup => ruleOf(h.rule)?.group ?? "absicht";

export type DecisionState = HintDecision["state"] | "neu";
export const decisionOf = (ex: Exercise, h: Hint): DecisionState => ex.hintDecisions?.[h.id]?.state ?? "neu";

/** Entscheid setzen (null = zurück auf «neu») – in `ex.hintDecisions`, wird mit der Übung gespeichert */
export function decide(x: Exercise, id: string, state: HintDecision["state"] | null, now = new Date()): Exercise {
  const d = { ...(x.hintDecisions ?? {}) };
  if (state) d[id] = { state, at: localIso(now) };
  else delete d[id];
  x.hintDecisions = d;
  return x;
}

/** ISO lokal (ohne Zeitzone), wie die Zeiten im Journal */
export function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface HintsState {
  /** sichtbar zur Lagezeit (im Zeitfenster; Referenz-Hinweise immer), wichtigste zuerst, dann neueste */
  hints: Hint[];
  /** Qualität je Meldung (E1/E2) zur Lagezeit */
  quality: Map<string, EventQuality>;
}

/** Situation vorbei (z. B. Ruhe beendet, Checkpoint abgebaut) */
export const isOver = (h: Hint, t: string): boolean => !!h.until && h.until <= t;

/**
 * Hinweise und Meldungsqualität zur Lagezeit `t`; Zeitfenster `from` (ISO lokal, null = alles) blendet ältere
 * Hinweise aus (Referenz-Hinweise bleiben).
 */
export function useHints(ex: Exercise | null, t: string, from: string | null): HintsState {
  const events = ex?.events;
  const areas = ex?.areas;
  const sheets = ex?.sheets;
  const all = useMemo(() => {
    if (!ex) return { list: [] as Hint[], quality: new Map<string, EventQuality>() };
    return { list: computeHints(ex, { t }), quality: eventQuality(ex.events ?? [], t, ex) };
  }, [events, areas, sheets, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const hints = useMemo(() => {
    // im Zeitfenster: zuletzt ausgelöst (`last ?? t`) bzw. beendet (`until`) im Fenster; Referenz immer
    const vis = all.list.filter((h) => h.level === "info" || !from || (h.until ?? h.last ?? h.t) >= from || (h.next !== undefined && h.next >= from));
    // Reihenfolge des Kerns (hoch > mittel > info, dann neueste); vorbei nach hinten
    return vis.sort((a, b) => Number(isOver(a, t)) - Number(isOver(b, t)) || compareHints(a, b));
  }, [all, from, t]);
  return { hints, quality: all.quality };
}

/** Zahl am Reiter: neue (nicht entschiedene) Hinweise der Stufen hoch und mittel */
export function newCount(ex: Exercise, hints: Hint[]): number {
  return hints.filter((h) => h.level !== "info" && !ex.hintDecisions?.[h.id]).length;
}

/** Zeit «07:05», mit Tag «T2 07:05», wenn die Übung mehrere Tage hat und der Tag nicht der der Lagezeit ist */
export function hhmm(t: string, days: string[], ref?: string): string {
  const hm = t.slice(11, 16);
  if (!ref || ref.slice(0, 10) === t.slice(0, 10)) return hm;
  const i = days.indexOf(t.slice(0, 10));
  return `${i >= 0 ? `T${i + 1}` : t.slice(8, 10) + "."} ${hm}`;
}
