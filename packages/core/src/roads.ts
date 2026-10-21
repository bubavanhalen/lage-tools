/**
 * Strassen im Gelände: Zeichen wie Sperre, Checkpoint, IED, Hinterhalt auf die wahrscheinlichste Strasse legen.
 *
 * Daten: swisstopo swissTLM3D «Strassen und Wege» (Layer `ch.swisstopo.swisstlm3d-strassen` der geo.admin-API).
 * Die App lädt sie kachelweise und speichert sie für den Betrieb ohne Netz (siehe `packages/ui/src/roadsource.ts`).
 * Hier nur reine Rechnungen (keine Abhängigkeiten, getestet).
 *
 * Objektart-Codes der geo.admin-API (`objektart`, geprüft über das htmlPopup des Layers):
 *   0 Ausfahrt · 1 Einfahrt · 2 Autobahn · 3 Raststätte · 4 Verbindung · 5 Zufahrt · 6 Dienstzufahrt
 *   8 10m Strasse · 9 6m Strasse · 10 4m Strasse · 11 3m Strasse · 12 Platz · 13 Autozug · 14 Fähre
 *   15 2m Weg · 16 1m Weg · 17 1m Wegfragment · 20 8m Strasse · 21 Autostrasse · 22 Klettersteig
 * `verkehrsbedeutung`: 100 Autobahn/Nationalstrasse · 200 Durchgangsstrasse · 300 Verbindungsstrasse · 999998 kein Wert.
 */
import type { LV95 } from "./lv95";
import type { Bounds } from "./raster";

export interface RoadSegment {
  /** eindeutige Kennung (z. B. aus TLM) */
  id: string;
  name?: string;
  /** TLM-Objektart (Strassenklasse) */
  cls: number;
  /** TLM-Verkehrsbedeutung (200 = Durchgangsstrasse, 300 = Verbindungsstrasse), falls bekannt */
  vb?: number;
  /** Polylinie in LV95 */
  pts: LV95[];
}

export interface RoadPlacement {
  pos: LV95;
  /** Strassenrichtung in Grad (0 = Nord, im Uhrzeigersinn), 0–180 */
  angle: number;
  road?: string;
  cls: number;
  /** Wichtigkeit (höher = Hauptstrasse) */
  rank: number;
  /** Strassenklasse im Klartext, z. B. «6m Strasse» */
  kind: string;
  /** Länge der gewählten Strasse innerhalb des Gebiets (m) */
  length: number;
  /** Kennung des Strassenstücks, auf dem der Punkt liegt */
  segId: string;
  /** nur bei `placeAlongRoad`: Punkt auf der Strasse (pos liegt daneben) */
  onRoad?: LV95;
  /** nur bei `placeAlongRoad`: Seite (1 = rechts, −1 = links in Richtung `angle`) */
  side?: 1 | -1;
  /** Bewertung (höher = wahrscheinlicher): Rang, −5 wenn nur gestreift, +50 im Text genannt, +100 von Hand gewählt */
  score?: number;
  /** Strasse von Hand gewählt («wahl») bzw. im Meldungstext genannt («text») statt nach Rang bestimmt */
  named?: "wahl" | "text";
  /** nur im Hauptergebnis: bis 3 verschiedene Strassen, wahrscheinlichste (= dieses Ergebnis) zuerst */
  candidates?: RoadPlacement[];
  /** nur im Hauptergebnis: Zweitbeste etwa gleich wichtig und gleich nahe (z. B. Kreuzung) – bitte bestätigen */
  ambiguous?: boolean;
}

/** Zielgebiet: Rechteck (Planquadrat, Unterquadrant) oder Polygon (NAI, Ring in LV95) */
export type RoadTarget = Bounds | LV95[];

