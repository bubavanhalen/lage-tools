/**
 * Hinweise zu Rot für die Bedienoberfläche: Berechnung zur Lagezeit (Kern), Zeitfenster, Entscheide, Beschriftungen.
 * Das Lagejournal gibt Hinweise, keine Fakten – der Zfhr entscheidet (bestätigen / verwerfen, jederzeit rückgängig).
 */
import { useMemo } from "react";
import {
  analyzeJournal, compareHints, decisionFor, hintRule,
  type EventQuality, type Exercise, type Hint, type HintDecision, type HintGroup, type HintLevel, type HintRule,
} from "@lage/core";
import "./perf"; // Messpunkte lt:enter/lt:zeile/lt:bereit und window.__ltPerf (P1)

/** IDs aller Hinweise derselben Berechnung – `decisionFor` übernimmt keine Entscheide, die einem anderen aktuellen Hinweis gehören */
const siblings = new WeakMap<Hint, Set<string>>();

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
/** Entscheid zu einem Hinweis – auch wenn sich seine ID durch Nachträge geändert hat (Kern: `decisionFor`) */
export const decisionRec = (ex: Exercise, h: Hint): HintDecision | undefined => decisionFor(h, ex.hintDecisions, siblings.get(h));
export const decisionOf = (ex: Exercise, h: Hint): DecisionState => decisionRec(ex, h)?.state ?? "neu";

/**
 * Entscheid setzen (null = zurück auf «neu») – in `ex.hintDecisions`, wird mit der Übung gespeichert.
 * Mit Regel und Auslösern, damit der Entscheid auch nach Nachträgen (neue ID) am Hinweis haftet.
 */
export function decide(x: Exercise, h: Hint, state: HintDecision["state"] | null, now = new Date()): Exercise {
  const d = { ...(x.hintDecisions ?? {}) };
  // bisherigen Entscheid (evtl. unter alter ID) ersetzen
  const old = decisionFor(h, d, siblings.get(h));
  for (const k of Object.keys(d)) if (d[k] === old) delete d[k];
  if (state) d[h.id] = { state, at: localIso(now), rule: h.rule, events: [...h.events] };
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
  /** alle Hinweise zur Lagezeit (ganzes Journal, ohne Zeitfenster) – für Lage Rot */
  all: Hint[];
}

/** Situation vorbei (z. B. Ruhe beendet, Checkpoint abgebaut) */
export const isOver = (h: Hint, t: string): boolean => !!h.until && h.until <= t;
/** offen = hoch/mittel, nicht beendet, nicht entschieden */
export const isOpen = (ex: Exercise, h: Hint, t: string): boolean => h.level !== "info" && !isOver(h, t) && !decisionRec(ex, h);

/** Prognose aus `next` (nie aus dem Text): «nächste ca. 07:40» bzw. «seit 07:40 überfällig»; null ohne Prognose/beendet */
export function nextLabel(h: Hint, t: string, days: string[]): { text: string; late: boolean } | null {
  if (!h.next || isOver(h, t)) return null;
  const at = hhmm(h.next, days, t);
  return h.next > t ? { text: `nächste ca. ${at}`, late: false } : { text: `seit ${at} überfällig`, late: true };
}

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
    // eine Vorbereitung für Hinweise und Qualität
    const r = analyzeJournal(ex, { t });
    const ids = new Set(r.hints.map((h) => h.id));
    for (const h of r.hints) siblings.set(h, ids);
    return { list: r.hints, quality: r.quality };
  }, [events, areas, sheets, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const hints = useMemo(() => {
    // im Zeitfenster: zuletzt ausgelöst (`last ?? t`) bzw. beendet (`until`) im Fenster; Referenz immer
    const vis = all.list.filter((h) => h.level === "info" || !from || (h.until ?? h.last ?? h.t) >= from || (h.next !== undefined && h.next >= from));
    // Reihenfolge des Kerns (hoch > mittel > info, dann neueste); vorbei nach hinten
    return vis.sort((a, b) => Number(isOver(a, t)) - Number(isOver(b, t)) || compareHints(a, b));
  }, [all, from, t]);
  return { hints, quality: all.quality, all: all.list };
}

/** Zahl am Reiter: offene Hinweise (hoch/mittel, nicht beendet, nicht entschieden) */
export function newCount(ex: Exercise, hints: Hint[], t: string): number {
  return hints.filter((h) => isOpen(ex, h, t)).length;
}
/** mindestens ein offener Hinweis der Stufe hoch (Farbe der Zahl am Reiter) */
export const hasOpenHoch = (ex: Exercise, hints: Hint[], t: string): boolean => hints.some((h) => h.level === "hoch" && isOpen(ex, h, t));

/**
 * Zahl am Umschalter «Journal | Was Rot vorhaben könnte» (Spez. MVP 1, Kap. 3.6): offene Hinweise (nicht entschieden,
 * nicht vorbei, Stufe hoch/mittel), «⚠» davor, wenn ein «hoch» offen ist. Neutral dargestellt (Tinte), kein Ton.
 * `text` ist leer, wenn nichts offen ist; `aria` für Bildschirmleser.
 */
export interface RedBadge { n: number; hoch: boolean; text: string; aria: string }
export function redBadge(ex: Exercise | null, hints: Hint[], t: string): RedBadge {
  if (!ex) return { n: 0, hoch: false, text: "", aria: "" };
  const open = hints.filter((h) => isOpen(ex, h, t));
  const n = open.length, hoch = open.some((h) => h.level === "hoch");
  return {
    n, hoch,
    text: n ? `${hoch ? "⚠" : ""}${n}` : "",
    aria: n ? `${n} ${n === 1 ? "offener Hinweis" : "offene Hinweise"}${hoch ? ", davon wichtige" : ""}` : "keine offenen Hinweise",
  };
}

/** erledigt = entschieden oder vorbei (hoch/mittel) – «Erledigte zeigen (n)» */
export const isDone = (ex: Exercise, h: Hint, t: string): boolean => h.level !== "info" && !isOpen(ex, h, t);

/** Zeit «07:05», mit Tag «T2 07:05», wenn die Übung mehrere Tage hat und der Tag nicht der der Lagezeit ist */
export function hhmm(t: string, days: string[], ref?: string): string {
  const hm = t.slice(11, 16);
  if (!ref || ref.slice(0, 10) === t.slice(0, 10)) return hm;
  const i = days.indexOf(t.slice(0, 10));
  return `${i >= 0 ? `T${i + 1}` : t.slice(8, 10) + "."} ${hm}`;
}
