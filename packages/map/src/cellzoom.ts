/**
 * Navigation im Führungsraster:
 * - Doppelklick in ein Feld zoomt auf das Feld; nochmals Doppelklick im bereits gefüllten Feld → Unterquadrant;
 *   ausserhalb des Rasters normales Hineinzoomen (Umschalt + Doppelklick = Herauszoomen).
 * - `flyToBoundsSharp`: Bereich so einpassen, dass die swisstopo-Kacheln scharf bleiben.
 *
 * Schärfe: Leaflet zeigt bei gebrochener Zoomstufe die Kacheln der *gerundeten* Stufe skaliert an.
 * Bei x.25 werden die Kacheln der Stufe x um ca. 10–20 % vergrössert (unscharf), bei x.5 und x.75 die der
 * Stufe x+1 verkleinert (scharf). Deshalb werden Zielstufen x.25 auf x.5 (wenn es passt) bzw. x.0 gelegt.
 */
import L from "leaflet";
import { cellAt, cellAtAny, cellBounds, type Bounds, type CellRef, type LV95, type RasterSheet } from "@lage/core";
import { isMeasuring } from "./measure";
import { toLatLng, toLv95 } from "./swissmap";

/** Rand in Pixeln: oben, rechts, unten, links */
export type NavPadding = [number, number, number, number];
/** Standardrand: oben Platz für Suchfeld/Werkzeuge, unten für Statuszeile */
export const NAV_PADDING: NavPadding = [64, 28, 44, 28];

/** Rand an kleine Karten anpassen (höchstens 40 % der Breite/Höhe pro Seite). */
function fitPadding(map: L.Map, pad: NavPadding): NavPadding {
  const s = map.getSize();
  const cx = (v: number) => Math.min(v, s.x * 0.4), cy = (v: number) => Math.min(v, s.y * 0.4);
  return [cy(pad[0]), cx(pad[1]), cy(pad[2]), cx(pad[3])];
}

/** Platz, den die Bedienelemente oben rechts (`.maptools` neben der Karte) belegen. */
function toolsBox(map: L.Map): { w: number; h: number } | null {
  const c = map.getContainer();
  const t = c.parentElement?.querySelector<HTMLElement>(".maptools");
  if (!t || !t.offsetParent) return null;
  const r = t.getBoundingClientRect(), m = c.getBoundingClientRect();
  if (r.width === 0) return null;
  return { w: Math.max(0, m.right - r.left), h: Math.max(0, r.bottom - m.top) };
}

/**
 * Rand für das Einpassen: entweder unter den Werkzeugen oben rechts (Bereich mittig) oder links davon
 * (Bereich nach links verschoben) – je nachdem, was den Bereich grösser zeigt.
 */
export function navPadding(map: L.Map, b: Bounds): NavPadding {
  const t = toolsBox(map);
  if (!t) return NAV_PADDING;
  const below: NavPadding = [Math.max(28, t.h + 10), 28, 44, 28];
  const beside: NavPadding = [28, Math.max(28, t.w + 12), 44, 28];
  return rawZoom(map, b, beside) > rawZoom(map, b, below) + 0.01 ? beside : below;
}

function rawZoom(map: L.Map, b: Bounds, pad: NavPadding): number {
  const p = fitPadding(map, pad);
  const size = map.getSize().subtract(L.point(p[1] + p[3], p[0] + p[2]));
  const z0 = map.getZoom();
  const bs = pxSize(map, b, z0);
  const z = map.getScaleZoom(Math.min(size.x / Math.max(1, bs.x), size.y / Math.max(1, bs.y)), z0);
  return isFinite(z) ? z : map.getMaxZoom();
}

/** Bildschirmgrösse (px) eines LV95-Bereichs bei Zoomstufe z. */
function pxSize(map: L.Map, b: Bounds, z: number): L.Point {
  const a = map.project(toLatLng({ e: b.minE, n: b.maxN }), z);
  const c = map.project(toLatLng({ e: b.maxE, n: b.minN }), z);
  return L.point(Math.abs(c.x - a.x), Math.abs(c.y - a.y));
}

/**
 * Zoomstufe, bei der `b` mit Rand `pad` ganz sichtbar ist – auf eine scharfe Stufe gelegt (siehe oben).
 * @param maxZoom obere Grenze (z. B. damit ein Punkt nicht bis auf 10 cm/px gezoomt wird)
 */
export function sharpZoomFor(map: L.Map, b: Bounds, pad: NavPadding = navPadding(map, b), maxZoom = map.getMaxZoom()): number {
  // wie map.getBoundsZoom, aber immer auf zoomSnap (Leaflet rundet ohne CSS-3D auf ganze Stufen)
  const snap = map.options.zoomSnap || 0.25;
  let z = rawZoom(map, b, pad);
  z = Math.floor(Math.round(z / (snap / 100)) * (snap / 100) / snap) * snap;
  z = Math.min(z, maxZoom);
  const base = Math.floor(z + 1e-6);
  const frac = z - base;
  if (frac > 0.01 && frac < 0.49) {
    // eine Viertelstufe höher (x.5) nehmen, wenn der Bereich dabei höchstens den halben Rand braucht
    const up = base + 0.5;
    const p = fitPadding(map, pad);
    const full = map.getSize();
    const s = pxSize(map, b, up);
    z = up <= maxZoom && s.x <= full.x - (p[1] + p[3]) / 2 && s.y <= full.y - (p[0] + p[2]) / 2 ? up : base;
  }
  return Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), z));
}

