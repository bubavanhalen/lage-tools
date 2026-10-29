/**
 * Anbindung des Analyse-Workers (Spez. MVP 3, Kap. 3.12 P2) für `useHints` (hintsData.ts), `useLageRot` (lageRot.ts)
 * und `useOffen`: Signaturen der Hooks bleiben, gerechnet wird im Web Worker (analyse.worker.ts).
 *
 * - Ein Auftrag je Stand (gleiche Meldungen/Raster/NAI/Trupps/Feindannahme/Entscheide und gleiche Lagezeit → kein neuer
 *   Auftrag). Ein neuerer Auftrag ersetzt ältere (Zähler `gen`, Antworten älterer Aufträge werden verworfen).
 * - Bis das Ergebnis da ist, zeigen die Hooks das letzte Ergebnis; dauert es länger als 300 ms, meldet
 *   `useAnalyseLaeuft()` «wird berechnet …» (nie still falsch).
 * - Die Übung geht ohne Bilder und Anhänge in den Worker (`AnalyseInput`).
 * - Rückfall im Hauptfaden (gleiche Rechnung `computeAnalyse`), wenn es keinen `Worker` gibt (Tests, alte Browser) oder
 *   der Worker ausfällt.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { offenePunkte, type Exercise, type OffenItem } from "@lage/core";
import { computeAnalyse, type AnalyseTeile } from "./analyseCompute";
import type { AnalyseAuftrag, AnalyseErgebnis, AnalyseInput } from "./shell/contracts";

/** Teile der Übung, von denen die Analyse abhängt (Identität genügt: jede Änderung ersetzt das Teil) */
export interface AnalyseKey {
  ex: Exercise;
  t: string;
  from: string | null;
  conflicts: string;
}
const PARTS = ["events", "sheets", "areas", "units", "days", "feindannahme", "hintDecisions", "tz"] as const;
export function sameInput(a: Exercise, b: Exercise): boolean {
  if (a === b) return true;
  if (a.id !== b.id) return false;
  for (const k of PARTS) if ((a as unknown as Record<string, unknown>)[k] !== (b as unknown as Record<string, unknown>)[k]) return false;
  return true;
}
const sameKey = (a: AnalyseKey | null, b: AnalyseKey | null) => !!a && !!b && a.t === b.t && a.from === b.from && a.conflicts === b.conflicts && sameInput(a.ex, b.ex);

function inputOf(ex: Exercise): AnalyseInput {
  const { overlays: _o, attachments: _a, ...rest } = ex;
  void _o; void _a;
  return rest;
}

/** Wartezeit, bis «wird berechnet …» erscheint */
export const RECHNET_MS = 300;

class AnalyseClient {
  private worker: Worker | null = null;
  /** Worker ausgefallen → Hauptfaden */
  failed = typeof Worker === "undefined";
  private gen = 0;
  private wanted: AnalyseKey | null = null;
  private wantedGen = 0;
  private since = 0;
  private timer: number | undefined;
  last: { key: AnalyseKey; res: AnalyseTeile } | null = null;
  laeuft = false;
  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  getVersion = () => this.version;
  private emit() { this.version++; for (const f of this.listeners) f(); }

  private ensure(): Worker | null {
    if (this.failed) return null;
    if (this.worker) return this.worker;
    try {
      const w = new Worker(new URL("./analyse.worker.ts", import.meta.url), { type: "module", name: "lt-analyse" });
      w.onmessage = (ev: MessageEvent<AnalyseErgebnis & { fehler?: string }>) => this.onResult(ev.data);
      w.onerror = (ev) => { ev.preventDefault?.(); this.fail(); };
      this.worker = w;
      return w;
    } catch {
      this.fail();
      return null;
    }
  }

  private fail() {
    this.failed = true;
    try { this.worker?.terminate(); } catch { /* egal */ }
    this.worker = null;
    this.laeuft = false;
    window.clearTimeout(this.timer);
    // offener Auftrag: im Hauptfaden rechnen (die Hooks lesen `failed` und rechnen selbst)
    this.emit();
  }

