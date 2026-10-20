/**
 * Geometrie-Hilfen: Affine Transformation aus Punktpaaren, Polygone vereinfachen, Flächen, Punkt-in-Polygon.
 */

export interface XY {
  x: number;
  y: number;
}

/** Affine Transformation: X = a*x + b*y + c ; Y = d*x + e*y + f */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function applyAffine(t: Affine, p: XY): XY {
  return { x: t.a * p.x + t.b * p.y + t.c, y: t.d * p.x + t.e * p.y + t.f };
}

export function invertAffine(t: Affine): Affine {
  const det = t.a * t.e - t.b * t.d;
  if (Math.abs(det) < 1e-12) throw new Error("Transformation nicht umkehrbar");
  const a = t.e / det, b = -t.b / det, d = -t.d / det, e = t.a / det;
  return { a, b, c: -(a * t.c + b * t.f), d, e, f: -(d * t.c + e * t.f) };
}

/**
 * Bestimmt die affine Transformation aus mind. 3 Punktpaaren (kleinste Quadrate).
 * @returns Transformation und mittlerer Restfehler (in Zieleinheiten, z. B. Meter)
 */
export function fitAffine(src: XY[], dst: XY[]): { t: Affine; rms: number } {
  if (src.length !== dst.length || src.length < 3) throw new Error("Mindestens 3 Punktpaare nötig");
  // Normalgleichungen für [x y 1] * [a b c]^T = X (und analog für Y)
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const vx = [0, 0, 0], vy = [0, 0, 0];
  src.forEach((s, i) => {
    const r = [s.x, s.y, 1];
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) m[j]![k]! += r[j]! * r[k]!;
      vx[j]! += r[j]! * dst[i]!.x;
      vy[j]! += r[j]! * dst[i]!.y;
    }
  });
  const [a, b, c] = solve3(m, vx);
  const [d, e, f] = solve3(m, vy);
  const t = { a, b, c, d, e, f };
  const rms = Math.sqrt(src.reduce((s, p, i) => {
    const q = applyAffine(t, p);
    return s + (q.x - dst[i]!.x) ** 2 + (q.y - dst[i]!.y) ** 2;
  }, 0) / src.length);
  return { t, rms };
}

function solve3(m: number[][], v: number[]): [number, number, number] {
  const A = m.map((r, i) => [...r, v[i]!]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[piv]![col]!)) piv = r;
    [A[col], A[piv]] = [A[piv]!, A[col]!];
    const p = A[col]![col]!;
    if (Math.abs(p) < 1e-12) throw new Error("Punkte liegen auf einer Linie – bitte anders wählen");
    for (let k = col; k < 4; k++) A[col]![k]! /= p;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = A[r]![col]!;
      for (let k = col; k < 4; k++) A[r]![k]! -= f * A[col]![k]!;
    }
  }
  return [A[0]![3]!, A[1]![3]!, A[2]![3]!];
}

/** Douglas-Peucker-Vereinfachung eines geschlossenen Rings (ohne Wiederholung des Startpunkts). */
export function simplifyRing(ring: XY[], tolerance: number): XY[] {
  if (ring.length <= 4) return ring.slice();
  // am weitesten entfernten Punkt vom ersten als zweiten Anker wählen
  let far = 0, fd = -1;
  ring.forEach((p, i) => { const d = (p.x - ring[0]!.x) ** 2 + (p.y - ring[0]!.y) ** 2; if (d > fd) { fd = d; far = i; } });
  const a = dp(ring.slice(0, far + 1), tolerance);
  const b = dp([...ring.slice(far), ring[0]!], tolerance);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function dp(pts: XY[], tol: number): XY[] {
  if (pts.length < 3) return pts;
  const s = pts[0]!, e = pts[pts.length - 1]!;
  let idx = -1, max = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i]!, s, e);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [s, e];
  return [...dp(pts.slice(0, idx + 1), tol).slice(0, -1), ...dp(pts.slice(idx), tol)];
}

function segDist(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Fläche eines Rings (Betrag). */
export function ringArea(ring: XY[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

export function ringCentroid(ring: XY[]): XY {
  const n = ring.length || 1;
  return { x: ring.reduce((s, p) => s + p.x, 0) / n, y: ring.reduce((s, p) => s + p.y, 0) / n };
}

export function pointInRing(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
