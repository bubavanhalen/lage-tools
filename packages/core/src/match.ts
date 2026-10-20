/**
 * Bildvergleich: findet einen Kartenausschnitt (z. B. Bildschirmfoto von map.geo.admin.ch)
 * in einem grösseren Kartenbild – Lage und Massstab, ohne Drehung.
 *
 * Verfahren: normierte Kreuzkorrelation (NCC) über FFT, zuerst grob über viele Massstäbe,
 * danach fein um den besten Treffer mit Interpolation unter Pixelgenauigkeit.
 */
import type { RGBAImage } from "./imageops";

export interface Gray {
  width: number;
  height: number;
  data: Float32Array;
}

/** Graustufen (Luminanz) aus RGBA. */
export function toGray(img: RGBAImage): Gray {
  const n = img.width * img.height;
  const out = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = 0.299 * img.data[p]! + 0.587 * img.data[p + 1]! + 0.114 * img.data[p + 2]!;
  return { width: img.width, height: img.height, data: out };
}

/** Kastenweichzeichner (separabel), Radius r. */
export function boxBlur(g: Gray, r: number): Gray {
  if (r < 1) return g;
  const { width: w, height: h } = g;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0, n = 0;
    const row = y * w;
    for (let x = -r; x < w + r; x++) {
      if (x + r < w) { s += g.data[row + Math.min(w - 1, x + r)]!; n++; }
      if (x - r - 1 >= 0) { s -= g.data[row + x - r - 1]!; n--; }
      if (x >= 0 && x < w) tmp[row + x] = s / n;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let y = -r; y < h + r; y++) {
      if (y + r < h) { s += tmp[Math.min(h - 1, y + r) * w + x]!; n++; }
      if (y - r - 1 >= 0) { s -= tmp[(y - r - 1) * w + x]!; n--; }
      if (y >= 0 && y < h) out[y * w + x] = s / n;
    }
  }
  return { width: w, height: h, data: out };
}

