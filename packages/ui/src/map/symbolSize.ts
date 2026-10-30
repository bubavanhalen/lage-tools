/**
 * Zeichengrösse V4 (Spez. MVP 3.5, K3, Kap. 3.2.1, B1) – Formel und Regler S/M/L pro Gerät. Phase 0: Formel nach der
 * Tabelle der Spezifikation (Werte aus `ZEICHEN`, entscheide.ts) und die Einstellung; die Lage-Ebene nutzt sie noch nicht
 * (`SituationOptions.groesse` ist verdrahtet, Paket B baut `situationLayer`, Icons, Tests `ui/test/symbolSize.test.ts`).
 */
import { useCallback, useEffect, useState } from "react";
import { ZEICHEN } from "@lage/core";
import { ZEICHEN_KEY, type ZeichenGroesse, type ZeichenStufe } from "../shell/contracts";

export { ZEICHEN_KEY };
export type { ZeichenGroesse, ZeichenStufe };

/** Grössenklasse = Spalte der Tabelle: 0 (> 15 m/px), 1 (10–15), 2 (5–10), 3 (< 5); wechselt genau an 15/10/5 */
export function symbolKlasse(mPerPx: number): 0 | 1 | 2 | 3 {
  const i = ZEICHEN.grundmass.findIndex((g) => mPerPx > g.abMPerPx);
  return (i < 0 ? ZEICHEN.grundmass.length - 1 : i) as 0 | 1 | 2 | 3;
}

/** Grundmass in px: Tabelle + Stufe (S −4, M 0, L +8); Präsentation +14 **statt** der Stufe. Gewählt: + `ZEICHEN.gewaehlt` (Aufrufer) */
export function symbolGrundmass(mPerPx: number, g: ZeichenGroesse): number {
  const basis = ZEICHEN.grundmass[symbolKlasse(mPerPx)]!.px;
  return basis + (g.praesentation ? ZEICHEN.praesentation : ZEICHEN.stufe[g.stufe]);
}

const lesen = (): ZeichenStufe => { try { const v = localStorage.getItem(ZEICHEN_KEY); return v === "S" || v === "L" ? v : "M"; } catch { return "M"; } };
const hoerer = new Set<(s: ZeichenStufe) => void>();

/** Stufe pro Gerät («S»|«M»|«L», fehlt = M); Änderung benachrichtigt alle Nutzer (Modul-Ereignis) und andere Fenster */
export function useZeichenGroesse(): [ZeichenStufe, (s: ZeichenStufe) => void] {
  const [stufe, setStufe] = useState<ZeichenStufe>(lesen);
  useEffect(() => {
    hoerer.add(setStufe);
    const st = (e: StorageEvent) => { if (e.key === ZEICHEN_KEY) setStufe(lesen()); };
    window.addEventListener("storage", st);
    return () => { hoerer.delete(setStufe); window.removeEventListener("storage", st); };
  }, []);
  const set = useCallback((s: ZeichenStufe) => {
    try { localStorage.setItem(ZEICHEN_KEY, s); } catch { /* egal */ }
    for (const h of hoerer) h(s);
  }, []);
  return [stufe, set];
}