  /** Auftrag für diesen Stand (nichts, wenn er schon gerechnet ist oder läuft) */
  request(key: AnalyseKey): void {
    if (sameKey(this.wanted, key) || (!this.wanted && sameKey(this.last?.key ?? null, key))) return;
    const w = this.ensure();
    if (!w) return;
    this.wanted = key;
    this.wantedGen = ++this.gen;
    this.since = performance.now();
    const msg: AnalyseAuftrag = { gen: this.wantedGen, ex: inputOf(key.ex), t: key.t, from: key.from, conflictIds: key.conflicts ? key.conflicts.split(",") : undefined };
    try { w.postMessage(msg); } catch { this.fail(); return; }
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { if (this.wanted && !this.laeuft) { this.laeuft = true; this.emit(); } }, RECHNET_MS);
  }

  private onResult(r: AnalyseErgebnis & { fehler?: string }) {
    if (r.gen !== this.wantedGen || !this.wanted) return; // älterer Auftrag
    if (r.fehler) { this.fail(); return; }
    this.last = { key: this.wanted, res: { all: r.all, hints: r.hints, quality: r.quality, lageRot: r.lageRot, offen: r.offen } };
    this.wanted = null;
    this.laeuft = false;
    window.clearTimeout(this.timer);
    this.emit();
  }

  /** wie lange der offene Auftrag schon läuft (ms), 0 ohne */
  wartet(): number { return this.wanted ? performance.now() - this.since : 0; }
}

let client: AnalyseClient | null = null;
export const analyseClient = (): AnalyseClient => (client ??= new AnalyseClient());

/** Konflikt-IDs des letzten Zusammenführens (für «Offen» im Worker) – von der Hülle gesetzt */
let conflicts = "";
export function setAnalyseKonflikte(ids: string[] | null | undefined): void { conflicts = (ids ?? []).slice().sort().join(","); }

/**
 * Ergebnis der Analyse für `ex` zur Lagezeit `t` (Zeitfenster `from` nur für die Kräfte-Spalte «im Fenster»): aus dem
 * Worker (letztes passendes oder letztes überhaupt, solange gerechnet wird) bzw. im Hauptfaden. `null` ohne Übung.
 */
export function useAnalyse(ex: Exercise | null, t: string, from: string | null): { res: AnalyseTeile | null; aktuell: boolean } {
  const c = analyseClient();
  useSyncExternalStore(c.subscribe, c.getVersion, c.getVersion);
  const sync = c.failed;
  const cf = conflicts;
  const key = useMemo<AnalyseKey | null>(() => (ex ? { ex, t, from, conflicts: cf } : null),
    // nur die Teile, von denen die Analyse abhängt
    [ex?.id, ex?.events, ex?.sheets, ex?.areas, ex?.units, ex?.days, ex?.feindannahme, ex?.hintDecisions, ex?.tz, t, from, cf]); // eslint-disable-line react-hooks/exhaustive-deps
  const local = useMemo(() => (sync && key ? computeAnalyse(key.ex, key.t, key.from, key.conflicts ? key.conflicts.split(",") : undefined) : null), [sync, key]);
  useEffect(() => { if (!sync && key) c.request(key); }, [sync, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!key) return { res: null, aktuell: true };
  if (local) return { res: local, aktuell: true };
  const last = c.last;
  if (!last || last.key.ex.id !== key.ex.id) return { res: null, aktuell: false };
  return { res: last.res, aktuell: sameKey(last.key, key) };
}

/** «wird berechnet …»: ein Auftrag läuft länger als 300 ms */
export function useAnalyseLaeuft(): boolean {
  const c = analyseClient();
  useSyncExternalStore(c.subscribe, c.getVersion, c.getVersion);
  return c.laeuft;
}

const NO_OFFEN: OffenItem[] = [];
/**
 * «Offen» zur LIVE-Zeit (`offenePunkte`, Kern): aus dem Worker, wenn dessen letzte Rechnung genau diesen Stand hat
 * (LIVE: gleiche Lagezeit wie Hinweise), sonst im Hauptfaden (z. B. im Rückblick – Offen zeigt immer den Stand jetzt).
 * `conflictIds` = Konflikte des letzten Zusammenführens (gehen beim nächsten Auftrag mit in den Worker).
 */
export function useOffen(ex: Exercise | null, tLive: string, conflictIds?: string[] | null): OffenItem[] {
  const c = analyseClient();
  useSyncExternalStore(c.subscribe, c.getVersion, c.getVersion);
  const ck = (conflictIds ?? []).slice().sort().join(",");
  useEffect(() => { setAnalyseKonflikte(conflictIds); }, [ck]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = c.last;
  const ok = !!ex && !!last && last.key.t === tLive && last.key.conflicts === ck && sameInput(last.key.ex, ex);
  const local = useMemo(() => (!ok && ex ? offenePunkte(ex, tLive, { conflictIds: ck ? ck.split(",") : undefined }) : null),
    [ok, ex?.events, ex?.units, ex?.id, tLive, ck]); // eslint-disable-line react-hooks/exhaustive-deps
  return ok ? last!.res.offen : local ?? NO_OFFEN;
}
