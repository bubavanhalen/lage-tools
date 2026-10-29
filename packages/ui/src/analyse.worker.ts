/**
 * Web Worker «Analyse» (Spez. MVP 3, Kap. 3.12 P2): Hinweise zu Rot und Meldungsqualität (`analyzeJournal`), Lage Rot
 * (`estimateRedForce`, `parseStrength`, `compareStrength`, `analyzeRedCoas`) und «Offen» (`offenePunkte`) – ausserhalb
 * des Hauptfadens, damit Eintragen und Tippen bei 800 Meldungen flüssig bleiben.
 *
 * Nachricht `AnalyseAuftrag` → `AnalyseErgebnis` (contracts.ts). Ein neuerer Auftrag ersetzt ältere: Aufträge werden
 * gesammelt und nur der jüngste gerechnet (`gen`). Importiert nur `@lage/core` (keine Oberfläche, kein Leaflet).
 * Gleiche Rechnung wie im Hauptfaden (`computeAnalyse`, analyseClient.ts) – der Rückfall ohne Worker ist identisch.
 */
import { computeAnalyse } from "./analyseCompute";
import type { AnalyseAuftrag, AnalyseErgebnis } from "./shell/contracts";

let next: AnalyseAuftrag | null = null;
let busy = false;

function run() {
  busy = false;
  const job = next;
  next = null;
  if (!job) return;
  try {
    const r: AnalyseErgebnis = { gen: job.gen, ...computeAnalyse(job.ex, job.t, job.from, job.conflictIds) };
    (self as unknown as Worker).postMessage(r);
  } catch (e) {
    (self as unknown as Worker).postMessage({ gen: job.gen, fehler: String((e as Error)?.message ?? e) });
  }
  if (next) schedule();
}
function schedule() {
  if (busy) return;
  busy = true;
  // erst nach allen wartenden Nachrichten rechnen: nur der jüngste Auftrag zählt
  setTimeout(run, 0);
}

self.onmessage = (ev: MessageEvent<AnalyseAuftrag>) => {
  next = ev.data;
  schedule();
};
