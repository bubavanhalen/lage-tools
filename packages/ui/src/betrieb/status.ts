/**
 * Betriebs-Status «Offline auf diesem Gerät» (Spez. MVP 3.5, S6/S7, A4): App · Karte · Ortsnamen · Speicher geschützt ·
 * Installiert · letzte Datei-Sicherung · Ladefortschritt. **Phase 0:** aus dem bisherigen `OfflineStatus` abgeleitet
 * (Karte nur ✓/✗, ohne Teilezahl); Paket A baut aus (`areaTileCoverage`, vollständige Prüfung S8) und liefert den
 * einmaligen Schutzhinweis (`useSchutzHinweis`, Phase 0: nie gezeigt).
 */
import { useEffect, useMemo, useReducer } from "react";
import { onlineAllowed, type Exercise } from "@lage/core";
import type { BetriebStatus, OfflineStatus, SchutzHinweis } from "../shell/contracts";
import { useDateiGesichert } from "./dateiSichern";
import { installWeg, istInstalliert, onInstallWeg } from "./install";
import { useLaden } from "./laden";

export function useBetriebStatus(ex: Exercise | null, offline: OfflineStatus): BetriebStatus {
  const [n, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onInstallWeg(bump), []);
  const dateiGesichert = useDateiGesichert(ex?.id);
  const laden = useLaden();
  const online = ex?.onlineDienste;
  return useMemo(() => {
    const karte = offline.parts.karte;
    return {
      app: offline.parts.app,
      karte: { share: karte ? 1 : 0, total: 0, cached: 0, geprueft: false },
      speicher: offline.parts.speicher,
      installiert: istInstalliert(),
      install: installWeg(),
      online: { ortssuche: onlineAllowed({ onlineDienste: online }, "ortssuche"), strassen: onlineAllowed({ onlineDienste: online }, "strassen") },
      dateiGesichert,
      laden,
      net: offline.net,
    };
  }, [offline.parts.app, offline.parts.karte, offline.parts.speicher, offline.net, online, dateiGesichert, laden, n]);
}

/** einmaliger Hinweis «Dieses Gerät schützt die Daten nicht dauerhaft.» (S7) – Phase 0: nie gezeigt (Paket A) */
export function useSchutzHinweis(exId: string | null, s: BetriebStatus): SchutzHinweis {
  void exId; void s;
  return useMemo(() => ({ zeigen: false, ok() { /* Paket A */ }, mehr() { /* Paket A */ } }), []);
}
