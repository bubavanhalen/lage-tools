/**
 * Eine Zahl, ein Name (Spez. MVP 3.5, S25, D5): offene Hinweise zu Rot zählt überall dieselbe Funktion – Reiter
 * «Was Rot ⚠n», Übergabe «Hinweise zu Rot offen n», Offen «Was Rot: n offene Hinweise», Rapport-Zahlen.
 * Phase 0 fertig (Test `test/vertraege35.test.ts`); danach Paket D (Verwendung in red/*, schicht.ts, Übergabe).
 */
import { zeitBis } from "./clock";
import { decisionFor, type Hint } from "./hints";
import type { Exercise } from "./model";

/**
 * Offene Hinweise zu Rot: ohne Stufe «info» (Referenz), ohne entschiedene (bestätigt oder verworfen, `decisionFor` –
 * haftet auch nach ID-Wechsel), ohne beendete (`until` ≤ `t`, nur wenn `t` gegeben ist). Gebündelte Hinweise
 * (`bundleHints`) zählen je 1 – `hints` ist die Liste, wie sie die Ansicht zeigt.
 * `erledigt` = entschiedene oder beendete (ohne «info»); `ids` = die offenen in der gegebenen Reihenfolge.
 */
export function offeneHinweise(hints: Hint[], decisions: Exercise["hintDecisions"], t?: string): { offen: number; erledigt: number; ids: string[] } {
  const alle = new Set(hints.map((h) => h.id));
  const ids: string[] = [];
  let erledigt = 0;
  for (const h of hints) {
    if (h.level === "info") continue;
    const vorbei = t !== undefined && !!h.until && zeitBis(h.until, t);
    if (vorbei || decisionFor(h, decisions, alle)) erledigt++;
    else ids.push(h.id);
  }
  return { offen: ids.length, erledigt, ids };
}
