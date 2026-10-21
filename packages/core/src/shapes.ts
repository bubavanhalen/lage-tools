/**
 * Flächen- und Linienzeichen (Minenfeld, Bereitstellungsraum, Stacheldraht, Phasenlinie, Achse …).
 *
 * Automatische Form aus dem Ort der Meldung:
 * - Fläche: Planquadrat bzw. Unterquadrant (4 % eingerückt; mehrere Felder → Hülle), NAI → NAI-Umriss,
 *   Koordinate/Karte/Ortsname → Kreis r = 150 m.
 * - Linie: auf der Strasse (`angle`) → quer zur Strasse, 60 m; mehrere Felder → durch die Feldmitten (z. B. Achse);
 *   sonst waagrecht über das Feld (bzw. in Bewegungsrichtung `dir`), über das NAI oder um den Punkt.
 * Automatische Formen (`auto: true`) werden bei jeder Darstellung aus dem aktuellen Ort neu berechnet; von Hand
 * gezeichnete (`auto: false`) bleiben, wie sie sind. Keine Laufzeit-Abhängigkeiten.
 */
import { pointInRing, ringArea, ringCentroid } from "./geo";
import type { LV95 } from "./lv95";
import type { Area, EventShape, LageEvent, Side } from "./model";
import { cellBounds, findCells, type Bounds, type RasterSheet } from "./raster";
import { catalogEntry, type Geometry, type ShapeStyle } from "./catalog";

export interface ShapeContext {
  sheets: RasterSheet[];
  areas: Area[];
}

/** Einzug der automatischen Fläche im Feld (Anteil der Feldbreite) */
export const SHAPE_INSET = 0.04;
/** Radius der automatischen Fläche um einen Punkt (m) */
export const SHAPE_RADIUS = 150;
/** Länge einer automatischen Linie quer zur Strasse (m) */
export const ROAD_LINE_LENGTH = 60;

/** Geometrie eines Zeichens aus dem Katalog (unbekannt / alt: Punkt) */
export function geometryOf(sym: string): Geometry {
  return catalogEntry(sym)?.geometry ?? "punkt";
}

/** Darstellungsart (Muster/Linienart) eines Flächen- oder Linienzeichens */
export function shapeStyleOf(sym: string): ShapeStyle {
  const c = catalogEntry(sym);
  return c?.style ?? (c?.geometry === "linie" ? "grenze" : "rand");
}

type Loc = Pick<LageEvent, "sym" | "pos" | "cells" | "nai" | "where" | "angle" | "dir">;

const inset = (b: Bounds, f = SHAPE_INSET): Bounds => {
  const dx = (b.maxE - b.minE) * f, dy = (b.maxN - b.minN) * f;
  return { minE: b.minE + dx, maxE: b.maxE - dx, minN: b.minN + dy, maxN: b.maxN - dy };
};
const rect = (b: Bounds): LV95[] => [
  { e: b.minE, n: b.maxN }, { e: b.maxE, n: b.maxN }, { e: b.maxE, n: b.minN }, { e: b.minE, n: b.minN },
];

/** Felder der Meldung (Bezeichnungen wie «AG13 C») als Rechtecke */
function cellRects(cells: string[] | undefined, sheets: RasterSheet[]): Bounds[] {
  const out: Bounds[] = [];
  for (const label of cells ?? []) {
    const c = findCells(label, sheets)[0];
    const s = c && sheets.find((x) => x.id === c.sheetId);
    if (c && s) out.push(cellBounds(s, c.col, c.row, c.quadrant));
  }
  return out;
}

/** Kreis-Polygon (24 Ecken) */
export function circleRing(c: LV95, r = SHAPE_RADIUS, n = 24): LV95[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return { e: c.e + r * Math.sin(a), n: c.n + r * Math.cos(a) };
  });
}

/** konvexe Hülle (Andrew), im Uhrzeigersinn ab oben links ist egal */
export function convexHull(pts: LV95[]): LV95[] {
  const p = [...pts].sort((a, b) => a.e - b.e || a.n - b.n);
  if (p.length < 3) return p;
  const cross = (o: LV95, a: LV95, b: LV95) => (a.e - o.e) * (b.n - o.n) - (a.n - o.n) * (b.e - o.e);
  const lower: LV95[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q); }
  const upper: LV95[] = [];
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Woher stammt der Ort? «raster», «nai» oder «punkt» (Koordinate, Karte, Ortsname, letzter Standort) */
function locKind(e: Loc, ctx: ShapeContext): "raster" | "nai" | "punkt" | null {
  const where = (e.where ?? "").split(" · ")[0]!.trim();
  const area = e.nai ? ctx.areas.find((a) => a.name === e.nai) : undefined;
  if (where) {
    if (e.cells?.length && e.cells.some((c) => c.toUpperCase() === where.toUpperCase())) return "raster";
    if (area && where === area.name) return "nai";
    return e.pos ? "punkt" : null;
  }
  if (e.cells?.length) return "raster";
  if (area) return "nai";
  return e.pos ? "punkt" : null;
}

