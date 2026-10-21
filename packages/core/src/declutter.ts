/**
 * Kollisionsauflösung für Kartenzeichen (Bildschirmpixel), wie im Lagebild-Prototyp:
 * Zeichen, die sich stark überdecken, bilden eine Ballung. Das Kern-Zeichen (gewählte Meldung
 * oder das Zeichen nächst dem Schwerpunkt) bleibt am Ort, die übrigen werden links und rechts in
 * Spalten aufgefächert. Der Aufrufer zeichnet für versetzte Zeichen einen Führungsstrich zum wahren Ort.
 *
 * Verbesserungen gegenüber dem Prototyp:
 * - Spalten benachbarter Ballungen werden gegeneinander und gegen ruhende Zeichen geprüft
 *   und bei Überlappung weiter nach aussen geschoben.
 * - Einzelne Zeichen, deren Beschriftung rechts mit einem Nachbarn kollidiert, links beschriften.
 *
 * Reine Funktion ohne Abhängigkeiten.
 */

/** Rechteck relativ zum Ankerpunkt: [links, oben, rechts, unten] (Pixel, y nach unten) */
export type Box = [number, number, number, number];

export interface DeclutterItem {
  /** wahrer Ort in Bildschirmpixeln */
  x: number;
  y: number;
  /** nur das Zeichen (für die Erkennung von Ballungen) */
  core: Box;
  /** Zeichen mit Beschriftung rechts */
  box: Box;
  /** Zeichen mit Beschriftung links (Standard: `box` gespiegelt am Zeichen) */
  boxL?: Box;
  /** bleibt in einer Ballung immer am Ort (z. B. gewählte Meldung) */
  pinned?: boolean;
}

export interface DeclutterPlacement {
  /** Position des Zeichens (Anker) */
  x: number;
  y: number;
  /** versetzt → Führungsstrich vom wahren Ort zum Zeichen zeichnen */
  moved: boolean;
  /** Seite der Beschriftung: 1 = rechts, -1 = links */
  side: 1 | -1;
  /** Nummer der Ballung (gleiche Nummer = gleiche Ballung), -1 = allein */
  group: number;
}

export interface DeclutterOptions {
  /** Anteil der Überdeckung (bezogen auf das kleinere Zeichen), ab dem eine Ballung entsteht (Standard 0.4) */
  overlap?: number;
  /** waagrechter Abstand der Spalten von der Ballung (Standard 22 px) */
  gap?: number;
  /** senkrechter Abstand der Zeichen in einer Spalte (Standard 3 px) */
  vgap?: number;
  /** Spalten höchstens so weit zusätzlich nach aussen schieben (Standard 240 px) */
  maxShift?: number;
}

type Rect = [number, number, number, number];

const rectOf = (x: number, y: number, b: Box): Rect => [x + b[0], y + b[1], x + b[2], y + b[3]];
const intersects = (a: Rect, b: Rect, pad = 0) => a[0] < b[2] + pad && a[2] + pad > b[0] && a[1] < b[3] + pad && a[3] + pad > b[1];
const area = (r: Rect) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);

/** Beschriftung links: das Zeichen bleibt, die Beschriftungsbreite wechselt die Seite. */
export function mirrorBox(box: Box, core: Box): Box {
  const extRight = box[2] - core[2];
  const extLeft = core[0] - box[0];
  return [core[0] - extRight, box[1], core[2] + extLeft, box[3]];
}

