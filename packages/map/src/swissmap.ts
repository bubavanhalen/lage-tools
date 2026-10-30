/**
 * swisstopo-Karte in LV95 (EPSG:2056) mit Leaflet.
 * Die Kacheln kommen direkt vom offiziellen WMTS-Dienst der swisstopo (frei nutzbar, Quellenangabe «© swisstopo»).
 * Rasterlinien bleiben dadurch exakt gerade und rechtwinklig.
 */
import L from "leaflet";
import proj4 from "proj4";
import type { LV95 } from "@lage/core";
import { massstab } from "./massstab";

const EPSG2056 =
  "+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs";
const conv = proj4("EPSG:4326", EPSG2056);

/** Auflösungen (m/Pixel) der swisstopo-Kachelmatrix 2056, Stufe 0–28 */
export const RESOLUTIONS = [
  4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750, 1500, 1250, 1000, 750, 650, 500, 250, 100, 50, 20, 10, 5,
  2.5, 2, 1.5, 1, 0.5, 0.25, 0.1,
];
const ORIGIN = { e: 2420000, n: 1350000 };

export const toLatLng = (p: LV95): L.LatLng => {
  const [lon, lat] = conv.inverse([p.e, p.n]);
  return L.latLng(lat!, lon!);
};
export const toLv95 = (ll: L.LatLngExpression): LV95 => {
  const l = L.latLng(ll);
  const [e, n] = conv.forward([l.lng, l.lat]);
  return { e: e!, n: n! };
};

/** LV95 je LatLng-Objekt (Leaflet projiziert bei jedem Neuaufbau und Zoom alle Zeichen neu; proj4 ist teuer) */
const projected = new WeakMap<L.LatLng, { lat: number; lng: number; e: number; n: number }>();
const projection: L.Projection = {
  project: (ll: L.LatLng) => {
    const c = typeof ll === "object" ? projected.get(ll) : undefined;
    if (c && c.lat === ll.lat && c.lng === ll.lng) return L.point(c.e, c.n);
    const p = toLv95(ll);
    if (ll instanceof L.LatLng) projected.set(ll, { lat: ll.lat, lng: ll.lng, e: p.e, n: p.n });
    return L.point(p.e, p.n);
  },
  unproject: (pt: L.Point) => toLatLng({ e: pt.x, n: pt.y }),
  bounds: L.bounds([2420000, 1030000], [2900000, 1350000]),
};

export const CRS_LV95: L.CRS = L.Util.extend({}, L.CRS, {
  code: "EPSG:2056",
  projection,
  transformation: new L.Transformation(1, -ORIGIN.e, -1, ORIGIN.n),
  scale: (z: number) => 1 / resolutionAt(z),
  zoom: (s: number) => zoomFor(1 / s),
  // Distanz in Metern in der Ebene LV95 (für den Massstab, `map.distance`); L.CRS selbst kennt keine Distanz
  distance: (a: L.LatLng, b: L.LatLng) => { const p = projection.project(a), q = projection.project(b); return Math.hypot(p.x - q.x, p.y - q.y); },
  infinite: false,
}) as unknown as L.CRS;

function resolutionAt(z: number): number {
  const i = Math.floor(z);
  const f = z - i;
  const a = RESOLUTIONS[Math.max(0, Math.min(RESOLUTIONS.length - 1, i))]!;
  const b = RESOLUTIONS[Math.max(0, Math.min(RESOLUTIONS.length - 1, i + 1))]!;
  return f === 0 ? a : a * Math.pow(b / a, f);
}
function zoomFor(res: number): number {
  for (let i = 0; i < RESOLUTIONS.length - 1; i++) {
    const a = RESOLUTIONS[i]!;
    const b = RESOLUTIONS[i + 1]!;
    if (res <= a && res >= b) return i + Math.log(res / a) / Math.log(b / a);
  }
  return res > RESOLUTIONS[0]! ? 0 : RESOLUTIONS.length - 1;
}

/**
 * Grundkarte. «grau» (MVP 1, Standard der Lagekarte) ist die farbige Landeskarte mit CSS-Filter (map.css,
 * `.lt-tiles-grau`) und Deckkraft `GRAU_DECKKRAFT` (Leaflet-Option): gleiche Kachel-Adressen wie «lk», damit das Offline-Kartenpaket (speichert nur `lk`) und der
 * Kachel-Cache des Service Workers auch für Grau gelten – eine eigene graue Kachelebene wäre offline leer.
 */