export interface PlaceOptions {
  /**
   * Autobahn, Autostrasse, Ein-/Ausfahrten und Raststätten normal nach Wichtigkeit werten.
   * Standard false: Sie werden nur genommen, wenn im Gebiet keine andere Strasse liegt
   * (eine Sperre oder ein Checkpoint liegt in der Übung kaum auf der Autobahn – Brücken, Tunnels).
   */
  motorway?: boolean;
  /** Strassen unter diesem Rang ignorieren (z. B. 3 = keine Wege). Standard: alles mit Rang > 0. */
  minRank?: number;
  /** Meldungstext: eine darin genannte Strasse («Seftigenstr») gewinnt vor dem Rang */
  text?: string;
  /** von Hand gewählte Strasse (Name) – gewinnt vor allem anderen, auch knapp ausserhalb des Gebiets */
  road?: string;
  /** von Hand gewählte (unbenannte) Strasse über die Kennung eines ihrer Stücke */
  segId?: string;
}

/** Klartext der TLM-Objektart */
export const TLM_CLASS: Record<number, string> = {
  0: "Ausfahrt", 1: "Einfahrt", 2: "Autobahn", 3: "Raststätte", 4: "Verbindung", 5: "Zufahrt", 6: "Dienstzufahrt",
  8: "10m Strasse", 9: "6m Strasse", 10: "4m Strasse", 11: "3m Strasse", 12: "Platz", 13: "Autozug", 14: "Fähre",
  15: "2m Weg", 16: "1m Weg", 17: "1m Wegfragment", 20: "8m Strasse", 21: "Autostrasse", 22: "Klettersteig",
};

export function roadClassName(cls: number): string {
  return TLM_CLASS[cls] ?? "Strasse";
}

/** Grundwert der Wichtigkeit je Objektart (0 = nicht für Zeichen geeignet) */
const RANK: Record<number, number> = {
  2: 10, 21: 9, 8: 8, 20: 7, 9: 6, 10: 5, 11: 4, 4: 4, 0: 3, 1: 3, 5: 3, 3: 2, 12: 2, 6: 1, 15: 1, 16: 0.5, 17: 0.3,
  13: 0, 14: 0, 22: 0,
};
const MOTORWAY = new Set([0, 1, 2, 3, 21]);

export function isMotorway(cls: number): boolean {
  return MOTORWAY.has(cls);
}

/**
 * Wichtigkeit einer TLM-Objektart (höher = wichtiger).
 * Mit Verkehrsbedeutung: Durchgangsstrasse +1.5, Verbindungsstrasse +0.75 (= «Haupttrasse»).
 */
export function roadRank(cls: number, vb?: number): number {
  const base = RANK[cls] ?? 1;
  if (base <= 0) return 0;
  return base + (vb === 200 ? 1.5 : vb === 300 ? 0.75 : 0);
}

// ---------------------------------------------------------------- Geometrie

const isBounds = (t: RoadTarget): t is Bounds => !Array.isArray(t);

function ringOf(t: RoadTarget): LV95[] {
  if (!isBounds(t)) return t;
  return [{ e: t.minE, n: t.minN }, { e: t.maxE, n: t.minN }, { e: t.maxE, n: t.maxN }, { e: t.minE, n: t.maxN }];
}

function ringBounds(r: LV95[]): Bounds {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const p of r) { minE = Math.min(minE, p.e); maxE = Math.max(maxE, p.e); minN = Math.min(minN, p.n); maxN = Math.max(maxN, p.n); }
  return { minE, maxE, minN, maxN };
}

/** Schwerpunkt eines Rings (Fläche), bei entarteten Ringen Mittel der Ecken */
function centroidOf(r: LV95[]): LV95 {
  let a = 0, ce = 0, cn = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!, q = r[(i + 1) % r.length]!;
    const x = p.e * q.n - q.e * p.n;
    a += x; ce += (p.e + q.e) * x; cn += (p.n + q.n) * x;
  }
  if (Math.abs(a) < 1e-9) return { e: r.reduce((s, p) => s + p.e, 0) / r.length, n: r.reduce((s, p) => s + p.n, 0) / r.length };
  return { e: ce / (3 * a), n: cn / (3 * a) };
}

