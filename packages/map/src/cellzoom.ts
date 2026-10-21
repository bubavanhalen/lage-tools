/**
 * Navigation im Führungsraster:
 * - Doppelklick in ein Feld zoomt auf das Feld; nochmals Doppelklick im bereits gefüllten Feld → Unterquadrant;
 *   ausserhalb des Rasters normales Hineinzoomen (Umschalt + Doppelklick = Herauszoomen).
 * - `flyToBoundsSharp`: Bereich so einpassen, dass die swisstopo-Kacheln scharf bleiben.
 *
 * Schärfe: Leaflet zeigt bei gebrochener Zoomstufe die Kacheln der *gerundeten* Stufe skaliert an.
 * Bei x.25 werden die Kacheln der Stufe x um ca. 10–20 % vergrössert (unscharf), bei x.5 und x.75 die der
 * Stufe x+1 verkleinert (scharf). Deshalb werden Zielstufen auf x.0 oder x.5 gelegt (die Karte hat zoomSnap 0.5).
 */
import L from "leaflet";
import { cellAt, cellAtAny, cellBounds, type Bounds, type CellRef, type LV95, type RasterSheet } from "@lage/core";
import { flashBounds, whenSettled } from "./flash";
import { isMeasuring } from "./measure";
import { toLatLng, toLv95 } from "./swissmap";

/** Rand in Pixeln: oben, rechts, unten, links */
export type NavPadding = [number, number, number, number];
/** Grundrand ohne Bedienelemente: unten Platz für die Statuszeile */
export const NAV_PADDING: NavPadding = [28, 28, 44, 28];

/**
 * Höchste Zoomstufen beim Navigieren (swisstopo-Stufen: 22 = 2,5 m/px, 23 = 2 m/px, 24 = 1,5 m/px, 25 = 1 m/px).
 * Tiefer bringt keinen Gewinn: Schrift wird riesig, der Nachbarkontext fehlt.
 */
export const NAV_MAX_ZOOM = { feld: 23, quadrant: 24, doppelklick: 25 } as const;

/** Rand an kleine Karten anpassen (höchstens 40 % der Breite/Höhe pro Seite). */
function fitPadding(map: L.Map, pad: NavPadding): NavPadding {
  const s = map.getSize();
  const cx = (v: number) => Math.min(v, s.x * 0.4), cy = (v: number) => Math.min(v, s.y * 0.4);
  return [cy(pad[0]), cx(pad[1]), cy(pad[2]), cx(pad[3])];
}

/** Bedienelemente über der Karte (im selben Container wie die Karte): Werkzeuge, Meldungsband, Legende. */
const OBSTACLES = [".maptools", ".mo-banner", "[data-legend]", ".mo-legend"];

interface Obstacle { top: number; right: number; bottom: number; left: number }

function obstacles(map: L.Map): Obstacle[] {
  const c = map.getContainer();
  const host = c.parentElement;
  if (!host) return [];
  const m = c.getBoundingClientRect();
  const seen = new Set<Element>();
  const out: Obstacle[] = [];
  for (const sel of OBSTACLES) {
    host.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (seen.has(el) || el === c || c.contains(el)) return;
      seen.add(el);
      if (!el.offsetParent) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.right <= m.left || r.left >= m.right || r.bottom <= m.top || r.top >= m.bottom) return;
      out.push({ top: r.top - m.top, right: r.right - m.left, bottom: r.bottom - m.top, left: r.left - m.left });
    });
  }
  return out;
}

/**
 * Rand für das Einpassen, so dass Werkzeuge (oben rechts), Meldungsband (oben links) und Legende (unten links)
 * den Bereich nicht verdecken. Jedes Element wird entweder vertikal (darunter/darüber) oder seitlich umgangen –
 * gewählt wird die Kombination, die den Bereich am grössten zeigt.
 */
