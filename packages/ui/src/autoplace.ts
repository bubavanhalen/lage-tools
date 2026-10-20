/**
 * Kartenausschnitt (Bildschirmfoto von map.geo.admin.ch, Landeskarte) automatisch einpassen:
 * Bild mit den swisstopo-Kacheln im aktuellen Kartenausschnitt vergleichen.
 * Ergebnis: Transformation Bildpixel → LV95 (nordausgerichtet, nur Massstab + Verschiebung).
 */
import {
  locateCoarse,
  locateFine,
  prepareSearch,
  resizeGray,
  toGray,
  type Affine,
  type Gray,
  type Match,
} from "@lage/core";
import { nearestLevel, renderTiles, tileLevel, type Bounds } from "./tiles";

export interface PlaceResult {
  t: Affine;
  /** Übereinstimmung 0…1 */
  score: number;
}

type Progress = (p: number, what: string) => void;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function drive<T>(gen: Generator<number, T>, onStep: (p: number) => void): Promise<T> {
  let last = performance.now();
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    onStep(r.value);
    if (performance.now() - last > 40) { await tick(); last = performance.now(); }
  }
}

function grayOf(cv: HTMLCanvasElement): Gray {
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  return toGray(ctx.getImageData(0, 0, cv.width, cv.height));
}

const fitMax = (g: Gray, max: number) => {
  const f = Math.min(1, max / Math.max(g.width, g.height));
  return f < 1 ? resizeGray(g, g.width * f, g.height * f) : g;
};

/** Feinsuche um eine Näherung; liefert Transformation für das Originalbild. */
async function refine(img: Gray, t0: Affine, onProgress: Progress, p0: number, p1: number): Promise<PlaceResult | null> {
  const r = t0.a; // Meter pro Originalpixel
  const fw = img.width * r, fh = img.height * r;
  const m = 0.15 * Math.max(fw, fh);
  const c: Bounds = { minE: t0.c - m, maxE: t0.c + fw + m, minN: t0.f - fh - m, maxN: t0.f + m };
  const z = Math.min(nearestLevel(r), tileLevel(c, r * 0.999, { maxTiles: 160 }));
  const tiles = await renderTiles(c, z, "lk", (p) => onProgress(p0 + (p1 - p0) * 0.4 * p, "Karte laden …"));
  // Arbeitsauflösung: Bild ca. 360 px breit
  const m1 = Math.max(fw / 360, tiles.res);
  const mapG = fitMax(grayOf(tiles.canvas), Math.max(tiles.canvas.width, tiles.canvas.height) * (tiles.res / m1));
  const m1x = (c.maxE - c.minE) / mapG.width;
  const mid = fitMax(img, 720);
  const k0 = (r * (img.width / mid.width)) / m1x;
  const search = prepareSearch(mapG);
  const best = await drive(locateFine(search, mid, { k: k0 }, { range: 0.07, step: 0.007 }), (p) => onProgress(p0 + (p1 - p0) * (0.4 + 0.6 * p), "Feinabgleich …"));
  if (!best) return null;
  const s = (best.k * m1x * mid.width) / img.width;
  return { t: { a: s, b: 0, c: c.minE + best.x * m1x, d: 0, e: -s, f: c.maxN - best.y * m1x }, score: best.score };
}

/**
 * Sucht das Bild im Kartenausschnitt `view` (wird ringsum um 25 % erweitert).
 * @returns bestes Ergebnis oder null (nichts Passendes gefunden)
 */
export async function autoPlace(cv: HTMLCanvasElement, view: Bounds, onProgress: Progress): Promise<PlaceResult | null> {
  const w = view.maxE - view.minE, h = view.maxN - view.minN;
  const b: Bounds = { minE: view.minE - 0.25 * w, maxE: view.maxE + 0.25 * w, minN: view.minN - 0.25 * h, maxN: view.maxN + 0.25 * h };
  const bw = b.maxE - b.minE;
  const z = tileLevel(b, bw / 1100, { maxTiles: 80 });
  onProgress(0, "Karte laden …");
  const tiles = await renderTiles(b, z, "lk", (p) => onProgress(0.15 * p, "Karte laden …"));
  const mapG = fitMax(grayOf(tiles.canvas), 480);
  const m0 = bw / mapG.width;
  const img = grayOf(cv);
  const small = fitMax(img, 480);
  const search = prepareSearch(mapG);
  const cands: Match[] = await drive(locateCoarse(search, small, { minFrac: 0.06, maxFrac: 0.95, step: 1.04, keep: 3 }), (p) => onProgress(0.15 + 0.45 * p, "Ort suchen …"));
  let best: PlaceResult | null = null;
  for (let i = 0; i < cands.length; i++) {
    const m = cands[i]!;
    const s = (m.k * m0 * small.width) / img.width;
    const t0: Affine = { a: s, b: 0, c: b.minE + m.x * m0, d: 0, e: -s, f: b.maxN - m.y * m0 };
    const span = 0.4 / cands.length;
    const r = await refine(img, t0, onProgress, 0.6 + span * i, 0.6 + span * (i + 1));
    if (r && (!best || r.score > best.score)) best = r;
    if (best && best.score > 0.75) break;
  }
  onProgress(1, "");
  return best;
}

/** Feinabgleich ausgehend von einer Näherung (z. B. aus Passpunkten). */
export async function refinePlace(cv: HTMLCanvasElement, t0: Affine, onProgress: Progress): Promise<PlaceResult | null> {
  return refine(grayOf(cv), t0, onProgress, 0, 1);
}