function inRing(p: LV95, r: LV95[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]!, b = r[j]!;
    if ((a.n > p.n) !== (b.n > p.n) && p.e < ((b.e - a.e) * (p.n - a.n)) / (b.n - a.n) + a.e) inside = !inside;
  }
  return inside;
}

const lerp = (a: LV95, b: LV95, t: number): LV95 => ({ e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t });
const dist = (a: LV95, b: LV95) => Math.hypot(a.e - b.e, a.n - b.n);

/** Parameter t (0…1) auf AB, an denen AB die Kante CD schneidet */
function crossT(a: LV95, b: LV95, c: LV95, d: LV95): number | null {
  const rx = b.e - a.e, ry = b.n - a.n, sx = d.e - c.e, sy = d.n - c.n;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.e - a.e) * sy - (c.n - a.n) * sx) / den;
  const u = ((c.e - a.e) * ry - (c.n - a.n) * rx) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
}

/** Stück einer Polylinie innerhalb des Gebiets, mit Index des Ursprungsabschnitts je Teilstrecke */
interface Piece { pts: LV95[]; idx: number[] }

/** Schneidet eine Polylinie auf das Gebiet zu (auch konkave Polygone). */
export function clipPolyline(pts: LV95[], target: RoadTarget): LV95[][] {
  return clipPieces(pts, ringOf(target)).map((p) => p.pts);
}

function clipPieces(pts: LV95[], ring: LV95[]): Piece[] {
  const out: Piece[] = [];
  let cur: Piece | null = null;
  const rb = ringBounds(ring);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    // grobe Vorprüfung: Abschnitt ganz ausserhalb des Rechtecks
    if (Math.max(a.e, b.e) < rb.minE || Math.min(a.e, b.e) > rb.maxE || Math.max(a.n, b.n) < rb.minN || Math.min(a.n, b.n) > rb.maxN) { cur = null; continue; }
    const ts = [0, 1];
    for (let k = 0; k < ring.length; k++) {
      const t = crossT(a, b, ring[k]!, ring[(k + 1) % ring.length]!);
      if (t !== null) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k]!, t1 = ts[k + 1]!;
      if (t1 - t0 < 1e-9) continue;
      if (!inRing(lerp(a, b, (t0 + t1) / 2), ring)) { cur = null; continue; }
      const p0 = lerp(a, b, t0), p1 = lerp(a, b, t1);
      if (cur && dist(cur.pts[cur.pts.length - 1]!, p0) < 1e-6) { cur.pts.push(p1); cur.idx.push(i); }
      else { cur = { pts: [p0, p1], idx: [i] }; out.push(cur); }
    }
  }
  return out;
}

const pieceLen = (p: Piece) => { let s = 0; for (let i = 0; i + 1 < p.pts.length; i++) s += dist(p.pts[i]!, p.pts[i + 1]!); return s; };

/** nächster Punkt auf Strecke AB zu q */
function nearestOnSeg(a: LV95, b: LV95, q: LV95): LV95 {
  const dx = b.e - a.e, dy = b.n - a.n, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((q.e - a.e) * dx + (q.n - a.n) * dy) / l2)) : 0;
  return { e: a.e + dx * t, n: a.n + dy * t };
}

/** Richtung (0–180°, 0 = Nord, im Uhrzeigersinn) der Polylinie bei Punkt p auf Abschnitt i, geglättet über ±span m */
function directionAt(pts: LV95[], i: number, p: LV95, span = 15): number {
  const walk = (dirn: 1 | -1): LV95 => {
    let left = span, at = p, k = dirn > 0 ? i + 1 : i;
    while (k >= 0 && k < pts.length) {
      const nx = pts[k]!, d = dist(at, nx);
      if (d >= left) return lerp(at, nx, left / d);
      left -= d; at = nx; k += dirn;
    }
    return at;
  };
  const a = walk(-1), b = walk(1);
  let de = b.e - a.e, dn = b.n - a.n;
  if (Math.hypot(de, dn) < 1e-6) { const s0 = pts[i]!, s1 = pts[Math.min(i + 1, pts.length - 1)]!; de = s1.e - s0.e; dn = s1.n - s0.n; }
  const deg = (Math.atan2(de, dn) * 180) / Math.PI;
  return Math.round((((deg % 180) + 180) % 180) * 10) / 10;
}

