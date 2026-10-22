/**
 * Fotos vorbereiten: zum Speichern verkleinern (JPEG), für die Texterkennung aufbereiten
 * (Graustufen, Hintergrund ausgleichen, Kontrast, leicht schärfen). Drehung gemäss EXIF beim Einlesen.
 * Die Bildoperationen (`toGray` … `sharpen`) sind reine Funktionen (getestet in test/photo.test.ts).
 */
import { newEventId, type Attachment } from "@lage/core";

/** längste Seite des gespeicherten Fotos */
export const PHOTO_MAX = 2000;
export const PHOTO_QUALITY = 0.8;

export interface Gray { w: number; h: number; d: Uint8ClampedArray }
export interface Rect { x: number; y: number; w: number; h: number }

// ---------------------------------------------------------------- reine Bildoperationen

/** RGBA → Graustufen (Luma) */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const d = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < d.length; i++, j += 4) d[i] = (rgba[j]! * 77 + rgba[j + 1]! * 150 + rgba[j + 2]! * 29) >> 8;
  return { w, h, d };
}

/** Mittelwert im Quadrat (2r+1)² – über ein Summenbild, O(n) */
export function boxBlur(g: Gray, r: number): Gray {
  const { w, h, d } = g;
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += d[y * w + x]!; sum[(y + 1) * W + x + 1] = sum[y * W + x + 1]! + row; }
  }
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = sum[y1 * W + x1]! - sum[y0 * W + x1]! - sum[y1 * W + x0]! + sum[y0 * W + x0]!;
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return { w, h, d: out };
}

/** Höchstwert im Quadrat (2r+1)² (trennbar: erst Zeilen, dann Spalten) – entfernt dunkle Schrift aus dem Hintergrund */
export function maxFilter(g: Gray, r: number): Gray {
  const { w, h, d } = g;
  const tmp = new Uint8ClampedArray(w * h), out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e; k++) if (d[y * w + k]! > m) m = d[y * w + k]!;
    tmp[y * w + x] = m;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    let m = 0;
    for (let k = Math.max(0, y - r), e = Math.min(h - 1, y + r); k <= e; k++) if (tmp[k * w + x]! > m) m = tmp[k * w + x]!;
    out[y * w + x] = m;
  }
  return { w, h, d: out };
}

/** Bild verkleinern (Mittelwert über Blöcke) bzw. auf Originalgrösse zurück (bilinear) */
export function downsample(g: Gray, f: number): Gray {
  const w = Math.max(1, Math.floor(g.w / f)), h = Math.max(1, Math.floor(g.h / f));
  const d = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let yy = y * f; yy < Math.min(g.h, (y + 1) * f); yy++) for (let xx = x * f; xx < Math.min(g.w, (x + 1) * f); xx++) { s += g.d[yy * g.w + xx]!; n++; }
    d[y * w + x] = n ? s / n : 255;
  }
  return { w, h, d };
}
export function upsample(s: Gray, w: number, h: number): Gray {
  const d = new Uint8ClampedArray(w * h);
  const fx = s.w / w, fy = s.h / h;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(s.h - 1, Math.max(0, (y + 0.5) * fy - 0.5)), y0 = Math.floor(sy), y1 = Math.min(s.h - 1, y0 + 1), ty = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(s.w - 1, Math.max(0, (x + 0.5) * fx - 0.5)), x0 = Math.floor(sx), x1 = Math.min(s.w - 1, x0 + 1), tx = sx - x0;
      const a = s.d[y0 * s.w + x0]! * (1 - tx) + s.d[y0 * s.w + x1]! * tx;
      const b = s.d[y1 * s.w + x0]! * (1 - tx) + s.d[y1 * s.w + x1]! * tx;
      d[y * w + x] = a * (1 - ty) + b * ty;
    }
  }
  return { w, h, d };
}

/**
 * Ungleichmässige Ausleuchtung (Schatten, Lampe, Blitz) ausgleichen: Papier-Helligkeit schätzen (Höchstwert, dann
 * glätten – auf verkleinertem Bild, schnell) und durch sie teilen → Papier gleichmässig weiss, Schrift bleibt dunkel.
 */
