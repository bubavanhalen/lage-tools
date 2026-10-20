/**
 * swisstopo-Kacheln (WMTS, LV95) zu einem Bild zusammensetzen – für PDF-Druck und Bildvergleich.
 */
import { RESOLUTIONS } from "@lage/map";

export const WMTS_LAYER = {
  lk: "ch.swisstopo.pixelkarte-farbe",
  img: "ch.swisstopo.swissimage",
  grau: "ch.swisstopo.pixelkarte-grau",
} as const;
export type TileLayer = keyof typeof WMTS_LAYER;

const TILE = 256;
const ORIGIN_E = 2420000, ORIGIN_N = 1350000;

export interface Bounds { minE: number; maxE: number; minN: number; maxN: number }

export interface MapRaster {
  canvas: HTMLCanvasElement;
  /** Meter pro Pixel */
  res: number;
  minE: number;
  maxN: number;
}

/** Feinste Stufe, deren Auflösung nicht feiner als `metersPerPx` ist, begrenzt auf `maxTiles`. */
export function tileLevel(b: Bounds, metersPerPx: number, opts: { maxZ?: number; maxTiles?: number } = {}): number {
  let z = RESOLUTIONS.findIndex((r) => r <= metersPerPx);
  if (z < 0) z = RESOLUTIONS.length - 1;
  z = Math.min(z, opts.maxZ ?? 27);
  const tilesFor = (zz: number) => {
    const r = RESOLUTIONS[zz]!;
    return Math.ceil((b.maxE - b.minE) / (TILE * r) + 1) * Math.ceil((b.maxN - b.minN) / (TILE * r) + 1);
  };
  while (z > 0 && tilesFor(z) > (opts.maxTiles ?? 400)) z--;
  return z;
}

/** Stufe mit der Auflösung, die `metersPerPx` am nächsten kommt (logarithmisch). */
export function nearestLevel(metersPerPx: number, maxZ = 27): number {
  let best = 0;
  RESOLUTIONS.forEach((r, i) => {
    if (i <= maxZ && Math.abs(Math.log(r / metersPerPx)) < Math.abs(Math.log(RESOLUTIONS[best]! / metersPerPx))) best = i;
  });
  return best;
}

export async function renderTiles(b: Bounds, z: number, layer: TileLayer, onProgress?: (p: number) => void): Promise<MapRaster> {
  const res = RESOLUTIONS[z]!;
  const x0 = Math.floor((b.minE - ORIGIN_E) / (TILE * res)), x1 = Math.floor((b.maxE - ORIGIN_E) / (TILE * res));
  const y0 = Math.floor((ORIGIN_N - b.maxN) / (TILE * res)), y1 = Math.floor((ORIGIN_N - b.minN) / (TILE * res));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round((b.maxE - b.minE) / res));
  cv.height = Math.max(1, Math.round((b.maxN - b.minN) / res));
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#eef0ea";
  ctx.fillRect(0, 0, cv.width, cv.height);
  const jobs: Array<() => Promise<void>> = [];
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      jobs.push(async () => {
        const url = `https://wmts.geo.admin.ch/1.0.0/${WMTS_LAYER[layer]}/default/current/2056/${z}/${tx}/${ty}.jpeg`;
        try {
          const r = await fetch(url);
          if (!r.ok) return;
          const bmp = await createImageBitmap(await r.blob());
          const e = ORIGIN_E + tx * TILE * res, n = ORIGIN_N - ty * TILE * res;
          ctx.drawImage(bmp, Math.round((e - b.minE) / res), Math.round((b.maxN - n) / res));
        } catch { /* Kachel fehlt – Rest trotzdem verwenden */ }
      });
  const total = jobs.length;
  let done = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (jobs.length) {
      await jobs.shift()!();
      onProgress?.(++done / total);
    }
  }));
  return { canvas: cv, res, minE: b.minE, maxN: b.maxN };
}
