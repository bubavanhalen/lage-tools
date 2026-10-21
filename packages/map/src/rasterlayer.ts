/**
 * Führungsraster-Blatt auf der Karte (wie Lagebild-Prototyp):
 * - Feldlinien auf weisser Unterlage: jede 5. Linie betont (1.6 px / .75), übrige 1 px / .45; Rand wie 5er-Linie.
 * - Randbeschriftung auf allen vier Seiten (Plex Mono 600 13px, weisser Halo), bei kleinen Feldern ausgedünnt.
 * - Grosse Feldbeschriftung in jedem Feld, skaliert mit dem Zoom (≈ 14,5 % der Feldhöhe), halbtransparent.
 * - Bei grossem Zoom zusätzlich Unterquadranten A B / D C (feines Kreuz + kleine Buchstaben).
 * Beschriftungen werden nur für den sichtbaren Ausschnitt gezeichnet (eine SVG, neu bei Verschieben/Zoom).
 */
import L from "leaflet";
import { sheetBounds, type RasterSheet } from "@lage/core";
import { toLatLng } from "./swissmap";

export interface RasterLayerOptions {
  /** Linienfarbe (Standard #111111) */
  color?: string;
  /** Ab dieser Feldhöhe in Bildschirmpixeln werden Feldbezeichnungen im Feld gezeigt (Standard 72) */
  cellLabelMinPx?: number;
  /** Ab dieser Feldhöhe werden Unterquadranten gezeigt (Standard 300) */
  quadrantMinPx?: number;
  /** grösste Schrift der Feldbezeichnung in px (Standard 56) */
  cellLabelMaxPx?: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const PANE = "ltRasterLabels";

export function rasterLayer(map: L.Map, sheet: RasterSheet, opts: RasterLayerOptions = {}): L.LayerGroup {
  const color = opts.color ?? "#111111";
  const group = L.layerGroup();
  const b = sheetBounds(sheet);
  const cols = sheet.colLabels.length;
  const rows = sheet.rowLabels.length;
  const major: L.LatLng[][] = [];
  const minor: L.LatLng[][] = [];
  for (let c = 0; c <= cols; c++) {
    const e = b.minE + c * sheet.cellW;
    (c % 5 === 0 || c === cols ? major : minor).push([toLatLng({ e, n: b.maxN }), toLatLng({ e, n: b.minN })]);
  }
  for (let r = 0; r <= rows; r++) {
    const n = b.maxN - r * sheet.cellH;
    (r % 5 === 0 || r === rows ? major : minor).push([toLatLng({ e: b.minE, n }), toLatLng({ e: b.maxE, n })]);
  }
  // weisse Unterlage: Linien bleiben auch auf der dichten Stadtkarte lesbar
  L.polyline([...minor, ...major], { color: "#fff", weight: 3, opacity: 0.55, interactive: false, className: "lt-grid-casing" }).addTo(group);
  if (minor.length) L.polyline(minor, { color, weight: 1, opacity: 0.45, interactive: false, className: "lt-grid" }).addTo(group);
  L.polyline(major, { color, weight: 1.6, opacity: 0.75, interactive: false, className: "lt-grid" }).addTo(group);
  group.addLayer(new RasterLabels(sheet, opts));
  void map;
  return group;
}

/** «schöner» Ausdünnungsschritt, damit beschriftete Linien auf die 5er-Linien fallen */
const niceStep = (need: number) => [1, 2, 5, 10, 20, 50].find((s) => s >= need) ?? 100;

class RasterLabels extends L.Layer {
  private svg: SVGSVGElement | null = null;
  private tl: L.LatLng | null = null;

  constructor(private sheet: RasterSheet, private o: RasterLayerOptions) {
    super();
  }

  override onAdd(map: L.Map): this {
    if (!map.getPane(PANE)) {
      const pane = map.createPane(PANE);
      pane.style.zIndex = "395"; // unter Flächen/Spuren (400), über den Kacheln
      pane.style.pointerEvents = "none";
    }
    const svg = (this.svg = document.createElementNS(SVG_NS, "svg"));
    svg.setAttribute("class", `lt-raster-lbl ${map.options.zoomAnimation && L.Browser.any3d ? "leaflet-zoom-animated" : "leaflet-zoom-hide"}`);
    svg.style.position = "absolute";
    svg.style.overflow = "visible";
    map.getPane(PANE)!.appendChild(svg);
    this.draw();
    return this;
  }

  override onRemove(): this {
    this.svg?.remove();
    this.svg = null;
    return this;
  }

  override getEvents(): { [name: string]: L.LeafletEventHandlerFn } {
    return { moveend: this.draw, resize: this.draw, viewreset: this.draw, zoomanim: this.animateZoom as L.LeafletEventHandlerFn };
  }

  private animateZoom(e: L.ZoomAnimEvent) {
    const map = this._map as L.Map & { _latLngToNewLayerPoint(ll: L.LatLng, z: number, c: L.LatLng): L.Point };
    if (!this.svg || !this.tl || !map) return;
    const scale = map.getZoomScale(e.zoom, map.getZoom());
    L.DomUtil.setTransform(this.svg as unknown as HTMLElement, map._latLngToNewLayerPoint(this.tl, e.zoom, e.center), scale);
  }

