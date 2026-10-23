/**
 * Aufbereitung der Meldungen für «Lage Rot» (Kräfte Rot, mögliche Aktionen Rot) – intern, nicht im öffentlichen Index.
 * Gleiche Grundsätze wie `hints.ts`: nur Meldungen bis zur Lagezeit, gelöschte zählen nicht, aktuelle Revision gilt.
 */
import { catalogEntry, type CatalogEntry, type Echelon } from "./catalog";
import { pointInRing } from "./geo";
import { baseCellAt, type BaseCell } from "./hintgeo";
import type { LV95 } from "./lv95";
import type { Area, Exercise, LageEvent } from "./model";

/** Distanz in m (LV95) – schnell (ohne Math.hypot), wird sehr oft gerechnet */
const dist = (a: LV95, b: LV95): number => { const x = b.e - a.e, y = b.n - a.n; return Math.sqrt(x * x + y * y); };

export const MIN_MS = 60000;

/** Personen je Stufe als Spanne (Schätzung für «1 Trp Inf», «1 Gr Inf» …): [vorsichtig, höchstens] */
export const ECHELON_PERS_RANGE: Record<Echelon, [number, number]> = {
  trp: [3, 5], gr: [6, 10], hz: [12, 18], zug: [25, 35], kp: [80, 120], bat: [400, 600], rgt: [1200, 1800], br: [3000, 5000], div: [8000, 12000],
};

/** Fahrzeug-Zeichen ohne bestimmten Typ (passen zu jedem Fz-Typ) */
export const GENERIC_FZ = new Set(["fz", "kolonne", "einheit"]);
const AIR = new Set(["drohne", "uav_einheit", "heli", "heli_einheit", "flugzeug"]);
const PERS_CATS = new Set(["Kampftruppen", "Zivile und Irreguläre"]);
const L = String.raw`\p{L}`;
const word = (alt: string) => new RegExp(`(?<!${L})(?:${alt})(?!${L})`, "iu");
/** Angabe aus fremder, nicht überprüfbarer Quelle (zählt nicht zur Untergrenze) */
export const HEARSAY_RE = word("zivilperson|zivilist|anwohner|anwohnerin|passant|passantin|angeblich|angebliche|angeblicher|gerücht|gerüchte|anonym|anonymer|anonyme|hörensagen");
const CIVIL_PERS_RE = new RegExp(`(?:wanderer|wandergruppe|spaziergänger|jogger|velofahrer|radfahrer|schulklasse|kinder|touristen|pfadi|familie)(?!${L})`, "iu");
const PERS_WORD_RE = word("pers|personen|person|mann|sdt|soldaten|bewaffnete|bewaffneter");
export const HALT_RE = word("hält|halten|halt|hielt|steht|stehen|stand|stoppt|parkiert|wartet|warten|bereit|bereitgestellt|laufendem motor");
export const MOVE_RE = word("fährt|fahren|rollt|rollen|verschiebt|verschieben|bewegt|bewegen|marschiert|marschieren|rtg|richtung|nähert|nähern");
const COLOR_RE = new RegExp(`(?<!${L})(weiss|weiß|schwarz|grau|silber|silbern|blau|grün|gelb|orange|braun|beige|rot|dunkel|hell)(e[rsnm]?|en)?(?!${L})`, "iu");
const VEH_NOUN_RE = word("lieferwagen|kastenwagen|transporter|pw|personenwagen|lw|lastwagen|lkw|bus|kleinbus|motorrad|töff|quad|traktor|pick-?up|suv|limousine|kombi|jeep|duro|van");
const PLATE_RE = /(?<![\p{L}\d])(AG|AI|AR|BE|BL|BS|FR|GE|GL|GR|JU|LU|NE|NW|OW|SG|SH|SO|SZ|TG|TI|UR|VD|VS|ZG|ZH)\s?(\d{3,6})(?!\d)/u;
/** Strassennamen im Meldungstext, z. B. «Seftigenstrasse», «Eigerweg» */
const ROAD_NAME_RE = /(?<![\p{L}])(\p{Lu}[\p{Ll}äöüé-]+(?:strasse|straße|str\.|weg|gasse|allee|brücke|platz|ring|rain))(?![\p{L}])/u;

/** Elementnamen vergleichbar machen: «H 04» = «H4», «Det. 2» = «Det2» */
export const nk = (s: string) => s.toLowerCase().replace(/[\s.\-_]/g, "").replace(/(\D)0+(\d)/g, "$1$2");

