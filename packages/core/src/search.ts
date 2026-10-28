/**
 * Eine Suche für alles: Planquadrat (inkl. Unterquadrant), Fläche (NAI/AO/Stao), Element (letzter Standort),
 * Koordinate (LV95/LV03/WGS84/Link), bekannter Ort und Rasterblatt.
 * Rein und ohne Abhängigkeiten – offline nutzbar. Die Online-Ortssuche (swisstopo) ergänzt die Oberfläche.
 */
import { compareEvents } from "./clock";
import { findCoordinates, formatLv95, isInSwitzerland, type LV95 } from "./lv95";
import type { Area, LageEvent, Place, Side } from "./model";
import { cellAtAny, cellBounds, findCells, sheetBounds, type Bounds, type RasterSheet } from "./raster";

export type SearchKind = "pq" | "element" | "flaeche" | "koordinate" | "blatt" | "ort";

export interface SearchHit {
  kind: SearchKind;
  /** Anzeige, z. B. «AK7 C», «NAI 2», «H04», «2'600'000 / 1'200'000» */
  label: string;
  /** Kurzbezeichnung für das Badge: PQ, NAI, AO, Stao, Fläche, Eigene, Feind, Unklar, UL, Koord, Ort, Blatt */
  badge: string;
  /** Zusatz, z. B. «Blatt BERN · 500 m», «zuletzt T2 06:50 · AM5» */
  detail?: string;
  /** Zielbereich zum Einpassen */
  bounds?: Bounds;
  /** Zielpunkt (wenn kein Bereich, sonst Mittelpunkt) */
  pos?: LV95;
  /** Umriss zum Aufblitzen (Flächen) */
  ring?: LV95[];
  /** Element: letzte Meldung (zum Auswählen) */
  eventId?: string;
  side?: Side;
  /** Treffer ist ein Unterquadrant */
  quadrant?: boolean;
  /** Relevanz 0–100 (höher = besser) */
  score: number;
}

export interface SearchContext {
  sheets: RasterSheet[];
  areas: Area[];
  events?: LageEvent[];
  units?: { rot: string[]; blau: string[]; ul: string[] };
  places?: Place[];
  /** Übungstage (ISO-Datum) für die Anzeige «T2 06:50» */
  days?: string[];
}

const KIND_ORDER: SearchKind[] = ["pq", "element", "flaeche", "koordinate", "blatt", "ort"];

/** Vergleichsschlüssel: klein, ohne Akzente, Leerzeichen, Punkte, Bindestriche; «H04» = «h4», «NAI 03» = «nai3». */
export function searchKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s.\-_/'’]/g, "")
    .replace(/(^|\D)0+(\d)/g, "$1$2");
}

/** Passt `q` auf `name`? 100 = gleich, 80 = Anfang, 70 = Wortanfang, 55 = enthalten, 0 = nein. */
export function matchScore(q: string, name: string): number {
  const kq = searchKey(q);
  const kn = searchKey(name);
  if (!kq || !kn) return 0;
  // Teileingabe mit Null («H0» → «H04»): ohne Entfernen führender Nullen vergleichen
  const raw = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s.\-_/'’]/g, "");
  if (kq !== kn && raw(name).startsWith(raw(q)) && raw(q).length > 0) return 80;
  if (kq === kn) return 100;
  if (kn.startsWith(kq)) return 80;
  if (kq.length < 2) return 0;
  const words = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[\s\-_/(),.]+/).filter(Boolean);
  if (words.some((w) => searchKey(w).startsWith(kq))) return 70;
  if (kn.includes(kq)) return 55;
  return 0;
}

export function ringBounds(ring: LV95[]): Bounds {
  return {
    minE: Math.min(...ring.map((p) => p.e)),
    maxE: Math.max(...ring.map((p) => p.e)),
    minN: Math.min(...ring.map((p) => p.n)),
    maxN: Math.max(...ring.map((p) => p.n)),
  };
}

/** «T2 06:50» (mit Übungstagen) bzw. «06:50» */
function timeLabel(t: string, days: string[]): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(t);
  if (!m) return t;
  const d = days.indexOf(m[1]!);
  return `${d >= 0 && days.length > 1 ? `T${d + 1} ` : ""}${m[2]}:${m[3]}`;
}