export function flattenBackground(g: Gray): Gray {
  const f = Math.max(1, Math.round(Math.max(g.w, g.h) / 400));
  const small = downsample(g, f);
  const r = Math.max(2, Math.round(Math.max(small.w, small.h) / 60));
  const bg = upsample(boxBlur(maxFilter(small, r), r * 2), g.w, g.h);
  const d = new Uint8ClampedArray(g.w * g.h);
  for (let i = 0; i < d.length; i++) d[i] = Math.min(255, (g.d[i]! * 255) / Math.max(24, bg.d[i]!));
  return { w: g.w, h: g.h, d };
}

/** Kontrast strecken: `lo`/`hi` Anteil der dunkelsten/hellsten Punkte wird schwarz/weiss */
export function stretch(g: Gray, lo = 0.01, hi = 0.02): Gray {
  const hist = new Uint32Array(256);
  for (const v of g.d) hist[v]!++;
  const n = g.d.length;
  let a = 0, b = 255, c = 0;
  for (let v = 0; v < 256; v++) { c += hist[v]!; if (c >= n * lo) { a = v; break; } }
  c = 0;
  for (let v = 255; v >= 0; v--) { c += hist[v]!; if (c >= n * hi) { b = v; break; } }
  if (b - a < 16) return g;
  const d = new Uint8ClampedArray(n);
  const k = 255 / (b - a);
  for (let i = 0; i < n; i++) d[i] = (g.d[i]! - a) * k;
  return { w: g.w, h: g.h, d };
}

/** leicht schärfen (Unschärfemaske, Radius 1) */
export function sharpen(g: Gray, amount = 0.6): Gray {
  const b = boxBlur(g, 1);
  const d = new Uint8ClampedArray(g.d.length);
  for (let i = 0; i < d.length; i++) d[i] = g.d[i]! + amount * (g.d[i]! - b.d[i]!);
  return { w: g.w, h: g.h, d };
}

/** Schwelle nach Otsu (trennt hell/dunkel bestmöglich) */
export function otsu(g: Gray): number {
  const hist = new Float64Array(256);
  for (const v of g.d) hist[v]!++;
  const n = g.d.length;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v]!;
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let v = 0; v < 256; v++) {
    wB += hist[v]!; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sB += v * hist[v]!;
    const mB = sB / wB, mF = (sum - sB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; th = v; }
  }
  return th;
}

export type Quad = [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];

/**
 * Papier auf dem Foto finden (heller als der Tisch): grösste helle Fläche, Ecken oben links, oben rechts, unten rechts,
 * unten links. null, wenn das Papier fast das ganze Bild füllt oder nichts Passendes da ist.
 */
export function findPaper(g: Gray): Quad | null {
  const f = Math.max(1, Math.round(Math.max(g.w, g.h) / 360));
  const s = downsample(g, f);
  const th = otsu(s);
  const { w, h } = s;
  const lab = new Int32Array(w * h).fill(-1);
  let bestN = 0, bestId = -1;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (lab[i] !== -1 || s.d[i]! <= th) continue;
    let n = 0;
    lab[i] = i; stack.push(i);
    while (stack.length) {
      const j = stack.pop()!; n++;
      const x = j % w, y = (j - x) / w;
      if (x > 0 && lab[j - 1] === -1 && s.d[j - 1]! > th) { lab[j - 1] = i; stack.push(j - 1); }
      if (x < w - 1 && lab[j + 1] === -1 && s.d[j + 1]! > th) { lab[j + 1] = i; stack.push(j + 1); }
      if (y > 0 && lab[j - w] === -1 && s.d[j - w]! > th) { lab[j - w] = i; stack.push(j - w); }
      if (y < h - 1 && lab[j + w] === -1 && s.d[j + w]! > th) { lab[j + w] = i; stack.push(j + w); }
    }
    if (n > bestN) { bestN = n; bestId = i; }
  }
  if (bestId < 0 || bestN < 0.12 * w * h || bestN > 0.93 * w * h) return null;
  // Kontrast Papier/Rest muss deutlich sein (sonst ist «hell» nur ein Lichtfleck)
  let inS = 0, outS = 0, outN = 0;
  for (let i = 0; i < w * h; i++) { if (lab[i] === bestId) inS += s.d[i]!; else { outS += s.d[i]!; outN++; } }
  if (outN && inS / bestN - outS / outN < 40) return null;
  let tl = { x: 0, y: 0, v: Infinity }, br = { x: 0, y: 0, v: -Infinity }, tr = { x: 0, y: 0, v: -Infinity }, bl = { x: 0, y: 0, v: Infinity };
  for (let i = 0; i < w * h; i++) {
    if (lab[i] !== bestId) continue;
    const x = i % w, y = (i - x) / w;
    if (x + y < tl.v) tl = { x, y, v: x + y };
    if (x + y > br.v) br = { x, y, v: x + y };
    if (x - y > tr.v) tr = { x, y, v: x - y };
    if (x - y < bl.v) bl = { x, y, v: x - y };
  }
  const sc = (p: { x: number; y: number }) => ({ x: (p.x + 0.5) * f, y: (p.y + 0.5) * f });
  const q: Quad = [sc(tl), sc(tr), sc(br), sc(bl)];
  // plausibles Viereck (nicht zu schmal)
  const len = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  if (Math.min(len(q[0], q[1]), len(q[3], q[2])) < 0.2 * g.w || Math.min(len(q[0], q[3]), len(q[1], q[2])) < 0.2 * g.h) return null;
  return q;
}