export function navPadding(map: L.Map, b: Bounds): NavPadding {
  const size = map.getSize();
  if (!size.x || !size.y) return NAV_PADDING;
  const obs = obstacles(map);
  if (!obs.length) return [64, 28, 44, 28];
  const GAP = 10;
  let best: NavPadding = NAV_PADDING, bestZ = -Infinity;
  for (let mask = 0; mask < 1 << obs.length; mask++) {
    const p: NavPadding = [...NAV_PADDING];
    obs.forEach((o, i) => {
      const cx = (o.left + o.right) / 2, cy = (o.top + o.bottom) / 2;
      if (mask & (1 << i)) {
        // seitlich ausweichen
        if (cx > size.x / 2) p[1] = Math.max(p[1], size.x - o.left + GAP);
        else p[3] = Math.max(p[3], o.right + GAP);
      } else if (cy < size.y / 2) p[0] = Math.max(p[0], o.bottom + GAP);
      else p[2] = Math.max(p[2], size.y - o.top + GAP);
    });
    // höchstens 60 % pro Achse für Ränder, sonst bleibt zu wenig Karte
    if (p[1] + p[3] > size.x * 0.6 || p[0] + p[2] > size.y * 0.6) continue;
    const z = rawZoom(map, b, p);
    if (z > bestZ + 0.01) { bestZ = z; best = p; }
  }
  return bestZ === -Infinity ? [64, 28, 44, 28] : best;
}

function rawZoom(map: L.Map, b: Bounds, pad: NavPadding): number {
  const p = fitPadding(map, pad);
  const size = map.getSize().subtract(L.point(p[1] + p[3], p[0] + p[2]));
  if (size.x <= 0 || size.y <= 0) return map.getZoom();
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
 * Liegt sie auf x.0 (bzw. x.25), wird x.5 genommen, wenn der Bereich dann mit dem halben Rand noch passt:
 * so zeigt die Karte die feinere Kachelstufe verkleinert statt der gröberen (z. B. Übersicht nicht auf der Kleinmassstabkarte).
 * @param maxZoom obere Grenze (z. B. damit ein Punkt nicht bis auf 10 cm/px gezoomt wird)
 */
export function sharpZoomFor(map: L.Map, b: Bounds, pad: NavPadding = navPadding(map, b), maxZoom = map.getMaxZoom()): number {
  // wie map.getBoundsZoom, aber immer auf zoomSnap (Leaflet rundet ohne CSS-3D auf ganze Stufen)
  const snap = map.options.zoomSnap || 0.5;
  let z = rawZoom(map, b, pad);
  z = Math.floor(Math.round(z / (snap / 100)) * (snap / 100) / snap) * snap;
  z = Math.min(z, maxZoom);
  const base = Math.floor(z + 1e-6);
  const frac = z - base;
  if (frac < 0.49) {
    const up = base + 0.5;
    const p = fitPadding(map, pad);
    const full = map.getSize();
    const s = pxSize(map, b, up);
    const fits = up <= maxZoom && s.x <= full.x - (p[1] + p[3]) / 2 && s.y <= full.y - (p[0] + p[2]) / 2;
    z = fits ? up : base;
  }
  return Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), z));
}

export interface FlyOptions {
  padding?: NavPadding;
  maxZoom?: number;
  /** Sekunden (Standard 0.6); 0 = ohne Animation */
  duration?: number;
}

/**
 * Fliegt auf einen LV95-Bereich (Feld, Unterquadrant, NAI …), scharf und mit Rand für die Bedienelemente.
 * @returns false, wenn nicht geflogen wurde (Karte ohne Grösse, z. B. ausgeblendet)
 */
