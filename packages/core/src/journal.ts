/**
 * Lagejournal: Meldungen so eingeben, wie man sie mitschreibt, z. B.
 *   «1015 Rot 2 Fz in NAI 3 Rtg N»   «0955 Blau H04 Beo Stao AB12 C»   «T2 0315 Det 4 angekommen Wabern»
 * Erkannt werden Zeit (und Übungstag), Seite, Element, Ort, Zeichen, Anzahl und Richtung.
 * Die Erkennung macht nur Vorschläge; der Originaltext bleibt immer erhalten.
 */
import { pointInRing, ringCentroid } from "./geo";
import { findCoordinates, type LV95 } from "./lv95";
import { newEventId, type Area, type LageEvent, type Place, type RoadHint, type Side } from "./model";
import { boundsCenter, cellBounds, findCells, type RasterSheet } from "./raster";
import { buildSidc, catalogEntry, describeTactical, isCountableWord, isTacticalWord, readTactical, type CatalogEntry, type Echelon, type Status } from "./catalog";
import { symbolDef, type Affiliation } from "./symbols";
import { findTimes } from "./time";
import { autoShape, shapeCenter } from "./shapes";

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
  /** vollständiger SIDC (Zeichen, Zugehörigkeit, Stufe, Status) */
  sidc: string;
  /** Stufe, z. B. «hz» (aus «1 gn hz inf») */
  echelon?: Echelon;
  /** «anticipated» = vermutet/möglich (gestrichelt) */
  status: Status;
  /** ausgeschriebener Sinn, z. B. «1 gegnerischer Halbzug Infanterie» */
  desc?: string;
  count?: number;
  /** Bewegungsrichtung in Grad (0 = Nord) */
  dir?: number;
  /** Richtung als Text, z. B. «Rtg Bern» */
  dirLabel?: string;
  /** Herkunft in Grad (0 = Nord), z. B. «Schuss aus Rtg O» → 90 (kein Bewegungspfeil) */
  from?: number;
  /** Herkunft als Text, z. B. «aus Rtg Bern» */
  fromLabel?: string;
  /** Strassenart aus dem Text («auf Hauptstrasse» → haupt, «auf Autobahn» / «A1» → autobahn) */
  roadHint?: RoadHint;
  pos?: LV95;
  where?: { kind: WhereKind; label: string };
  cells?: string[];
  nai?: string;
  /** Ortsname, der (online) noch nachgeschlagen werden kann */
  placeQuery?: string;
  /** Meldungstext ohne führende Zeit/Seite */
  text: string;
  /**
   * Probleme, die das Eintragen sperren (nie still falsch). Leer/fehlend = keine.
   * - `ort`: genannter Ort existiert nicht («AK77», «ZZ3», «NAI 9») → kein Ersatzort (kein «bei Melder»), `pos` fehlt
   * - `zeit`: ungültige Zeitangabe («13:70») → Zeit «jetzt» ist nur Platzhalter
   * Die UI zeigt `text` als roten Chip und sperrt Enter/Eintragen (Ausweg: Ort auf Karte setzen, Text korrigieren).
   */
  problems?: DraftProblem[];
}

/** Grund, weshalb ein Entwurf so nicht eingetragen werden darf (Klartext für die Vorschau). */
export interface DraftProblem {
  kind: "ort" | "zeit";
  /** Klartext, z. B. «AK77» gibt es nicht */
  text: string;
  /** betroffene Textstelle, z. B. «AK77» */
  token?: string;
}

