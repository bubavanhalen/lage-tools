/**
 * Geometrie für die Hinweise: Grundfeld (Planquadrat ohne Unterquadrant), Nachbarschaft im Raster,
 * Abstand zu einer Fläche. Alles in LV95, ohne Abhängigkeiten.
 */
import { pointInRing } from "./geo";
import type { LV95 } from "./lv95";
import { cellLabel, type RasterSheet } from "./raster";

/** Grundfeld eines Punkts (ohne Unterquadrant) */
export interface BaseCell {
  sheetId: string;
  col: number;
  row: number;
  /** z. B. «AK9» */
  label: string;
  /** Feldgrösse in m (für Toleranzen) */
  size: number;
}

/** Abstand, ab dem zwei Orte ohne gemeinsames Raster nicht mehr als «benachbart» gelten (m) */
export const NEIGHBOR_FALLBACK_M = 750;

/** Grundfeld im detailliertesten Blatt, das den Punkt enthält; null ausserhalb aller Blätter */
export function baseCellAt(sheets: RasterSheet[], p: LV95): BaseCell | null {
  let best: { s: RasterSheet; col: number; row: number } | null = null;
  for (const s of sheets) {
    const col = Math.floor((p.e - s.origin.e) / s.cellW);
    const row = Math.floor((s.origin.n - p.n) / s.cellH);
    if (col < 0 || row < 0 || col >= s.colLabels.length || row >= s.rowLabels.length) continue;
    if (!best || s.cellW * s.cellH < best.s.cellW * best.s.cellH) best = { s, col, row };
  }
  if (!best) return null;
  return { sheetId: best.s.id, col: best.col, row: best.row, label: cellLabel(best.s, best.col, best.row), size: Math.max(best.s.cellW, best.s.cellH) };
}

/** Distanz in m (LV95) */
export function dist(a: LV95, b: LV95): number {
  return Math.hypot(b.e - a.e, b.n - a.n);
}

/** Azimut von a nach b in Grad (0 = Nord) */
export function bearing(a: LV95, b: LV95): number {
  return ((Math.atan2(b.e - a.e, b.n - a.n) * 180) / Math.PI + 360) % 360;
}

/** kleinster Winkel zwischen zwei Richtungen (0–180°) */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export interface Located {
  pos?: LV95;
  cell?: BaseCell | null;
}

/**
 * Gleiches oder benachbartes Planquadrat (8er-Nachbarschaft im selben Blatt).
 * Ohne gemeinsames Blatt: Abstand ≤ `NEIGHBOR_FALLBACK_M`.
 */
export function sameOrNeighbor(a: Located, b: Located): boolean {
  if (a.cell && b.cell && a.cell.sheetId === b.cell.sheetId) {
    return Math.abs(a.cell.col - b.cell.col) <= 1 && Math.abs(a.cell.row - b.cell.row) <= 1;
  }
  if (a.pos && b.pos) return dist(a.pos, b.pos) <= NEIGHBOR_FALLBACK_M;
  return false;
}

/** Gleiches Grundfeld */
export function sameCell(a: Located, b: Located): boolean {
  if (a.cell && b.cell) return a.cell.sheetId === b.cell.sheetId && a.cell.col === b.cell.col && a.cell.row === b.cell.row;
  return false;
}

/** Abstand eines Punkts zu einer Fläche (0 = innerhalb), m */
export function distToRing(p: LV95, ring: LV95[]): number {
  if (ring.length < 3) return ring[0] ? dist(p, ring[0]) : Infinity;
  if (pointInRing({ x: p.e, y: p.n }, ring.map((q) => ({ x: q.e, y: q.n })))) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const de = b.e - a.e, dn = b.n - a.n;
    const len2 = de * de + dn * dn;
    const u = len2 ? Math.max(0, Math.min(1, ((p.e - a.e) * de + (p.n - a.n) * dn) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.e - (a.e + u * de), p.n - (a.n + u * dn)));
  }
  return best;
}

/** Schwerpunkt mehrerer Punkte (gerundet) */
export function centroid(ps: LV95[]): LV95 | undefined {
  if (!ps.length) return undefined;
  const e = ps.reduce((s, p) => s + p.e, 0) / ps.length;
  const n = ps.reduce((s, p) => s + p.n, 0) / ps.length;
  return { e: Math.round(e), n: Math.round(n) };
}
