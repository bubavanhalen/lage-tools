/**
 * Übung: Raster, NAI, Elemente – Erstellen, Speichern als Datei, Laden.
 */
import { makeBlattSheet, makeFeldSheet, niceScaleBar, type RasterSheet } from "./raster";
import type { Area, Exercise } from "./model";
import type { LV95 } from "./lv95";

export const FILE_FORMAT = "lage-tools/uebung";
export const FILE_VERSION = 1;

export interface ExerciseFile {
  format: typeof FILE_FORMAT;
  version: number;
  savedAt: string;
  exercise: Exercise;
}

export function newExercise(name = "Neue Übung"): Exercise {
  return {
    id: "ex-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    days: [new Date().toISOString().slice(0, 10)],
    sheets: [],
    areas: [],
    units: { rot: [], blau: [], ul: [] },
    events: [],
    places: [],
  };
}

export function exerciseToFile(ex: Exercise): string {
  const f: ExerciseFile = { format: FILE_FORMAT, version: FILE_VERSION, savedAt: new Date().toISOString(), exercise: ex };
  return JSON.stringify(f, null, 1);
}

export function exerciseFromFile(text: string): Exercise {
  const f = JSON.parse(text) as Partial<ExerciseFile>;
  if (f.format !== FILE_FORMAT || !f.exercise) throw new Error("Keine Übungsdatei von Lage-Tools");
  if ((f.version ?? 0) > FILE_VERSION) throw new Error("Datei stammt aus einer neueren Version – bitte App aktualisieren");
  const ex = f.exercise;
  ex.sheets ??= [];
  ex.areas ??= [];
  ex.units ??= { rot: [], blau: [], ul: [] };
  ex.events ??= [];
  ex.places ??= [];
  return ex;
}

// ---------- Raster aus aufgezogenem Rechteck ----------

const NICE_CELLS = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1500, 2000];

/** Rundet eine Feldgrösse auf den nächsten «schönen» Wert nach oben. */
export function niceCellSize(m: number): number {
  return NICE_CELLS.find((v) => v >= m) ?? Math.ceil(m / 500) * 500;
}

export interface Rect {
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
}

/** Nächster freier Präfix-Buchstabe für ein Blatt (Gesamtblatt «A», danach in Reihenfolge). */
export function nextPrefix(sheets: RasterSheet[], preferred?: string): string {
  const used = new Set(sheets.filter((s) => s.variant === "blatt").map((s) => s.colLabels[0]!.slice(0, -1)));
  if (preferred && /^[A-Z]$/.test(preferred) && !used.has(preferred)) return preferred;
  for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!used.has(c)) return c;
  throw new Error("Alle Präfix-Buchstaben belegt");
}

/** Blatt-Raster (21 × 15) so, dass das Rechteck abgedeckt ist. */
export function blattFromRect(r: Rect, name: string, prefix: string, opts: { cols?: number; rows?: number; cellSize?: number } = {}): RasterSheet {
  const cols = opts.cols ?? 21;
  const rows = opts.rows ?? 15;
  const w = r.maxE - r.minE, h = r.maxN - r.minN;
  const cellSize = opts.cellSize ?? niceCellSize(Math.max(w / cols, h / rows));
  const center = { e: Math.round((r.minE + r.maxE) / 2), n: Math.round((r.minN + r.maxN) / 2) };
  const s = makeBlattSheet({ name, prefix, center, cellSize, cols, rows });
  s.reference = referencePoint(s);
  return s;
}

/** Feld-Raster: Rechteck in Felder der Grösse `cellSize` teilen (Zeilen A…, Spalten 1…). */
export function feldFromRect(r: Rect, name: string, cellSize: number): RasterSheet {
  const cols = Math.max(1, Math.ceil((r.maxE - r.minE) / cellSize));
  const rows = Math.max(1, Math.ceil((r.maxN - r.minN) / cellSize));
  const s = makeFeldSheet({ name, origin: { e: Math.round(r.minE), n: Math.round(r.maxN) }, cellW: cellSize, cellH: cellSize, rows, cols });
  s.scaleBar = niceScaleBar(cellSize * 3);
  s.reference = referencePoint(s);
  return s;
}

/** Referenzkreuz: Rasterschnittpunkt links unten (nach der 2. Spalte, 3.-letzte Zeile), wie auf den Druckvorlagen. */
export function referencePoint(s: RasterSheet): LV95 {
  const col = Math.min(2, s.colLabels.length - 1);
  const row = Math.max(0, s.rowLabels.length - 3);
  return { e: s.origin.e + col * s.cellW, n: s.origin.n - row * s.cellH };
}

/** Kurzform wie auf der Karte (LV03-Stil): 738'175 / 241'101 */
export function formatShortRef(p: LV95): string {
  const f = (v: number) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${f(p.e - 2000000)} / ${f(p.n - 1000000)}`;
}

export function areaFromRing(name: string, ring: LV95[], kind: Area["kind"] = "nai", color?: string): Area {
  return { id: "a-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, kind, ring, color };
}
