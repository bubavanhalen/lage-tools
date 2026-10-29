/**
 * Karten-Werkzeuge: Rechteck aufziehen, Punkt wählen, Flächen und georeferenzierte Bilder darstellen.
 */
import L from "leaflet";
import { applyAffine, type Affine, type Area, type LV95 } from "@lage/core";
import { toLatLng, toLv95 } from "./swissmap";
import { KARTE } from "./kartenfarben";

export interface RectLV95 {
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
}

/** Lässt den Benutzer ein Rechteck auf der Karte aufziehen (Maus oder Finger). Esc bricht ab. */
export function drawRect(map: L.Map, color: string = KARTE.ink): Promise<RectLV95 | null> {
  return new Promise((resolve) => {
    const el = map.getContainer();
    el.classList.add("lt-drawing");
    map.dragging.disable();
    map.boxZoom.disable();
    let start: L.LatLng | null = null;
    let rect: L.Polygon | null = null;
    const corners = (a: LV95, b: LV95): L.LatLng[] => [
      toLatLng({ e: a.e, n: a.n }), toLatLng({ e: b.e, n: a.n }), toLatLng({ e: b.e, n: b.n }), toLatLng({ e: a.e, n: b.n }),
    ];
    const ll = (ev: PointerEvent) => map.containerPointToLatLng(map.mouseEventToContainerPoint(ev as unknown as MouseEvent));
    const down = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      start = ll(ev);
      el.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    };
    const move = (ev: PointerEvent) => {
      if (!start) return;
      const a = toLv95(start), b = toLv95(ll(ev));
      if (rect) rect.setLatLngs(corners(a, b));
      else rect = L.polygon(corners(a, b), { color, weight: 2, dashArray: "6 4", fillOpacity: 0.08, interactive: false }).addTo(map);
    };
    const finish = (r: RectLV95 | null) => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      document.removeEventListener("keydown", key);
      el.classList.remove("lt-drawing");
      map.dragging.enable();
      map.boxZoom.enable();
      if (rect) map.removeLayer(rect);
      resolve(r);
    };
    const up = (ev: PointerEvent) => {
      if (!start) return;
      const a = toLv95(start), b = toLv95(ll(ev));
      start = null;
      const r = { minE: Math.min(a.e, b.e), maxE: Math.max(a.e, b.e), minN: Math.min(a.n, b.n), maxN: Math.max(a.n, b.n) };
      if (r.maxE - r.minE < 20 || r.maxN - r.minN < 20) return; // versehentlicher Klick
      finish(r);
    };
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") finish(null); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    document.addEventListener("keydown", key);
  });
}

/** Wartet auf einen Klick in die Karte (Esc bricht ab). */
export function pickPoint(map: L.Map): Promise<LV95 | null> {
  return new Promise((resolve) => {
    const el = map.getContainer();
    el.classList.add("lt-picking");
    const click = (ev: L.LeafletMouseEvent) => { done(); resolve(toLv95(ev.latlng)); };
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") { done(); resolve(null); } };
    const done = () => { map.off("click", click); document.removeEventListener("keydown", key); el.classList.remove("lt-picking"); };
    map.on("click", click);
    document.addEventListener("keydown", key);
  });
}

/**
 * Zeichnet NAI / Räume wie im Lagebild-Prototyp: zuerst weisse Unterlage (5 px), dann farbig.
 * NAI: durchgezogen 2.5 px, Füllung 10 %, Beschriftung über der obersten Ecke (ab Schwerpunkt-x).
 * AO: gestrichelt «10 6», ohne Füllung, Beschriftung links neben der westlichsten Ecke.
 * Stao: rot gestrichelt «6 4», Füllung 10 %.
 */
export function areasLayer(areas: Area[], opts: { onClick?: (a: Area) => void; selectedId?: string } = {}): L.LayerGroup {
  const g = L.layerGroup();
  for (const a of areas) {
    if (a.ring.length < 3) continue;
    const style = AREA_STYLE[a.kind] ?? AREA_STYLE.nai;
    const color = a.color && a.kind !== "stao" ? a.color : style.line;
    const ring = a.ring.map(toLatLng);
    const sel = a.id === opts.selectedId;
    L.polygon(ring, { color: "#fff", weight: sel ? 7 : 5, opacity: 0.8, fill: false, interactive: false }).addTo(g);
    const poly = L.polygon(ring, {
      color, weight: sel ? 4 : 2.5, dashArray: style.dash, fill: style.fill > 0, fillColor: a.kind === "stao" ? KARTE.feind : color, fillOpacity: style.fill,
      interactive: !!opts.onClick, bubblingMouseEvents: false,
    }).addTo(g);
    if (opts.onClick) poly.on("click", () => opts.onClick!(a));
    let at: LV95;
    let cls = "top";
    if (a.kind === "ao") {
      at = a.ring.reduce((m, p) => (p.e < m.e ? p : m), a.ring[0]!);
      cls = "ao";
    } else {
      const top = a.ring.reduce((m, p) => (p.n > m.n ? p : m), a.ring[0]!);
      at = a.kind === "stao" ? top : { e: a.ring.reduce((s, p) => s + p.e, 0) / a.ring.length, n: top.n };
    }
    L.marker(toLatLng(at), {
      interactive: false, keyboard: false, zIndexOffset: -1000,
      icon: L.divIcon({ className: `lt-area-lbl ${cls}`, html: `<span style="color:${color}">${escapeHtml(a.name)}</span>`, iconSize: [0, 0] }),
    }).addTo(g);
  }
  return g;
}