const bbox = (pts: LV95[]): Bounds => ({
  minE: Math.min(...pts.map((p) => p.e)), maxE: Math.max(...pts.map((p) => p.e)),
  minN: Math.min(...pts.map((p) => p.n)), maxN: Math.max(...pts.map((p) => p.n)),
});

/** Linie durch `c` in Richtung `deg` (0 = Nord, 90 = Ost), Länge `len` */
const lineThrough = (c: LV95, deg: number, len: number): LV95[] => {
  const a = (deg * Math.PI) / 180, h = len / 2;
  const de = Math.sin(a) * h, dn = Math.cos(a) * h;
  return [{ e: c.e - de, n: c.n - dn }, { e: c.e + de, n: c.n + dn }];
};

/** Länge einer Linie ohne Strassenbezug um einen Punkt: Hindernis kurz, Führungslinie länger */
const pointLineLength = (style: ShapeStyle) => (style === "draht" || style === "sperre" || style === "graben" ? ROAD_LINE_LENGTH * 2 : 400);

/**
 * Automatische Form aus dem Ort (siehe Kopfkommentar); undefined bei Punktzeichen oder ohne Ort.
 */
export function autoShape(e: Loc, ctx: ShapeContext): EventShape | undefined {
  const geo = geometryOf(e.sym);
  if (geo === "punkt") return undefined;
  const kind = locKind(e, ctx);
  if (!kind) return undefined;
  const rects = kind === "raster" ? cellRects(e.cells, ctx.sheets) : [];
  const area = kind === "nai" ? ctx.areas.find((a) => a.name === e.nai) : undefined;
  if (geo === "flaeche") {
    if (rects.length === 1) return { kind: "flaeche", pts: rect(inset(rects[0]!)), auto: true };
    if (rects.length > 1) return { kind: "flaeche", pts: convexHull(rects.flatMap((b) => rect(inset(b)))), auto: true };
    if (area && area.ring.length >= 3) return { kind: "flaeche", pts: area.ring.map((p) => ({ ...p })), auto: true };
    if (e.pos) return { kind: "flaeche", pts: circleRing(e.pos), auto: true };
    return undefined;
  }
  // Linie
  const style = shapeStyleOf(e.sym);
  if (e.angle !== undefined && isFinite(e.angle) && e.pos) {
    return { kind: "linie", pts: lineThrough(e.pos, e.angle + 90, ROAD_LINE_LENGTH), auto: true };
  }
  if (rects.length > 1) {
    const pts = rects.map((b) => ({ e: (b.minE + b.maxE) / 2, n: (b.minN + b.maxN) / 2 }));
    return { kind: "linie", pts, auto: true };
  }
  const b = rects[0] ? inset(rects[0]) : area ? inset(bbox(area.ring), 0.1) : undefined;
  if (b) {
    const c = rects[0] || !area ? { e: (b.minE + b.maxE) / 2, n: (b.minN + b.maxN) / 2 } : naiCenter(area);
    const w = b.maxE - b.minE;
    if (e.dir !== undefined && isFinite(e.dir)) return { kind: "linie", pts: lineThrough(c, e.dir, w), auto: true };
    return { kind: "linie", pts: [{ e: b.minE, n: c.n }, { e: b.maxE, n: c.n }], auto: true };
  }
  if (e.pos) return { kind: "linie", pts: lineThrough(e.pos, e.dir ?? 90, pointLineLength(style)), auto: true };
  return undefined;
}

function naiCenter(a: Area): LV95 {
  const xy = a.ring.map((p) => ({ x: p.e, y: p.n }));
  const c = ringCentroid(xy);
  return pointInRing(c, xy) ? { e: c.x, n: c.y } : a.ring[0]!;
}

/**
 * Form zur Darstellung: von Hand gezeichnet hat Vorrang; sonst automatisch aus dem aktuellen Ort (ältere Meldungen
 * ohne `shape` bekommen so auch eine Form); geht das nicht (kein Ort) oder wurde das Zeichen auf der Karte verschoben
 * («Karte», Form mitverschoben), die gespeicherte automatische Form.
 */