export interface PEv {
  e: LageEvent;
  id: string;
  ms: number;
  pos?: LV95;
  cell: BaseCell | null;
  /** Ort ausdrücklich gemeldet (nicht «bei H04» / «letzter Standort») */
  precise: boolean;
  /** Ort nur über NAI (Mittelpunkt) */
  naiOnly: boolean;
  nais: string[];
  cat?: CatalogEntry;
  side: LageEvent["side"];
  feind: boolean;
  unklar: boolean;
  /** Element-Schlüssel (`nk`) bzw. leer */
  unitKey: string;
  melder: string;
  /** Personen: vorsichtig / höchstens */
  persLo: number;
  persHi: number;
  /** Fahrzeuge */
  fz: number;
  /** Typ-Zeilen (Katalog-Schlüssel, z. B. «kpz», «drohne», «mg») → Anzahl */
  types: Array<[string, number]>;
  isFz: boolean;
  isPers: boolean;
  isDrone: boolean;
  /** Bewegung zu Fuss (6 km/h) bzw. motorisiert/in der Luft (60 km/h) */
  foot: boolean;
  hearsay: boolean;
  moving: boolean;
  halt: boolean;
  /** Erkennungsmerkmal eines Fz ohne Element (Farbe + Typ, Kennzeichen) */
  sig?: string;
  road?: string;
}

const parseMs = (t: string | undefined) => {
  const ms = t ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? ms : NaN;
};
const pad = (n: number) => String(n).padStart(2, "0");
/** ISO lokal ohne Sekunden (wie `LageEvent.t`) */
export function isoOfMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const hmOf = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** Dauer kurz, z. B. «4 h 15′», «45′» */
export const durShort = (min: number) => { const m = Math.max(0, Math.round(min)); return m < 60 ? `${m}′` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}′` : ""}`; };

/** aktuelle Revision je ID (wie `mergeEvents`) */
export function currentEvents(events: LageEvent[]): LageEvent[] {
  const map = new Map<string, LageEvent>();
  for (const e of events) {
    const c = map.get(e.id);
    if (!c || e.rev > c.rev || (e.rev === c.rev && (e.updatedAt > c.updatedAt || (e.updatedAt === c.updatedAt && e.device > c.device)))) map.set(e.id, e);
  }
  return [...map.values()];
}

function sigOf(text: string): string | undefined {
  const plate = PLATE_RE.exec(text);
  if (plate) return `kz:${plate[1]}${plate[2]}`;
  const noun = VEH_NOUN_RE.exec(text);
  const c = COLOR_RE.exec(text);
  if (!noun || !c) return undefined;
  const base = c[1]!.toLowerCase().replace("ß", "ss");
  if ((base === "rot" || base === "blau") && !c[2]) return undefined;
  return `fz:${base}-${noun[0].toLowerCase()}`;
}

function toPEv(e: LageEvent, sheets: Exercise["sheets"], nais: Area[]): PEv | null {
  const ms = parseMs(e.t);
  if (!Number.isFinite(ms)) return null;
  const cat = catalogEntry(e.sym);
  const text = e.text ?? "";
  const where = e.where ?? "";
  const precise = !!e.pos && where !== "letzter Standort" && !/^bei\s/i.test(where);
  const cell = e.pos ? baseCellAt(sheets ?? [], e.pos) : null;
  const inNai = (a: Area) => e.nai === a.name || (precise && !!e.pos && a.ring.length >= 3 && pointInRing({ x: e.pos.e, y: e.pos.n }, a.ring.map((p) => ({ x: p.e, y: p.n }))));
  const isDrone = e.sym === "drohne" || e.sym === "uav_einheit" || (/drohne/i.test(text) && (!cat || cat.kind !== "einheit" || e.sym === "einheit"));
  const isAir = isDrone || AIR.has(e.sym);
  const isFz = !isAir && cat?.category === "Fahrzeuge";
  const civil = CIVIL_PERS_RE.test(text);
  const isPers = !isFz && !isAir && !civil &&
    (e.sym === "patrouille" || (cat?.kind === "einheit" && (PERS_CATS.has(cat.category) || (e.sym === "einheit" && PERS_WORD_RE.test(text)))));
  let persLo = 0, persHi = 0;
  if (isPers) {
    const n = e.count ?? (e.sym === "patrouille" ? 2 : 1);
    const r = e.echelon ? ECHELON_PERS_RANGE[e.echelon] : undefined;
    persLo = r ? n * r[0] : n;
    persHi = r ? n * r[1] : n;
  }
  const fz = isFz ? e.count ?? (e.sym === "kolonne" ? 3 : 1) : 0;
  const types: Array<[string, number]> = [];
  if (isFz && !GENERIC_FZ.has(e.sym) && e.sym !== "ziv_fz") types.push([e.sym, fz]);
  if (isAir) types.push([isDrone ? "drohne" : e.sym === "heli_einheit" ? "heli" : e.sym, e.count ?? 1]);
  if (cat?.category === "Waffen") types.push([e.sym, e.count ?? 1]);
  if (e.sym === "scharfschuetze") types.push(["scharfschuetze", e.count ?? 1]);
  const rot = e.side === "rot";
  const road = e.road || ROAD_NAME_RE.exec(text)?.[1];
  return {
    e, id: e.id, ms, pos: e.pos, cell, precise, naiOnly: !!e.nai && where === e.nai, nais: nais.filter(inNai).map((a) => a.name), cat,
    side: e.side, feind: rot && e.aff !== "U", unklar: rot && e.aff === "U",
    unitKey: e.unit ? nk(e.unit) : "", melder: e.melder ? nk(e.melder) : "",
    persLo, persHi, fz, types, isFz, isPers, isDrone, foot: isPers && !isFz,
    hearsay: HEARSAY_RE.test(text), moving: e.dir !== undefined || MOVE_RE.test(text), halt: HALT_RE.test(text),
    sig: rot && !e.unit && isFz ? sigOf(text) : undefined, road: road || undefined,
  };
}