// ---------------------------------------------------------------- Platzierung

interface GroupPiece { seg: RoadSegment; piece: Piece; rank: number; len: number }
interface Group { key: string; rank: number; cls: number; name?: string; len: number; pieces: GroupPiece[] }

/**
 * Strassenstücke im Gebiet zu «Strassen» zusammenfassen: gleicher Name (auch über Klassenwechsel hinweg),
 * bzw. ohne Name: gleicher Rang und zusammenhängend. Rang einer benannten Strasse = höchster Rang, der auf
 * mindestens `minLen` m vorkommt (ein kurzes Stück «Durchgangsstrasse» macht die Strasse nicht wichtiger).
 */
function buildGroups(target: RoadTarget, roads: RoadSegment[], opts: PlaceOptions, minLen: number): Group[] {
  const ring = ringOf(target);
  const groups = new Map<string, Group>();
  const unnamed: Group[] = [];
  for (const seg of roads) {
    if (seg.pts.length < 2) continue;
    let rank = roadRank(seg.cls, seg.vb);
    if (rank <= 0 || rank < (opts.minRank ?? 0)) continue;
    // Autobahn & Co. ans Ende (nur wenn sonst nichts im Gebiet liegt)
    const mw = !opts.motorway && isMotorway(seg.cls);
    if (mw) rank = rank / 100;
    const pieces = clipPieces(seg.pts, ring);
    if (!pieces.length) continue;
    const name = seg.name?.trim() || undefined;
    const gp = pieces.map((piece) => ({ seg, piece, rank, len: pieceLen(piece) }));
    const len = gp.reduce((s, p) => s + p.len, 0);
    if (name) {
      const key = `${mw ? "A" : ""}|${name}`;
      let g = groups.get(key);
      if (!g) { g = { key, rank, cls: seg.cls, name, len: 0, pieces: [] }; groups.set(key, g); }
      g.len += len;
      g.pieces.push(...gp);
    } else {
      unnamed.push({ key: `#${seg.id}`, rank, cls: seg.cls, len, pieces: gp });
    }
  }
  for (const g of groups.values()) {
    const byRank = new Map<number, { len: number; cls: number }>();
    for (const p of g.pieces) {
      const x = byRank.get(p.rank) ?? { len: 0, cls: p.seg.cls };
      x.len += p.len; byRank.set(p.rank, x);
    }
    const ranks = [...byRank.entries()].sort((a, b) => b[0] - a[0]);
    const best = ranks.find(([, x]) => x.len >= minLen) ?? ranks[0]!;
    g.rank = best[0]; g.cls = best[1].cls;
  }
  // unbenannte Stücke gleichen Rangs, die sich an den Enden berühren, zusammenführen
  const ends = (g: Group) => g.pieces.flatMap(({ piece }) => [piece.pts[0]!, piece.pts[piece.pts.length - 1]!]);
  const merged: Group[] = [];
  for (const g of unnamed) {
    const ge = ends(g);
    const hits = merged.filter((m) => m.rank === g.rank && ends(m).some((p) => ge.some((q) => dist(p, q) < 1.5)));
    if (!hits.length) { merged.push(g); continue; }
    const into = hits[0]!;
    into.len += g.len; into.pieces.push(...g.pieces);
    for (const h of hits.slice(1)) { into.len += h.len; into.pieces.push(...h.pieces); merged.splice(merged.indexOf(h), 1); }
  }
  return [...groups.values(), ...merged];
}

// ---------------------------------------------------------------- Strassenname im Meldungstext

/** Allgemeine Wörter, die allein nie eine bestimmte Strasse meinen */
const GENERIC = new Set([
  "strasse", "strassen", "gasse", "platz", "allee", "kreuzung", "bruecke", "autobahn", "hauptstrasse", "nebenstrasse",
  "feldweg", "waldweg", "richtung", "ausfahrt", "einfahrt", "verzweigung", "kreisel", "unterfuehrung", "ueberfuehrung",
]);
const SUFFIX_RE = /(strasse|gasse|weg|platz|allee|ring|rain|stutz)$/;