export function eventShape(e: Loc & Pick<LageEvent, "shape">, ctx: ShapeContext): EventShape | undefined {
  const stored = validShape(e.shape) ? e.shape : undefined;
  if (stored && !stored.auto) return stored;
  if (geometryOf(e.sym) === "punkt") return stored;
  // auf der Karte verschoben: die mitverschobene Form behalten (`relocatePatch`), sonst Kreis um den neuen Ort
  if (stored && e.where === "Karte") return stored;
  return autoShape(e, ctx) ?? stored;
}

export function validShape(s: EventShape | undefined): s is EventShape {
  return !!s && (s.kind === "flaeche" ? s.pts.length >= 3 : s.kind === "linie" && s.pts.length >= 2)
    && s.pts.every((p) => isFinite(p.e) && isFinite(p.n));
}

/** Meldung mit (neu berechneter) automatischer Form; von Hand gezeichnete Form bleibt. Zum Speichern/Exportieren. */
export function withAutoShape<T extends Loc & Pick<LageEvent, "shape">>(e: T, ctx: ShapeContext): T {
  if (e.shape && !e.shape.auto) return e;
  const s = autoShape(e, ctx);
  if (!s) { if (!e.shape) return e; const { shape: _drop, ...rest } = e; return rest as T; }
  return { ...e, shape: s };
}

/** Länge eines Linienzugs (m) */
export function lineLength(pts: LV95[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i]!.e - pts[i - 1]!.e, pts[i]!.n - pts[i - 1]!.n);
  return s;
}

/** Punkt bei Anteil `f` (0–1) der Länge eines Linienzugs, mit Richtung (Grad, 0 = Nord) */
export function pointAlong(pts: LV95[], f: number): { pos: LV95; deg: number } {
  const total = lineLength(pts);
  let rest = Math.max(0, Math.min(1, f)) * total;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const l = Math.hypot(b.e - a.e, b.n - a.n);
    if (rest <= l || i === pts.length - 1) {
      const t = l ? Math.min(1, rest / l) : 0;
      return { pos: { e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t }, deg: ((Math.atan2(b.e - a.e, b.n - a.n) * 180) / Math.PI + 360) % 360 };
    }
    rest -= l;
  }
  return { pos: pts[0]!, deg: 0 };
}

/**
 * Ort des Punktzeichens: Fläche → Schwerpunkt (liegt er ausserhalb, z. B. bei U-Form: Mitte der Eckpunkte bzw.
 * erster Punkt), Linie → Mitte der Länge.
 */
export function shapeCenter(s: EventShape): LV95 {
  if (s.kind === "linie") return pointAlong(s.pts, 0.5).pos;
  const xy = s.pts.map((p) => ({ x: p.e, y: p.n }));
  const c = polygonCentroid(xy);
  if (pointInRing(c, xy)) return { e: c.x, n: c.y };
  const m = ringCentroid(xy);
  return pointInRing(m, xy) ? { e: m.x, n: m.y } : s.pts[0]!;
}

function polygonCentroid(r: Array<{ x: number; y: number }>): { x: number; y: number } {
  const a = ringArea(r);
  if (!a) return ringCentroid(r);
  let cx = 0, cy = 0, s = 0;
  const o = r[0]!;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!, q = r[(i + 1) % r.length]!;
    const f = (p.x - o.x) * (q.y - o.y) - (q.x - o.x) * (p.y - o.y);
    cx += (p.x - o.x + q.x - o.x) * f; cy += (p.y - o.y + q.y - o.y) * f; s += f;
  }
  return s ? { x: o.x + cx / (3 * s), y: o.y + cy / (3 * s) } : ringCentroid(r);
}

/** Form verschieben (z. B. wenn das Zeichen auf der Karte gezogen wird und die Form von Hand gezeichnet ist) */
export function translateShape(s: EventShape, from: LV95, to: LV95): EventShape {
  const de = to.e - from.e, dn = to.n - from.n;
  return { ...s, pts: s.pts.map((p) => ({ e: p.e + de, n: p.n + dn })) };
}

/**
 * Kurzname für die Beschriftung: erster Teil des Katalognamens, z. B. «Minensperre», «Kontaktlinie».
 * Achse nach Seite: Feind «Vormarschachse», eigene (und ohne Angabe) «Verschiebungsachse».
 */
export function shapeShortName(sym: string, side?: Side): string {
  if (sym === "achse") return side === "rot" ? "Vormarschachse" : "Verschiebungsachse";
  const n = catalogEntry(sym)?.name ?? sym;
  const first = n.split(" / ")[0]!.replace(/\s*\(.*\)$/, "").trim();
  // «Front-/Kontaktlinie» → «Kontaktlinie»
  return first.includes("-/") ? first.split("-/")[1]!.replace(/^./, (c) => c.toUpperCase()) : first;
}