/** Ganze Eingabe (ohne Leer-/Satzzeichen) wurde als Treffer gelesen? */
function covers(raw: string, q: string): boolean {
  const k = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return k(raw) === k(q);
}

function pqHits(q: string, sheets: RasterSheet[]): SearchHit[] {
  const text = q.trim();
  let found = findCells(text, sheets);
  // umgekehrte Schreibweise «7AK», «14-K C»
  if (!found.length) {
    const m = /^(\d{1,2})\s*-?\s*([A-Za-z]{1,2})\b(.*)$/.exec(text);
    if (m) found = findCells(`${m[2]}${m[1]}${m[3]}`, sheets).map((f) => ({ ...f, raw: text }));
  }
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const f of found) {
    const key = `${f.sheetId}|${f.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const s = sheets.find((x) => x.id === f.sheetId)!;
    const size = f.quadrant ? `${s.cellW / 2} m` : `${s.cellW} m`;
    out.push({
      kind: "pq",
      label: f.label,
      badge: "PQ",
      detail: `${f.quadrant ? "Unterquadrant" : "Feld"} · Blatt ${s.name} · ${size}`,
      bounds: cellBounds(s, f.col, f.row, f.quadrant),
      quadrant: !!f.quadrant,
      score: covers(f.raw, text) ? 95 : 45,
    });
  }
  return out;
}

function coordHits(q: string, sheets: RasterSheet[]): SearchHit[] {
  const text = q.trim();
  const found = findCoordinates(text).map((c) => ({ pos: c.lv95, raw: c.raw, kind: c.kind as string }));
  // LV03 nur mit Leerzeichen getrennt: «600000 200000»
  const sp = /^(\d{6}(?:\.\d+)?)\s+(\d{6}(?:\.\d+)?)$/.exec(text.replace(/['’]/g, ""));
  if (!found.length && sp) found.push({ pos: { e: +sp[1]! + 2000000, n: +sp[2]! + 1000000 }, raw: text, kind: "lv03" });
  const names: Record<string, string> = { lv95: "LV95", lv03: "LV03", wgs84: "WGS84", link: "Link" };
  return found
    .filter((c) => isInSwitzerland(c.pos))
    .slice(0, 1)
    .map((c) => {
      const cell = cellAtAny(sheets, c.pos);
      return {
        kind: "koordinate" as const,
        label: formatLv95(c.pos),
        badge: "Koord",
        detail: `${names[c.kind] ?? c.kind}${cell ? ` · in ${cell.label}` : ""}`,
        pos: c.pos,
        score: c.kind === "link" || covers(c.raw, text) ? 92 : 40,
      };
    });
}

const AREA_BADGE: Record<Area["kind"], string> = { nai: "NAI", ao: "AO", stao: "Stao", other: "Fläche" };

function areaHits(q: string, areas: Area[]): SearchHit[] {
  const out: SearchHit[] = [];
  for (const a of areas) {
    if (a.ring.length < 3) continue;
    const s = matchScore(q, a.name);
    if (!s) continue;
    out.push({ kind: "flaeche", label: a.name, badge: AREA_BADGE[a.kind] ?? "Fläche", bounds: ringBounds(a.ring), ring: a.ring, score: s });
  }
  return out;
}

interface UnitInfo {
  unit: string;
  side: Side;
  last?: LageEvent;
  lastPos?: LageEvent;
}

function unitIndex(ctx: SearchContext): Map<string, UnitInfo> {
  const idx = new Map<string, UnitInfo>();
  const key = (side: Side, u: string) => `${side}:${searchKey(u)}`;
  const add = (side: Side, u: string) => {
    if (!u.trim()) return undefined;
    const k = key(side, u);
    let x = idx.get(k);
    if (!x) idx.set(k, (x = { unit: u.trim(), side }));
    return x;
  };
  const u = ctx.units ?? { rot: [], blau: [], ul: [] };
  u.blau.forEach((n) => add("blau", n));
  u.rot.forEach((n) => add("rot", n));
  u.ul.forEach((n) => add("ul", n));
  const evs = (ctx.events ?? []).filter((e) => !e.deleted).sort(compareEvents);
  for (const e of evs) {
    if (e.melder) add("blau", e.melder);
    if (!e.unit) continue;
    const x = add(e.side, e.unit)!;
    x.last = e;
    if (e.pos) x.lastPos = e;
  }
  return idx;
}

function elementHits(q: string, ctx: SearchContext): SearchHit[] {
  const out: SearchHit[] = [];
  const days = ctx.days ?? [];
  for (const x of unitIndex(ctx).values()) {
    const s = matchScore(q, x.unit);
    if (!s) continue;
    const aff = x.last?.aff;
    const badge = x.side === "blau" ? "Eigene" : x.side === "ul" ? "UL" : aff === "U" ? "Unklar" : "Feind";
    const lp = x.lastPos;
    const where = lp ? (lp.cells?.[0] ?? lp.where ?? "") : "";
    out.push({
      kind: "element",
      label: x.unit,
      badge,
      detail: lp ? `zuletzt ${timeLabel(lp.t, days)}${where ? ` · ${where}` : ""}` : x.last ? `${timeLabel(x.last.t, days)} · ohne Standort` : "noch keine Meldung",
      pos: lp?.pos,
      eventId: x.last?.id,
      side: x.side,
      score: s,
    });
  }
  return out;
}

function placeHits(q: string, places: Place[], sheets: RasterSheet[]): SearchHit[] {
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  for (const p of places) {
    const s = matchScore(q, p.name);
    if (!s || seen.has(searchKey(p.name))) continue;
    seen.add(searchKey(p.name));
    const cell = cellAtAny(sheets, p.pos);
    out.push({ kind: "ort", label: p.name, badge: "Ort", detail: cell ? `in ${cell.label}` : formatLv95(p.pos), pos: p.pos, score: s - 5 });
  }
  return out;
}

function sheetHits(q: string, sheets: RasterSheet[]): SearchHit[] {
  if (searchKey(q).length < 2) return [];
  return sheets
    .map((s) => ({ s, sc: matchScore(q, s.name) }))
    .filter((x) => x.sc >= 70)
    .map(({ s, sc }) => ({
      kind: "blatt" as const,
      label: s.name,
      badge: "Blatt",
      detail: `${s.colLabels[0]}–${s.colLabels.at(-1)} × ${s.rowLabels[0]}–${s.rowLabels.at(-1)} · ${s.cellW} m`,
      bounds: sheetBounds(s),
      score: sc - 10,
    }));
}

/**
 * Löst eine Sucheingabe auf. Reihenfolge nach Relevanz; bei Gleichstand PQ vor Element, Fläche, Koordinate, Blatt, Ort.
 * @param limit höchstens so viele Treffer
 */
export function searchAll(query: string, ctx: SearchContext, limit = 12): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const hits = [
    ...pqHits(q, ctx.sheets),
    ...elementHits(q, ctx),
    ...areaHits(q, ctx.areas),
    ...coordHits(q, ctx.sheets),
    ...sheetHits(q, ctx.sheets),
    ...placeHits(q, ctx.places ?? [], ctx.sheets),
  ];
  return hits
    .sort((a, b) => b.score - a.score || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.label.localeCompare(b.label, "de-CH", { numeric: true }))
    .slice(0, limit);
}

/** Lohnt sich die Online-Ortssuche? Nicht bei eindeutigem Planquadrat oder Koordinate. */
export function wantsPlaceLookup(query: string, hits: SearchHit[]): boolean {
  const q = query.trim();
  if (q.length < 3 || !/[a-zäöüéèà]{3}/i.test(q)) return false;
  return !hits.some((h) => (h.kind === "pq" || h.kind === "koordinate" || h.kind === "element") && h.score >= 90);
}

/** Mittelpunkt eines Treffers (Bereich oder Punkt). */
export function hitCenter(h: SearchHit): LV95 | undefined {
  if (h.bounds) return { e: (h.bounds.minE + h.bounds.maxE) / 2, n: (h.bounds.minN + h.bounds.maxN) / 2 };
  return h.pos;
}
