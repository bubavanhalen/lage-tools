/**
 * Schicht und Kürzel dieses Geräts (Spez. MVP 3, Kap. 2.3, 3.6, Entscheid E5).
 *
 * - `localStorage[SCHICHT_KEY(exId)]` hält Kürzel, Beginn (ISO UTC) und ID des Wechsels; alle Fenster des Geräts teilen
 *   ihn (Abgleich über das `storage`-Ereignis).
 * - Kürzel setzen = Schichtbeginn (`SchichtWechsel { art: "beginn" }` in `ex.schichten`), «nur Schreibweise» ändert
 *   nur das Kürzel. Übergabe abschliessen = `SchichtWechsel { art: "uebergabe" }`, das Gerät übernimmt das neue Kürzel.
 * - `gefragt`: die Abfrage «Wer erfasst?» erscheint höchstens einmal pro Sitzung und Übung (danach erst nach Neuladen).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Exercise, SchichtWechsel } from "@lage/core";
import { SCHICHT_KEY, kuerzelNorm, type SchichtApi, type SchichtLokal } from "../shell/contracts";

const LEER: SchichtLokal = { kuerzel: null, seit: null, wechselId: null };

export function readSchicht(exId: string): SchichtLokal {
  try {
    const v = JSON.parse(localStorage.getItem(SCHICHT_KEY(exId)) ?? "null") as Partial<SchichtLokal> | null;
    if (!v || typeof v !== "object") return LEER;
    return { kuerzel: typeof v.kuerzel === "string" ? v.kuerzel : null, seit: typeof v.seit === "string" ? v.seit : null, wechselId: typeof v.wechselId === "string" ? v.wechselId : null };
  } catch { return LEER; }
}
function writeSchicht(exId: string, s: SchichtLokal): void {
  try { localStorage.setItem(SCHICHT_KEY(exId), JSON.stringify(s)); } catch { /* gesperrter Speicher: gilt nur in diesem Fenster */ }
}

/** Abfrage in dieser Sitzung schon gezeigt (pro Übung) */
const GEFRAGT = new Set<string>();

let seq = 0;
const wechselId = (device: string) => `schicht-${device}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export interface SchichtState extends SchichtApi {
  /** Lagezeit des Schichtbeginns (ISO lokal) – für «Schicht MU seit 22:00»; null ohne Schicht */
  seitT: string | null;
  /** Wechsel in `ex.schichten`, falls bekannt */
  wechsel: SchichtWechsel | null;
}

/** Lagezeit (ISO lokal) eines UTC-Zeitpunkts auf diesem Gerät */
const lokal = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return iso.slice(0, 16);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function useSchicht(ex: Exercise | null, device: string, update: (f: (x: Exercise) => Exercise) => void, tLive: string): SchichtState {
  const exId = ex?.id ?? "";
  const [s, setS] = useState<SchichtLokal>(() => (exId ? readSchicht(exId) : LEER));
  const [gefragt, setGefragtState] = useState(() => GEFRAGT.has(exId));
  const tRef = useRef(tLive);
  tRef.current = tLive;

  // Übungswechsel: Schicht dieser Übung lesen
  useEffect(() => { setS(exId ? readSchicht(exId) : LEER); setGefragtState(GEFRAGT.has(exId)); }, [exId]);
  // andere Fenster desselben Geräts
  useEffect(() => {
    if (!exId) return;
    const on = (ev: StorageEvent) => { if (ev.key === SCHICHT_KEY(exId)) setS(readSchicht(exId)); };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, [exId]);

  const apply = useCallback((next: SchichtLokal, w: SchichtWechsel | null) => {
    if (!exId) return;
    writeSchicht(exId, next);
    setS(next);
    if (w) update((x) => (x.id === exId ? { ...x, schichten: [...(x.schichten ?? []).filter((y) => y.id !== w.id), w] } : x));
  }, [exId, update]);

  const setKuerzel = useCallback((k: string, o?: { neu?: boolean }) => {
    const kz = kuerzelNorm(k);
    if (!kz || !exId) return;
    const cur = readSchicht(exId);
    if (o?.neu === false && cur.seit) {
      // nur Schreibweise: Beginn bleibt, Wechsel trägt das neue Kürzel
      apply({ ...cur, kuerzel: kz }, null);
      if (cur.wechselId) update((x) => (x.id === exId ? { ...x, schichten: (x.schichten ?? []).map((y) => (y.id === cur.wechselId ? { ...y, an: kz } : y)) } : x));
      return;
    }
    const at = new Date().toISOString();
    const w: SchichtWechsel = { id: wechselId(device), art: "beginn", at, t: tRef.current.slice(0, 16), an: kz, device };
    apply({ kuerzel: kz, seit: at, wechselId: w.id }, w);
  }, [exId, device, apply, update]);

  const uebergeben = useCallback((von: string, an: string, stand: { offen: number; neu: number }) => {
    const kz = kuerzelNorm(an);
    if (!kz || !exId) return;
    const at = new Date().toISOString();
    const w: SchichtWechsel = { id: wechselId(device), art: "uebergabe", at, t: tRef.current.slice(0, 16), an: kz, ...(kuerzelNorm(von) ? { von: kuerzelNorm(von)! } : {}), device, stand };
    apply({ kuerzel: kz, seit: at, wechselId: w.id }, w);
  }, [exId, device, apply]);

  const setGefragt = useCallback(() => { GEFRAGT.add(exId); setGefragtState(true); }, [exId]);

  const wechsel = useMemo(() => (s.wechselId ? (ex?.schichten ?? []).find((w) => w.id === s.wechselId) ?? null : null), [s.wechselId, ex?.schichten]);
  const seitT = s.kuerzel && s.seit ? (wechsel?.t ?? lokal(s.seit)) : null;

  return useMemo(() => ({
    kuerzel: s.kuerzel, seit: s.kuerzel ? s.seit : null, setKuerzel, uebergeben, gefragt, setGefragt, seitT, wechsel,
  }), [s.kuerzel, s.seit, setKuerzel, uebergeben, gefragt, setGefragt, seitT, wechsel]);
}

/** «seit 22:00» bzw. ohne Schicht null */
export const seitText = (seitT: string | null): string | null => (seitT ? seitT.slice(11, 16) : null);