const AREA_STYLE: Record<Area["kind"], { line: string; dash?: string; fill: number }> = {
  nai: { line: KARTE.nai, fill: 0.1 },
  ao: { line: KARTE.ao, dash: "10 6", fill: 0 },
  stao: { line: KARTE.feind, dash: "6 4", fill: 0.1 },
  other: { line: KARTE.nai, fill: 0.1 },
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * Bild, das per affiner Transformation (Bildpixel → LV95) auf der Karte liegt.
 * Wird mit CSS-Matrix exakt positioniert (auch gedreht/verzerrt).
 * Das Bild liegt in einem Rahmen, der beim Zoomen wie Leaflets Ebenen mitskaliert (`zoomanim` per CSS-Transition,
 * `zoom` in jedem Bild einer Kamerafahrt bzw. eines Pinch-Zooms) – erst danach wird die Matrix neu berechnet.
 */
export class AffineImageLayer extends L.Layer {
  private box: HTMLDivElement | null = null;
  private img: HTMLImageElement | null = null;
  /** Bezugspunkt (Layer-Pixel 0/0) und Zoomstufe beim letzten Berechnen der Matrix */
  private ref: L.LatLng | null = null;
  private z = 0;
  constructor(private url: string, private w: number, private h: number, private affine: Affine, private opacity = 0.7) {
    super();
  }
  override onAdd(map: L.Map): this {
    const anim = !!map.options.zoomAnimation && L.Browser.any3d;
    const box = (this.box = L.DomUtil.create("div", `lt-affine ${anim ? "leaflet-zoom-animated" : "leaflet-zoom-hide"}`) as HTMLDivElement);
    box.style.position = "absolute";
    box.style.left = "0";
    box.style.top = "0";
    box.style.transformOrigin = "0 0";
    box.style.pointerEvents = "none";
    const img = (this.img = L.DomUtil.create("img", "lt-affine-img", box) as HTMLImageElement);
    img.src = this.url;
    img.style.position = "absolute";
    img.style.left = "0";
    img.style.top = "0";
    img.style.width = this.w + "px";
    img.style.height = this.h + "px";
    img.style.maxWidth = "none";
    img.style.transformOrigin = "0 0";
    img.style.opacity = String(this.opacity);
    img.style.pointerEvents = "none";
    map.getPanes().overlayPane.appendChild(box);
    this.update();
    return this;
  }
  override onRemove(): this {
    this.box?.remove();
    this.box = null;
    this.img = null;
    return this;
  }
  override getEvents(): { [name: string]: L.LeafletEventHandlerFn } {
    return { viewreset: this.update, moveend: this.update, zoom: this.onZoom, zoomanim: this.animateZoom as L.LeafletEventHandlerFn };
  }
  setOpacity(o: number) {
    this.opacity = o;
    if (this.img) this.img.style.opacity = String(o);
  }
  private animateZoom(e: L.ZoomAnimEvent) {
    this.follow(e.center, e.zoom);
  }
  private onZoom() {
    const map = (this as unknown as { _map?: L.Map })._map;
    if (!map) return;
    if (!L.Browser.any3d) { this.update(); return; }
    this.follow(map.getCenter(), map.getZoom());
  }
  /** Rahmen so verschieben/skalieren, wie er bei Mitte `center` und Stufe `zoom` liegen muss */
  private follow(center: L.LatLng, zoom: number) {
    const map = (this as unknown as { _map?: L.Map & { _latLngToNewLayerPoint(ll: L.LatLng, z: number, c: L.LatLng): L.Point } })._map;
    if (!map || !this.box || !this.ref) return;
    L.DomUtil.setTransform(this.box, map._latLngToNewLayerPoint(this.ref, zoom, center), map.getZoomScale(zoom, this.z));
  }
  private update() {
    const map = (this as unknown as { _map: L.Map })._map;
    if (!map || !this.img || !this.box) return;
    // Rahmen bei Layer-Pixel 0/0 (ohne Skalierung); Bild darin per Matrix aus drei Bildecken
    this.ref = map.layerPointToLatLng(L.point(0, 0));
    this.z = map.getZoom();
    L.DomUtil.setPosition(this.box, L.point(0, 0));
    // ungerundete Layer-Pixel (latLngToLayerPoint rundet auf ganze Pixel)
    const origin = map.getPixelOrigin();
    const p = (x: number, y: number) => {
      const q = applyAffine(this.affine, { x, y });
      return map.project(toLatLng({ e: q.x, n: q.y }), map.getZoom()).subtract(origin);
    };
    const o = p(0, 0), px = p(this.w, 0), py = p(0, this.h);
    const a = (px.x - o.x) / this.w, b = (px.y - o.y) / this.w, c = (py.x - o.x) / this.h, d = (py.y - o.y) / this.h;
    this.img.style.transform = `matrix(${a},${b},${c},${d},${o.x},${o.y})`;
  }
}
