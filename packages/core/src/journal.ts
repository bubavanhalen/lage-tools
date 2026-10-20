/**
 * Lagejournal: Meldungen so eingeben, wie man sie mitschreibt, z. B.
 *   «1015 Rot 2 Fz in NAI 3 Rtg N»   «0955 Blau H04 Beo Stao AB12 C»   «T2 0315 Det 4 angekommen Wabern»
 * Erkannt werden Zeit (und Übungstag), Seite, Element, Ort, Zeichen, Anzahl und Richtung.
 * Die Erkennung macht nur Vorschläge; der Originaltext bleibt immer erhalten.
 */
import { pointInRing, ringCentroid } from "./geo";
import { findCoordinates, type LV95 } from "./lv95";
import { newEventId, type Area, type LageEvent, type Place, type Side } from "./model";
import { boundsCenter, cellBounds, findCells, type RasterSheet } from "./raster";
import { detectSymbol, symbolDef, type Affiliation } from "./symbols";
import { findTimes } from "./time";

export interface JournalContext {
  sheets: RasterSheet[];
  areas: Area[];
  units: { rot: string[]; blau: string[]; ul: string[] };
  /** bekannte Orte (z. B. Standorte, früher gefundene Ortsnamen) */
  places?: Place[];
  /** Seite, wenn im Text keine genannt ist (Umschalter in der Eingabe) */
  side: Side;
  /** Übungstage (ISO-Datum), für «T1», «T2» */
  days: string[];
  /** Tag, wenn keiner genannt ist */
  day: string;
  /** jetzt (für Meldungen ohne Zeitangabe) */
  now: Date;
  /** letzte bekannte Lage eines Elements */
  lastPos?: (unit: string, side: Side) => LV95 | undefined;
}

export type WhereKind = "koordinate" | "raster" | "nai" | "ort" | "zuletzt" | "karte";

export interface Draft {
  /** Minuten seit Mitternacht */
  minutes: number;
  day: string;
  /** ISO lokal, z. B. «2026-10-20T10:15» */
  t: string;
  timeFromText: boolean;
  side: Side;
  unit: string;
  sym: string;
  aff: Affiliation;
  count?: number;
  /** Bewegungsrichtung in Grad (0 = Nord) */
  dir?: number;
  /** Richtung als Text, z. B. «Rtg Bern» */
  dirLabel?: string;
  pos?: LV95;
  where?: { kind: WhereKind; label: string };
  cells?: string[];
  nai?: string;
  /** Ortsname, der (online) noch nachgeschlagen werden kann */
  placeQuery?: string;
  /** Meldungstext ohne führende Zeit/Seite */
  text: string;
}

const SIDE_WORDS: Array<[RegExp, Side]> = [
  [/^(?:seite\s+)?(?:rot|gegner|feind|fe)\b[:,]?\s*/i, "rot"],
  [/^(?:seite\s+)?(?:blau|eigen|eig)\b[:,]?\s*/i, "blau"],
  [/^(?:ul|übungsleitung|schiri)\b[:,]?\s*/i, "ul"],
];

/** Gängige Elementbezeichnungen: H04, Det 2, Zug 1, Gr 3, Trp 2, Pat 1, Kp, Zfhr … */
const UNIT_RE = /(?<![\wÄÖÜäöü])(H\d{1,3}|Det\.?\s?\d{1,2}|Zug\s?\d{1,2}|Z\s?\d|Gr\.?\s?\d{1,2}|Trp\.?\s?\d{1,2}|Pat\.?\s?\d{1,2}|Patr\.?\s?\d{1,2}|Zfhr|Kdt|Kp|LVZ|KP)(?![\wÄÖÜäöü])/i;

const DIRS: Record<string, number> = {
  N: 0, NORD: 0, NORDEN: 0, NO: 45, NE: 45, NORDOST: 45, NORDOSTEN: 45, O: 90, E: 90, OST: 90, OSTEN: 90,
  SO: 135, SE: 135, SÜDOST: 135, SÜDOSTEN: 135, S: 180, SÜD: 180, SÜDEN: 180, SW: 225, SÜDWEST: 225, SÜDWESTEN: 225,
  W: 270, WEST: 270, WESTEN: 270, NW: 315, NORDWEST: 315, NORDWESTEN: 315,
};