export function flyToBoundsSharp(map: L.Map, b: Bounds, o: FlyOptions = {}): boolean {
  const size = map.getSize();
  if (!size.x || !size.y || ![b.minE, b.maxE, b.minN, b.maxN].every(Number.isFinite)) return false;
  const pad = fitPadding(map, o.padding ?? navPadding(map, b));
  const z = sharpZoomFor(map, b, pad, o.maxZoom);
  if (!Number.isFinite(z)) return false;
  // Mitte unter Berücksichtigung des ungleichen Rands (wie Leaflet `_getBoundsCenterZoom`)
  const off = L.point((pad[1] - pad[3]) / 2, (pad[2] - pad[0]) / 2);
  const a = map.project(toLatLng({ e: b.minE, n: b.minN }), z);
  const c = map.project(toLatLng({ e: b.maxE, n: b.maxN }), z);
  const center = map.unproject(a.add(c).divideBy(2).add(off), z);
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return false;
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = o.duration ?? 0.6;
  if (duration <= 0 || reduce) map.setView(center, z, { animate: false });
  else map.flyTo(center, z, { duration });
  return true;
}

/** Bereich um `m` Meter nach allen Seiten vergrössert (Nachbarkontext). */
export function growBounds(b: Bounds, m: number): Bounds {
  return { minE: b.minE - m, maxE: b.maxE + m, minN: b.minN - m, maxN: b.maxN + m };
}

/** Planquadrat oder Unterquadrant mit Nachbarkontext anfliegen (1 Feld bzw. 1 Unterquadrant Rand, Höchststufe 23/24). */
export function flyToCell(map: L.Map, b: Bounds, quadrant: boolean, duration = 0.6): boolean {
  return flyToBoundsSharp(map, cellView(b), { maxZoom: quadrant ? NAV_MAX_ZOOM.quadrant : NAV_MAX_ZOOM.feld, duration });
}

function cellView(b: Bounds): Bounds {
  return growBounds(b, Math.max(b.maxE - b.minE, b.maxN - b.minN));
}

/** Bereich rund um einen Punkt: halbe Seitenlänge in Metern. */
export function boundsAround(p: LV95, half: number): Bounds {
  return { minE: p.e - half, maxE: p.e + half, minN: p.n - half, maxN: p.n + half };
}

// ---------- Feld-Zoom ----------

const registry = new WeakMap<L.Map, () => RasterSheet[]>();

/** Wird der Bereich bereits so gezeigt, wie `flyToCell` ihn zeigen würde (Zoom ≈ Ziel, Mitte nahe der Kartenmitte)? */
function isFilled(map: L.Map, b: Bounds, maxZoom: number): boolean {
  const v = cellView(b);
  const target = sharpZoomFor(map, v, navPadding(map, v), maxZoom);
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
  else if (!isFilled(map, feld, NAV_MAX_ZOOM.feld)) lvl = "feld";
  else if (!isFilled(map, quad, NAV_MAX_ZOOM.quadrant)) lvl = "quadrant";
  else return null;
  const bounds = lvl === "feld" ? feld : quad;
  whenSettled(map, () => flashBounds(map, bounds));
  if (!flyToCell(map, bounds, lvl === "quadrant", 0.45)) return null;
  const label = lvl === "feld" ? cellAt(s, p, false)!.label : `${cellAt(s, p, false)!.label} ${q}`;
  return { cell: { ...ref, quadrant: lvl === "quadrant" ? q : undefined, label }, bounds, level: lvl };
}

/** Raster der Übung, wie bei `enableCellZoom` angemeldet (leer, wenn keins). */
export function registeredSheets(map: L.Map): RasterSheet[] {
  return registry.get(map)?.() ?? [];
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
    // sonst normal hineinzoomen, aber nie tiefer als Stufe 25 (1 m/px)
    const z = Math.min(NAV_MAX_ZOOM.doppelklick, Math.round(map.getZoom()) + 1);
    if (!hit && z > map.getZoom()) map.setZoomAround(ev.containerPoint, z);
  };
  map.on("dblclick", onDbl);
  return () => {
    map.off("dblclick", onDbl);
    registry.delete(map);
  };
}
