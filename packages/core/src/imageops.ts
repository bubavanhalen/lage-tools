/**
 * Bildoperationen für die Umriss-Erkennung von NAI in Bildern (ohne Abhängigkeiten).
 *
 * Ablauf: Linienfarbe wählen → Maske «Linie» → von einem Klickpunkt aus fluten (Linien sind Wände)
 * → Fläche um halbe Linienbreite erweitern → Kontur verfolgen → vereinfachen.
 */
import { simplifyRing, type XY } from "./geo";

export interface RGBAImage {
  width: number;
  height: number;
  /** RGBA, 4 Byte pro Pixel (wie ImageData.data) */
  data: Uint8ClampedArray | Uint8Array;
}

export interface Mask {
  width: number;
  height: number;
  data: Uint8Array; // 0/1
}

/** Maske aller Pixel, deren Farbe nahe an `color` liegt (Distanz im RGB-Raum). */
export function colorMask(img: RGBAImage, color: [number, number, number], tolerance = 60): Mask {
  const out = new Uint8Array(img.width * img.height);
  const t2 = tolerance * tolerance;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const dr = img.data[p]! - color[0], dg = img.data[p + 1]! - color[1], db = img.data[p + 2]! - color[2];
    out[i] = dr * dr + dg * dg + db * db <= t2 ? 1 : 0;
  }
  return { width: img.width, height: img.height, data: out };
}

/** Dilatation mit quadratischem Element (Radius r). */
export function dilate(m: Mask, r: number): Mask {
  if (r <= 0) return m;
  const { width: w, height: h } = m;
  // separabel: erst horizontal, dann vertikal
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let run = -1;
    for (let x = 0; x < w; x++) if (m.data[y * w + x]) run = x;
      else if (run >= 0 && x - run <= r) tmp[y * w + x] = 1;
    run = -1;
    for (let x = w - 1; x >= 0; x--) {
      if (m.data[y * w + x]) { run = x; tmp[y * w + x] = 1; }
      else if (run >= 0 && run - x <= r) tmp[y * w + x] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let run = -1;
    for (let y = 0; y < h; y++) if (tmp[y * w + x]) { run = y; out[y * w + x] = 1; }
      else if (run >= 0 && y - run <= r) out[y * w + x] = 1;
    run = -1;
    for (let y = h - 1; y >= 0; y--) if (tmp[y * w + x]) run = y;
      else if (run >= 0 && run - y <= r) out[y * w + x] = 1;
  }
  return { width: w, height: h, data: out };
}

/**
 * Flutet von (sx, sy) über alle Pixel, die in `walls` 0 sind.
 * @returns Füllmaske oder null, wenn der Bereich offen ist (berührt den Bildrand) oder zu gross wird.
 */
export function floodFill(walls: Mask, sx: number, sy: number, maxFraction = 0.6): Mask | null {
  const { width: w, height: h } = walls;
  sx = Math.round(sx); sy = Math.round(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || walls.data[sy * w + sx]) return null;
  const out = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  out[sy * w + sx] = 1;
  let count = 0;
  const max = w * h * maxFraction;
  while (stack.length) {
    const i = stack.pop()!;
    count++;
    if (count > max) return null;
    const x = i % w, y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return null; // offen zum Rand
    for (const j of [i - 1, i + 1, i - w, i + w]) {
      if (!out[j] && !walls.data[j]) { out[j] = 1; stack.push(j); }
    }
  }
  return { width: w, height: h, data: out };
}

/** Verfolgt die Aussenkontur der (grössten zusammenhängenden) Fläche in der Maske (Moore-Nachbarschaft). */
export function traceContour(m: Mask): XY[] {
  const { width: w, height: h } = m;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m.data[y * w + x] === 1;
  let start = -1;
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) { start = i; break; }
  if (start < 0) return [];
  const sx = start % w, sy = (start - sx) / w;
  // 8 Richtungen im Uhrzeigersinn, beginnend links
  const dirs: Array<[number, number]> = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const ring: XY[] = [{ x: sx, y: sy }];
  let cx = sx, cy = sy, back = 0; // Herkunft: von links (Startpixel ist das erste in Zeilenreihenfolge)
  for (let guard = 0; guard < w * h * 4; guard++) {
    let found = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const nx = cx + dirs[d]![0], ny = cy + dirs[d]![1];
      if (at(nx, ny)) {
        back = (d + 4) % 8; // Richtung zurück zum vorherigen Pixel
        cx = nx; cy = ny;
        found = true;
        break;
      }
    }
    if (!found) break; // Einzelpixel
    if (cx === sx && cy === sy) break;
    ring.push({ x: cx, y: cy });
  }
  return ring;
}

/**
 * Erkennt den NAI-Umriss rund um einen Klickpunkt.
 * @param lineColor Farbe der Umrandung (RGB)
 * @param lineWidth Linienbreite in Pixeln (für die Erweiterung bis Linienmitte)
 * @returns Ring in Bildpixeln oder null
 */
