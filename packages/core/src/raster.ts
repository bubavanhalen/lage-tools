/**
 * Führungsraster auf LV95.
 *
 * Zwei Varianten:
 * - «blatt» (Standard): Gesamtblatt + Detailblätter mit Codenamen.
 *   Spalten zweibuchstabig mit Blatt-Präfix (AA–AU, UA–UU), Zeilen 1–15. Bezeichnung «UK7».
 * - «feld»: ein Blatt, Zeilen A–Z, AA–AD …, Spalten 1–30. Bezeichnung «W18».
 *
 * Optional Unterquadranten A B / D C (A oben links, B oben rechts, C unten rechts, D unten links),
 * z. B. «UK7 C» oder «O20 (C)».
 */
import type { LV95 } from "./lv95";

export type RasterVariant = "blatt" | "feld";
export type Quadrant = "A" | "B" | "C" | "D";

export interface RasterSheet {
  id: string;
  /** Codename, z. B. «GESAMT», «URANUS», «STEIN» */
  name: string;
  variant: RasterVariant;
  /** Ecke oben links (LV95) */
  origin: LV95;
  /** Feldbreite / -höhe in Metern */
  cellW: number;
  cellH: number;
  colLabels: string[];
  rowLabels: string[];
  /** Reihenfolge in der Feldbezeichnung: «UK7» = Spalte+Zeile, «W18» = Zeile+Spalte */
  labelOrder: "col-row" | "row-col";
  quadrants: boolean;
  basemap: "lk" | "img";
  classification: string;
  /** Länge des Massstabsbalkens in Metern */
  scaleBar: number;
  /** Referenzkreuz (LV95), auf dem Blatt mit Koordinaten beschriftet */
  reference?: LV95;
}

export interface CellRef {
  sheetId: string;
  col: number; // 0-basiert
  row: number; // 0-basiert
  quadrant?: Quadrant;
  label: string; // z. B. «UK7 C»
}

