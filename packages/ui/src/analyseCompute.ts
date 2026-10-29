/**
 * Eine Rechnung für Hinweise, Qualität, Lage Rot und «Offen» (Spez. MVP 3, Kap. 3.12 P2) – im Web Worker
 * (analyse.worker.ts) und als Rückfall im Hauptfaden. Nur `@lage/core`, kein React, kein Leaflet.
 */
import {
  analyzeJournal, analyzeRedCoas, compareStrength, estimateRedForce, offenePunkte, parseStrength,
  type EventQuality, type Exercise, type Hint, type OffenItem,
} from "@lage/core";
import type { LageRotState } from "./lageRot";
import type { AnalyseInput } from "./shell/contracts";

export interface AnalyseTeile {
  /** alle Hinweise zur Lagezeit (ganzes Journal) */
  all: Hint[];
  /** = `all` (die Sicht im Zeitfenster filtert `useHints` selbst, ohne neue Rechnung) */
  hints: Hint[];
  quality: Map<string, EventQuality>;
  lageRot: LageRotState;
  offen: OffenItem[];
}

export function computeAnalyse(ex: AnalyseInput | Exercise, t: string, from: string | null, conflictIds?: string[]): AnalyseTeile {
  const x = ex as Exercise;
  const r = analyzeJournal(x, { t });
  const force = estimateRedForce(x, t, { from: from ?? undefined });
  const spec = x.feindannahme?.trim() ? parseStrength(x.feindannahme) : null;
  const compare = compareStrength(force, spec);
  const c = analyzeRedCoas(x, { t, hints: r.hints, decisions: x.hintDecisions });
  const ids = new Set(c.picked.map((k) => k.id));
  const lageRot: LageRotState = { coas: c.picked, more: c.all.filter((k) => !ids.has(k.id)), force, spec, compare, from, hints: r.hints };
  const offen = offenePunkte(x, t, { conflictIds });
  return { all: r.hints, hints: r.hints, quality: r.quality, lageRot, offen };
}