  private draw() {
    const map = this._map;
    const svg = this.svg;
    if (!map || !svg) return;
    const sh = this.sheet;
    const cols = sh.colLabels.length;
    const rows = sh.rowLabels.length;
    const size = map.getSize();
    const padX = Math.round(size.x * 0.3), padY = Math.round(size.y * 0.3);
    const tl = map.containerPointToLayerPoint([-padX, -padY]).round();
    const W = size.x + 2 * padX, H = size.y + 2 * padY;
    this.tl = map.layerPointToLatLng(tl);
    L.DomUtil.setPosition(svg as unknown as HTMLElement, tl);
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    // LV95 → Pixel in der SVG (ungerundet; die Projektion ist in LV95 linear)
    const z = map.getZoom();
    const po = map.getPixelOrigin();
    const P = (e: number, n: number) => map.project(toLatLng({ e, n }), z).subtract(po).subtract(tl);
    const p0 = P(sh.origin.e, sh.origin.n);
    const p1 = P(sh.origin.e + sh.cellW * cols, sh.origin.n - sh.cellH * rows);
    const cw = (p1.x - p0.x) / cols;
    const ch = (p1.y - p0.y) / rows;
    const X = (c: number) => p0.x + c * cw;
    const Y = (r: number) => p0.y + r * ch;

    const parts: string[] = [];
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    const inX = (x: number) => x > -60 && x < W + 60;
    const inY = (y: number) => y > -60 && y < H + 60;

    // ---- Randbeschriftung (auch bei kleinen Feldern, dann ausgedünnt)
    const colW = Math.max(...sh.colLabels.map((s) => s.length)) * 8 + 6;
    const colStep = niceStep(colW / cw);
    const rowStep = niceStep(17 / ch);
    const offV = Math.max(0.45 * ch, 12);
    const rowW = Math.max(...sh.rowLabels.map((s) => s.length)) * 8;
    const offH = Math.max(0.45 * cw, rowW / 2 + 7);
    const edge = (x: number, y: number, t: string) => parts.push(`<text class="lt-edge-t" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${esc(t)}</text>`);
    for (let c = 0; c < cols; c++) {
      if (c % colStep) continue;
      const x = X(c + 0.5);
      if (!inX(x)) continue;
      if (inY(Y(0))) edge(x, Y(0) - offV, sh.colLabels[c]!);
      if (inY(Y(rows))) edge(x, Y(rows) + offV, sh.colLabels[c]!);
    }
    for (let r = 0; r < rows; r++) {
      if (r % rowStep) continue;
      const y = Y(r + 0.5);
      if (!inY(y)) continue;
      if (inX(X(0))) edge(X(0) - offH, y, sh.rowLabels[r]!);
      if (inX(X(cols))) edge(X(cols) + offH, y, sh.rowLabels[r]!);
    }

    // ---- sichtbare Felder
    const c0 = Math.max(0, Math.floor(-p0.x / cw)), c1 = Math.min(cols - 1, Math.floor((W - p0.x) / cw));
    const r0 = Math.max(0, Math.floor(-p0.y / ch)), r1 = Math.min(rows - 1, Math.floor((H - p0.y) / ch));
    const minPx = this.o.cellLabelMinPx ?? 72;
    if (ch >= minPx && c0 <= c1 && r0 <= r1) {
      // Unterquadranten (feines Kreuz + A B / D C)
      if (sh.quadrants && ch >= (this.o.quadrantMinPx ?? 300)) {
        let d = "";
        for (let c = c0; c <= c1; c++) d += `M${X(c + 0.5).toFixed(1)} ${Y(r0).toFixed(1)}V${Y(r1 + 1).toFixed(1)}`;
        for (let r = r0; r <= r1; r++) d += `M${X(c0).toFixed(1)} ${Y(r + 0.5).toFixed(1)}H${X(c1 + 1).toFixed(1)}`;
        parts.push(`<path class="lt-quad-x" d="${d}"/>`);
        const dq = 13;
        for (let r = r0; r <= r1; r++)
          for (let c = c0; c <= c1; c++) {
            const cx = X(c + 0.5), cy = Y(r + 0.5);
            parts.push(
              `<text class="lt-quad-t" x="${cx - dq}" y="${cy - dq}">A</text><text class="lt-quad-t" x="${cx + dq}" y="${cy - dq}">B</text>`
              + `<text class="lt-quad-t" x="${cx + dq}" y="${cy + dq}">C</text><text class="lt-quad-t" x="${cx - dq}" y="${cy + dq}">D</text>`,
            );
          }
      }
      const fs = Math.min(this.o.cellLabelMaxPx ?? 56, Math.max(11, 0.145 * ch));
      const dx = Math.min(0.044 * cw, fs * 0.3);
      const dy = fs * 1.17;
      const sw = Math.max(2.5, fs / 6);
      const cells: string[] = [];
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const t = sh.labelOrder === "col-row" ? sh.colLabels[c]! + sh.rowLabels[r]! : sh.rowLabels[r]! + sh.colLabels[c]!;
          cells.push(`<text x="${(X(c) + dx).toFixed(1)}" y="${(Y(r) + dy).toFixed(1)}">${esc(t)}</text>`);
        }
      parts.push(`<g class="lt-cell-t" style="font-size:${fs.toFixed(1)}px;stroke-width:${sw.toFixed(1)}px">${cells.join("")}</g>`);
    }
    svg.innerHTML = parts.join("");
  }
}