export function detectOutline(
  img: RGBAImage,
  click: XY,
  lineColor: [number, number, number],
  opts: { tolerance?: number; lineWidth?: number; simplify?: number; closeGaps?: number } = {},
): XY[] | null {
  let walls = colorMask(img, lineColor, opts.tolerance ?? 70);
  // kleine Lücken in gestrichelten / unterbrochenen Linien schliessen
  if (opts.closeGaps) walls = dilate(walls, opts.closeGaps);
  const fill = floodFill(walls, click.x, click.y);
  if (!fill) return null;
  const grown = dilate(fill, Math.round((opts.lineWidth ?? 4) / 2 + (opts.closeGaps ?? 0)));
  const ring = traceContour(grown);
  if (ring.length < 4) return null;
  return simplifyRing(ring, opts.simplify ?? 1.5);
}

/**
 * Findet alle geschlossenen Flächen, die von Linien der Farbe `lineColor` umrandet sind
 * (berühren den Bildrand nicht, nicht zu klein, nicht zu gross). Buchstaben-Innenräume fallen weg.
 * @returns Ringe in Bildpixeln, grösste zuerst
 */
export function detectAllOutlines(
  img: RGBAImage,
  lineColor: [number, number, number],
  opts: { tolerance?: number; lineWidth?: number; simplify?: number; closeGaps?: number; minArea?: number; maxFraction?: number } = {},
): XY[][] {
  const { width: w, height: h } = img;
  let walls = colorMask(img, lineColor, opts.tolerance ?? 70);
  const gaps = opts.closeGaps ?? 1;
  if (gaps) walls = dilate(walls, gaps);
  const minArea = opts.minArea ?? Math.max(300, w * h * 0.0015);
  const maxArea = w * h * (opts.maxFraction ?? 0.7);
  const grow = Math.round((opts.lineWidth ?? 4) / 2 + gaps);
  const label = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  const rings: Array<{ ring: XY[]; area: number }> = [];
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (walls.data[start] || label[start]) continue;
    const id = ++next;
    let qh = 0, qt = 0, open = false;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    queue[qt++] = start;
    label[start] = id;
    while (qh < qt) {
      const i = queue[qh++]!;
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) open = true;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && !walls.data[i - 1] && !label[i - 1]) { label[i - 1] = id; queue[qt++] = i - 1; }
      if (x < w - 1 && !walls.data[i + 1] && !label[i + 1]) { label[i + 1] = id; queue[qt++] = i + 1; }
      if (y > 0 && !walls.data[i - w] && !label[i - w]) { label[i - w] = id; queue[qt++] = i - w; }
      if (y < h - 1 && !walls.data[i + w] && !label[i + w]) { label[i + w] = id; queue[qt++] = i + w; }
    }
    const area = qt;
    if (open || area < minArea || area > maxArea) continue;
    // schmale Gebilde (Strassenstücke zwischen zwei Linien) verwerfen
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (area / (bw * bh) < 0.08 || Math.min(bw, bh) < 8) continue;
    // Maske nur im Ausschnitt um die Fläche, dann bis Linienmitte erweitern
    const m = grow + 2;
    const ox = Math.max(0, minX - m), oy = Math.max(0, minY - m);
    const cw = Math.min(w, maxX + m + 1) - ox, ch = Math.min(h, maxY + m + 1) - oy;
    const sub = new Uint8Array(cw * ch);
    for (let k = 0; k < qt; k++) {
      const i = queue[k]!;
      const x = i % w, y = (i - x) / w;
      sub[(y - oy) * cw + (x - ox)] = 1;
    }
    const contour = traceContour(dilate({ width: cw, height: ch, data: sub }, grow));
    if (contour.length < 4) continue;
    const ring = simplifyRing(contour.map((p) => ({ x: p.x + ox, y: p.y + oy })), opts.simplify ?? 1.5);
    if (ring.length >= 3) rings.push({ ring, area });
  }
  return rings.sort((a, b) => b.area - a.area).map((r) => r.ring);
}

/** Schätzt die Linienbreite: kleinster Lauf der Linienfarbe nahe dem Klick (horizontal und vertikal). */
export function estimateLineWidth(walls: Mask, x: number, y: number, radius = 200): number {
  const { width: w, height: h } = walls;
  const runs: number[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    let px = Math.round(x), py = Math.round(y), n = 0, run = 0;
    while (n++ < radius && px >= 0 && py >= 0 && px < w && py < h) {
      if (walls.data[py * w + px]) run++;
      else if (run > 0) break;
      px += dx; py += dy;
    }
    if (run > 0) runs.push(run);
  }
  if (!runs.length) return 4;
  runs.sort((a, b) => a - b);
  return runs[0]!;
}
