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
  /** erzwingt die Einordnung (Umschalter in der Vorschau); sonst entscheidet der Inhalt */
  kind?: Kind;
  /** Übungstage (ISO-Datum), für «T1», «T2» */
  days: string[];
  /** Tag, wenn keiner genannt ist */
  day: string;
  /** jetzt (für Meldungen ohne Zeitangabe) */
  now: Date;
  /** letzte bekannte Lage eines Elements */
  lastPos?: (unit: string, side: Side) => LV95 | undefined;
}

export type WhereKind = "koordinate" | "raster" | "nai" | "ort" | "zuletzt" | "melder" | "karte";
/** Lageverfolgung: eigene Lage (Melder selbst) oder Sichtung (Feind / unklar) */
export type Kind = "eigen" | "feind" | "unklar";

export interface Draft {
  /** Minuten seit Mitternacht */
  minutes: number;
  day: string;
  /** ISO lokal, z. B. «2026-10-20T10:15» */
  t: string;
  timeFromText: boolean;
  kind: Kind;
  /** wie wurde eingeordnet (für die Vorschau) */
  kindFrom: "text" | "inhalt" | "vorgabe";
  side: Side;
  /** eigenes Element, das meldet (z. B. «H04») */
  melder: string;
  /** Element auf der Karte: bei «eigen» der Melder, bei Sichtungen ein bekanntes Feindelement oder leer */
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

const KIND_WORDS: Array<[RegExp, Kind]> = [
  [/^(?:seite\s+)?(?:rot|gegner|feind|fe)\b[:,]?\s*/i, "feind"],
  [/^(?:seite\s+)?(?:blau|eigen|eig)\b[:,]?\s*/i, "eigen"],
  [/^(?:unklar|unbekannt)\b[:,]?\s*/i, "unklar"],
];
const UNCLEAR_RE = /\b(unklar|unbekannt|nicht erkennbar|zivil\??|evtl\.?|vermutlich|möglicherweise)\b/i;
const ENEMY_RE = /\b(gegner|feind|fe|rot|verdächtig|bewaffnet|fremde?)\b/i;
/** Zeichen, die in LVZ-Meldungen fast immer eine Sichtung sind */
const SIGHTING_SYMS = new Set(["fz", "lw", "inf_gr", "inf_trp", "drohne", "patrouille", "hinterhalt", "sperre", "kontrollposten", "mun_lager", "kontakt"]);
const sideOf = (k: Kind): Side => (k === "eigen" ? "blau" : "rot");

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

  // ---- ausdrückliche Einordnung am Anfang («Rot …», «Feind …», «Eigen …»)
  let kind: Kind | null = null;
  for (const [re, k] of KIND_WORDS) {
    const m = re.exec(rest);
    if (m) { kind = k; rest = rest.slice(m[0].length); break; }
  }
  const explicit = kind !== null;
  const text = rest.trim();

  // ---- Elemente: Melder (eigen) und ggf. bekanntes Feindelement
  const known: Array<[string, Side]> = [
    ...ctx.units.rot.map((u) => [u, "rot"] as [string, Side]),
    ...ctx.units.blau.map((u) => [u, "blau"] as [string, Side]),
  ].sort((a, b) => b[0].length - a[0].length);
  const hits: Array<{ u: string; side: Side | null; index: number }> = [];
  for (const [u, sd] of known) {
    const m = flexRe(u).exec(text);
    if (m && !hits.some((h) => m.index >= h.index && m.index < h.index + h.u.length)) hits.push({ u, side: sd, index: m.index });
  }
  for (const m of text.matchAll(new RegExp(UNIT_RE.source, "gi"))) {
    const u = m[1]!.replace(/\.\s?|\s+/g, " ").replace(/^(\D+?)\s?(\d)/, (_, a: string, d: string) => (a.length > 1 ? `${a} ${d}` : a + d)).trim();
    if (!hits.some((h) => Math.abs(h.index - m.index!) < 2 || norm(h.u) === norm(u))) hits.push({ u, side: null, index: m.index! });
  }
  hits.sort((a, b) => a.index - b.index);
  const melderHit = hits.find((h) => h.side !== "rot");
  const enemyHit = hits.find((h) => h.side === "rot");
  const melder = melderHit?.u ?? "";

  // ---- Anzahl, Zeichen, Einordnung
  const cm = COUNT_RE.exec(text);
  const count = cm ? +cm[1]! : undefined;
  const sym = detectSymbol(text);
  let kindFrom: Draft["kindFrom"] = explicit ? "text" : "inhalt";
  if (ctx.kind) { kind = ctx.kind; kindFrom = "vorgabe"; }
  if (!kind) {
    if (UNCLEAR_RE.test(text)) kind = "unklar";
    else if (enemyHit || ENEMY_RE.test(text) || count !== undefined || SIGHTING_SYMS.has(sym)) kind = "feind";
    else kind = "eigen";
  }
  const side = sideOf(kind);
  const unit = kind === "eigen" ? melder : enemyHit?.u ?? "";
  const unitIndex = kind === "eigen" ? melderHit?.index ?? -1 : enemyHit?.index ?? -1;
  void unitIndex;
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
  const exclude = [...known.map(([u]) => u), ...hits.map((h) => h.u)].map((u) => u.replace(/\s/g, ""));
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
    if (kind === "eigen") {
      const last = melder ? ctx.lastPos?.(melder, "blau") : undefined;
      if (last) { pos = last; where = { kind: "zuletzt", label: "letzter Standort" }; }
    } else {
      // Sichtung ohne Ort: beim bekannten Feindelement, sonst beim Melder
      const lastEnemy = unit ? ctx.lastPos?.(unit, "rot") : undefined;
      const atMelder = melder ? ctx.lastPos?.(melder, "blau") : undefined;
      if (lastEnemy) { pos = lastEnemy; where = { kind: "zuletzt", label: "letzter Standort" }; }
      else if (atMelder) { pos = atMelder; where = { kind: "melder", label: `bei ${melder}` }; }
    }
  }

  const aff: Affiliation = kind === "eigen" ? "F" : kind === "feind" ? "H" : "U";
  return { minutes, day, t: isoOf(day, minutes), timeFromText, kind, kindFrom, side, melder, unit, sym, aff, count, dir, dirLabel, pos, where, cells, nai, placeQuery, text: text || input.trim() };
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
export function situationAt(events: LageEvent[], t: string, maxAgeMin = Infinity): { units: UnitState[]; loose: LageEvent[] } {
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

/** «Eigene», «Feind», «Unklar» (bzw. «UL») */
export function kindLabel(e: Pick<LageEvent, "side" | "aff">): string {
  if (e.side === "blau") return "Eigene";
  if (e.side === "ul") return "UL";
  return e.aff === "U" ? "Unklar" : "Feind";
}

const csvCell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function journalToCsv(events: LageEvent[], days: string[]): string {
  const head = ["Tag", "Zeit", "Art", "Element", "Melder", "Meldung", "Zeichen", "Ort", "Planquadrat", "NAI", "E", "N"];
  const rows = events.filter((e) => !e.deleted).sort((a, b) => a.t.localeCompare(b.t)).map((e) => {
    const d = e.t.slice(0, 10);
    const tag = days.indexOf(d) >= 0 ? `T${days.indexOf(d) + 1}` : d;
    return [tag, e.t.slice(11, 16), kindLabel(e), e.unit, e.melder ?? "", e.text, e.sym, e.where ?? "", (e.cells ?? []).join(" "), e.nai ?? "",
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
    melder: d.melder || undefined,
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
