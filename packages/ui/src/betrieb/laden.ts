/**
 * «Alles für offline laden» ohne Oberfläche (Spez. MVP 3.5, A4) – ein Modul-Speicher mit `subscribe`, damit das Laden das
 * Schliessen des Popovers überlebt. **Phase-0-Stub:** `allesOffline` ist noch nicht gebaut (Paket A übernimmt die Logik
 * aus `OfflineBox.run`: Speicherschutz anfragen, Kacheln Normal 2 m, Strassen nur mit `strassen`, Abbruch, danach
 * `notifyOfflineChanged()`); `useLaden` liefert den Fortschritt (Phase 0: immer null).
 */
import { useEffect, useState } from "react";
import type L from "leaflet";
import type { Exercise } from "@lage/core";

type Stand = { done: number; total: number } | null;
let stand: Stand = null;
const hoerer = new Set<(s: Stand) => void>();

/** Fortschritt setzen (nur laden.ts selbst bzw. Paket A) */
export function setLadenStand(s: Stand): void {
  stand = s;
  for (const h of hoerer) h(s);
}

/** Phase 0: noch nicht gebaut – wirft, damit niemand still «fertig» annimmt */
export async function allesOffline(ex: Exercise, map: L.Map, o: { signal?: AbortSignal } = {}): Promise<{ saved: number; failed: number; fehlen: number }> {
  void ex; void map; void o;
  throw new Error("«Alles für offline laden» kommt mit Paket A – bis dahin Vorbereiten → Offline");
}

/** Fortschritt von «Alles für offline laden», null = läuft nicht */
export function useLaden(): Stand {
  const [s, setS] = useState<Stand>(stand);
  useEffect(() => { hoerer.add(setS); setS(stand); return () => { hoerer.delete(setS); }; }, []);
  return s;
}
