/**
 * Offline-Status für den Kopf (Spez. MVP 1, Kap. 3.1; MVP 3.5, S8/A5): «Offline bereit ✓» = App im Cache (Service Worker
 * steuert die Seite) ∧ Kartenpaket fürs Raster-Gebiet **vollständig** (oder noch kein Raster). Der Speicherschutz
 * (`storage.persisted()`) ist nur eine Empfehlung (Entscheid MVP 1-Nachbesserung M1, MVP 3.5 Frage 9.2): ein dauerhaftes
 * ✗ im Kopf würde man übersehen lernen. Er steht in `parts.speicher` und `recommend`, nicht in `missing`.
 *
 * MVP 3.5: Die Karte wird vollständig geprüft (`areaTileCoverage` bis zur Ladestufe 2 m, keine Stichprobe), aber **nur auf Ereignis** – beim
 * Start, bei Raster-Änderung, nach dem Laden für offline (`notifyOfflineChanged`) und bei `online`; das Ergebnis wird pro
 * Raster-Schlüssel gemerkt. App, Netz und Speicher prüft der Kopf zusätzlich alle 60 s. Keine Netzanfragen – nur Cache
 * und Browser-Zustand. `abdeckung` liefert die Teilezahlen für das Offline-Popover («96 % (933 von 971 Teilen)»).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { sheetBounds, type Exercise } from "@lage/core";
import { areaTileCoverage, offlineReady, OFFLINE_FEINSTE_M, type TeileZahl } from "./offline";
import type { OfflineStatus } from "./shell/contracts";
import type { Bounds } from "./tiles";

export const OFFLINE_GRUND = {
  karte: "Karte nicht gespeichert",
  speicher: "Speicher nicht geschützt – der Browser darf löschen",
  app: "App noch nicht offline geladen",
} as const;

/**
 * Kartenabdeckung des Raster-Gebiets über **alle Stufen bis zur Ladestufe** (2 m/px, Review 6 Feld H1); `geprueft` =
 * vollständig geprüft. `uebersicht`/`detail`: Teilezahlen der Stufen ≥ bzw. < 10 m/px (Ampel «Übersicht ✓ · Detail 25 %»),
 * `feinsteZ`: feinste lückenlos vorhandene Stufe.
 */
export interface KartenAbdeckung { share: number; total: number; cached: number; geprueft: boolean; uebersicht?: TeileZahl; detail?: TeileZahl; feinsteZ?: number | null }
/** `OfflineStatus` mit Teilezahlen der Karte (für `useBetriebStatus`) */
export type OfflineStatusVoll = OfflineStatus & { checked?: boolean; recommend?: string[]; abdeckung?: KartenAbdeckung };

const EVT = "lt-offline-changed";
/** nach «Alles für offline laden», Speicherschutz usw.: Status sofort neu prüfen (auch die Karte) */
export function notifyOfflineChanged(): void {
  try { window.dispatchEvent(new Event(EVT)); } catch { /* egal */ }
}

/** Gebiet des Kartenpakets: alle Raster mit 10 % Rand (wie OfflineBox), null = kein Raster */
export function rasterArea(ex: Pick<Exercise, "sheets">): Bounds | null {
  if (!ex.sheets.length) return null;
  const bs = ex.sheets.map(sheetBounds);
  const b = { minE: Math.min(...bs.map((x) => x.minE)), maxE: Math.max(...bs.map((x) => x.maxE)), minN: Math.min(...bs.map((x) => x.minN)), maxN: Math.max(...bs.map((x) => x.maxN)) };
  const m = 0.1 * Math.max(b.maxE - b.minE, b.maxN - b.minN);
  return { minE: b.minE - m, maxE: b.maxE + m, minN: b.minN - m, maxN: b.maxN + m };
}

/** reine Zusammenfassung (testbar): bereit = App und Karte offline; Speicherschutz nur Empfehlung (`recommend`) */
export function summarize(parts: OfflineStatus["parts"], net: boolean): OfflineStatus & { recommend: string[] } {
  const missing: string[] = [];
  if (!parts.karte) missing.push(OFFLINE_GRUND.karte);
  if (!parts.app) missing.push(OFFLINE_GRUND.app);
  return { ready: !missing.length, net, parts, missing, recommend: parts.speicher ? [] : [OFFLINE_GRUND.speicher] };
}

/** Karte ✓ nur bei 100 % (S8) – kein Raster: nichts zu laden, ✓ */
export const karteVollstaendig = (a: Pick<KartenAbdeckung, "share" | "total">): boolean => a.total === 0 || a.share >= 1;

