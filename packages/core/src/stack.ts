/**
 * Stapel für Kartenzeichen (Bildschirmpixel, nach jedem Zoom neu):
 * Zeichen, deren Rahmen sich auf dem Bildschirm überlappen, bilden einen Stapel am Ort des wichtigsten
 * Zeichens (oberstes). Ein Klick fächert den Stapel im Kreis um den Ort auf (`fanLayout`).
 * Ersetzt die frühere Kollisionsauflösung mit Führungsstrichen: im Normalzustand keine Striche,
 * die Übersicht zeigt einfacher, was wo passiert.
 *
 * Reine Funktionen ohne Abhängigkeiten.
 */

/** Rechteck relativ zum Ankerpunkt: [links, oben, rechts, unten] (Pixel, y nach unten) */
export type Box = [number, number, number, number];

export interface StackItem {
  /** angezeigter Ort (Anker) in Bildschirmpixeln */
  x: number;
  y: number;
  /** nur das Zeichen */
  core: Box;
  /** Zeichen mit Beschriftung rechts (Zeit, Zusatz); ohne Angabe = `core` */
  box?: Box;
  /** Wichtigkeit: höher = weiter oben im Stapel */
  prio: number;
}

export interface Stack {
  /** Indizes der Zeichen, wichtigstes (oberstes) zuerst */
  members: number[];
  /** Ort des Stapels = Ort des obersten Zeichens */
  x: number;
  y: number;
  /** Seite der Beschriftung des obersten Zeichens: 1 = rechts, -1 = links */
  side: 1 | -1;
}

export interface StackOptions {
  /** Überlappung (px, in beiden Richtungen), ab der zwei Zeichen einen Stapel bilden (Standard 3) */
  minOverlap?: number;
  /** Versatz der darunterliegenden Zeichen nach rechts oben (px, Standard 4) */
  peek?: number;
  /** so viele Zeichen eines Stapels sind sichtbar (Standard 3) */
  visible?: number;
}

type Rect = [number, number, number, number];
const rectOf = (x: number, y: number, b: Box): Rect => [x + b[0], y + b[1], x + b[2], y + b[3]];
const hit = (a: Rect, b: Rect, min = 0) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > min && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > min;

/** Beschriftung links: das Zeichen bleibt, die Beschriftungsbreite wechselt die Seite. */
export function mirrorBox(box: Box, core: Box): Box {
  const extRight = box[2] - core[2];
  const extLeft = core[0] - box[0];
  return [core[0] - extRight, box[1], core[2] + extLeft, box[3]];
}

/** Versatz des i-ten Zeichens eines geschlossenen Stapels (0 = oberstes); null = verdeckt */
export function peekOffset(i: number, opts: StackOptions = {}): [number, number] | null {
  const peek = opts.peek ?? 4;
  const visible = opts.visible ?? 3;
  if (i >= visible) return null;
  return [i * peek, -i * peek];
}

/** Reihenfolge: höhere Wichtigkeit zuerst, bei Gleichstand der kleinere Index (stabil) */
const byPrio = (items: StackItem[]) => (a: number, b: number) => items[b]!.prio - items[a]!.prio || a - b;

/**
 * Bildet die Stapel. Ein Stapel steht am Ort seines obersten Zeichens; ein weiteres Zeichen kommt hinzu,
 * wenn es den angezeigten Stapel (oberstes Zeichen samt Versatz der darunterliegenden) überlappt.
 * So bleiben alle Zeichen eines Stapels höchstens etwa eine Zeichengrösse von ihrem wahren Ort entfernt.
 */
export function buildStacks(items: StackItem[], opts: StackOptions = {}): Stack[] {
  const min = opts.minOverlap ?? 3;
  const order = byPrio(items);
  let groups: number[][] = items.map((_, i) => [i]);
  const display = (g: number[]): Rect => {
    const top = items[g[0]!]!;
    const r = rectOf(top.x, top.y, top.core);
    const k = Math.min(g.length, opts.visible ?? 3) - 1;
    const p = (opts.peek ?? 4) * Math.max(0, k);
    return [r[0], r[1] - p, r[2] + p, r[3]];
  };
  // so lange zusammenführen, bis sich keine zwei Stapel mehr überlappen (wichtigere Stapel zuerst)
  for (let pass = 0; pass < items.length + 1; pass++) {
    groups.sort((a, b) => order(a[0]!, b[0]!));
    const rects = groups.map(display);
    const used = new Array<boolean>(groups.length).fill(false);
    const next: number[][] = [];
    let merged = false;
    for (let a = 0; a < groups.length; a++) {
      if (used[a]) continue;
      used[a] = true;
      let g = groups[a]!;
      for (let b = a + 1; b < groups.length; b++) {
        if (used[b] || !hit(rects[a]!, rects[b]!, min)) continue;
        used[b] = true;
        g = [...g, ...groups[b]!].sort(order);
        merged = true;
      }
      next.push(g);
    }
    groups = next;
    if (!merged) break;
  }
  groups.sort((a, b) => order(a[0]!, b[0]!));

  // Beschriftung des obersten Zeichens links, wenn sie rechts auf einen anderen Stapel fällt
  const rects = groups.map(display);
  const labelRect = (g: number[], side: 1 | -1): Rect | null => {
    const it = items[g[0]!]!;
    if (!it.box) return null;
    return rectOf(it.x, it.y, side > 0 ? it.box : mirrorBox(it.box, it.core));
  };
  const sides: Array<1 | -1> = groups.map(() => 1);
  const blocked = (gi: number, r: Rect) => groups.some((_, j) => {
    if (j === gi) return false;
    if (hit(r, rects[j]!, 0)) return true;
    const lr = j < gi ? labelRect(groups[j]!, sides[j]!) : null; // bereits gesetzte Beschriftungen
    return !!lr && hit(r, lr, 0);
  });
  groups.forEach((g, gi) => {
    const right = labelRect(g, 1);
    if (!right) return;
    const it = items[g[0]!]!;
    if (it.box![2] <= it.core[2] && it.box![1] >= it.core[1]) return; // keine Beschriftung
    if (blocked(gi, right) && !blocked(gi, labelRect(g, -1)!)) sides[gi] = -1;
  });
  return groups.map((g, gi) => ({ members: g, x: items[g[0]!]!.x, y: items[g[0]!]!.y, side: sides[gi]! }));
}