export type Basemap = "lk" | "img" | "grau";
/**
 * Deckkraft der grauen Karte (Spez. 5.4: `opacity .7` auf Weiss). Als Leaflet-Option bzw. `setOpacity`, nicht per CSS:
 * Leaflet setzt die Deckkraft der Kachelebene inline (sonst 1) und überschreibt damit jede CSS-Regel.
 */
export const GRAU_DECKKRAFT = 0.7;
const LAYERS: Record<Basemap, { id: string; ext: string; max: number; className?: string }> = {
  lk: { id: "ch.swisstopo.pixelkarte-farbe", ext: "jpeg", max: 27 },
  grau: { id: "ch.swisstopo.pixelkarte-farbe", ext: "jpeg", max: 27, className: "lt-tiles-grau" },
  img: { id: "ch.swisstopo.swissimage", ext: "jpeg", max: 28 },
};

/** Adresse der Kacheln einer Grundkarte (Grau = Landeskarte) */
export function basemapTileUrl(kind: Basemap): string {
  const l = LAYERS[kind];
  return `https://wmts.geo.admin.ch/1.0.0/${l.id}/default/current/2056/{z}/{x}/{y}.${l.ext}`;
}

/** Kachel-Zwischenspeicher (Service Worker, «Alles für offline laden»; gleich wie `ui/src/offline.ts`) */
export const KACHEL_CACHE = "lt-tiles-v1";
/** so viele Stufen gröber sucht der Ersatz höchstens (2 m → 20 m sind 4 Stufen; 0.25 m → 2 m sind 5) */
const ERSATZ_STUFEN = 8;

interface KachelTile extends HTMLImageElement { _ltc?: L.Coords; _ltErsatz?: string }

/**
 * Ersatz für eine fehlende Kachel (Review 6 Feld H1, «gröber statt weiss»): die feinste gröbere Stufe aus dem
 * Kachel-Zwischenspeicher, auf das Feld der fehlenden Kachel vergrössert. Nur Cache-Abfragen, kein Netz. Die Stufen der
 * Kachelmatrix 2056 sind keine Zweierpotenzen – das Feld wird über die Koordinaten (m) zugeschnitten, es kann 1–4
 * gröbere Kacheln berühren. null = keine gröbere Stufe vollständig vorhanden.
 */
export async function ersatzKachel(url: (z: number, x: number, y: number) => string, c: { x: number; y: number; z: number }, size = 256): Promise<Blob | null> {
  if (typeof caches === "undefined" || typeof createImageBitmap === "undefined") return null;
  let cache: Cache;
  try { cache = await caches.open(KACHEL_CACHE); } catch { return null; }
  const r = RESOLUTIONS[c.z];
  if (r === undefined) return null;
  // Feld der fehlenden Kachel in m (E nach rechts, N nach unten als Abstand vom Ursprung)
  const e0 = c.x * size * r, e1 = e0 + size * r, s0 = c.y * size * r, s1 = s0 + size * r;
  for (let z = c.z - 1; z >= Math.max(0, c.z - ERSATZ_STUFEN); z--) {
    const rr = RESOLUTIONS[z]!, t = size * rr;
    const xs: number[] = [], ys: number[] = [];
    for (let x = Math.floor(e0 / t); x * t < e1 - 1e-6; x++) xs.push(x);
    for (let y = Math.floor(s0 / t); y * t < s1 - 1e-6; y++) ys.push(y);
    const teile: Array<{ x: number; y: number; res: Response }> = [];
    let alle = true;
    for (const y of ys) for (const x of xs) {
      const res = await cache.match(url(z, x, y)).catch(() => undefined);
      if (!res || !res.ok) { alle = false; break; }
      teile.push({ x, y, res });
    }
    if (!alle || !teile.length) continue;
    try {
      const cv = document.createElement("canvas");
      cv.width = cv.height = size;
      const ctx = cv.getContext("2d");
      if (!ctx) return null;
      const k = rr / r; // Pixel der fehlenden Stufe je Pixel der gröberen
      ctx.imageSmoothingQuality = "high";
      for (const tl of teile) {
        const bmp = await createImageBitmap(await tl.res.blob());
        ctx.drawImage(bmp, (tl.x * t - e0) / r, (tl.y * t - s0) / r, size * k, size * k);
        bmp.close?.();
      }
      return await new Promise<Blob | null>((ok) => cv.toBlob(ok, "image/jpeg", 0.85));
    } catch { continue; }
  }
  return null;
}

/**
 * swisstopo-Kachelebene mit Ersatz: Lädt eine Kachel nicht (offline, Teil fehlt im Zwischenspeicher, Netz hängt), zeigt
 * die Ebene statt Weiss die feinste vorhandene gröbere Stufe vergrössert (`ersatzKachel`). Feld H1 (Review 6).
 */