const KIND_WORDS: Array<[RegExp, Kind]> = [
  [/^(?:seite\s+)?(?:rot|gegner|feind|fe)\b[:,]?\s*/i, "feind"],
  [/^(?:seite\s+)?(?:blau|eigen|eig)\b[:,]?\s*/i, "eigen"],
  [/^(?:unklar|unbekannt)\b[:,]?\s*/i, "unklar"],
];
const W = "[\\wÄÖÜäöü]";
/** Zugehörigkeit ausdrücklich unklar («verdächtig» = gesichtet, Zugehörigkeit unklar, nicht gestrichelt) */
const UNCLEAR_RE = new RegExp(`(?<!${W})(unklar\\w*|unbekannt\\w*|nicht erkennbar|verdacht|verdächtig\\w*)(?!${W})`, "i");
/** ausdrücklich gegnerisch: «gn», «gegn.», «Gegner», «feindl.» */
const STRONG_ENEMY_RE = new RegExp(`(?<!${W})(gn|gegn|gegner\\w*|gegnerisch\\w*|feindl\\w*)(?!${W})`, "i");
/** vermutet / möglich → gestrichelt; Feind bei inhärent feindlichen Zeichen (IED, Minen, Sperre …), sonst unklar */
const MAYBE_RE = new RegExp(`(?<!${W})(zivil\\??|evtl|eventuell|vermutlich|vmtl|vermutl|verm|vermutet\\w*|möglicherweise|mögl|möglich\\w*|mutmasslich\\w*|wahrscheinlich|allenfalls)(?!${W})`, "i");
/**
 * Blockade/Hindernis ohne Katalogbegriff («Strasse blockiert», «Weg versperrt», «Baumstämme auf der Strasse»): Sichtung
 * einer Sperre, nicht eigene Lage des Melders (eigene Lage nur mit Stellungsbegriffen oder «eig»).
 */
const BLOCKADE_RE = new RegExp(`(?<!${W})(blockiert\\w*|blockier\\w*|blockade\\w*|versperrt\\w*|verbarrikadiert\\w*|baumstämme\\w*|baumstamm\\w*)(?!${W})`, "i");
const ENEMY_RE = new RegExp(`(?<!${W})(gegner|feind|fe|rot|bewaffnet\\w*|fremde?)(?!${W})`, "i");
const sideOf = (k: Kind): Side => (k === "eigen" ? "blau" : "rot");

/** Gängige Elementbezeichnungen: H04, Det 2, Zug 1, Gr 3, Trp 2, Pat 1, Kp, Zfhr … */
const UNIT_RE = /(?<![\wÄÖÜäöü])(H\d{1,3}|Det\.?\s?\d{1,2}|Zug\s?\d{1,2}|Z\s?\d|Gr\.?\s?\d{1,2}|Trp\.?\s?\d{1,2}|Pat\.?\s?\d{1,2}|Patr\.?\s?\d{1,2}|Zfhr|Kdt|Kp|LVZ|KP)(?![\wÄÖÜäöü])/i;

const DIRS: Record<string, number> = {
  N: 0, NORD: 0, NORDEN: 0, NO: 45, NE: 45, NORDOST: 45, NORDOSTEN: 45, O: 90, E: 90, OST: 90, OSTEN: 90,
  SO: 135, SE: 135, SÜDOST: 135, SÜDOSTEN: 135, S: 180, SÜD: 180, SÜDEN: 180, SW: 225, SÜDWEST: 225, SÜDWESTEN: 225,
  W: 270, WEST: 270, WESTEN: 270, NW: 315, NORDWEST: 315, NORDWESTEN: 315,
};