/** Schreibweise vereinheitlichen: klein, Umlaute ausgeschrieben, «str.» → «strasse», Satzzeichen → Leerschlag */
export function normRoadText(s: string): string {
  return s.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/str\b\.?/g, "strasse")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface RoadNameHit {
  name: string;
  /** 3 = ganzer Name (auch «Seftigenstr.», «Seftigen-Strasse»), 2 = Teilwort ab 5 Zeichen («Seftigen») */
  score: number;
}

/**
 * Welche der Strassennamen nennt der Meldungstext? Bester Treffer zuerst (ganzer Name vor Teilwort, längerer
 * Name vor kürzerem); leer, wenn keiner. Teilwörter unter 5 Zeichen und allgemeine Wörter («Strasse») zählen nicht.
 */
export function matchRoadNames(text: string, names: Iterable<string>): RoadNameHit[] {
  const toks = normRoadText(text).split(" ").filter(Boolean);
  if (!toks.length) return [];
  const out = new Map<string, number>();
  for (const name of names) {
    const nt = normRoadText(name).split(" ").filter(Boolean);
    if (!nt.length) continue;
    const compact = nt.join("");
    let score = 0;
    // ganzer Name: ein oder mehrere aufeinanderfolgende Wörter des Texts ergeben zusammen den Namen
    for (let i = 0; i < toks.length && !score; i++) {
      let s = "";
      for (let k = i; k < Math.min(toks.length, i + 4); k++) {
        s += toks[k];
        if (s === compact) { score = 3; break; }
        if (s.length >= compact.length) break;
      }
    }
    if (!score) {
      const stem = compact.replace(SUFFIX_RE, "");
      const words = nt.filter((w) => w.length >= 5 && !GENERIC.has(w));
      for (const t of toks) {
        if (t.length < 5 || GENERIC.has(t) || /^\d/.test(t)) continue;
        if (compact.startsWith(t) || (stem.length >= 5 && t.startsWith(stem)) || words.some((w) => w.startsWith(t))) { score = 2; break; }
      }
    }
    if (score) out.set(name, Math.max(out.get(name) ?? 0, score));
  }
  return [...out].map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score || b.name.length - a.name.length);
}

// ---------------------------------------------------------------- Platzierung (mit Kandidaten)

/** So weit (m) ausserhalb des Gebiets darf eine im Text genannte bzw. gewählte Strasse liegen */
export const NAMED_ROAD_NEAR = 250;

const sameName = (a?: string, b?: string) => !!a && !!b && normRoadText(a) === normRoadText(b);

function distToRing(p: LV95, ring: LV95[]): number {
  if (inRing(p, ring)) return 0;
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) d = Math.min(d, dist(p, nearestOnSeg(ring[i]!, ring[(i + 1) % ring.length]!, p)));
  return d;
}

interface Scored { g: Group; full: boolean; d: number; outside?: boolean }

/**
 * Legt einen Punkt auf die wahrscheinlichste Strasse im Zielgebiet (Planquadrat/Unterquadrant/NAI).
 * Wahl: (1) von Hand gewählte Strasse (`opts.road`/`opts.segId`), (2) im Meldungstext genannte Strasse
 * (`opts.text`, auch knapp ausserhalb des Gebiets: nächster Punkt auf ihr), (3) höchster Rang (Hauptstrasse);
 * Strassen, die das Gebiet nur knapp streifen, zählen erst, wenn nichts anderes da ist. Bei Gleichstand die
 * nächste zu `prefer` bzw. (ohne `prefer`) die längste im Gebiet.
 * Punkt: auf dieser Strasse am nächsten zu `prefer` bzw. zur Gebietsmitte, möglichst nicht am Rand.
 * Ergebnis mit `candidates` (bis 3 verschiedene Strassen, wahrscheinlichste zuerst) und `ambiguous`
 * (Zweitbeste etwa gleich wichtig – Rangunterschied < 1 – und etwa gleich nahe, z. B. Kreuzung zweier Hauptstrassen).
 * @param prefer bevorzugter Punkt (z. B. gemeldete Koordinate); Standard: Mitte des Gebiets
 * @returns null, wenn keine Strasse im Gebiet (bzw. keine genannte in der Nähe) liegt
 */