const KachelEbene = L.TileLayer.extend({
  createTile(this: L.TileLayer, coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = (L.TileLayer.prototype as unknown as { createTile(c: L.Coords, d: L.DoneCallback): KachelTile }).createTile.call(this, coords, done);
    tile._ltc = coords;
    return tile;
  },
  _tileOnError(this: L.TileLayer & { _url: string }, done: L.DoneCallback, tile: KachelTile, e: Error) {
    const c = tile._ltc;
    const fail = () => (L.TileLayer.prototype as unknown as { _tileOnError(d: L.DoneCallback, t: HTMLElement, e: Error): void })._tileOnError.call(this, done, tile, e);
    if (!c || tile._ltErsatz) { fail(); return; }
    tile._ltErsatz = "…";
    const tpl = this._url, opts = this.options;
    const z = c.z; // Stufe der Kachel (ohne zoomOffset/zoomReverse; LAYERS setzt keines)
    void ersatzKachel((zz, x, y) => L.Util.template(tpl, { ...opts, z: zz, x, y } as unknown as Record<string, string>), { x: c.x, y: c.y, z }).then((blob) => {
      if (!blob) { fail(); return; }
      const u = URL.createObjectURL(blob);
      tile._ltErsatz = u;
      tile.classList.add("lt-ersatz");
      // `load` ruft Leaflets `_tileOnLoad` → done(null, tile); die Adresse danach freigeben
      tile.addEventListener("load", () => URL.revokeObjectURL(u), { once: true });
      tile.src = u;
    }, fail);
  },
}) as unknown as new (url: string, o: L.TileLayerOptions) => L.TileLayer;

export function swisstopoLayer(kind: Basemap): L.TileLayer {
  const l = LAYERS[kind];
  return new KachelEbene(basemapTileUrl(kind), {
    className: l.className ?? "",
    maxNativeZoom: l.max,
    maxZoom: 28,
    minZoom: 14,
    bounds: L.latLngBounds(toLatLng({ e: 2420000, n: 1030000 }), toLatLng({ e: 2900000, n: 1350000 })),
    attribution: '© <a href="https://www.swisstopo.admin.ch" target="_blank" rel="noopener">swisstopo</a>',
    crossOrigin: true,
    opacity: kind === "grau" ? GRAU_DECKKRAFT : 1,
  });
}

export interface SwissMap {
  map: L.Map;
  setBasemap(kind: Basemap): void;
  fitLv95(min: LV95, max: LV95, padding?: number): void;
}

export function createSwissMap(el: HTMLElement, opts: { basemap?: Basemap; center?: LV95; zoom?: number } = {}): SwissMap {
  const map = L.map(el, {
    crs: CRS_LV95,
    center: toLatLng(opts.center ?? { e: 2660000, n: 1190000 }),
    zoom: opts.zoom ?? 16,
    minZoom: 14,
    maxZoom: 28,
    zoomSnap: 0.5,
    // ohne 3D-Transformation rundet Leaflet auf ganze Stufen (zoomSnap gilt dann nicht): ein halber Schritt «−» würde
    // wieder aufgerundet und «−» zoomte nie heraus – dann ganze Schritte (MVP 3.5, Paket A, betrieb.spec 12)
    zoomDelta: L.Browser.any3d ? 0.5 : 1,
    wheelPxPerZoomLevel: 90,
  });
  map.attributionControl.setPrefix(false);
  // Massstab unten links (MVP 3.5, B3)
  massstab(map);
  const mark = (kind: Basemap) => el.classList.toggle("lt-base-grau", kind === "grau");
  let kind0 = opts.basemap ?? "lk";
  let layer = swisstopoLayer(kind0).addTo(map);
  mark(kind0);
  return {
    map,
    setBasemap(kind) {
      if (kind === kind0) return;
      const same = LAYERS[kind].id === LAYERS[kind0].id;
      kind0 = kind;
      mark(kind);
      // Grau ↔ Landeskarte: dieselben Kacheln, nur der Filter wechselt (kein Neuladen, kein Flackern)
      const c = same ? layer.getContainer() : undefined;
      if (c) { c.classList.toggle("lt-tiles-grau", kind === "grau"); layer.setOpacity(kind === "grau" ? GRAU_DECKKRAFT : 1); return; }
      map.removeLayer(layer);
      layer = swisstopoLayer(kind).addTo(map);
      layer.bringToBack();
      mark(kind);
    },
    fitLv95(min, max, padding = 20) {
      map.fitBounds(L.latLngBounds(toLatLng(min), toLatLng(max)), { padding: [padding, padding] });
    },
  };
}