/** «3 Pers», «2 Fz» – nicht in Elementnamen wie «H05», «Det 2» (Lookbehind: kein Buchstabe/Ziffer davor) */
const COUNT_RE = /(?<![\p{L}\d'’.:])(\d{1,3})\s*(?:x|×)?\s*(fz|fahrzeuge?|pw|lw|lastwagen|g-?klasse|duros?|pers(?:onen)?\.?|mann|sdt|soldaten|ag|angehörige|drohnen?|motorräder|töff)(?![\p{L}\d])/giu;

/**
 * Sichtung ohne Katalogbegriff: «1 weisser Lieferwagen», «1 Velo», «2 Traktoren», «1 Pw schwarz» – Zahl, höchstens zwei
 * Beschreibungswörter, dann ein Fahrzeug bzw. eine Person. Das ist nie die eigene Lage des Melders.
 */
const SIGHT_RE = /(?<![\p{L}\d'’.:])(\d{1,3})\s+(?:[\p{L}\-]+\s+){0,2}?(velos?|fahrr(?:ad|äder)|velofahrer(?:in)?|radfahrer(?:in)?|traktor(?:en)?|landwirtschaftsfahrzeug(?:e)?|lieferwagen|kastenwagen|transporter|pick-?ups?|suvs?|limousinen?|kombis?|jeeps?|vans?|motorr(?:ad|äder)|töffs?|roller|quads?|lkws?|lastwagen|laster|holzlaster|kleinbus(?:se)?|wohnmobile?|autos?|pws?|personenwagen|fahrzeuge?|fz|pers(?:onen)?|leute|männer|frauen|wanderer|jogger(?:in)?|fussgänger(?:in)?|spaziergänger(?:in)?)(?![\p{L}\d])/iu;
/** zivil geprägte Sichtungen → Zugehörigkeit unklar (Velo, Traktor, Wanderer …) */
const SIGHT_CIVIL_RE = /^(?:velo|fahrr|velofahrer|radfahrer|traktor|landwirtschaft|wohnmobil|wanderer|jogger|fussgänger|spaziergänger)/i;
const SIGHT_SYM = (noun: string): string => (/^(?:pers|leute|männer|frauen)/i.test(noun) ? "inf_trp" : SIGHT_CIVIL_RE.test(noun) ? (/^(?:traktor|landwirtschaft|wohnmobil)/i.test(noun) ? "ziv_fz" : "zivil") : "fz");

/** Herkunft: «aus Rtg O», «aus Richtung Bern», «von N», «aus W» (keine Bewegungsrichtung) */
const FROM_RE = /(?<![\p{L}\d])(?:aus|von)\s+(?:der\s+)?(?:(rtg|richtung)\.?\s+)?([\p{L}][\p{L}\d\-]*)/iu;
/** Strassenart: «auf Hauptstrasse», «auf der HS», «auf Autobahn», «auf A1» – geht nicht in die Ortssuche */
const ROAD_HAUPT_RE = /(?<![\p{L}\d])(?:(?:auf|entlang)\s+(?:der\s+|die\s+)?)?haupt(?:strasse|straße|trasse|achse|verkehrsstrasse|verkehrsachse)(?![\p{L}\d])|(?<![\p{L}\d])auf\s+(?:der\s+)?hs(?![\p{L}\d])/iu;
const ROAD_AB_RE = /(?<![\p{L}\d])(?:(?:auf|entlang)\s+(?:der\s+|die\s+)?)?(?:autobahn|autostrasse)(?![\p{L}\d])|(?<![\p{L}\d])auf\s+(?:der\s+)?(?:ab|a\s?\d{1,2})(?![\p{L}\d])/iu;
/** Elementnamen, die immer Namen sind (nie Anzahl/Stufe): «H05», «Det 2» */
const NAME_ALWAYS_RE = /^(?:H\d|Det)/i;

/** Textstelle durch Leerzeichen ersetzen (Länge bleibt, damit Positionen stimmen) */
const blank = (s: string, a: number, b: number) => s.slice(0, a) + " ".repeat(b - a) + s.slice(b);

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
  const hits: Array<{ u: string; side: Side | null; index: number; len: number }> = [];
  for (const [u, sd] of known) {
    const m = flexRe(u).exec(text);
    if (m && !hits.some((h) => m.index >= h.index && m.index < h.index + h.len)) hits.push({ u, side: sd, index: m.index, len: m[0].length });
  }
  // Elementnamen mit Nummer sind keine Anzahl: «H05 Drohne» ≠ 5 Drohnen, «Det 2 Patrouille», «Zug 1», «Gr 3».
  // Ausnahme: Zahl vor einer Einheit / einem Gerät («Pat 3 Pers» = Patrouille mit 3 Personen).
  const skip: Array<[number, number]> = hits.map((h) => [h.index, h.index + h.len]);
  for (const m of text.matchAll(new RegExp(UNIT_RE.source, "gi"))) {
    const raw = m[1]!;
    if (!/\d/.test(raw)) continue;
    const a = m.index!, b = a + raw.length;
    if (skip.some(([x, y]) => a < y && b > x)) continue;
    const next = /^\s*([\p{L}][\p{L}\d]*)/u.exec(text.slice(b))?.[1];
    if (NAME_ALWAYS_RE.test(raw) || !next || !isCountableWord(next)) skip.push([a, b]);
  }
  // taktische Begriffe zuerst lesen: «Kp» in «1 Kp Pz» ist eine Stufe, kein Melder
  const reading = readTactical(text, { skip });
  for (const m of text.matchAll(new RegExp(UNIT_RE.source, "gi"))) {
    if (reading?.spans.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
    const u = m[1]!.replace(/\.\s?|\s+/g, " ").replace(/^(\D+?)\s?(\d)/, (_, a: string, d: string) => (a.length > 1 ? `${a} ${d}` : a + d)).trim();
    if (!hits.some((h) => Math.abs(h.index - m.index!) < 2 || norm(h.u) === norm(u))) hits.push({ u, side: null, index: m.index!, len: m[1]!.length });
  }
  hits.sort((a, b) => a.index - b.index);
  const melderHit = hits.find((h) => h.side !== "rot");
  const enemyHit = hits.find((h) => h.side === "rot");
  const melder = melderHit?.u ?? "";

  // ---- Sichtung ohne Katalogbegriff («1 weisser Lieferwagen AO2»): Anzahl und allgemeines Zeichen
  let sight: { count: number; sym: string; civil: boolean } | undefined;
  if (!reading) {
    const m = SIGHT_RE.exec(text);
    if (m && !skip.some(([a, b]) => m.index < b && m.index + m[1]!.length > a)) {
      sight = { count: +m[1]!, sym: SIGHT_SYM(m[2]!), civil: SIGHT_CIVIL_RE.test(m[2]!) };
    }
  }

  // ---- Anzahl, Zeichen, Einordnung
  const sym = reading?.key ?? sight?.sym ?? (BLOCKADE_RE.test(text) ? "sperre" : "einheit");
  const entry = catalogEntry(sym) ?? catalogEntry("einheit")!;
  const isElement = entry.kind === "einheit" || entry.kind === "geraet";
  // Anzahl aus der Erkennung; sonst (nur bei Elementen) «3 Pers», «2 Fz» irgendwo im Text (nicht in Elementnamen)
  let cmCount: number | undefined;
  if (!reading) {
    for (const m of text.matchAll(COUNT_RE)) {
      if (skip.some(([a, b]) => m.index! < b && m.index! + m[0].length > a)) continue;
      cmCount = +m[1]!;
      break;
    }
  }
  const count = reading?.count ?? cmCount ?? sight?.count;
  let kindFrom: Draft["kindFrom"] = explicit ? "text" : "inhalt";
  if (ctx.kind) { kind = ctx.kind; kindFrom = "vorgabe"; }
  if (!kind) kind = kindOf(text, reading, entry, { melder, enemy: !!enemyHit, count, civil: sight?.civil });
  const side = sideOf(kind);
  const unit = kind === "eigen" ? melder : enemyHit?.u ?? "";

  // ---- Herkunft und Richtung: «aus Rtg O» = Herkunft (kein Pfeil), «Rtg N» = Bewegungsrichtung
  let locText = text;
  let from: number | undefined;
  let fromLabel: string | undefined;
  const fm = FROM_RE.exec(text);
  if (fm) {
    const w = fm[2]!.toUpperCase();
    if (w in DIRS) from = DIRS[w];
    else if (fm[1]) fromLabel = `aus Rtg ${fm[2]}`;
    if (from !== undefined || fromLabel) locText = blank(locText, fm.index, fm.index + fm[0].length);
  }
  let dir: number | undefined;
  let dirLabel: string | undefined;
  const rm = /\b(?:rtg|richtung|fahrtrichtung|in\s+rtg)\.?\s+([A-Za-zÄÖÜäöü][\wÄÖÜäöü\-]*)/i.exec(locText);
  if (rm) {
    const w = rm[1]!.toUpperCase();
    if (w in DIRS) dir = DIRS[w];
    else dirLabel = `Rtg ${rm[1]}`;
  }
  // ---- Strassenart («auf Hauptstrasse», «auf Autobahn», «auf A1»): Hinweis für die Lage auf der Strasse
  let roadHint: RoadHint | undefined;
  for (const [re, h] of [[ROAD_AB_RE, "autobahn"], [ROAD_HAUPT_RE, "haupt"]] as Array<[RegExp, RoadHint]>) {
    const m = re.exec(locText);
    if (m) { roadHint ??= h; locText = blank(locText, m.index, m.index + m[0].length); }
  }

  // ---- Ort
  let pos: LV95 | undefined;
  let where: Draft["where"];
  let cells: string[] | undefined;
  let nai: string | undefined;
  let placeQuery: string | undefined;
  const coords = findCoordinates(locText);
  if (coords[0]) {
    pos = coords[0].lv95;
    where = { kind: "koordinate", label: "Koordinate" };
  }
  const exclude = [...known.map(([u]) => u), ...hits.map((h) => h.u)].map((u) => u.replace(/\s/g, ""));
  const found = findCells(locText, ctx.sheets, { exclude });
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
    .map((a) => ({ a, m: flexRe(a.name).exec(locText) }))
    .filter((x) => x.m)
    .sort((x, y) => x.m!.index - y.m!.index || y.a.name.length - x.a.name.length);
  if (areaHits[0]) {
    nai = areaHits[0].a.name;
    if (!pos) { pos = areaCenter(areaHits[0].a); where = { kind: "nai", label: nai }; }
  }
  if (!pos && ctx.places?.length) {
    const p = [...ctx.places].sort((a, b) => b.name.length - a.name.length).find((pl) => flexRe(pl.name).test(locText));
    if (p) { pos = p.pos; where = { kind: "ort", label: p.name }; }
  }
  if (!pos) {
    // Ortsname nach einer Präposition, z. B. «angekommen in Wabern», «bei Bümpliz», «Dorfeingang Wabern»
    const pm = /\b(?:in|bei|beim|ab|an|auf|nach|bis|vor|höhe|richtung|rtg|(?:[Oo]rts|[Dd]orf)?(?:[Ee]in|[Aa]us)gang)\.?\s+([A-ZÄÖÜ][\wäöüÄÖÜß'’\-]+)(?:\s+([A-ZÄÖÜ][\wäöüÄÖÜß'’\-]+))?/.exec(locText);
    const isUnit = (w: string) => hits.some((h) => norm(h.u) === norm(w)) || UNIT_RE.test(w) && /\d/.test(w);
    if (pm && /^[A-ZÄÖÜ]/.test(pm[1]!) && !/^(NAI|PQ|Rtg|Richtung|Rot|Blau)$/i.test(pm[1]!) && !isUnit(pm[1]!) && !isTacticalWord(pm[1]!, ["e", "ech", "st", "act", "aff"])) {
      const second = pm[2] && /^[A-ZÄÖÜ]/.test(pm[2]) && !isTacticalWord(pm[2], ["e", "ech", "st", "act", "aff"]) && !isUnit(pm[2]) ? ` ${pm[2]}` : "";
      placeQuery = (pm[1]! + second).replace(/[’']$/, "");
    }
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

  // Fläche/Linie über mehrere Felder («Achse AN6 AL8 AJ10»): Punktzeichen in die Mitte der Form statt ins erste Feld
  if (where?.kind === "raster" && (cells?.length ?? 0) > 1 && entry.geometry && entry.geometry !== "punkt") {
    const sh = autoShape({ sym, pos, cells, where: where.label }, { sheets: ctx.sheets, areas: ctx.areas });
    if (sh) { const c = shapeCenter(sh); pos = { e: Math.round(c.e), n: Math.round(c.n) }; }
  }
  const aff: Affiliation = kind === "eigen" ? "F" : kind === "feind" ? "H" : "U";
  const status: Status = reading?.status ?? "present";
  const echelon = reading?.echelon;
  const sidcEntry = reading?.of ? catalogEntry(reading.of) ?? entry : entry;
  const sidc = buildSidc(sidcEntry, aff, { echelon, status });
  // Adjektiv «gegnerisch»: bei Elementen (Einheit/Gerät) immer, sonst nur, wenn «gn» im Text steht; «eigen» nur ausdrücklich
  const adjAff: Affiliation | null = kind === "feind" && (isElement || (reading?.explicitAff && reading.aff === "H")) ? "H" : kind === "eigen" && reading?.aff === "F" ? "F" : null;
  const desc = reading ? describeTactical({ ...reading, count }, adjAff) : undefined;
  return {
    minutes, day, t: isoOf(day, minutes), timeFromText, kind, kindFrom, side, melder, unit, sym, aff, sidc, echelon, status, desc, count,
    dir, dirLabel, from, fromLabel, roadHint, pos, where, cells, nai, placeQuery, text: text || input.trim(),
  };
}

/**
 * Einordnung nach Inhalt (Lageverfolgung):
 * - «unklar», «verdächtig» → unklar; «gn» → Feind; «eig» → eigen;
 * - «möglich/vermutet»: Feind bei inhärent feindlichen Zeichen (IED, Minen, Sperre, Hinterhalt …), sonst unklar;
 * - Ereignis/Tätigkeit/Anlage/Grafik: nie eigen ohne «eig» (ausser eigene Lage wie Beo Stao, Stellung); sonst unklar,
 *   Feind bei inhärent feindlichen Zeichen oder bekanntem Feindelement. Eine Anzahl macht nur Einheiten/Geräte zu Feind.
 */
function kindOf(text: string, reading: ReturnType<typeof readTactical>, entry: CatalogEntry, o: { melder: string; enemy: boolean; count?: number; civil?: boolean }): Kind {
  if (UNCLEAR_RE.test(text)) return "unklar";
  // gezählte zivile Sichtung (Velo, Traktor, Wanderer) ohne «gn»: unklar
  if (o.civil && !o.enemy && !STRONG_ENEMY_RE.test(text) && !ENEMY_RE.test(text)) return "unklar";
  if (STRONG_ENEMY_RE.test(text) || reading?.aff === "H" && reading.status !== "anticipated") return "feind";
  if (reading?.aff === "F") return "eigen";
  if (reading?.status === "anticipated" || MAYBE_RE.test(text)) return entry.hostile || o.enemy ? "feind" : "unklar";
  if (entry.kind === "einheit" || entry.kind === "geraet") {
    if (entry.lean === "unklar" && !o.enemy) return "unklar";
    if (o.enemy || ENEMY_RE.test(text) || o.count !== undefined || entry.lean === "feind") return "feind";
    // eigene Lage nur mit Melder; ohne Melder und ohne Hinweis bleibt es unklar
    return o.melder ? "eigen" : "unklar";
  }
  if (entry.lean === "eigen" && o.melder && !o.enemy && !ENEMY_RE.test(text)) return "eigen";
  // eigene Anlage bezogen/eingerichtet (z. B. «H05 Checkpoint AK7 bezogen»): eigene Lage
  if (o.melder && !o.enemy && !ENEMY_RE.test(text) && entry.kind === "anlage" && OWN_SETUP_RE.test(text)) return "eigen";
  if (o.enemy || ENEMY_RE.test(text) || entry.lean === "feind") return "feind";
  return "unklar";
}

/**
 * Verben, mit denen ein Melder eine eigene Anlage meldet. «errichtet», «aufgebaut» sind mehrdeutig (meist Sichtung:
 * «Checkpoint errichtet») und zählen nicht; «eingerichtet» nur mit «wir» («wir haben Checkpoint eingerichtet»).
 */
const OWN_SETUP_RE = /\b(?:bezogen|beziehen|bezieht|in\s+betrieb(?:\s+genommen)?|wir\b.*\b(?:eingerichtet|richten\s+\S+(?:\s+\S+)?\s+ein)\b|eingerichtet\b.*\bwir)\b/i;

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
    // Tätigkeit / Ereignis (Kontakt, Sperre, Explosion …): als eigenes Zeichen am Ort; das Element behält sein Zeichen.
    // Eigene Meldungen damit verschieben den Melder nicht (nur Einheiten-Meldungen und eigene Lage wie Stellung).
    const cat = catalogEntry(e.sym);
    if (cat ? cat.activity : symbolDef(e.sym).activity) {
      const pos = e.pos ?? cur?.pos;
      if (pos && Date.parse(e.t) >= tMin) loose.push({ ...e, pos });
      // Räume und Linien (Beobachtungsraum, Phasenlinie …) sind nie der Standort des Melders
      if (e.side === "blau" && (cat?.lean !== "eigen" || (cat.geometry && cat.geometry !== "punkt"))) continue;
      if (cur) e = { ...e, sym: cur.event.sym };
      else if (!e.pos) continue;
      else e = { ...e, sym: "einheit" };
    }
    if (e.pos) {
      const track = cur ? [...cur.track] : [];
      const last = track[track.length - 1];
      if (!last || last.e !== e.pos.e || last.n !== e.pos.n) track.push(e.pos);
      // allgemeines Zeichen («rollt», «verschiebt») ersetzt kein bekanntes Zeichen
      const ev = cur && e.sym === "einheit" ? { ...e, sym: cur.event.sym } : e;
      byUnit.set(k, { key: k, unit: e.unit, side: e.side, event: ev, pos: e.pos, track });
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
  return e.aff === "U" ? "Unklar" : e.aff === "N" ? "Neutral" : "Feind";
}

const csvCell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Form für den CSV-Export: gezeichnet mit Eckpunkten (LV95, gerundet), sonst «Fläche (aus Ort)» */
function shapeCsv(e: LageEvent): string {
  const geo = e.shape?.kind ?? catalogEntry(e.sym)?.geometry;
  if (!geo || geo === "punkt") return "";
  const word = geo === "flaeche" ? "Fläche" : "Linie";
  if (!e.shape || e.shape.auto) return `${word} (aus Ort)`;
  return `${word}: ${e.shape.pts.map((p) => `${Math.round(p.e)} ${Math.round(p.n)}`).join(", ")}`;
}

export function journalToCsv(events: LageEvent[], days: string[]): string {
  const head = ["Tag", "Zeit", "Art", "Element", "Melder", "Meldung", "Zeichen", "Ort", "Planquadrat", "NAI", "E", "N", "Form"];
  const rows = events.filter((e) => !e.deleted).sort((a, b) => a.t.localeCompare(b.t)).map((e) => {
    const d = e.t.slice(0, 10);
    const tag = days.indexOf(d) >= 0 ? `T${days.indexOf(d) + 1}` : d;
    return [tag, e.t.slice(11, 16), kindLabel(e), e.unit, e.melder ?? "", e.text, e.sym, e.where ?? "", (e.cells ?? []).join(" "), e.nai ?? "",
      e.pos ? String(Math.round(e.pos.e)) : "", e.pos ? String(Math.round(e.pos.n)) : "", shapeCsv(e)];
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
    sidc: d.sidc,
    echelon: d.echelon,
    status: d.status !== "present" ? d.status : undefined,
    desc: d.desc,
    pos: d.pos,
    cells: d.cells,
    nai: d.nai,
    count: d.count,
    dir: d.dir,
    from: d.from,
    fromLabel: d.fromLabel,
    roadHint: d.roadHint,
    where: d.where?.label,
    source: { kind: "text" },
    confirmed: true,
  };
}

/** Änderung an einem Eintrag (Revision hochzählen, für den späteren Abgleich zwischen Geräten). */
export function reviseEvent(e: LageEvent, patch: Partial<LageEvent>, device: string, now = new Date()): LageEvent {
  return { ...e, ...patch, rev: e.rev + 1, device, updatedAt: now.toISOString() };
}