/** Grösse ändern (beim Verkleinern vorher weichzeichnen, dann bilinear abtasten). */
export function resizeGray(g: Gray, w: number, h: number): Gray {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const fx = g.width / w, fy = g.height / h;
  const src = Math.min(fx, fy) > 1.5 ? boxBlur(g, Math.floor(Math.min(fx, fy) / 2)) : g;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(g.height - 1, Math.max(0, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(g.height - 1, y0 + 1), ty = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(g.width - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(g.width - 1, x0 + 1), tx = sx - x0;
      const a = src.data[y0 * g.width + x0]!, b = src.data[y0 * g.width + x1]!;
      const c = src.data[y1 * g.width + x0]!, d = src.data[y1 * g.width + x1]!;
      out[y * w + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return { width: w, height: h, data: out };
}

/** Ausschnitt (ganzzahlig, wird auf das Bild begrenzt). */
export function cropGray(g: Gray, x: number, y: number, w: number, h: number): Gray {
  x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
  w = Math.min(g.width - x, Math.round(w)); h = Math.min(g.height - y, Math.round(h));
  const out = new Float32Array(Math.max(0, w * h));
  for (let r = 0; r < h; r++) out.set(g.data.subarray((y + r) * g.width + x, (y + r) * g.width + x + w), r * w);
  return { width: w, height: h, data: out };
}

// ---------- FFT ----------

const pow2 = (n: number) => { let p = 1; while (p < n) p <<= 1; return p; };

function fft1(re: Float64Array, im: Float64Array, off: number, stride: number, n: number, inv: boolean, bufR: Float64Array, bufI: Float64Array) {
  for (let i = 0; i < n; i++) { bufR[i] = re[off + i * stride]!; bufI[i] = im[off + i * stride]!; }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = bufR[i]!; bufR[i] = bufR[j]!; bufR[j] = t;
      t = bufI[i]!; bufI[i] = bufI[j]!; bufI[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inv ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = bufR[b]! * cr - bufI[b]! * ci, xi = bufR[b]! * ci + bufI[b]! * cr;
        bufR[b] = bufR[a]! - xr; bufI[b] = bufI[a]! - xi;
        bufR[a] = bufR[a]! + xr; bufI[a] = bufI[a]! + xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  for (let i = 0; i < n; i++) { re[off + i * stride] = bufR[i]!; im[off + i * stride] = bufI[i]!; }
}

function fft2(re: Float64Array, im: Float64Array, W: number, H: number, inv: boolean) {
  const bR = new Float64Array(Math.max(W, H)), bI = new Float64Array(Math.max(W, H));
  for (let y = 0; y < H; y++) fft1(re, im, y * W, 1, W, inv, bR, bI);
  for (let x = 0; x < W; x++) fft1(re, im, x, W, H, inv, bR, bI);
  if (inv) { const s = 1 / (W * H); for (let i = 0; i < re.length; i++) { re[i]! *= s; im[i]! *= s; } }
}

/** Vorbereitetes Suchbild: Spektrum und Summentabellen für die Fenster-Normierung. */
export interface SearchImage {
  g: Gray;
  W: number;
  H: number;
  re: Float64Array;
  im: Float64Array;
  s1: Float64Array; // Summentabelle (w+1)*(h+1)
  s2: Float64Array; // Summentabelle der Quadrate
}

export function prepareSearch(g: Gray): SearchImage {
  const W = pow2(g.width), H = pow2(g.height);
  const re = new Float64Array(W * H), im = new Float64Array(W * H);
  let mean = 0;
  for (let i = 0; i < g.data.length; i++) mean += g.data[i]!;
  mean /= g.data.length;
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) re[y * W + x] = g.data[y * g.width + x]! - mean;
  fft2(re, im, W, H, false);
  const w1 = g.width + 1;
  const s1 = new Float64Array(w1 * (g.height + 1)), s2 = new Float64Array(w1 * (g.height + 1));
  for (let y = 0; y < g.height; y++) {
    let r1 = 0, r2 = 0;
    for (let x = 0; x < g.width; x++) {
      const v = g.data[y * g.width + x]! - mean;
      r1 += v; r2 += v * v;
      s1[(y + 1) * w1 + x + 1] = s1[y * w1 + x + 1]! + r1;
      s2[(y + 1) * w1 + x + 1] = s2[y * w1 + x + 1]! + r2;
    }
  }
  return { g, W, H, re, im, s1, s2 };
}

export interface NccMap {
  width: number; // gültige Positionen x: 0..width-1
  height: number;
  score: Float32Array;
  best: { x: number; y: number; score: number };
}

/** NCC des Musters an allen gültigen Positionen im Suchbild. */
export function nccMap(s: SearchImage, tpl: Gray): NccMap | null {
  const { W, H, g } = s;
  const tw = tpl.width, th = tpl.height, n = tw * th;
  if (tw >= g.width || th >= g.height || tw < 4 || th < 4) return null;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += tpl.data[i]!;
  mean /= n;
  const re = new Float64Array(W * H), im = new Float64Array(W * H);
  let tn = 0;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const v = tpl.data[y * tw + x]! - mean;
    re[y * W + x] = v; tn += v * v;
  }
  tn = Math.sqrt(tn);
  if (tn < 1e-6) return null;
  fft2(re, im, W, H, false);
  // Kreuzkorrelation: S * conj(T)
  for (let i = 0; i < re.length; i++) {
    const ar = s.re[i]!, ai = s.im[i]!, br = re[i]!, bi = -im[i]!;
    re[i] = ar * br - ai * bi; im[i] = ar * bi + ai * br;
  }
  fft2(re, im, W, H, true);
  const vw = g.width - tw + 1, vh = g.height - th + 1, w1 = g.width + 1;
  const score = new Float32Array(vw * vh);
  let best = { x: 0, y: 0, score: -2 };
  for (let y = 0; y < vh; y++) for (let x = 0; x < vw; x++) {
    const a = y * w1 + x, b = y * w1 + x + tw, c = (y + th) * w1 + x, d = (y + th) * w1 + x + tw;
    const sum = s.s1[d]! - s.s1[b]! - s.s1[c]! + s.s1[a]!;
    const sq = s.s2[d]! - s.s2[b]! - s.s2[c]! + s.s2[a]!;
    const v = sq - (sum * sum) / n;
    const sc = v > 1e-6 ? re[y * W + x]! / (tn * Math.sqrt(v)) : 0;
    score[y * vw + x] = sc;
    if (sc > best.score) best = { x, y, score: sc };
  }
  return { width: vw, height: vh, score, best };
}

/** Treffer: Bildpixel (0,0) liegt bei (x, y) im Suchbild, ein Bildpixel = k Suchbild-Pixel. */
export interface Match {
  k: number;
  x: number;
  y: number;
  score: number;
}

/**
 * Grobsuche über viele Massstäbe. Als Generator, damit die Oberfläche zwischendurch zeichnen kann
 * (liefert den Fortschritt 0…1, am Ende die besten, deutlich verschiedenen Treffer, bester zuerst).
 * @param img Bild (bereits verkleinert, z. B. max. 600 px)
 * @param minFrac kleinste Bildbreite relativ zur Suchbildbreite
 */
export function* locateCoarse(
  search: SearchImage,
  img: Gray,
  opts: { minFrac?: number; maxFrac?: number; step?: number; keep?: number } = {},
): Generator<number, Match[]> {
  const { g } = search;
  const minW = Math.max(24, (opts.minFrac ?? 0.08) * g.width);
  const maxW = Math.min(g.width - 2, (opts.maxFrac ?? 0.95) * g.width, ((g.height - 2) * img.width) / img.height);
  const step = opts.step ?? 1.04;
  if (maxW < minW) return [];
  const widths: number[] = [];
  for (let w = minW; w <= maxW; w *= step) widths.push(w);
  const all: Match[] = [];
  for (let i = 0; i < widths.length; i++) {
    const tw = Math.round(widths[i]!), th = Math.round((tw * img.height) / img.width);
    const r = nccMap(search, resizeGray(img, tw, th));
    if (r) all.push({ k: tw / img.width, x: r.best.x, y: r.best.y, score: r.best.score });
    yield (i + 1) / widths.length;
  }
  all.sort((a, b) => b.score - a.score);
  const out: Match[] = [];
  const centre = (m: Match) => ({ x: m.x + (img.width * m.k) / 2, y: m.y + (img.height * m.k) / 2 });
  for (const m of all) {
    const c = centre(m);
    const distinct = out.every((o) => {
      const d = centre(o);
      return Math.hypot(c.x - d.x, c.y - d.y) > 0.1 * g.width || Math.abs(Math.log(m.k / o.k)) > 0.15;
    });
    if (distinct) out.push(m);
    if (out.length >= (opts.keep ?? 3)) break;
  }
  return out;
}

/** Scheitel einer Parabel durch drei Werte (für Interpolation unter Pixelgenauigkeit). */
function peak(a: number, b: number, c: number): number {
  const d = a - 2 * b + c;
  return d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0;
}

/**
 * Feinsuche um eine Näherung: Massstab ± range in kleinen Schritten, Lage frei im Suchbild.
 * Ergebnis mit Interpolation unter Pixelgenauigkeit (Lage und Massstab).
 */
export function* locateFine(
  search: SearchImage,
  img: Gray,
  init: { k: number },
  opts: { range?: number; step?: number } = {},
): Generator<number, Match | null> {
  const range = opts.range ?? 0.06, step = opts.step ?? 0.006;
  const ks: number[] = [];
  for (let f = -range; f <= range + 1e-9; f += step) ks.push(init.k * (1 + f));
  const results: Array<{ k: number; m: NccMap } | null> = [];
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i]!;
    const tw = Math.round(img.width * k), th = Math.round(img.height * k);
    const m = nccMap(search, resizeGray(img, tw, th));
    // tatsächlicher Massstab nach Rundung der Mustergrösse
    results.push(m ? { k: (tw / img.width + th / img.height) / 2, m } : null);
    yield (i + 1) / ks.length;
  }
  let bi = -1;
  results.forEach((r, i) => { if (r && (bi < 0 || r.m.best.score > results[bi]!.m.best.score)) bi = i; });
  if (bi < 0) return null;
  const { k, m } = results[bi]!;
  const { x, y, score } = m.best;
  const at = (xx: number, yy: number) => (xx >= 0 && yy >= 0 && xx < m.width && yy < m.height ? m.score[yy * m.width + xx]! : score);
  const dx = peak(at(x - 1, y), score, at(x + 1, y));
  const dy = peak(at(x, y - 1), score, at(x, y + 1));
  let kk = k;
  const prev = results[bi - 1], next = results[bi + 1];
  if (prev && next) kk = k + peak(prev.m.best.score, score, next.m.best.score) * (next.k - prev.k) / 2;
  return { k: kk, x: x + dx, y: y + dy, score };
}

/** Generator vollständig ausführen (für Tests und Worker). */
export function runSync<T>(gen: Generator<number, T>): T {
  for (;;) { const r = gen.next(); if (r.done) return r.value; }
}