const COUNT_RE = /(?<![\d'’.:])(\d{1,3})\s*(?:x|×)?\s*(fz|fahrzeuge?|pw|lw|lastwagen|g-?klasse|duros?|pers(?:onen)?\.?|mann|sdt|soldaten|ag|angehörige|drohnen?|motorräder|töff)\b/i;

const pad = (n: number) => String(n).padStart(2, "0");
export const isoOf = (day: string, minutes: number) => `${day}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
export const minutesOf = (t: string) => { const m = /T(\d{2}):(\d{2})/.exec(t); return m ? +m[1]! * 60 + +m[2]! : 0; };

const norm = (s: string) => s.toLowerCase().replace(/[\s.\-_]/g, "").replace(/(\D)0+(\d)/g, "$1$2");

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Name als flexibler Suchausdruck: «NAI 3» passt auf «NAI3», «NAI-3», «nai 03». */
function flexRe(name: string): RegExp {
  const parts = name.trim().split(/(?<=\D)(?=\d)|(?<=\d)(?=\D)|\s+/).filter(Boolean).map((p) => (/^\d+$/.test(p) ? `0*${+p}` : escapeRe(p)));
  return new RegExp(`(?<![\\wÄÖÜäöü])${parts.join("[\\s\\-.]*")}(?![\\wÄÖÜäöü\\d])`, "i");
}

/** Mittelpunkt einer Fläche (liegt er ausserhalb, z. B. bei U-Form: erster Eckpunkt). */
export function areaCenter(a: Area): LV95 {
  const xy = a.ring.map((p) => ({ x: p.e, y: p.n }));
  const c = ringCentroid(xy);
  if (pointInRing(c, xy)) return { e: c.x, n: c.y };
  return a.ring[0]!;
}

export function parseMeldung(input: string, ctx: JournalContext): Draft {
  let rest = input.trim();
  // ---- Tag und Zeit am Anfang
  let day = ctx.day;
  const dm = /^T\s?(\d)\b[\s,:]*/i.exec(rest);
  if (dm) {
    const d = ctx.days[+dm[1]! - 1];
    if (d) day = d;
    rest = rest.slice(dm[0].length);
  }
  let minutes = ctx.now.getHours() * 60 + ctx.now.getMinutes();
  let timeFromText = false;
  const times = findTimes(rest);
  const lead = times.find((x) => x.index <= 2);
  if (lead) {
    minutes = lead.minutes;
    timeFromText = true;
    rest = (rest.slice(0, lead.index) + rest.slice(lead.index + lead.raw.length)).replace(/^[\s,:\-–]+/, "");
  } else if (times[0] && /\b(?:um|zeit|wann)\b\s*:?\s*$/i.test(rest.slice(0, times[0].index))) {
    minutes = times[0].minutes;
    timeFromText = true;
  }

  // ---- Seite am Anfang
  let side: Side | null = null;
  for (const [re, s] of SIDE_WORDS) {
    const m = re.exec(rest);
    if (m) { side = s; rest = rest.slice(m[0].length); break; }
  }
  const text = rest.trim();

  // ---- Element
  const known: Array<[string, Side]> = [
    ...ctx.units.rot.map((u) => [u, "rot"] as [string, Side]),
    ...ctx.units.blau.map((u) => [u, "blau"] as [string, Side]),
    ...ctx.units.ul.map((u) => [u, "ul"] as [string, Side]),
  ].sort((a, b) => b[0].length - a[0].length);
  let unit = "";
  let unitIndex = -1;
  for (const [u, s] of known) {
    const m = flexRe(u).exec(text);
    if (m && (unitIndex < 0 || m.index < unitIndex)) {
      unit = u; unitIndex = m.index;
      if (!side) side = s;
    }
  }
  if (!unit) {
    const m = UNIT_RE.exec(text);
    if (m) { unit = m[1]!.replace(/\.\s?|\s+/g, " ").replace(/^(\D+?)\s?(\d)/, (_, a: string, d: string) => (a.length > 1 ? `${a} ${d}` : a + d)).trim(); unitIndex = m.index; }
  }
  side ??= ctx.side;

  // ---- Anzahl, Richtung
  const cm = COUNT_RE.exec(text);
  const count = cm ? +cm[1]! : undefined;
  let dir: number | undefined;
  let dirLabel: string | undefined;
  const rm = /\b(?:rtg|richtung|fahrtrichtung|in\s+rtg)\.?\s+([A-Za-zÄÖÜäöü][\wÄÖÜäöü\-]*)/i.exec(text);
  if (rm) {
    const w = rm[1]!.toUpperCase();
    if (w in DIRS) dir = DIRS[w];
    else dirLabel = `Rtg ${rm[1]}`;
  }

  // ---- Ort
  let pos: LV95 | undefined;
  let where: Draft["where"];
  let cells: string[] | undefined;
  let nai: string | undefined;
  let placeQuery: string | undefined;
  const coords = findCoordinates(text);
  if (coords[0]) {
    pos = coords[0].lv95;
    where = { kind: "koordinate", label: "Koordinate" };
  }
  const exclude = [...known.map(([u]) => u), ...(unit ? [unit] : [])].map((u) => u.replace(/\s/g, ""));
  const found = findCells(text, ctx.sheets, { exclude });
  if (found.length) {
    cells = found.map((c) => c.label);
    if (!pos) {
      const f = found[0]!;
      const s = ctx.sheets.find((x) => x.id === f.sheetId)!;
      pos = boundsCenter(cellBounds(s, f.col, f.row, f.quadrant));
      where = { kind: "raster", label: f.label };
    }
  }
  const areaHits = ctx.areas
    .map((a) => ({ a, m: flexRe(a.name).exec(text) }))
    .filter((x) => x.m)
    .sort((x, y) => x.m!.index - y.m!.index || y.a.name.length - x.a.name.length);
  if (areaHits[0]) {
    nai = areaHits[0].a.name;
    if (!pos) { pos = areaCenter(areaHits[0].a); where = { kind: "nai", label: nai }; }
  }
  if (!pos && ctx.places?.length) {
    const p = [...ctx.places].sort((a, b) => b.name.length - a.name.length).find((pl) => flexRe(pl.name).test(text));
    if (p) { pos = p.pos; where = { kind: "ort", label: p.name }; }
  }
  if (!pos) {
    // Ortsname nach einer Präposition, z. B. «angekommen in Wabern», «bei Bümpliz»
    const pm = /\b(?:in|bei|beim|ab|an|auf|nach|bis|vor|höhe|richtung|rtg|ausgang|eingang|ortseingang|ortsausgang)\.?\s+([A-ZÄÖÜ][\wäöüÄÖÜß'’\-]+(?:\s+[A-ZÄÖÜ][\wäöüÄÖÜß'’\-]+)?)/.exec(text);
    if (pm && !/^(NAI|PQ|Rtg|Richtung|Rot|Blau)$/i.test(pm[1]!)) placeQuery = pm[1]!.replace(/[’']$/, "");
    const last = unit ? ctx.lastPos?.(unit, side) : undefined;
    if (last) { pos = last; where = { kind: "zuletzt", label: "letzter Standort" }; }
  }

  // ---- Zeichen und Zugehörigkeit
  const sym = detectSymbol(text);
  const unknown = /\b(unklar|unbekannt|nicht erkennbar)\b/i.test(text);
  const aff: Affiliation = unknown ? "U" : side === "rot" ? "H" : side === "blau" ? "F" : "N";

  return { minutes, day, t: isoOf(day, minutes), timeFromText, side, unit, sym, aff, count, dir, dirLabel, pos, where, cells, nai, placeQuery, text: text || input.trim() };
}

/** Lage zum Zeitpunkt: pro Element die letzte Meldung mit Standort (bis einschliesslich `t`). */
export interface UnitState {
  key: string;
  unit: string;
  side: Side;
  event: LageEvent;
  pos: LV95;
  /** Standorte bis `t` (für die Spur), älteste zuerst */
  track: LV95[];
}

export function unitKey(side: Side, unit: string): string {
  return `${side}:${norm(unit)}`;
}

/**
 * @param maxAgeMin Meldungen ohne Element werden nur so lange gezeigt (Minuten)
 */
export function situationAt(events: LageEvent[], t: string, maxAgeMin = 120): { units: UnitState[]; loose: LageEvent[] } {
  const live = events.filter((e) => !e.deleted && e.t <= t).sort((a, b) => a.t.localeCompare(b.t) || a.id.localeCompare(b.id));
  const byUnit = new Map<string, UnitState>();
  const loose: LageEvent[] = [];
  const tMin = Date.parse(t) - maxAgeMin * 60000;
  for (let e of live) {
    if (!e.unit) {
      if (e.pos && Date.parse(e.t) >= tMin) loose.push(e);
      continue;
    }
    const k = unitKey(e.side, e.unit);
    const cur = byUnit.get(k);
    // Tätigkeit (Kontakt, Sperre …): als eigenes Zeichen am Ort; das Element behält sein Zeichen
    if (symbolDef(e.sym).activity) {
      const pos = e.pos ?? cur?.pos;
      if (pos && Date.parse(e.t) >= tMin) loose.push({ ...e, pos });
      if (cur) e = { ...e, sym: cur.event.sym };
      else if (!e.pos) continue;
      else e = { ...e, sym: "einheit" };
    }
    if (e.pos) {
      const track = cur ? [...cur.track] : [];
      const last = track[track.length - 1];
      if (!last || last.e !== e.pos.e || last.n !== e.pos.n) track.push(e.pos);
      byUnit.set(k, { key: k, unit: e.unit, side: e.side, event: e, pos: e.pos, track });
    } else if (cur) {
      // Meldung ohne Ort: Element bleibt am letzten Standort, Zeichen/Text werden aktualisiert
      byUnit.set(k, { ...cur, event: { ...e, pos: cur.pos, sym: e.sym === "einheit" ? cur.event.sym : e.sym } });
    }
  }
  return { units: [...byUnit.values()], loose };
}

/** Letzter bekannter Standort eines Elements (für Meldungen ohne Ortsangabe). */
export function lastPosition(events: LageEvent[], side: Side, unit: string, before?: string): LV95 | undefined {
  const k = unitKey(side, unit);
  let best: LageEvent | undefined;
  for (const e of events) {
    if (e.deleted || !e.pos || !e.unit || unitKey(e.side, e.unit) !== k) continue;
    if (before && e.t > before) continue;
    if (!best || e.t > best.t) best = e;
  }
  return best?.pos;
}

// ---------- Export ----------

const csvCell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function journalToCsv(events: LageEvent[], days: string[]): string {
  const head = ["Tag", "Zeit", "Seite", "Element", "Meldung", "Zeichen", "Ort", "Planquadrat", "NAI", "E", "N"];
  const rows = events.filter((e) => !e.deleted).sort((a, b) => a.t.localeCompare(b.t)).map((e) => {
    const d = e.t.slice(0, 10);
    const tag = days.indexOf(d) >= 0 ? `T${days.indexOf(d) + 1}` : d;
    return [tag, e.t.slice(11, 16), e.side === "rot" ? "Rot" : e.side === "blau" ? "Blau" : "UL", e.unit, e.text, e.sym, e.where ?? "", (e.cells ?? []).join(" "), e.nai ?? "",
      e.pos ? String(Math.round(e.pos.e)) : "", e.pos ? String(Math.round(e.pos.n)) : ""];
  });
  return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}

/** Neuer Journaleintrag aus einer erkannten Meldung. */
export function eventFromDraft(d: Draft, device: string, now = new Date()): LageEvent {
  return {
    id: newEventId(now.getTime()),
    rev: 1,
    device,
    updatedAt: now.toISOString(),
    t: d.t,
    side: d.side,
    unit: d.unit,
    text: d.text,
    label: d.count ? String(d.count) : undefined,
    sym: d.sym,
    aff: d.aff,
    pos: d.pos,
    cells: d.cells,
    nai: d.nai,
    count: d.count,
    dir: d.dir,
    where: d.where?.label,
    source: { kind: "text" },
    confirmed: true,
  };
}

/** Änderung an einem Eintrag (Revision hochzählen, für den späteren Abgleich zwischen Geräten). */
export function reviseEvent(e: LageEvent, patch: Partial<LageEvent>, device: string, now = new Date()): LageEvent {
  return { ...e, ...patch, rev: e.rev + 1, device, updatedAt: now.toISOString() };
}