export interface Bounds {
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A, B, …, Z, AA, AB, … (wie Excel-Spalten) */
export function letterLabel(i: number): string {
  let s = "";
  let k = i + 1;
  while (k > 0) {
    const r = (k - 1) % 26;
    s = LETTERS[r] + s;
    k = Math.floor((k - 1) / 26);
  }
  return s;
}

let idCounter = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export interface BlattOptions {
  name: string;
  /** Blatt-Präfix, z. B. «A» für das Gesamtblatt, «U» für URANUS */
  prefix: string;
  /** Mittelpunkt des Blattes */
  center: LV95;
  /** Feldgrösse in Metern (quadratisch) */
  cellSize: number;
  cols?: number;
  rows?: number;
  basemap?: "lk" | "img";
  classification?: string;
  quadrants?: boolean;
}

/** Blatt der Standardvariante: 21 Spalten × 15 Zeilen. */
export function makeBlattSheet(o: BlattOptions): RasterSheet {
  const cols = o.cols ?? 21;
  const rows = o.rows ?? 15;
  if (cols > 26) throw new Error("Variante «blatt»: höchstens 26 Spalten pro Blatt");
  const origin = { e: o.center.e - (cols * o.cellSize) / 2, n: o.center.n + (rows * o.cellSize) / 2 };
  return {
    id: newId("blatt"),
    name: o.name,
    variant: "blatt",
    origin,
    cellW: o.cellSize,
    cellH: o.cellSize,
    colLabels: Array.from({ length: cols }, (_, i) => o.prefix.toUpperCase() + LETTERS[i]),
    rowLabels: Array.from({ length: rows }, (_, i) => String(i + 1)),
    labelOrder: "col-row",
    quadrants: o.quadrants ?? true,
    basemap: o.basemap ?? "lk",
    classification: o.classification ?? "INTERN",
    scaleBar: niceScaleBar(o.cellSize * 5),
  };
}

export interface FeldOptions {
  name: string;
  /** Ecke oben links */
  origin: LV95;
  cellW: number;
  cellH: number;
  rows?: number;
  cols?: number;
  basemap?: "lk" | "img";
  classification?: string;
  quadrants?: boolean;
}

/** Blatt der Variante «feld»: Zeilen mit Buchstaben, Spalten mit Zahlen. */
export function makeFeldSheet(o: FeldOptions): RasterSheet {
  const rows = o.rows ?? 30;
  const cols = o.cols ?? 30;
  return {
    id: newId("feld"),
    name: o.name,
    variant: "feld",
    origin: o.origin,
    cellW: o.cellW,
    cellH: o.cellH,
    colLabels: Array.from({ length: cols }, (_, i) => String(i + 1)),
    rowLabels: Array.from({ length: rows }, (_, i) => letterLabel(i)),
    labelOrder: "row-col",
    quadrants: o.quadrants ?? true,
    basemap: o.basemap ?? "lk",
    classification: o.classification ?? "INTERN",
    scaleBar: niceScaleBar(o.cellW * 3),
  };
}

/** Rundet auf einen «schönen» Massstabsbalken (100, 200, 250, 400, 500, 1000, 2000, …). */
export function niceScaleBar(m: number): number {
  const steps = [100, 200, 250, 400, 500, 1000, 2000, 2500, 4000, 5000, 10000, 20000];
  return steps.reduce((best, s) => (Math.abs(s - m) < Math.abs(best - m) ? s : best), steps[0]!);
}

export function sheetBounds(s: RasterSheet): Bounds {
  return {
    minE: s.origin.e,
    maxE: s.origin.e + s.colLabels.length * s.cellW,
    maxN: s.origin.n,
    minN: s.origin.n - s.rowLabels.length * s.cellH,
  };
}

export function cellBounds(s: RasterSheet, col: number, row: number, quadrant?: Quadrant): Bounds {
  const minE = s.origin.e + col * s.cellW;
  const maxN = s.origin.n - row * s.cellH;
  const b = { minE, maxE: minE + s.cellW, maxN, minN: maxN - s.cellH };
  if (!quadrant) return b;
  const midE = (b.minE + b.maxE) / 2;
  const midN = (b.minN + b.maxN) / 2;
  const left = quadrant === "A" || quadrant === "D";
  const top = quadrant === "A" || quadrant === "B";
  return {
    minE: left ? b.minE : midE,
    maxE: left ? midE : b.maxE,
    minN: top ? midN : b.minN,
    maxN: top ? b.maxN : midN,
  };
}

export function boundsCenter(b: Bounds): LV95 {
  return { e: (b.minE + b.maxE) / 2, n: (b.minN + b.maxN) / 2 };
}

export function cellLabel(s: RasterSheet, col: number, row: number, quadrant?: Quadrant): string {
  const c = s.colLabels[col] ?? "?";
  const r = s.rowLabels[row] ?? "?";
  const base = s.labelOrder === "col-row" ? c + r : r + c;
  return quadrant ? `${base} ${quadrant}` : base;
}

/** Feld (und Unterquadrant) zu einer Koordinate; null, wenn ausserhalb des Blattes. */
export function cellAt(s: RasterSheet, p: LV95, withQuadrant = s.quadrants): CellRef | null {
  const col = Math.floor((p.e - s.origin.e) / s.cellW);
  const row = Math.floor((s.origin.n - p.n) / s.cellH);
  if (col < 0 || row < 0 || col >= s.colLabels.length || row >= s.rowLabels.length) return null;
  let quadrant: Quadrant | undefined;
  if (withQuadrant) {
    const fx = (p.e - s.origin.e) / s.cellW - col;
    const fy = (s.origin.n - p.n) / s.cellH - row;
    quadrant = fy < 0.5 ? (fx < 0.5 ? "A" : "B") : fx < 0.5 ? "D" : "C";
  }
  return { sheetId: s.id, col, row, quadrant, label: cellLabel(s, col, row, quadrant) };
}

/** Sucht das kleinste (detaillierteste) Blatt, das die Koordinate enthält. */
export function cellAtAny(sheets: RasterSheet[], p: LV95): CellRef | null {
  const hits = sheets
    .map((s) => ({ s, c: cellAt(s, p) }))
    .filter((x): x is { s: RasterSheet; c: CellRef } => !!x.c)
    .sort((a, b) => a.s.cellW * a.s.cellH - b.s.cellW * b.s.cellH);
  return hits[0]?.c ?? null;
}

const PHONETIC: Record<string, Quadrant> = { ALPHA: "A", ALFA: "A", BRAVO: "B", CHARLIE: "C", DELTA: "D" };

export interface FoundCell extends CellRef {
  raw: string;
  index: number;
}

export interface ParseCellOptions {
  /** Begriffe, die keine Planquadrate sind (z. B. Truppbezeichnungen «H10») */
  exclude?: string[];
}

/**
 * Findet Planquadrat-Bezeichnungen in einem Freitext, z. B. «W18», «PQ: O20 (C)», «G 19 Delta», «UK7 C», «O21,22».
 * Zahlen mit führender Null (H01, H04) werden nicht als Planquadrat gelesen. «AR11, 1 Verwundeter»: die Zahl nach dem
 * Komma ist eine Anzahl (es folgt ein Wort), kein zweites Planquadrat.
 */
export function findCells(text: string, sheets: RasterSheet[], opts: ParseCellOptions = {}): FoundCell[] {
  const exclude = new Set((opts.exclude ?? []).map((x) => x.toUpperCase().replace(/\s/g, "")));
  const out: FoundCell[] = [];
  const quadRe = String.raw`(?:\s*\(\s*([ABCD])\s*\)|\s*(?:-|\s)\s*(ALPHA|ALFA|BRAVO|CHARLIE|DELTA)\b|(?:\s+|(?<=\d))([ABCD])\b(?![-'’]))?`;
  const upper = text.toUpperCase();
  for (const s of sheets) {
    const letters = s.labelOrder === "col-row" ? s.colLabels : s.rowLabels;
    const numbers = s.labelOrder === "col-row" ? s.rowLabels : s.colLabels;
    const letterAlt = [...letters].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
    const re = new RegExp(String.raw`(?<![A-ZÄÖÜ0-9])(${letterAlt})\s?-?\s?([1-9]\d?)(?:\s*,\s*([1-9]\d?)(?![0-9])(?!\s+(?![ABCD](?![A-ZÄÖÜ]))[A-ZÄÖÜ]{2,}))?(?![0-9])` + quadRe, "g");
    for (const m of upper.matchAll(re)) {
      const letter = m[1]!;
      const nums = [m[2]!, m[3]].filter(Boolean) as string[];
      const qRaw = m[4] ?? m[5] ?? m[6];
      const quadrant = qRaw ? (qRaw.length > 1 ? PHONETIC[qRaw] : (qRaw as Quadrant)) : undefined;
      for (const nStr of nums) {
        const li = letters.indexOf(letter);
        const ni = numbers.indexOf(nStr);
        if (li < 0 || ni < 0) continue;
        const col = s.labelOrder === "col-row" ? li : ni;
        const row = s.labelOrder === "col-row" ? ni : li;
        const label = cellLabel(s, col, row);
        if (exclude.has(label) || exclude.has(letter + nStr)) continue;
        const rawPrefix = text.slice(m.index!, m.index! + 4).toUpperCase().replace(/\s/g, "");
        if (exclude.has(rawPrefix)) continue;
        out.push({ sheetId: s.id, col, row, quadrant, label: cellLabel(s, col, row, quadrant), raw: text.slice(m.index!, m.index! + m[0].length), index: m.index! });
      }
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Beispielraster (fiktiv, Raum Bern) für Demo und Tests – keine Übungsdaten. */
export function demoFeldSheet(): RasterSheet {
  return makeFeldSheet({
    name: "DEMO",
    origin: { e: 2592000, n: 1206000 },
    cellW: 500,
    cellH: 500,
    rows: 24,
    cols: 30,
  });
}