export function placeOnRoad(target: RoadTarget, roads: RoadSegment[], prefer?: LV95, opts: PlaceOptions = {}): RoadPlacement | null {
  const ring = ringOf(target);
  if (ring.length < 3) return null;
  const rb = ringBounds(ring);
  const size = Math.sqrt(Math.max(1, (rb.maxE - rb.minE) * (rb.maxN - rb.minN)));
  const minLen = Math.max(15, Math.min(80, 0.15 * size));
  const groups = buildGroups(target, roads, opts, minLen);
  const anchor = prefer ?? centroidOf(ring);
  const nearest = (g: Group) => {
    let best = { d: Infinity, p: anchor, seg: g.pieces[0]!.seg, i: 0 };
    for (const { seg, piece } of g.pieces) {
      for (let k = 0; k + 1 < piece.pts.length; k++) {
        const p = nearestOnSeg(piece.pts[k]!, piece.pts[k + 1]!, anchor);
        const d = dist(p, anchor);
        if (d < best.d) best = { d, p, seg, i: piece.idx[k]! };
      }
    }
    return best;
  };
  /** benannte Strasse ausserhalb des Gebiets (ganze Stücke), wenn sie höchstens NAMED_ROAD_NEAR m entfernt liegt */
  const outsideGroup = (name: string): Group | null => {
    const segs = roads.filter((s) => s.pts.length >= 2 && roadRank(s.cls, s.vb) > 0 && sameName(s.name, name));
    if (!segs.length) return null;
    const g: Group = {
      key: `~|${name}`, name: segs[0]!.name, cls: segs[0]!.cls, len: 0,
      rank: Math.max(...segs.map((s) => roadRank(s.cls, s.vb))),
      pieces: segs.map((seg) => ({ seg, rank: roadRank(seg.cls, seg.vb), len: 0, piece: { pts: seg.pts, idx: seg.pts.slice(1).map((_, i) => i) } })),
    };
    return distToRing(nearest(g).p, ring) <= NAMED_ROAD_NEAR ? g : null;
  };

  const scored: Scored[] = groups.map((g) => ({ g, full: g.len >= minLen, d: nearest(g).d }));
  const anyFull = scored.some((s) => s.full);
  const order = (a: Scored, b: Scored) =>
    Number(b.full) - Number(a.full) || b.g.rank - a.g.rank || (prefer ? a.d - b.d : b.g.len - a.g.len);
  const sorted = [...scored].sort(order);

  // 1. von Hand gewählt, 2. im Text genannt
  let pick: Scored | undefined;
  let how: "wahl" | "text" | undefined;
  if (opts.segId) pick = scored.find((s) => s.g.pieces.some((p) => p.seg.id === opts.segId));
  if (!pick && opts.road) {
    pick = scored.find((s) => sameName(s.g.name, opts.road));
    if (!pick) { const g = outsideGroup(opts.road); if (g) pick = { g, full: false, d: nearest(g).d, outside: true }; }
  }
  if (pick) how = "wahl";
  if (!pick && opts.text) {
    const names = new Set<string>();
    for (const s of scored) if (s.g.name) names.add(s.g.name);
    const rbN = { minE: rb.minE - NAMED_ROAD_NEAR, maxE: rb.maxE + NAMED_ROAD_NEAR, minN: rb.minN - NAMED_ROAD_NEAR, maxN: rb.maxN + NAMED_ROAD_NEAR };
    for (const s of roadsInBounds(roads, rbN)) if (s.name?.trim()) names.add(s.name.trim());
    for (const hit of matchRoadNames(opts.text, names)) {
      // gleich gute Treffer: zuerst die im Gebiet
      const inside = sorted.find((s) => sameName(s.g.name, hit.name));
      if (inside) { pick = inside; break; }
      const g = outsideGroup(hit.name);
      if (g) { pick = { g, full: false, d: nearest(g).d, outside: true }; break; }
    }
    if (pick) how = "text";
  }
  pick ??= sorted[0];
  if (!pick) return null;

  const margin = Math.min(25, 0.1 * size);
  const c = centroidOf(ring);
  const inner = ring.map((p) => {
    const d = dist(p, c) || 1;
    const f = Math.max(0, (d - margin * 1.41) / d);
    return { e: c.e + (p.e - c.e) * f, n: c.n + (p.n - c.n) * f };
  });
  const place = (s: Scored, named?: "wahl" | "text"): RoadPlacement => {
    const g = s.g;
    // Punkt nicht direkt an den Rand legen: zuerst im verkleinerten Gebiet suchen
    let at = null as ReturnType<typeof nearest> | null;
    if (!s.outside) {
      const innerPieces = g.pieces.flatMap((gp) =>
        clipPieces(gp.piece.pts, inner).map((ip) => ({ ...gp, piece: { pts: ip.pts, idx: ip.idx.map((k) => gp.piece.idx[k]!) } })));
      if (innerPieces.length) at = nearest({ ...g, pieces: innerPieces });
    }
    at ??= nearest(g);
    const seg = at.seg;
    const mw = !opts.motorway && isMotorway(g.cls);
    const r: RoadPlacement = {
      pos: { e: Math.round(at.p.e * 10) / 10, n: Math.round(at.p.n * 10) / 10 },
      angle: directionAt(seg.pts, at.i, at.p),
      road: g.name,
      cls: g.cls,
      rank: mw ? roadRank(g.cls) : g.rank,
      kind: roadClassName(g.cls),
      length: Math.round(g.len),
      segId: seg.id,
      score: Math.round((g.rank + (s.full || s.outside ? 0 : -5) + (named === "wahl" ? 100 : named === "text" ? 50 : 0)) * 100) / 100,
    };
    if (named) r.named = named;
    return r;
  };
  const best = place(pick, how);
  const others = sorted.filter((s) => s !== pick && (s.full || !anyFull)).slice(0, 2);
  const candidates = [best, ...others.map((s) => place(s))];
  const second = others[0];
  const ambiguous = !how && !!second && pick.full && second.full && Math.abs(second.g.rank - pick.g.rank) < 1
    && Math.abs(second.d - pick.d) <= Math.max(25, 0.2 * size);
  return { ...best, candidates, ambiguous };
}

