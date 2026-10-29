/**
 * Offline-Status für den Kopf (Spez. MVP 1, Kap. 3.1): «Offline bereit ✓» = App im Cache (Service Worker steuert die
 * Seite) ∧ Kartenpaket fürs Raster-Gebiet (oder noch kein Raster) ∧ Speicher geschützt (`storage.persisted()`).
 * Prüfung beim Start, alle 60 s, bei Netz an/aus, bei Raster-Änderung und nach dem Laden für offline
 * (`notifyOfflineChanged`). Keine Netzanfragen – nur Cache und Browser-Zustand.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { sheetBounds, type Exercise } from "@lage/core";
import { areaTilesCached, offlineReady } from "./offline";
import type { OfflineStatus } from "./shell/contracts";
import type { Bounds } from "./tiles";

export const OFFLINE_GRUND = {
  karte: "Karte nicht gespeichert",
  speicher: "Speicher nicht geschützt – der Browser darf löschen",
  app: "App noch nicht offline geladen",
} as const;

const EVT = "lt-offline-changed";
/** nach «Alles für offline laden», Speicherschutz usw.: Status sofort neu prüfen */
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

/** reine Zusammenfassung (testbar) */
export function summarize(parts: OfflineStatus["parts"], net: boolean): OfflineStatus {
  const missing: string[] = [];
  if (!parts.karte) missing.push(OFFLINE_GRUND.karte);
  if (!parts.speicher) missing.push(OFFLINE_GRUND.speicher);
  if (!parts.app) missing.push(OFFLINE_GRUND.app);
  return { ready: !missing.length, net, parts, missing };
}

async function persisted(): Promise<boolean> {
  try { return !!(await navigator.storage?.persisted?.()); } catch { return false; }
}

const START: OfflineStatus = summarize({ app: true, karte: true, speicher: true }, true);

export function useOfflineStatus(ex: Pick<Exercise, "id" | "sheets"> | null): OfflineStatus & { checked: boolean; recheck(): void } {
  const [st, setSt] = useState<OfflineStatus>(START);
  const [checked, setChecked] = useState(false);
  const exRef = useRef(ex);
  exRef.current = ex;
  const seq = useRef(0);
  const check = useCallback(async () => {
    const n = ++seq.current;
    const x = exRef.current;
    const area = x ? rasterArea(x) : null;
    const [karte, speicher] = await Promise.all([area ? areaTilesCached(area) : Promise.resolve(true), persisted()]);
    if (n !== seq.current) return;
    // Testhaken der Abnahme (e2e/run.mjs): Grundansicht im Zustand «Offline bereit» zählen – nur wenn gesetzt
    if ((window as unknown as { __ltOfflineBereit?: boolean }).__ltOfflineBereit === true) { setSt(summarize({ app: true, karte: true, speicher: true }, navigator.onLine)); setChecked(true); return; }
    setSt(summarize({ app: offlineReady(), karte, speicher }, navigator.onLine));
    setChecked(true);
  }, []);
  const sheetKey = ex ? `${ex.id}|${ex.sheets.map((s) => `${s.id}:${s.origin.e},${s.origin.n}:${s.cellW}:${s.colLabels.length}x${s.rowLabels.length}`).join(";")}` : "";
  useEffect(() => { void check(); }, [sheetKey, check]);
  useEffect(() => {
    const on = () => void check();
    const id = window.setInterval(on, 60000);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    window.addEventListener(EVT, on);
    navigator.serviceWorker?.addEventListener?.("controllerchange", on);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
      window.removeEventListener(EVT, on);
      navigator.serviceWorker?.removeEventListener?.("controllerchange", on);
    };
  }, [check]);
  return { ...st, checked, recheck: () => void check() };
}
