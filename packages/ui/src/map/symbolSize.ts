/**
 * Zeichengrösse V4 (Spez. MVP 3.5, K3, Kap. 3.2.1, B1) – Formel und Regler S/M/L pro Gerät (Werte aus `ZEICHEN`,
 * entscheide.ts). Die Lage-Ebene (`situationLayer`) baut ihre Zeichen nur neu, wenn die Grössenklasse (`symbolKlasse`)
 * oder die Einstellung wechselt. Tests: `ui/test/symbolSize.test.ts`.
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

/** Linienstärken der Zeichen (milsymbol-Einheiten, V4): Rahmen 7, Halo 8 */
export const ZEICHEN_STRICH = { strokeWidth: ZEICHEN.strokeWidth, outlineWidth: ZEICHEN.outlineWidth } as const;

/** dünnste Linie eines Zeichens auf dem Bildschirm (px; Review 6 Erstbenutzer N: S bei 20 m/px war 1.4 px) */
export const LINIE_MIN_PX = 1.5;
/**
 * Linienstärken für ein Zeichen von `px` Grundmass: milsymbol rechnet in Einheiten von `px`/100 – Rahmen 7 ergibt bei
 * 20 px nur 1.4 px. Darunter wird der Rahmen so verstärkt, dass er `LINIE_MIN_PX` sicher erreicht (+2 %, auf 0.1 auf).
 */
export function zeichenStrich(px: number): { strokeWidth: number; outlineWidth: number } {
  // 2 % Reserve: milsymbol rundet die Bildgrösse, der Massstab ist nicht genau px/100
  const min = Math.ceil(((LINIE_MIN_PX * 1.02 * 100) / Math.max(1, px)) * 10) / 10;
  return min > ZEICHEN.strokeWidth ? { strokeWidth: min, outlineWidth: ZEICHEN.outlineWidth } : ZEICHEN_STRICH;
}

/** Schriftgrösse von Zusatz und Zeitfähnchen: 12 px, in der Präsentation 16 px */
export function beschriftungPx(g: ZeichenGroesse | undefined): number {
  return g?.praesentation ? ZEICHEN.beschriftungPraesentationPx : ZEICHEN.beschriftungPx;
}

/** Meter je Bildschirmpixel einer Leaflet-Karte (LV95-CRS: Massstab = 1 / Auflösung) */
export function mPerPxOf(map: { getZoom(): number; options: { crs?: { scale(z: number): number } } }): number {
  const crs = map.options.crs;
  return crs ? 1 / crs.scale(map.getZoom()) : 10;
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