export interface FanSlot {
  /** Versatz des Zeichens (Anker) vom Ort des Stapels */
  dx: number;
  dy: number;
  /** Seite der Beschriftung: 1 = rechts, -1 = links (linke Hälfte des Kreises) */
  side: 1 | -1;
}

export interface FanOptions {
  /** Mindestabstand zwischen den Zeichen samt Beschriftung (px, Standard 6) */
  gap?: number;
  /** kleinster Radius (px, Standard 30) */
  minR?: number;
  /** Zeichen im ersten Ring; jeder weitere Ring fasst doppelt so viele (Standard 8) */
  perRing?: number;
  /** freier Raum um den Ort (Punkt), Standard 8 px */
  hole?: number;
}

/**
 * Auffächern im Kreis um den Ort: erstes Zeichen oben (12 Uhr), dann im Uhrzeigersinn.
 * Der Radius wächst, bis sich keine zwei Zeichen samt Beschriftung überdecken (linke Kreishälfte
 * beschriftet links). Bei vielen Zeichen ein zweiter (dritter …) Ring.
 * @param boxes je Zeichen der Rahmen mit Beschriftung rechts; `cores` nur das Zeichen
 */
export function fanLayout(boxes: Box[], cores: Box[] = boxes, opts: FanOptions = {}): FanSlot[] {
  const n = boxes.length;
  if (n === 0) return [];
  if (n === 1) return [{ dx: 0, dy: 0, side: 1 }];
  const gap = opts.gap ?? 6;
  const per = Math.max(3, opts.perRing ?? 8);
  const hole = opts.hole ?? 8;
  // Ringgrössen: 8, 16, 32 … (letzter Ring so gross wie nötig, aber nicht unnötig klein)
  const rings: number[] = [];
  for (let left = n, cap = per; left > 0; cap *= 2) { const k = Math.min(left, cap); rings.push(k); left -= k; }
  if (rings.length > 1 && rings[rings.length - 1]! < 3) { const extra = rings.pop()!; rings[rings.length - 1]! += extra; }
  const out: FanSlot[] = new Array(n);
  const placed: Rect[] = [];
  const maxH = Math.max(...cores.map((c) => c[3] - c[1]));
  const maxW = Math.max(...cores.map((c) => c[2] - c[0]));
  let r0 = Math.max(opts.minR ?? 30, hole + Math.hypot(maxW, maxH) / 2 + 4);
  let idx = 0;
  rings.forEach((k, ri) => {
    const phase = ri % 2 ? Math.PI / k : 0;
    const slotsAt = (r: number) => {
      const s: Array<{ dx: number; dy: number; side: 1 | -1; rect: Rect }> = [];
      for (let j = 0; j < k; j++) {
        const a = -Math.PI / 2 + phase + (2 * Math.PI * j) / k;
        const dx = Math.round(Math.cos(a) * r), dy = Math.round(Math.sin(a) * r);
        const side: 1 | -1 = Math.cos(a) < -0.2 ? -1 : 1;
        const b = side > 0 ? boxes[idx + j]! : mirrorBox(boxes[idx + j]!, cores[idx + j]!);
        s.push({ dx, dy, side, rect: [dx + b[0] - gap / 2, dy + b[1] - gap / 2, dx + b[2] + gap / 2, dy + b[3] + gap / 2] });
      }
      return s;
    };
    const centre: Rect = [-hole, -hole, hole, hole];
    let r = r0;
    let s = slotsAt(r);
    for (let iter = 0; iter < 200; iter++) {
      const bad = s.some((a, i) => hit(a.rect, centre) || placed.some((p) => hit(a.rect, p)) || s.some((b, j) => j > i && hit(a.rect, b.rect)));
      if (!bad) break;
      r += 3;
      s = slotsAt(r);
    }
    s.forEach((x, j) => { out[idx + j] = { dx: x.dx, dy: x.dy, side: x.side }; placed.push(x.rect); });
    idx += k;
    r0 = r + maxH + gap;
  });
  return out;
}
