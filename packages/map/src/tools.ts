/**
 * Karten-Werkzeuge: Rechteck aufziehen, Punkt wählen, Flächen und georeferenzierte Bilder darstellen.
 */
import L from "leaflet";
import { applyAffine, type Affine, type Area, type LV95 } from "@lage/core";
import { toLatLng, toLv95 } from "./swissmap";

export interface RectLV95 {
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
}

/** Lässt den Benutzer ein Rechteck auf der Karte aufziehen (Maus oder Finger). Esc bricht ab. */
export function drawRect(map: L.Map, color = "#c8102e"): Promise<RectLV95 | null> {
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

/** Zeichnet NAI / Räume mit Beschriftung. */
export function areasLayer(areas: Area[], opts: { onClick?: (a: Area) => void; selectedId?: string } = {}): L.LayerGroup {
  const g = L.layerGroup();
  for (const a of areas) {
    const color = a.color ?? (a.kind === "ao" ? "#0b3d91" : "#1f78d1");
    const ring = a.ring.map(toLatLng);
    const sel = a.id === opts.selectedId;
    const poly = L.polygon(ring, {
      color, weight: sel ? 4 : 2.5, dashArray: a.kind === "ao" ? "10 6" : undefined, fillColor: color, fillOpacity: a.kind === "ao" ? 0 : 0.12,
    }).addTo(g);
    if (opts.onClick) poly.on("click", () => opts.onClick!(a));
    const top = ring.reduce((best, p) => (p.lat > best.lat ? p : best), ring[0]!);
    L.marker(top, { interactive: false, icon: L.divIcon({ className: "lt-area-lbl", html: `<span style="color:${color}">${escapeHtml(a.name)}</span>`, iconSize: [0, 0] }) }).addTo(g);
  }
  return g;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * Bild, das per affiner Transformation (Bildpixel → LV95) auf der Karte liegt.
 * Wird mit CSS-Matrix exakt positioniert (auch gedreht/verzerrt).
 */
export class AffineImageLayer extends L.Layer {
  private img: HTMLImageElement | null = null;
  constructor(private url: string, private w: number, private h: number, private affine: Affine, private opacity = 0.7) {
    super();
  }
  override onAdd(map: L.Map): this {
    const img = (this.img = L.DomUtil.create("img", "lt-affine-img leaflet-zoom-hide") as HTMLImageElement);
    img.src = this.url;
    img.style.position = "absolute";
    img.style.left = "0";
    img.style.top = "0";
    img.style.width = this.w + "px";
    img.style.height = this.h + "px";
    img.style.transformOrigin = "0 0";
    img.style.opacity = String(this.opacity);
    img.style.pointerEvents = "none";
    map.getPanes().overlayPane.appendChild(img);
    map.on("zoomend viewreset moveend", this.update, this);
    this.update();
    return this;
  }
  override onRemove(map: L.Map): this {
    map.off("zoomend viewreset moveend", this.update, this);
    this.img?.remove();
    this.img = null;
    return this;
  }
  setOpacity(o: number) {
    this.opacity = o;
    if (this.img) this.img.style.opacity = String(o);
  }
  private update() {
    const map = (this as unknown as { _map: L.Map })._map;
    if (!map || !this.img) return;
    // drei Bildecken → Layer-Pixel
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