/** Aufbereitete Meldung je Meldungs-Objekt (gültig, solange Raster und Flächen dieselben Objekte sind) */
const PEV_CACHE = new WeakMap<LageEvent, { sheets: unknown; areas: unknown; rev: number; upd: string; v: PEv | null }>();
/** Meldungen in Zeitfolge je Journal-Objekt (Abspielen: gleiche Meldungen, andere Lagezeit); `snap` erkennt Änderungen im Array */
const LIST_CACHE = new WeakMap<LageEvent[], { sheets: unknown; areas: unknown; snap: LageEvent[]; revs: string; list: PEv[] }>();
const revsOf = (events: LageEvent[]) => { let h = ""; for (const e of events) h += `${e.rev}${e.updatedAt}|`; return h; };

/** Meldungen bis `tMs` (aktuelle Revision, ohne gelöschte), älteste zuerst */
export function prepareRed(ex: Pick<Exercise, "events" | "sheets" | "areas">, tMs: number): PEv[] {
  const events = ex.events ?? [];
  let all = LIST_CACHE.get(events);
  const same = !!all && all.sheets === ex.sheets && all.areas === ex.areas && all.snap.length === events.length &&
    all.snap.every((e, i) => e === events[i]) && all.revs === revsOf(events);
  if (!all || !same) {
    const nais = (ex.areas ?? []).filter((a) => a.kind === "nai");
    const list: PEv[] = [];
    for (const e of currentEvents(events)) {
      if (e.deleted) continue;
      let c = PEV_CACHE.get(e);
      if (!c || c.sheets !== ex.sheets || c.areas !== ex.areas || c.rev !== e.rev || c.upd !== e.updatedAt) {
        c = { sheets: ex.sheets, areas: ex.areas, rev: e.rev, upd: e.updatedAt, v: toPEv(e, ex.sheets ?? [], nais) };
        PEV_CACHE.set(e, c);
      }
      if (c.v) list.push(c.v);
    }
    list.sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    all = { sheets: ex.sheets, areas: ex.areas, snap: events.slice(), revs: revsOf(events), list };
    LIST_CACHE.set(events, all);
  }
  // bis zur Lagezeit (binäre Suche; Liste nach Zeit sortiert)
  const l = all.list;
  let lo = 0, hi = l.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (l[m]!.ms <= tMs) lo = m + 1; else hi = m; }
  return l.slice(0, lo);
}

/** Lagezeit in ms; ungültig → letzte Meldung */
export function lageMs(ex: Pick<Exercise, "events">, t: string): number {
  const ms = parseMs(t);
  if (Number.isFinite(ms)) return ms;
  let last = -Infinity;
  for (const e of ex.events ?? []) { const x = parseMs(e.t); if (x > last) last = x; }
  return Number.isFinite(last) ? last : 0;
}

/** Ortsunschärfe einer Meldung in m (Planquadrat bzw. NAI) */
export const posTol = (v: PEv) => (v.naiOnly ? 600 : v.precise ? (v.cell ? v.cell.size * 0.6 : 300) : 1000);

/** Konnten a und b dasselbe Objekt sein (Tempo in km/h)? Ohne Ort: ja (vorsichtig). */
export function reachable(a: PEv, b: PEv, kmh: number): boolean {
  if (!a.pos || !b.pos) return true;
  const d = dist(a.pos, b.pos) - posTol(a) - posTol(b);
  if (d <= 0) return true;
  return d <= (kmh * 1000 / 60) * (Math.abs(a.ms - b.ms) / MIN_MS);
}

/** Planquadrat-Bezeichnung bzw. NAI eines Punkts */
export function placeLabel(sheets: Exercise["sheets"], p: LV95 | undefined, fallback = ""): string {
  if (!p) return fallback;
  return baseCellAt(sheets ?? [], p)?.label ?? fallback;
}