/** Punkt um `offset` m quer zur Strasse versetzen, zur Gebietsmitte hin */
function offsetPlacement(r: RoadPlacement, c: LV95, offset: number): RoadPlacement {
  const a = (r.angle * Math.PI) / 180;
  const right = { e: Math.cos(a), n: -Math.sin(a) }; // rechts in Richtung `angle`
  const toC = (c.e - r.pos.e) * right.e + (c.n - r.pos.n) * right.n;
  const side: 1 | -1 = toC < 0 ? -1 : 1;
  return {
    ...r,
    onRoad: r.pos,
    side,
    pos: { e: Math.round((r.pos.e + right.e * offset * side) * 10) / 10, n: Math.round((r.pos.n + right.n * offset * side) * 10) / 10 },
  };
}

/**
 * Wie `placeOnRoad`, aber der Punkt liegt am Strassenrand (z. B. Hinterhalt): um `offset` m quer zur Strasse
 * versetzt, zur Gebietsmitte hin (Deckung ist nicht bekannt). `onRoad` = Punkt auf der Strasse. Kandidaten ebenso.
 */
export function placeAlongRoad(target: RoadTarget, roads: RoadSegment[], prefer?: LV95, offset = 25, opts: PlaceOptions = {}): RoadPlacement | null {
  const r = placeOnRoad(target, roads, prefer, opts);
  if (!r) return null;
  const c = centroidOf(ringOf(target));
  const out = offsetPlacement(r, c, offset);
  if (r.candidates) out.candidates = r.candidates.map((x) => offsetPlacement(x, c, offset));
  return out;
}