async function persisted(): Promise<boolean> {
  try { return !!(await navigator.storage?.persisted?.()); } catch { return false; }
}

/** Schlüssel des Raster-Gebiets (Prüfung nur bei Änderung, Ergebnis gemerkt) */
export function sheetKeyOf(ex: Pick<Exercise, "id" | "sheets"> | null): string {
  return ex ? `${ex.id}|${ex.sheets.map((s) => `${s.id}:${s.origin.e},${s.origin.n}:${s.cellW}:${s.colLabels.length}x${s.rowLabels.length}`).join(";")}` : "";
}

/** gemerkte Abdeckung je Raster-Schlüssel (Modul-Speicher: überlebt Neuaufbau der Komponente) */
const gemerkt = new Map<string, KartenAbdeckung>();
const KEIN_RASTER: KartenAbdeckung = { share: 1, total: 0, cached: 0, geprueft: true };
const UNGEPRUEFT: KartenAbdeckung = { share: 1, total: 0, cached: 0, geprueft: false };

/** eingehängte Prüfungen (je `useOfflineStatus`), damit «Alles für offline laden» erst nach der Neuprüfung «fertig» meldet */
const pruefer = new Set<() => Promise<void>>();
/** Karte in allen eingehängten Status sofort vollständig neu prüfen und warten, bis das Ergebnis gesetzt ist */
export async function karteNeuPruefen(): Promise<void> {
  await Promise.all([...pruefer].map((f) => f().catch(() => {})));
}

const START: OfflineStatus = summarize({ app: true, karte: true, speicher: true }, true);

export function useOfflineStatus(ex: Pick<Exercise, "id" | "sheets"> | null): OfflineStatusVoll & { checked: boolean; recheck(): void } {
  const [st, setSt] = useState<OfflineStatus & { recommend?: string[] }>(START);
  const [abdeckung, setAbdeckung] = useState<KartenAbdeckung>(UNGEPRUEFT);
  const [checked, setChecked] = useState(false);
  const exRef = useRef(ex);
  exRef.current = ex;
  const abRef = useRef<KartenAbdeckung>(UNGEPRUEFT);
  const seq = useRef(0);
  const sheetKey = sheetKeyOf(ex);
  const keyRef = useRef(sheetKey);
  keyRef.current = sheetKey;

  /** App, Netz, Speicher (+ Karte neu prüfen, wenn `karte`) */
  const check = useCallback(async (karte: boolean) => {
    const n = ++seq.current;
    const x = exRef.current;
    const key = keyRef.current;
    const area = x ? rasterArea(x) : null;
    let ab = abRef.current;
    if (!area) ab = KEIN_RASTER;
    else if (karte || !gemerkt.has(key)) {
      const c = await areaTileCoverage(area, OFFLINE_FEINSTE_M);
      ab = { ...c, geprueft: true };
      gemerkt.set(key, ab);
    } else ab = gemerkt.get(key)!;
    const speicher = await persisted();
    if (n !== seq.current) return;
    abRef.current = ab;
    // Testhaken der Abnahme (e2e/run.mjs): Grundansicht im Zustand «Offline bereit» zählen – nur wenn gesetzt
    if ((window as unknown as { __ltOfflineBereit?: boolean }).__ltOfflineBereit === true) {
      setAbdeckung({ share: 1, total: ab.total, cached: ab.total, geprueft: true });
      setSt(summarize({ app: true, karte: true, speicher: true }, navigator.onLine));
      setChecked(true);
      return;
    }
    setAbdeckung(ab);
    setSt(summarize({ app: offlineReady(), karte: karteVollstaendig(ab), speicher }, navigator.onLine));
    setChecked(true);
  }, []);

  // beim Start und bei Raster-Änderung: Karte prüfen (gemerktes Ergebnis desselben Rasters gilt bis zum nächsten Ereignis)
  useEffect(() => { void check(!gemerkt.has(sheetKey)); }, [sheetKey, check]);
  useEffect(() => {
    const f = () => check(true);
    pruefer.add(f);
    return () => { pruefer.delete(f); };
  }, [check]);
  useEffect(() => {
    const rest = () => void check(false);
    const alles = () => void check(true);
    const id = window.setInterval(rest, 60000);
    window.addEventListener("online", alles);
    window.addEventListener("offline", rest);
    window.addEventListener(EVT, alles);
    navigator.serviceWorker?.addEventListener?.("controllerchange", rest);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("online", alles);
      window.removeEventListener("offline", rest);
      window.removeEventListener(EVT, alles);
      navigator.serviceWorker?.removeEventListener?.("controllerchange", rest);
    };
  }, [check]);
  return { ...st, abdeckung, checked, recheck: () => void check(true) };
}