/** Projektive Abbildung (3×3, zeilenweise) von 4 Punkten auf 4 Punkte */
export function homography(src: Quad, dst: Quad): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!, { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gauss mit Pivot
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const k = A[r]![c]! / A[c]![c]!;
      for (let j = c; j < 9; j++) A[r]![j]! -= k * A[c]![j]!;
    }
  }
  const hh = A.map((r, i) => r[8]! / r[i]!);
  return [...hh, 1];
}

/** Papier gerade ziehen: Viereck `q` → Rechteck w×h (bilinear) */
export function warpQuad(g: Gray, q: Quad, w: number, h: number): Gray {
  // Abbildung Ziel → Quelle
  const H = homography([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], q);
  const d = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const z = H[6]! * x + H[7]! * y + H[8]!;
    const sx = (H[0]! * x + H[1]! * y + H[2]!) / z, sy = (H[3]! * x + H[4]! * y + H[5]!) / z;
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    if (x0 < 0 || y0 < 0 || x0 >= g.w - 1 || y0 >= g.h - 1) { d[y * w + x] = 255; continue; }
    const tx = sx - x0, ty = sy - y0, i = y0 * g.w + x0;
    d[y * w + x] = (g.d[i]! * (1 - tx) + g.d[i + 1]! * tx) * (1 - ty) + (g.d[i + g.w]! * (1 - tx) + g.d[i + g.w + 1]! * tx) * ty;
  }
  return { w, h, d };
}

/** Zielgrösse für das gerade gezogene Papier (mittlere Kantenlängen) */
export function quadSize(q: Quad): { w: number; h: number } {
  const len = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  return { w: Math.round((len(q[0], q[1]) + len(q[3], q[2])) / 2), h: Math.round((len(q[0], q[3]) + len(q[1], q[2])) / 2) };
}

/** Schwarz/weiss mit örtlicher Schwelle (Schrift dunkler als die Umgebung) */
export function binarize(g: Gray, r = 16, c = 14): Gray {
  const m = boxBlur(g, r);
  const d = new Uint8ClampedArray(g.d.length);
  for (let i = 0; i < d.length; i++) d[i] = g.d[i]! < m.d[i]! - c && g.d[i]! < 200 ? 0 : 255;
  return { w: g.w, h: g.h, d };
}

/**
 * Tabellen- und Formularlinien entfernen – sie stören die Erkennung. Zuerst lange waagrechte Läufe, dann alle
 * zusammenhängenden dunklen Teile, die lang und dünn sind (auch leicht schräge Linien). Schrift ist kürzer.
 * `min` = Mindestlänge in px.
 */