export function declutter(items: DeclutterItem[], opts: DeclutterOptions = {}): DeclutterPlacement[] {
  const overlap = opts.overlap ?? 0.4;
  const GAP = opts.gap ?? 22;
  const VGAP = opts.vgap ?? 3;
  const maxShift = opts.maxShift ?? 240;
  const n = items.length;
  const out: DeclutterPlacement[] = items.map((it) => ({ x: it.x, y: it.y, moved: false, side: 1, group: -1 }));
  if (n < 2) return out;
  const boxL = items.map((it) => it.boxL ?? mirrorBox(it.box, it.core));
  const boxOf = (i: number) => (out[i]!.side < 0 ? boxL[i]! : items[i]!.box);

  // ---- Ballungen: starke Überdeckung der Zeichen selbst (ohne Beschriftung)
  const cores = items.map((it) => rectOf(it.x, it.y, it.core));
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  // nach x sortiert durchgehen: nur Paare prüfen, die sich waagrecht überhaupt berühren können
  const order = items.map((_, i) => i).sort((a, b) => cores[a]![0] - cores[b]![0]);
  for (let a = 0; a < n; a++) {
    const i = order[a]!;
    const ri = cores[i]!;
    for (let b = a + 1; b < n; b++) {
      const j = order[b]!;
      const rj = cores[j]!;
      if (rj[0] >= ri[2]) break;
      const iw = Math.min(ri[2], rj[2]) - Math.max(ri[0], rj[0]);
      const ih = Math.min(ri[3], rj[3]) - Math.max(ri[1], rj[1]);
      if (iw <= 0 || ih <= 0) continue;
      const m = Math.min(area(ri), area(rj));
      if (m > 0 && (iw * ih) / m > overlap) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }

  interface Column { idx: number[]; dir: 1 | -1; group: number }
  const columns: Column[] = [];
  let gid = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const id = gid++;
    const cx = g.reduce((s, i) => s + items[i]!.x, 0) / g.length;
    const cy = g.reduce((s, i) => s + items[i]!.y, 0) / g.length;
    const dist = (i: number) => Math.hypot(items[i]!.x - cx, items[i]!.y - cy);
    const kern = g.find((i) => items[i]!.pinned) ?? [...g].sort((a, b) => dist(a) - dist(b) || a - b)[0]!;
    const rects = g.map((i) => rectOf(items[i]!.x, items[i]!.y, items[i]!.box));
    const gl = Math.min(...rects.map((r) => r[0]));
    const gr = Math.max(...rects.map((r) => r[2]));
    const L: number[] = [];
    const R: number[] = [];
    for (const i of g) {
      out[i]!.group = id;
      if (i === kern) continue;
      const dx = items[i]!.x - items[kern]!.x;
      (dx < -0.5 ? L : dx > 0.5 ? R : L.length <= R.length ? L : R).push(i);
    }
    for (const [col, dir] of [[L, -1], [R, 1]] as Array<[number[], 1 | -1]>) {
      if (!col.length) continue;
      col.sort((a, b) => items[a]!.y - items[b]!.y || a - b);
      let lastBottom = -Infinity;
      for (const i of col) {
        const o = out[i]!;
        o.side = dir;
        o.moved = true;
        const b = boxOf(i);
        o.x = dir < 0 ? gl - GAP - b[2] : gr + GAP - b[0];
        let y = items[i]!.y;
        if (y + b[1] < lastBottom + VGAP) y = lastBottom + VGAP - b[1];
        o.y = y;
        lastBottom = y + b[3];
      }
      // Spalte senkrecht auf die wahren Orte zentrieren
      const top = out[col[0]!]!.y + boxOf(col[0]!)[1];
      const bottom = out[col[col.length - 1]!]!.y + boxOf(col[col.length - 1]!)[3];
      const want = col.reduce((s, i) => s + items[i]!.y, 0) / col.length;
      const d = want - (top + bottom) / 2;
      for (const i of col) out[i]!.y += d;
      columns.push({ idx: col, dir, group: id });
    }
  }

  // ---- ruhende Einzelzeichen: Beschriftung links, wenn sie rechts mit einem Nachbarn kollidiert
  const finalRect = (i: number) => rectOf(out[i]!.x, out[i]!.y, boxOf(i));
  const still = out.map((o, i) => (o.moved ? -1 : i)).filter((i) => i >= 0);
  for (const i of still) {
    if (out[i]!.group >= 0) continue;
    const it = items[i]!;
    if (it.box[2] <= it.core[2] && it.box[1] >= it.core[1]) continue; // keine Beschriftung
    const hitsAt = (r: Rect) => {
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const other = out[j]!.moved ? finalRect(j) : rectOf(items[j]!.x, items[j]!.y, items[j]!.core);
        if (intersects(r, other)) return true;
      }
      return false;
    };
    if (hitsAt(rectOf(it.x, it.y, it.box)) && !hitsAt(rectOf(it.x, it.y, boxL[i]!))) out[i]!.side = -1;
  }

  // ---- Spalten gegeneinander und gegen ruhende Zeichen prüfen, bei Überlappung nach aussen schieben
  const obstacles: Array<{ r: Rect; group: number }> = still.map((i) => ({ r: finalRect(i), group: out[i]!.group }));
  columns.sort((a, b) => Math.min(...a.idx.map((i) => items[i]!.x)) - Math.min(...b.idx.map((i) => items[i]!.x)));
  for (const c of columns) {
    let shift = 0;
    for (let iter = 0; iter < 24; iter++) {
      const rs = c.idx.map((i) => { const r = finalRect(i); return [r[0] + shift, r[1], r[2] + shift, r[3]] as Rect; });
      let need = 0;
      for (const ob of obstacles) {
        for (const r of rs) {
          if (!intersects(r, ob.r, 2)) continue;
          const d = c.dir > 0 ? ob.r[2] + 4 - r[0] : r[2] + 4 - ob.r[0];
          if (d > need) need = d;
        }
      }
      if (need <= 0) break;
      shift += c.dir * need;
      if (Math.abs(shift) > maxShift) { shift = 0; break; }
    }
    for (const i of c.idx) {
      out[i]!.x += shift;
      obstacles.push({ r: finalRect(i), group: c.group });
    }
  }
  return out;
}
