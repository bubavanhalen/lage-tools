/**
 * Zeichnet ein Führungsraster-Blatt auf die Karte: Rahmen, Feldlinien, Beschriftung am Rand
 * und – ab genügend Zoom – die Feldbezeichnung in jedem Feld.
 */
import L from "leaflet";
import { cellBounds, cellLabel, sheetBounds, type RasterSheet } from "@lage/core";
import { toLatLng } from "./swissmap";

export interface RasterLayerOptions {
  color?: string;
  /** Ab dieser Feldgrösse in Bildschirmpixeln werden Feldbezeichnungen gezeigt */
  cellLabelMinPx?: number;
}

export function rasterLayer(map: L.Map, sheet: RasterSheet, opts: RasterLayerOptions = {}): L.LayerGroup {
  const color = opts.color ?? "#1d1d1d";
  const minPx = opts.cellLabelMinPx ?? 46;
  const group = L.layerGroup();
  const lines = L.layerGroup().addTo(group);
  const labels = L.layerGroup().addTo(group);
  const b = sheetBounds(sheet);
  const cols = sheet.colLabels.length;
  const rows = sheet.rowLabels.length;

  for (let c = 0; c <= cols; c++) {
    const e = b.minE + c * sheet.cellW;
    L.polyline([toLatLng({ e, n: b.maxN }), toLatLng({ e, n: b.minN })], {
      color, weight: c === 0 || c === cols ? 2.2 : 0.9, opacity: 0.85, interactive: false,
    }).addTo(lines);
  }
  for (let r = 0; r <= rows; r++) {
    const n = b.maxN - r * sheet.cellH;
    L.polyline([toLatLng({ e: b.minE, n }), toLatLng({ e: b.maxE, n })], {
      color, weight: r === 0 || r === rows ? 2.2 : 0.9, opacity: 0.85, interactive: false,
    }).addTo(lines);
  }

  const edge = (text: string, ll: L.LatLng, cls: string) =>
    L.marker(ll, {
      interactive: false,
      icon: L.divIcon({ className: `lt-edge ${cls}`, html: `<span>${text}</span>`, iconSize: [0, 0] }),
    }).addTo(labels);

  const drawLabels = () => {
    labels.clearLayers();
    const z = map.getZoom();
    const px = sheet.cellW / map.options.crs!.scale(z) ** -1;
    const step = px < 24 ? Math.ceil(24 / px) : 1;
    for (let c = 0; c < cols; c += step) {
      const e = b.minE + (c + 0.5) * sheet.cellW;
      edge(sheet.colLabels[c]!, toLatLng({ e, n: b.maxN }), "top");
      edge(sheet.colLabels[c]!, toLatLng({ e, n: b.minN }), "bottom");
    }
    for (let r = 0; r < rows; r += step) {
      const n = b.maxN - (r + 0.5) * sheet.cellH;
      edge(sheet.rowLabels[r]!, toLatLng({ e: b.minE, n }), "left");
      edge(sheet.rowLabels[r]!, toLatLng({ e: b.maxE, n }), "right");
    }
    if (px >= minPx) {
      const view = map.getBounds();
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const cb = cellBounds(sheet, c, r);
          const tl = toLatLng({ e: cb.minE, n: cb.maxN });
          if (!view.contains(tl)) continue;
          L.marker(tl, {
            interactive: false,
            icon: L.divIcon({ className: "lt-cell", html: `<span>${cellLabel(sheet, c, r)}</span>`, iconSize: [0, 0] }),
          }).addTo(labels);
        }
    }
  };
  group.on("add", () => {
    drawLabels();
    map.on("zoomend moveend", drawLabels);
  });
  group.on("remove", () => map.off("zoomend moveend", drawLabels));
  return group;
}