export function removeLines(b: Gray, min?: number): Gray {
  const { w, h } = b;
  // lange Läufe: deutlich länger als ein Wort (unscharfe fette Schrift verschmilzt sonst zu «Linien»)
  const L = min ?? Math.max(60, Math.round(0.15 * w));
  /** kürzere Stücke (z. B. senkrechte Linie zwischen zwei Querlinien) – länger als eine Schriftzeile */
  const S = Math.max(44, Math.round(0.022 * Math.max(w, h)));
  const d = new Uint8ClampedArray(b.d);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && d[y * w + x] === 0) run++;
      else { if (run >= L) for (let k = x - run; k < x; k++) d[y * w + k] = 255; run = 0; }
    }
  }
  // lange, dünne Teile (8er-Nachbarschaft)
  const seen = new Uint8Array(w * h);
  const stack: number[] = [], comp: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || d[i] !== 0) continue;
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    comp.length = 0;
    seen[i] = 1; stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      comp.push(j);
      const x = j % w, y = (j - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (!seen[k] && d[k] === 0) { seen[k] = 1; stack.push(k); }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // lang und dünn (Linienstück zwischen zwei Querlinien) oder grosses, lockeres Gitter
    const len = Math.max(bw, bh);
    const long = len >= S && comp.length < len * 8 && Math.min(bw, bh) < len * 0.25;
    const grid = bw * bh > 0.04 * w * h && comp.length < 0.12 * bw * bh;
    // Störpunkte (Rauschen, Staub)
    const speck = comp.length <= 8;
    if (long || grid || speck) for (const j of comp) d[j] = 255;
  }
  return { w, h, d };
}

/** ganze Aufbereitung für die Texterkennung (Graustufen → schwarz/weiss ohne Linien) */
export function prepareForOcr(g: Gray, o: { lines?: boolean } = {}): Gray {
  const flat = stretch(flattenBackground(g));
  const bin = binarize(sharpen(flat, 0.4), Math.max(8, Math.round(Math.max(g.w, g.h) / 120)));
  return o.lines === false ? bin : removeLines(bin);
}

/** Markiertes Rechteck auf die Bildgrenzen beschränken (null = zu klein / ausserhalb) */
export function clampRect(r: Rect, w: number, h: number): Rect | null {
  const x = Math.max(0, Math.min(w, Math.round(Math.min(r.x, r.x + r.w))));
  const y = Math.max(0, Math.min(h, Math.round(Math.min(r.y, r.y + r.h))));
  const x2 = Math.max(0, Math.min(w, Math.round(Math.max(r.x, r.x + r.w))));
  const y2 = Math.max(0, Math.min(h, Math.round(Math.max(r.y, r.y + r.h))));
  return x2 - x >= 16 && y2 - y >= 16 ? { x, y, w: x2 - x, h: y2 - y } : null;
}

// ---------------------------------------------------------------- Browser: Einlesen, Speichern, Aufbereiten

/** Bild einlesen, Drehung gemäss EXIF (Kamera hochkant) */
export async function decodeImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // ältere Browser: <img> wendet EXIF ebenfalls an
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return img;
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

const sizeOf = (s: ImageBitmap | HTMLImageElement | HTMLCanvasElement) => ("naturalWidth" in s ? { w: s.naturalWidth, h: s.naturalHeight } : { w: s.width, h: s.height });

/** auf ein Canvas zeichnen (verkleinert auf `max`, optional um `rot` × 90° gedreht) */
export function toCanvas(src: ImageBitmap | HTMLImageElement | HTMLCanvasElement, max = PHOTO_MAX, rot = 0): HTMLCanvasElement {
  const { w, h } = sizeOf(src);
  const k = Math.min(1, max / Math.max(w, h));
  const sw = Math.round(w * k), sh = Math.round(h * k);
  const q = ((rot % 4) + 4) % 4;
  const cv = document.createElement("canvas");
  cv.width = q % 2 ? sh : sw; cv.height = q % 2 ? sw : sh;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#fff"; c.fillRect(0, 0, cv.width, cv.height);
  c.translate(cv.width / 2, cv.height / 2);
  c.rotate((q * Math.PI) / 2);
  c.imageSmoothingQuality = "high";
  c.drawImage(src, -sw / 2, -sh / 2, sw, sh);
  return cv;
}