// ---------------------------------------------------------------- Daten (geo.admin)

/** Strassen, deren Ausdehnung das Gebiet berührt (schnelle Vorauswahl) */
export function roadsInBounds(roads: RoadSegment[], b: Bounds, margin = 0): RoadSegment[] {
  return roads.filter((r) => {
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
    for (const p of r.pts) { if (p.e < minE) minE = p.e; if (p.e > maxE) maxE = p.e; if (p.n < minN) minN = p.n; if (p.n > maxN) maxN = p.n; }
    return maxE >= b.minE - margin && minE <= b.maxE + margin && maxN >= b.minN - margin && minN <= b.maxN + margin;
  });
}

/** Kachel für das Laden/Speichern der Strassen (an `size` m ausgerichtet) */
export interface RoadTile { key: string; b: Bounds }

/** Kacheln (Standard 1 km), die das Gebiet abdecken */
export function roadTiles(b: Bounds, size = 1000): RoadTile[] {
  const out: RoadTile[] = [];
  const x0 = Math.floor(b.minE / size), x1 = Math.floor((b.maxE - 1e-6) / size);
  const y0 = Math.floor(b.minN / size), y1 = Math.floor((b.maxN - 1e-6) / size);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    out.push({ key: `${size}:${x}:${y}`, b: { minE: x * size, maxE: (x + 1) * size, minN: y * size, maxN: (y + 1) * size } });
  }
  return out;
}

/** Abfrage-URL (geo.admin identify) für ein Rechteck; Seiten zu `limit` (max. 200) mit `offset` */
export function tlmRoadsUrl(b: Bounds, offset = 0, limit = 200): string {
  const g = [b.minE, b.minN, b.maxE, b.maxN].map((v) => Math.round(v)).join(",");
  return "https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=esriGeometryEnvelope"
    + `&geometry=${g}&imageDisplay=500,500,96&mapExtent=${g}&tolerance=0&layers=all:ch.swisstopo.swisstlm3d-strassen`
    + `&sr=2056&geometryFormat=geojson&returnGeometry=true&limit=${limit}&offset=${offset}`;
}

/** Antwort der geo.admin-API (identify, geojson) → Strassenstücke. Ungeeignete Klassen (Fähre, Autozug, Klettersteig) fallen weg. */
export function parseTlmIdentify(json: unknown): RoadSegment[] {
  const res = (json as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(res)) return [];
  const out: RoadSegment[] = [];
  const r1 = (v: number) => Math.round(v * 10) / 10;
  (res as Array<Record<string, any>>).forEach((f, fi) => {
    const p = (f?.properties ?? f?.attributes ?? {}) as Record<string, unknown>;
    const cls = Number(p.objektart);
    if (!Number.isFinite(cls) || roadRank(cls) <= 0) return;
    const g = f?.geometry as { type?: string; coordinates?: unknown } | undefined;
    const lines: number[][][] = g?.type === "LineString" ? [g.coordinates as number[][]] : g?.type === "MultiLineString" ? (g.coordinates as number[][][]) : [];
    const name = typeof p.strassenname === "string" && p.strassenname.trim() && p.strassenname !== "-" ? p.strassenname.trim() : undefined;
    const vbn = Number(p.verkehrsbedeutung);
    const vb = vbn === 100 || vbn === 200 || vbn === 300 ? vbn : undefined;
    lines.forEach((ln, i) => {
      const pts = (ln ?? []).filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])).map((c) => ({ e: r1(c[0]!), n: r1(c[1]!) }));
      if (pts.length < 2) return;
      const fid = String(f?.id ?? f?.featureId ?? `f${fi}`);
      const seg: RoadSegment = { id: lines.length > 1 ? `${fid}-${i}` : fid, cls, pts };
      if (name) seg.name = name;
      if (vb) seg.vb = vb;
      out.push(seg);
    });
  });
  return out;
}
