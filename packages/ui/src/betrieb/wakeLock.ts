/**
 * Bildschirm bleibt an (Spez. MVP 3.5, S5, A3). Einstellung pro Gerät `localStorage[WAKE_KEY]` («an»|«aus», fehlt = an).
 * **Phase-0-Stub:** liest/schreibt die Einstellung und meldet, ob der Browser es kann – fordert aber noch nichts an
 * (`aktivJetzt` immer false). Paket A: `navigator.wakeLock.request("screen")` bei `aktiv && an && sichtbar`, neu anfordern
 * bei `visibilitychange`, freigeben bei `!aktiv`/`!an`; Fehler → `fehler` («zurzeit nicht möglich»).
 */
import { useCallback, useState } from "react";
import { WAKE_KEY } from "../shell/contracts";

export { WAKE_KEY };

const lesen = (): boolean => { try { return localStorage.getItem(WAKE_KEY) !== "aus"; } catch { return true; } };

export interface WakeLockApi {
  /** Einstellung des Geräts (Standard an) */
  an: boolean;
  /** Browser kennt `navigator.wakeLock` */
  unterstuetzt: boolean;
  /** Sperre ist jetzt gehalten */
  aktivJetzt: boolean;
  /** letzter Fehler (z. B. Energiesparmodus) – Menü «zurzeit nicht möglich» */
  fehler?: string | null;
  setAn(v: boolean): void;
}

/** @param aktiv Modus «Lage führen» (Workspace verdrahtet in Phase 0) */
export function useWakeLock(aktiv: boolean): WakeLockApi {
  void aktiv;
  const [an, setAnState] = useState(lesen);
  const setAn = useCallback((v: boolean) => {
    try { localStorage.setItem(WAKE_KEY, v ? "an" : "aus"); } catch { /* egal */ }
    setAnState(v);
  }, []);
  const unterstuetzt = typeof navigator !== "undefined" && "wakeLock" in navigator;
  return { an, unterstuetzt, aktivJetzt: false, fehler: null, setAn };
}