export const canvasBlob = (cv: HTMLCanvasElement, type = "image/jpeg", q = PHOTO_QUALITY) =>
  new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("Bild konnte nicht gespeichert werden"))), type, q));

export interface PreparedPhoto { blob: Blob; canvas: HTMLCanvasElement; att: Attachment }

/** Foto für den Anhang: verkleinert (~2000 px), JPEG 0.8, Metadaten (Anhang noch nicht gespeichert) */
export async function preparePhoto(file: Blob, rot = 0): Promise<PreparedPhoto> {
  const img = await decodeImage(file);
  const canvas = toCanvas(img, PHOTO_MAX, rot);
  if ("close" in img) img.close();
  const blob = await canvasBlob(canvas);
  const att: Attachment = {
    id: "att-" + newEventId(), kind: "foto", mime: "image/jpeg", createdAt: new Date().toISOString(),
    size: blob.size, width: canvas.width, height: canvas.height,
  };
  return { blob, canvas, att };
}

/**
 * Ausschnitt fürs Erkennen aufbereiten: Text braucht ~30 px Zeilenhöhe – kleine Ausschnitte werden vergrössert
 * (bis 2400 px Breite), grosse bleiben. Ergebnis: Graustufen-Canvas.
 */
export function ocrCanvas(src: HTMLCanvasElement, rect?: Rect | null): HTMLCanvasElement {
  const sel = rect ? clampRect(rect, src.width, src.height) : null;
  const r = sel ?? { x: 0, y: 0, w: src.width, h: src.height };
  const k = Math.min(3, Math.max(1, 1800 / Math.max(r.w, r.h * 0.75)));
  let w = Math.round(r.w * k), h = Math.round(r.h * k);
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  const c0 = tmp.getContext("2d", { willReadFrequently: true })!;
  c0.imageSmoothingQuality = "high";
  c0.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, w, h);
  let g = toGray(c0.getImageData(0, 0, w, h).data, w, h);
  // ganzes Foto: Papier suchen und gerade ziehen (Perspektive, Schräglage, Tisch weg)
  if (!sel) {
    const q = findPaper(g);
    if (q) {
      const s = quadSize(q);
      const kk = Math.min(1.6, 2200 / Math.max(s.w, s.h));
      g = warpQuad(g, q, Math.round(s.w * kk), Math.round(s.h * kk));
      w = g.w; h = g.h;
    }
  }
  const out = prepareForOcr(g);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const c = cv.getContext("2d")!;
  const id = c.createImageData(w, h);
  for (let i = 0, j = 0; i < out.d.length; i++, j += 4) { id.data[j] = id.data[j + 1] = id.data[j + 2] = out.d[i]!; id.data[j + 3] = 255; }
  c.putImageData(id, 0, 0);
  return cv;
}

/** Bild aus der Zwischenablage bzw. vom Ziehen (erste Bilddatei) */
export function imageFromTransfer(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  for (const f of Array.from(dt.files ?? [])) if (f.type.startsWith("image/")) return f;
  for (const it of Array.from(dt.items ?? [])) if (it.kind === "file" && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) return f; }
  return null;
}

export const fmtSize = (b?: number) => (b === undefined ? "" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} kB` : `${(b / 1048576).toFixed(1).replace(".", ",")} MB`);

/** Versuch: Varianten der Aufbereitung */
export function prepareForOcrMode(g: Gray, mode: string): Gray {
  const flat = stretch(flattenBackground(g));
  if (mode === "flat") return flat;
  const bin = binarize(boxBlur(flat, 1), Math.max(8, Math.round(Math.max(g.w, g.h) / 120)));
  if (mode === "bin") return removeLines(bin);
  const nl = removeLines(bin);
  const d = new Uint8ClampedArray(flat.d);
  for (let i = 0; i < d.length; i++) if (bin.d[i] === 0 && nl.d[i] === 255) d[i] = 255; // Linien weiss
  // Hintergrund (nicht Schrift-Umgebung) ganz weiss: Rauschen weg
  const near = boxBlur({ w: g.w, h: g.h, d: nl.d }, 3);
  for (let i = 0; i < d.length; i++) if (near.d[i] === 255) d[i] = 255;
  return { w: g.w, h: g.h, d };
}