export interface FlyOptions {
  padding?: NavPadding;
  maxZoom?: number;
  /** Sekunden (Standard 0.6); 0 = ohne Animation */
  duration?: number;
}

/** Fliegt auf einen LV95-Bereich (Feld, Unterquadrant, NAI …), scharf und mit Rand für die Bedienelemente. */
export function flyToBoundsSharp(map: L.Map, b: Bounds, o: FlyOptions = {}): void {
  const pad = fitPadding(map, o.padding ?? navPadding(map, b));
  const z = sharpZoomFor(map, b, pad, o.maxZoom);
  // Mitte unter Berücksichtigung des ungleichen Rands (wie Leaflet `_getBoundsCenterZoom`)
  const off = L.point((pad[1] - pad[3]) / 2, (pad[2] - pad[0]) / 2);
  const a = map.project(toLatLng({ e: b.minE, n: b.minN }), z);
  const c = map.project(toLatLng({ e: b.maxE, n: b.maxN }), z);
  const center = map.unproject(a.add(c).divideBy(2).add(off), z);
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = o.duration ?? 0.6;
  if (duration <= 0 || reduce) map.setView(center, z, { animate: false });
  else map.flyTo(center, z, { duration });
}

/** Bereich rund um einen Punkt: halbe Seitenlänge in Metern. */
export function boundsAround(p: LV95, half: number): Bounds {
  return { minE: p.e - half, maxE: p.e + half, minN: p.n - half, maxN: p.n + half };
}

// ---------- Feld-Zoom ----------

const registry = new WeakMap<L.Map, () => RasterSheet[]>();

/** Ist der Bereich bereits bildschirmfüllend gezeigt (Zoom ≈ Ziel, Mitte nahe der Kartenmitte)? */
function isFilled(map: L.Map, b: Bounds): boolean {
  const target = sharpZoomFor(map, b);
  if (map.getZoom() < target - 0.3) return false;
  if (map.getZoom() > target + 0.3) return true; // schon näher dran als «gefüllt»
  const size = map.getSize();
  const c = map.latLngToContainerPoint(toLatLng({ e: (b.minE + b.maxE) / 2, n: (b.minN + b.maxN) / 2 }));
  return Math.abs(c.x - size.x / 2) < size.x * 0.25 && Math.abs(c.y - size.y / 2) < size.y * 0.25;
}

export type CellZoomLevel = "feld" | "quadrant" | "auto";

export interface CellZoomResult {
  cell: CellRef;
  bounds: Bounds;
  level: "feld" | "quadrant";
}

/**
 * Zoomt auf das Feld (bzw. den Unterquadranten) an `p`.
 * «auto»: Feld; ist das Feld schon gefüllt → Unterquadrant; ist auch der gefüllt → null (normal zoomen).
 * @returns was angezeigt wird, oder null (ausserhalb des Rasters / nichts mehr zu tun)
 */
export function zoomToCell(map: L.Map, p: LV95, level: CellZoomLevel = "auto", sheets?: RasterSheet[]): CellZoomResult | null {
  const sh = sheets ?? registry.get(map)?.() ?? [];
  const ref = cellAtAny(sh, p);
  if (!ref) return null;
  const s = sh.find((x) => x.id === ref.sheetId)!;
  const feld = cellBounds(s, ref.col, ref.row);
  const q = cellAt(s, p, true)!.quadrant!;
  const quad = cellBounds(s, ref.col, ref.row, q);
  let lvl: "feld" | "quadrant";
  if (level === "feld") lvl = "feld";
  else if (level === "quadrant") lvl = "quadrant";
  else if (!isFilled(map, feld)) lvl = "feld";
  else if (!isFilled(map, quad)) lvl = "quadrant";
  else return null;
  const bounds = lvl === "feld" ? feld : quad;
  flyToBoundsSharp(map, bounds, { duration: 0.45 });
  const label = lvl === "feld" ? cellAt(s, p, false)!.label : `${cellAt(s, p, false)!.label} ${q}`;
  return { cell: { ...ref, quadrant: lvl === "quadrant" ? q : undefined, label }, bounds, level: lvl };
}

/** Feld in der Kartenmitte (für die Werkzeugleiste). */
export function zoomToCellAtCenter(map: L.Map, level: CellZoomLevel = "auto"): CellZoomResult | null {
  return zoomToCell(map, toLv95(map.getCenter()), level);
}

/**
 * Doppelklick in ein Feld zoomt auf das Feld, nochmals → Unterquadrant, sonst normal hineinzoomen.
 * Erwartet `map.doubleClickZoom.disable()`.
 * @returns Funktion zum Abmelden
 */
export function enableCellZoom(map: L.Map, getSheets: () => RasterSheet[]): () => void {
  registry.set(map, getSheets);
  const onDbl = (ev: L.LeafletMouseEvent) => {
    if (isMeasuring(map)) return;
    const oe = ev.originalEvent;
    if (oe?.shiftKey) {
      map.setZoomAround(ev.containerPoint, map.getZoom() - 1);
      return;
    }
    const hit = zoomToCell(map, toLv95(ev.latlng), "auto", getSheets());
    if (!hit) map.setZoomAround(ev.containerPoint, Math.min(map.getMaxZoom(), Math.round(map.getZoom()) + 1));
  };
  map.on("dblclick", onDbl);
  return () => {
    map.off("dblclick", onDbl);
    registry.delete(map);
  };
}
