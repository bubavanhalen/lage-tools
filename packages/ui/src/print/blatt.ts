/**
 * Blatt der Lagekarte (Spez. MVP 3, Kap. 2.9): Masse A4/A3 quer, Kartenfeld, Legende (A4 Band unten, A3 Spalte
 * rechts), Ausschnitt auf Papierverhältnis erweitern. Rein, ohne Leaflet und jsPDF.
 */
import { sheetBounds, type Exercise } from "@lage/core";
import type { Bounds } from "../tiles";
import type { LagekarteDruck } from "../shell/contracts";

export interface BlattLayout {
  pw: number; ph: number;
  /** Kartenfeld (mm) */
  field: { x: number; y: number; w: number; h: number };
  /** Legende: A4 Band unten, A3 Spalte rechts */
  legend: { x: number; y: number; w: number; h: number; band: boolean };
}

export const RAND = 8;
const KOPF = 9, FUSS = 6, LAB_TOP = 4, LAB_LEFT = 5;

export function blattLayout(paper: LagekarteDruck["paper"]): BlattLayout {
  if (paper === "A3") {
    const pw = 420, ph = 297, lw = 60;
    const x = RAND + LAB_LEFT, y = RAND + KOPF + LAB_TOP;
    const w = pw - RAND - lw - 4 - x, h = ph - RAND - FUSS - 2 - y;
    return { pw, ph, field: { x, y, w, h }, legend: { x: pw - RAND - lw, y, w: lw, h, band: false } };
  }
  // Legende: vier Zeilen Zeichen und eine Zeile Erklärung (nie abgeschnitten, Prüfung N)
  const pw = 297, ph = 210, lh = 21;
  const x = RAND + LAB_LEFT, y = RAND + KOPF + LAB_TOP;
  const w = pw - RAND - x, h = ph - RAND - FUSS - lh - 2 - y;
  return { pw, ph, field: { x, y, w, h }, legend: { x: RAND, y: y + h + 1.5, w: pw - 2 * RAND, h: lh, band: true } };
}

/** Ausschnitt auf das Verhältnis des Kartenfelds erweitern (nie beschneiden), Mitte bleibt */
export function fitAspect(b: Bounds, aspect: number): Bounds {
  const w = b.maxE - b.minE, h = b.maxN - b.minN;
  const cx = (b.minE + b.maxE) / 2, cy = (b.minN + b.maxN) / 2;
  if (w / h < aspect) { const nw = h * aspect; return { minE: cx - nw / 2, maxE: cx + nw / 2, minN: b.minN, maxN: b.maxN }; }
  const nh = w / aspect;
  return { minE: b.minE, maxE: b.maxE, minN: cy - nh / 2, maxN: cy + nh / 2 };
}

/** ganzes Raster (alle Blätter) bzw. NAI, sonst null */
export function rasterBounds(ex: Pick<Exercise, "sheets" | "areas">): Bounds | null {
  const bs = ex.sheets.map(sheetBounds);
  if (!bs.length) {
    const pts = ex.areas.flatMap((a) => a.ring);
    if (!pts.length) return null;
    return { minE: Math.min(...pts.map((p) => p.e)), maxE: Math.max(...pts.map((p) => p.e)), minN: Math.min(...pts.map((p) => p.n)), maxN: Math.max(...pts.map((p) => p.n)) };
  }
  return { minE: Math.min(...bs.map((b) => b.minE)), maxE: Math.max(...bs.map((b) => b.maxE)), minN: Math.min(...bs.map((b) => b.minN)), maxN: Math.max(...bs.map((b) => b.maxN)) };
}
