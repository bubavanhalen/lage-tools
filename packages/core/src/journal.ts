/**
 * Lagejournal: Meldungen so eingeben, wie man sie mitschreibt, z. B.
 *   «1015 Rot 2 Fz in NAI 3 Rtg N»   «0955 Blau H04 Beo Stao AB12 C»   «T2 0315 Det 4 angekommen Wabern»
 * Erkannt werden Zeit (und Übungstag), Seite, Element, Ort, Zeichen, Anzahl und Richtung.
 * Die Erkennung macht nur Vorschläge; der Originaltext bleibt immer erhalten.
 */
import { pointInRing, ringCentroid } from "./geo";
import { findCoordinates, type LV95 } from "./lv95";
import { newEventId, revisionOf, type Area, type EntryArt, type Exercise, type LageEvent, type MeldeFelder, type Place, type RoadHint, type Side } from "./model";
import { artOf, artText, isLage, istDringend, readArt, type ArtLesung } from "./arten";
import { readMeldeFelder, felderZuText } from "./felder";
import { aufhebZiele, istAufhebbar, liftMap, lvzIndex, vermerkeOf } from "./lvz";
import { findByNr, nrLabel } from "./nummer";
import { boundsCenter, cellBounds, findCells, type RasterSheet } from "./raster";
import { buildSidc, catalogEntry, describeTactical, isCountableWord, isTacticalWord, readTactical, type CatalogEntry, type Echelon, type Status } from "./catalog";
import { symbolDef, type Affiliation } from "./symbols";
import { findTimes } from "./time";
import { addDays, compareEvents, localDay, localIso, nearestDay, offsetFor } from "./clock";
import { autoShape, shapeCenter } from "./shapes";
import { countWords, hourTimes, isGenericPlace, isNeedNote, listParts, looseTime, melderProblems, namesPlace, normalizeMelder, normalizeTyped, observedOwn, ownDirection, partPlaces, pickTime, placeProblems, placeSpans, sameUnitName, splitMelderCount, staysOwn, stripLead, stueckCount, timeProblems, unknownSubject, vagueAmount, type UnknownWord } from "./erkennung";

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
  /** jetzt (für Meldungen ohne Zeitangabe) – im Meldungsfeld beim Eintragen (Enter) neu bestimmen, nicht beim Tippen */
  now: Date;
  /**
   * Tag folgt der Uhr: Tag = Kalendertag von `now` (statt `day`), auch wenn er noch kein Übungstag ist (wird beim
   * Eintragen angelegt); getippte Zeit ohne Tag mehr als 12 h in der Zukunft → Vortag. Aus, wenn der Tag von Hand gewählt ist.
   */
  dayFromClock?: boolean;
  /** letzte bekannte Lage eines Elements */
  lastPos?: (unit: string, side: Side) => LV95 | undefined;
  /**
   * (MVP 3) erzwingt die Art (Auswahl «Was ist es?» in der Vorschau), gilt bis der Text gelöscht wird; «meldung» =
   * Feind/Eigene/Unklar gewählt. Sonst entscheidet der Text (`readArt`, Paket A).
   */
  art?: EntryArt;
  /** (MVP 3) bisherige Einträge – für «zu 42», «Antwort …» und «… aufgehoben» (Bezug/Ziel) */
  events?: LageEvent[];
  /** (MVP 3) Übung – für Nummern (`findByNr`) */
  ex?: Pick<Exercise, "events">;
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
  /** Tag ausdrücklich genannt («T2 1535») – dann ist eine Zeit in der Zukunft nur «bitte prüfen», sonst «geht nicht» */
  dayFromText?: boolean;
  /** Zeitangabe wie getippt («1535», «15:35», «vor 10 min») – zum Markieren im Text */
  timeToken?: string;
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
  /** Meldungstext ohne führende Zeit/Seite (bei Funk-/Sprechsprache der Originaltext, siehe `normalized`) */
  text: string;
  /**
   * Lesart, wenn getippte Funk-/Sprechsprache normalisiert wurde («Hotel 4 meldet zwei Fahrzeuge in Alpha Kilo 7» →
   * «H04 meldet 2 Fz in AK7»); fehlt bei Kurzmeldungen. Für die Vorschau («verstanden als …»).
   */
  normalized?: string;
  /**
   * Probleme, die das Eintragen sperren (nie still falsch). Leer/fehlend = keine.
   * - `ort`: genannter Ort existiert nicht («AK77», «ZZ3», «NAI 9») → kein Ersatzort (kein «bei Melder»), `pos` fehlt
   * - `zeit`: ungültige Zeitangabe («13:70»), zweite andere Zeitangabe oder ungefähre Zeit («kurz nach acht») → Zeit
   *   «jetzt» ist nur Platzhalter
   * - `melder`: eigenes Element, das es in der Übung nicht gibt («H13», wenn H01–H05 bekannt sind; `token` = Name) →
   *   Ausweg: Trupp im Text korrigieren oder ausdrücklich als neues Element aufnehmen (UI)
   * - `orte`: mehrere Anzahlen an verschiedenen Orten («2 Fz AK7 und 3 Pers AL8») – die Karte zeigt nur einen Ort →
   *   als einzelne Meldungen eintragen («Ort auf Karte» löst das nicht)
   * Die UI zeigt `text` als roten Chip und sperrt Enter/Eintragen (Ausweg: Ort auf Karte setzen, Text korrigieren).
   */
  problems?: DraftProblem[];
  /**
   * Vorschlag der Erkennung, die Meldung **nicht** als Lage einzutragen: «notiz» = Rückfrage, Auftrag, Befehl oder Frage
   * («H04 Rückfrage: Standort Det 2?», «Auftrag an H01: Beo NAI 1», Text endet mit «?»). Dann hat der Entwurf kein Zeichen
   * und verschiebt nichts: `pos`, `where`, `cells`, `nai`, `unit`, `count`, `dir` fehlen, `side` = blau, `sym` = einheit;
   * Ortsprobleme entfallen; «Auftrag an H01» → `melder` leer. `entryState` meldet gelb «Als Notiz ohne Zeichen?»
   * (Code `notiz`); 2. Enter trägt als Notiz ein (`eventFromDraft` setzt `LageEvent.notiz`). Ausweg «doch als Lage»:
   * Einordnung von Hand wählen (`JournalContext.kind`) – dann gibt es keinen Hinweis und die Meldung wird normal gelesen.
   */
  kindHint?: "notiz";
  /**
   * Unbekanntes/verstümmeltes Wort an der Stelle des Gesehenen («2 schützenpnzr»): keine geratene Art – `sym` = einheit,
   * Einordnung unklar (ausser ausdrücklich «Feind»/«gn» bzw. von Hand gewählt), `desc` = «2 ? («schützenpnzr»)».
   * `suggest`/`suggestLabel` = nächster Katalogbegriff (nur Vorschlag). `entryState`: gelb, Code `was`.
   */
  unknownWord?: UnknownWord;

  // ---- MVP 3 (Spez. MVP 3, Kap. 5.3) – `kindHint` bleibt (gesetzt, wenn art ≠ meldung und der Hinweis schwach ist) ----
  /** Art des Eintrags; Phase 0: «meldung», bzw. «notiz» bei `kindHint`, bzw. die Vorgabe `JournalContext.art` */
  art: EntryArt;
  /** woher die Art: Text (starker Hinweis), Inhalt (schwacher Hinweis), Vorgabe (Auswahl), Standard (nichts erkannt) */
  artFrom: "text" | "inhalt" | "vorgabe" | "standard";
  /** starker Hinweis (grün) – sonst gelb «Als … ohne Zeichen?» */
  artStark?: boolean;
  /** Auftrag/Rückfrage: Empfänger; Orientierung: Absender; Auftrag: Frist (ISO lokal); Vbk: Ergebnis */
  an?: string;
  quelle?: string;
  frist?: string;
  vbk?: LageEvent["vbk"];
  /** Bezug auf einen früheren Eintrag (ID), wie geschrieben (`bezugNr`), unbekannte Nummer (`bezugFehlt`) */
  bezug?: string;
  bezugArt?: LageEvent["bezugArt"];
  bezugNr?: string;
  bezugFehlt?: boolean;
  /** «… aufgehoben»: Ziel (genau eines) bzw. Kandidaten (keines/mehrere → gelb) */
  hebtAuf?: string;
  hebtAufKandidaten?: string[];
  /** genannte Orte einer Nicht-Meldung/Aufhebung (nur Text) */
  orte?: string[];
  /** AEIOU / Meldezettel, wie gelesen (felder.ts) */
  felder?: MeldeFelder;
  /** Vorschlag «dringend» aus dem Text (`istDringend`) */
  dringend?: boolean;
}

/** Grund, weshalb ein Entwurf so nicht eingetragen werden darf (Klartext für die Vorschau). */
export interface DraftProblem {
  kind: "ort" | "zeit" | "melder" | "orte";
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
const SIGHT_CIVIL_RE = /^(?:velo|fahrr|velofahrer|radfahrer|traktor|landwirtschaft|wohnmobil|wanderer|jogger|fussgänger|spaziergänger|leute)/i;
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

/** Ergebnis der eigentlichen Erkennung (ohne Art) mit Angaben für die Zeitregel der Nicht-Meldungen */
interface CoreParse {
  d: Draft;
  /** Zeit stand am Anfang (bzw. nach dem Melder) */
  lead: boolean;
  /** Zeitprobleme aus der Wahl der Zeit (zweite Zeitangabe, ungefähre Zeit) – entfallen bei Nicht-Meldungen ohne Zeit am Anfang */
  zeitWahl: DraftProblem[];
}

function parseCore(input: string, ctx: JournalContext): CoreParse {
  // getippte Funk-/Sprechsprache wie beim Diktat lesen («Hotel 4 … zwei Fz … Alpha Kilo 7»); Kurzmeldungen unverändert
  const typed0 = normalizeTyped(input.trim(), { blau: ctx.units.blau, now: ctx.now });
  // «Hotel eins drei Personen» → «H13 Pers»: gibt es H13 nicht, aber H01 → «H01 3 Pers» (sichtbar als «gelesen als»)
  const split = splitMelderCount(typed0.text, ctx.units.blau);
  const typed = split === typed0.text ? typed0 : { text: split, changed: true };
  let rest = typed.text;
  /** Probleme, die das Eintragen sperren (Zeit hier, Ort weiter unten) – kommen als `problems` in den Entwurf */
  const problems: DraftProblem[] = [];
  // ---- Tag und Zeit am Anfang (Tag folgt der Uhr, wenn `dayFromClock`)
  let day = ctx.dayFromClock ? localDay(ctx.now) : ctx.day;
  let dayFromText = false;
  const dm = /^T\s?(\d)\b[\s,:]*/i.exec(rest);
  if (dm) {
    const n = +dm[1]!;
    const d = ctx.days[n - 1];
    const last = ctx.days[ctx.days.length - 1];
    dayFromText = true;
    if (d) day = d;
    // nächster, noch nicht angelegter Tag («T2» in der ersten Nacht) – wird beim Eintragen angelegt
    else if (last && n === ctx.days.length + 1) day = addDays(last, 1);
    else problems.push({ kind: "zeit", text: `«T${n}» gibt es nicht (Übung hat ${ctx.days.length} ${ctx.days.length === 1 ? "Tag" : "Tage"})`, token: dm[0].trim() });
    rest = rest.slice(dm[0].length);
  }
  let minutes = ctx.now.getHours() * 60 + ctx.now.getMinutes();
  let timeFromText = false;
  // Zeit irgendwo im Satz (Anfang, nach Melder, «um …», am Ende); weitere andere Zeitangabe → Problem
  const found0 = findTimes(rest);
  const tp = pickTime(rest, [...found0, ...hourTimes(rest, found0)].sort((a, b) => a.index - b.index));
  const badTimes = timeProblems(rest);
  problems.push(...badTimes, ...tp.problems);
  // ohne Uhrzeit: «vor 10 min» = jetzt − 10, «gegen neun» = 09:00, «kurz nach acht» = Problem (nie still «jetzt»)
  const loose = tp.used ? null : looseTime(rest, minutes);
  if (loose) problems.push(...loose.problems);
  // ungültige Zeit am Anfang («1370 Auftrag …») bleibt auch bei Nicht-Meldungen ein Problem, alles andere ist Zeitwahl
  const leadBad = badTimes.filter((p) => p.token && rest.trimStart().replace(/^[\p{L}]{1,6}\.?\s?\d{0,3}\s*[:,]?\s+(?=\d)/u, "").startsWith(p.token));
  const zeitWahl = [...badTimes.filter((p) => !leadBad.includes(p)), ...tp.problems, ...(loose?.problems ?? [])];
  /** Meldungstext für das Journal (eine Zeit mitten im Satz bleibt stehen); `rest` = Text für die Erkennung */
  let shownRest = rest;
  let timeToken: string | undefined;
  if (tp.used) {
    minutes = tp.used.minutes;
    timeFromText = true;
    timeToken = tp.used.raw.trim();
    const [a, b] = tp.span!;
    if (tp.lead) {
      const head = rest.slice(0, a).replace(/\s+$/, "");
      const tail = rest.slice(b).replace(/^[\s,:\-–]+/, "");
      shownRest = rest = head ? `${head} ${tail}` : tail;
    }
    else rest = blank(rest, a, b);
  }
  let relDay = false;
  if (loose?.used) {
    minutes = loose.used.minutes;
    timeFromText = true;
    timeToken = loose.used.raw.trim();
    rest = blank(rest, loose.span![0], loose.span![1]);
    if (loose.used.relative) {
      relDay = true;
      if (loose.dayBefore && !dm) day = addDays(day, -1);
    }
  }
  // getippte Zeit ohne Tag kurz nach Mitternacht («2355» um 00:15) gehört zum Vortag
  if (timeFromText && !dm && !relDay && ctx.dayFromClock) day = nearestDay(day, minutes, ctx.now);

  // ---- ausdrückliche Einordnung am Anfang («Rot …», «Feind …», «Eigen …»)
  let kind: Kind | null = null;
  for (const [re, k] of KIND_WORDS) {
    const m = re.exec(rest);
    if (m) { kind = k; rest = rest.slice(m[0].length); shownRest = shownRest.slice(m[0].length); break; }
  }
  const explicit = kind !== null;
  const shown = shownRest.trim();
  // (MVP 3) Art liest `readArt` in `parseMeldung`; hier nur: bei Nicht-Meldung kein «unbekanntes Wort» suchen
  const note = ctx.kind || ctx.art === "meldung" ? false : ctx.art ? true : readArt(shown, { blau: ctx.units.blau }).art !== "meldung";
  // «Rtg eigene Stellung»: Ziel einer Bewegung – weder Ort noch Zeichen, macht die Meldung nicht zur eigenen Lage
  const ownDir = ownDirection(rest);
  if (ownDir) rest = blank(rest, ownDir.span[0], ownDir.span[1]);
  // Anzahl in Worten nur für die Erkennung («ein Panzer» → «1 Panzer», «ein Dutzend» → «12»)
  const text = countWords(rest.trim());

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
  // Ziel nach «erreicht» und Anlage nach «bei der …» sind Ort, nicht Sichtung; Bedarf («Mun Nachschub benötigt») ist kein Lager
  const elementBefore = (i: number) => hits.some((h) => h.index < i) || UNIT_RE.test(text.slice(0, i));
  let reading = readTactical(text, { skip: [...skip, ...placeSpans(text, elementBefore)] });
  if (isNeedNote(text, reading)) reading = null;
  // unbekanntes / verstümmeltes Wort an der Stelle des Gesehenen («2 schützenpnzr»): keine geratene Art
  const unknown = note ? undefined : unknownSubject(text, reading, skip, (w) => SIGHT_RE.test(`1 ${w}`));
  if (unknown) reading = null;
  for (const m of text.matchAll(new RegExp(UNIT_RE.source, "gi"))) {
    if (reading?.spans.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
    const u = m[1]!.replace(/\.\s?|\s+/g, " ").replace(/^(\D+?)\s?(\d)/, (_, a: string, d: string) => (a.length > 1 ? `${a} ${d}` : a + d)).trim();
    if (!hits.some((h) => Math.abs(h.index - m.index!) < 2 || norm(h.u) === norm(u))) hits.push({ u, side: null, index: m.index!, len: m[1]!.length });
  }
  hits.sort((a, b) => a.index - b.index);
  const melderHit = hits.find((h) => h.side !== "rot");
  const enemyHit = hits.find((h) => h.side === "rot");
  // Melder in der Schreibweise der Übung («h3» → «H03»)
  const melder = melderHit ? (melderHit.side === null ? normalizeMelder(melderHit.u, ctx.units.blau) : melderHit.u) : "";
  // eigenes Element, das es in der Übung nicht gibt («H13» bei H01–H05): Problem statt still neuer Trupp
  problems.push(...melderProblems(hits.filter((h) => h.side === null).map((h) => h.u), ctx.units.blau));

  // ---- Sichtung ohne Katalogbegriff («1 weisser Lieferwagen AO2»): Anzahl und allgemeines Zeichen
  let sight: { count: number; sym: string; civil: boolean } | undefined;
  if (!reading && !unknown) {
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
  // Aufzählung («1 Auto 1 Lw und 3 Pers»): alle Teile in den Sinn, keine irreführende Einzelanzahl
  let parts = reading?.parts ? undefined : listParts(text, skip);
  if (unknown) parts = undefined;
  const count = unknown ? unknown.count : parts ? undefined : reading?.count ?? cmCount ?? sight?.count ?? stueckCount(text);
  let kindFrom: Draft["kindFrom"] = explicit ? "text" : "inhalt";
  if (ctx.kind) { kind = ctx.kind; kindFrom = "vorgabe"; }
  if (!kind) kind = kindOf(text, reading, entry, { melder, enemy: !!enemyHit, count: count ?? (parts ? 2 : undefined), civil: sight?.civil });
  // unbekanntes Wort: Zugehörigkeit nicht raten (ausser «gn», «Feind» im Text oder bekanntes Feindelement)
  if (unknown && kindFrom === "inhalt" && !enemyHit && !STRONG_ENEMY_RE.test(text) && !ENEMY_RE.test(text)) kind = "unklar";
  // «H02 sieht H04 in AK9»: das gesehene eigene Element ist am Ort, nicht der Melder
  const seenOwn = observedOwn(text, hits, ctx.units.blau);
  let side = sideOf(kind);
  let unit = kind === "eigen" ? seenOwn ?? melder : enemyHit?.u ?? "";

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
  if (ownDir && dir === undefined && !dirLabel) dirLabel = ownDir.label;

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
  // Aufzählung an mehreren Orten («2 Fz AK7 und 3 Pers AL8»): Ort je Teil in den Sinn (Zeichen steht am ersten Ort)
  if (parts && found.length > 1) parts = listParts(text, skip, found.map((f) => ({ index: f.index, label: f.label }))) ?? parts;
  // die Karte zeigt nur einen Ort: Teile an verschiedenen Orten als einzelne Meldungen eintragen
  const multi = partPlaces(locText, skip, found.map((f) => ({ index: f.index, label: f.label })));
  if (multi.length > 1) problems.push({ kind: "orte", text: `${multi.length === 2 ? "zwei" : multi.length} Orte (${multi.join(", ")}) – bitte als ${multi.length === 2 ? "zwei" : multi.length} Meldungen eintragen`, token: multi.join(" ") });
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
  // Ort, den es nicht gibt («AK77», «ZZ3», «NAI 9»): Problem statt Ersatzort («bei H04»)
  const ortProblems = placeProblems(locText, { sheets: ctx.sheets, areas: ctx.areas, found, exclude });
  problems.push(...ortProblems);
  // Sichtung verschiebt nie den Melder: «eigen» mit Ort, aber ohne Standortwort → Sichtung (unklar) am Ort
  if (kind === "eigen" && kindFrom === "inhalt" && pos && !seenOwn) {
    let own = locText;
    for (const [a, b] of [...hits.map((h) => [h.index, h.index + h.len]), ...found.map((f) => [f.index, f.index + f.raw.length]),
      ...areaHits.map((x) => [x.m!.index, x.m!.index + x.m![0].length]), ...coords.map((c) => [c.index, c.index + c.raw.length]),
      ...(rm ? [[rm.index, rm.index + rm[0].length]] : []),
      ...(where?.kind === "ort" ? [flexRe(where.label).exec(locText)].filter((m) => !!m).map((m) => [m!.index, m!.index + m![0].length]) : [])] as Array<[number, number]>) {
      own = blank(own, a, Math.min(b, own.length));
    }
    if (!staysOwn(text, own, reading, entry)) { kind = "unklar"; side = sideOf(kind); unit = enemyHit?.u ?? ""; }
  }
  if (!pos) {
    // Ortsname nach einer Präposition, z. B. «angekommen in Wabern», «bei Bümpliz», «Dorfeingang Wabern»
    const pm = /\b(?:in|bei|beim|ab|an|auf|nach|bis|vor|höhe|richtung|rtg|(?:[Oo]rts|[Dd]orf)?(?:[Ee]in|[Aa]us)gang)\.?\s+([A-ZÄÖÜ][\wäöüÄÖÜß'’\-]+)(?:\s+([A-ZÄÖÜ][\wäöüÄÖÜß'’\-]+))?/.exec(locText);
    const isUnit = (w: string) => hits.some((h) => norm(h.u) === norm(w)) || UNIT_RE.test(w) && /\d/.test(w);
    if (pm && /^[A-ZÄÖÜ]/.test(pm[1]!) && !/^(NAI|PQ|Rtg|Richtung|Rot|Blau)$/i.test(pm[1]!) && !isUnit(pm[1]!) && !isTacticalWord(pm[1]!, ["e", "ech", "st", "act", "aff"])) {
      const second = pm[2] && /^[A-ZÄÖÜ]/.test(pm[2]) && !isTacticalWord(pm[2], ["e", "ech", "st", "act", "aff"]) && !isUnit(pm[2]) ? ` ${pm[2]}` : "";
      placeQuery = (pm[1]! + second).replace(/[’']$/, "");
      // «bei Kreuzung», «beim Waldrand»: Gattungswort, kein Ortsname (nicht nachschlagen)
      if (isGenericPlace(placeQuery)) placeQuery = undefined;
    }
    // genannter, aber (noch) unbekannter Ort («in Wabern», «AK77»): kein Ersatzort – sonst Widerspruch «bei H04» ↔ Ort fehlt
    if (ortProblems.length || namesPlace(locText, placeQuery, kind === "eigen")) {
      // Ort bleibt offen: Ortssuche, Karte oder Korrektur
    } else if (kind === "eigen") {
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
  const baseDesc = reading ? describeTactical({ ...reading, count }, adjAff) : undefined;
  // Aufzählung: nur ersetzen, wenn der Sinn nicht schon alle Anzahlen enthält
  const desc0 = parts && !parts.split(", ").every((p) => new RegExp(`(?<!\\d)${p.split(" ")[0]}(?!\\d)`).test(baseDesc ?? "")) ? parts : baseDesc;
  // unbestimmte Menge («ein paar Soldaten»): keine Anzahl, aber im Sinn behalten
  const vague = count === undefined && !parts ? vagueAmount(text) : undefined;
  const desc1 = vague && desc0 && !desc0.toLowerCase().includes(vague) ? `${vague} ${desc0}` : desc0;
  const desc = unknown ? `${unknown.count ? `${unknown.count} ` : ""}? («${unknown.token}»)` : desc1;
  const out: Draft = {
    minutes, day, t: isoOf(day, minutes), timeFromText, ...(dayFromText ? { dayFromText } : {}), ...(timeToken ? { timeToken } : {}), kind, kindFrom, side, melder, unit, sym, aff, sidc, echelon, status, desc, count,
    dir, dirLabel, from, fromLabel, roadHint, pos, where, cells, nai, placeQuery,
    // Originaltext bleibt erhalten; die Lesart der Funk-/Sprechsprache steht in `normalized`
    text: typed.changed ? stripLead(input) || input.trim() : shown || input.trim(),
    ...(typed.changed ? { normalized: typed.text } : {}),
    ...(problems.length ? { problems } : {}),
    ...(unknown ? { unknownWord: unknown } : {}),
    art: "meldung",
    artFrom: "standard",
  };
  return { d: out, lead: !!tp.used && tp.lead, zeitWahl };
}

/** «Bem: …» / «Bemerkung: …» am Ende einer Kurzmeldung: steht im Text, wird aber nie ausgewertet (wie U bei AEIOU) */
const BEM_RE = /(?<=^|\s)(?:bem|bemerkung|umwelt)\s*:.*$/isu;
/** Tag und Zeit am Anfang («T2 0725 », «07:25 ») */
const LEAD_DT_RE = /^(?:T\s?\d(?!\d)[\s,:]*)?(?:(?:[01]?\d|2[0-3])[:.h]?[0-5]\d(?:\s*uhr)?(?![\d'’])[\s,:]*)?/i;
/** «aufgehoben», «abgebaut», «wieder frei» … (Kap. 3.5) */
const AUFHEB_RE = /(?<![\p{L}\d])(aufgehoben|abgebaut|entfernt|geräumt|wieder\s+frei|freigegeben|nicht\s+mehr\s+(?:da|vorhanden)|weg)(?![\p{L}\d])/iu;

const DAY_MIN = 1440;

/**
 * Meldung lesen (Spez. MVP 3, Kap. 3.1–3.5): zuerst Felder (AEIOU/Meldezettel, `readMeldeFelder`), dann die Art
 * (`readArt`, Vorgabe `ctx.art`/`ctx.kind` schlägt die Erkennung), dann die bisherige Erkennung.
 * - Nicht-Meldungen (Auftrag, Orientierung, Rückfrage, Vbk, Notiz): kein Zeichen, kein Ort, kein Element (Invariante
 *   E3, `asNonLageDraft`); genannte Orte nur als Text (`orte`); Ereigniszeit nur aus einer Zeit am Anfang, sonst jetzt.
 * - AEIOU/Meldezettel: Zeit nur aus A/Wann, Ort nur aus O/Wo, U/Bem nie; E ist das Gesehene, nie der Melder (Entscheid 2).
 * - Bezug («Antwort zu 57», «Quittung», «Auftrag ausgeführt») und Aufheben («Sperre AG13 aufgehoben») über `ctx.events`.
 * `Draft.text` bleibt der Originaltext; `kindHint: "notiz"` (MVP 1) bei schwach erkannter Nicht-Meldung.
 */
export function parseMeldung(input: string, ctx: JournalContext): Draft {
  const blau = ctx.units.blau;
  const raw = input.trim();
  const felder = readMeldeFelder(raw, { blau }) ?? undefined;
  const les = felder ? felderZuText(felder) : raw.replace(BEM_RE, "").trim() || raw;
  const lesung: ArtLesung = readArt(les, { blau });
  let art: EntryArt = "meldung";
  let artFrom: Draft["artFrom"] = "standard";
  let artStark = true;
  if (ctx.art) { art = ctx.art; artFrom = "vorgabe"; }
  else if (ctx.kind) { artFrom = "vorgabe"; }
  else if (lesung.art !== "meldung") { art = lesung.art; artFrom = lesung.stark ? "text" : "inhalt"; artStark = lesung.stark; }
  // Meldung mit Bezug («Antwort zu 57: Det 2 in AJ8»): Bezug nicht als Inhalt lesen
  const ohneBezug = art === "meldung" && lesung.bezugToken ? les.replace(lesung.bezugToken, " ").replace(/\s+([:,])/g, "$1").replace(/(^|\s)[:,]\s*/, "$1").replace(/\s+/g, " ").trim() : les;
  const core = parseCore(ohneBezug, ctx);
  let d: Draft = { ...core.d, art, artFrom, ...(art !== "meldung" || artFrom !== "standard" ? { artStark } : {}) };
  // Originaltext bleibt (Felder: ganz; Bezug: ohne Tag/Zeit am Anfang, wie sonst)
  if (felder) d = { ...d, text: raw, normalized: les, felder };
  else if (ohneBezug !== les) d = { ...d, text: raw.replace(LEAD_DT_RE, "").trim() || raw };
  else if (les !== raw && !core.d.normalized) d = { ...d, text: `${d.text} ${raw.slice(les.length).trim()}`.trim() };
  if (felder) d = felderOrt(d, felder, ctx);
  const events = ctx.events ?? ctx.ex?.events;
  if (art !== "meldung") d = asNonLageDraft(d, lesung, core, ctx);
  else d = meldungBezug(d, lesung, ctx, events);
  if (art === "meldung" && events && !d.bezug && AUFHEB_RE.test(ohneBezug)) d = aufhebLesen(d, events);
  const melderEigen = !!d.melder && blau.some((u) => sameUnitName(u, d.melder));
  if (istDringend(les, { eigenerMelder: melderEigen })) d = { ...d, dringend: true };
  if (art !== "meldung" && !artStark) d = { ...d, kindHint: "notiz" };
  return d;
}

/** Meldezettel/AEIOU: Ort nur aus O/Wo (Ortsprobleme dort sperren wie sonst); ohne Melder nie ein Element aus E */
function felderOrt(d: Draft, f: MeldeFelder, ctx: JournalContext): Draft {
  let out = d;
  // Entscheid 2: E ist das Gesehene – ohne «Melder:»/«Von:»/Text vor dem ersten Feld gibt es keinen Melder
  if (!f.melder && d.melder) out = { ...out, melder: "" };
  const { pos: _p, where: _w, cells: _c, nai: _n, placeQuery: _q, ...rest } = out;
  const keep = (out.problems ?? []).filter((p) => p.kind !== "ort" && p.kind !== "orte");
  // Ersatzort (letzter Standort, beim Melder) kommt nicht aus dem Text – bleibt, wenn O/Wo fehlt
  if (!f.wo) {
    const fallback = out.where && (out.where.kind === "zuletzt" || out.where.kind === "melder") && out.melder ? { pos: out.pos, where: out.where } : {};
    return { ...rest, ...fallback, ...(keep.length ? { problems: keep } : { problems: undefined }) };
  }
  const o = parseCore(f.wo, { ...ctx, kind: d.kind }).d;
  const ortProbleme = (o.problems ?? []).filter((p) => p.kind === "ort" || p.kind === "orte");
  const problems = [...keep, ...ortProbleme];
  return {
    ...rest,
    ...(o.pos && o.where && o.where.kind !== "zuletzt" && o.where.kind !== "melder" ? { pos: o.pos, where: o.where } : {}),
    ...(o.cells ? { cells: o.cells } : {}), ...(o.nai ? { nai: o.nai } : {}), ...(o.placeQuery ? { placeQuery: o.placeQuery } : {}),
    problems: problems.length ? problems : undefined,
  };
}

/** Frist «bis 1200» → ISO lokal am Tag des Eintrags (früher als die Ereigniszeit → nächster Tag) */
function fristIso(day: string, t: string, hhmm: string): string {
  const min = +hhmm.slice(0, 2) * 60 + +hhmm.slice(2);
  const iso = isoOf(day, min);
  return iso < t ? isoOf(addDays(day, 1), min) : iso;
}

/** genannte Orte als Text (Nicht-Meldungen, Aufhebungen): Planquadrate, NAI, Ortsname */
function orteOf(d: Pick<Draft, "cells" | "nai" | "where" | "placeQuery">): string[] {
  const out = [...(d.cells ?? []), ...(d.nai ? [d.nai] : []), ...(d.where?.kind === "ort" ? [d.where.label] : []), ...(d.placeQuery ? [d.placeQuery] : [])];
  return [...new Set(out)];
}

/** jüngster offener Auftrag an `trupp` bzw. jüngste offene Rückfrage von/an `trupp` (vor `t`) */
function offenerBezug(events: LageEvent[], art: "auftrag" | "rueckfrage", trupp: string, t: string): LageEvent | undefined {
  if (!trupp) return undefined;
  const idx = lvzIndex(events);
  let best: LageEvent | undefined;
  for (const e of events) {
    if (e.deleted || artOf(e) !== art || e.t > t) continue;
    const wer = art === "auftrag" ? e.an : e.an ?? e.melder;
    const wer2 = art === "rueckfrage" ? e.melder : undefined;
    if (!(wer && sameUnitName(wer, trupp)) && !(wer2 && sameUnitName(wer2, trupp))) continue;
    if (vermerkeOf(e, idx).status !== "offen") continue;
    if (!best || compareEvents(e, best) > 0) best = e;
  }
  return best;
}

/** Bezug über die Nummer («zu 42», «12a») oder – ohne Nummer – auf den offenen Auftrag/die offene Rückfrage des Trupps */
function bezugAufloesen(d: Draft, l: ArtLesung, ctx: JournalContext, events: LageEvent[] | undefined, ohneNr?: "auftrag" | "rueckfrage"): Draft {
  if (!events) return l.bezugNr ? { ...d, bezugNr: l.bezugNr, ...(l.bezugArt ? { bezugArt: l.bezugArt } : {}) } : d;
  if (l.bezugNr) {
    const z = findByNr(ctx.ex ?? { events }, l.bezugNr);
    if (!z) return { ...d, bezugNr: l.bezugNr, bezugFehlt: true, ...(l.bezugArt ? { bezugArt: l.bezugArt } : {}) };
    return { ...d, bezug: z.id, bezugNr: l.bezugNr, bezugArt: l.bezugArt ?? "verweis" };
  }
  if (!ohneNr || !l.bezugArt) return d;
  const z = offenerBezug(events, ohneNr, d.melder, d.t);
  if (!z) return { ...d, bezugArt: l.bezugArt };
  return { ...d, bezug: z.id, bezugNr: nrLabel(z, ctx.ex ?? { events }), bezugArt: l.bezugArt };
}

function meldungBezug(d: Draft, l: ArtLesung, ctx: JournalContext, events: LageEvent[] | undefined): Draft {
  if (l.bezugArt === "ausgefuehrt") return bezugAufloesen(d, l, ctx, events, "auftrag");
  if (l.bezugArt === "antwort") return bezugAufloesen(d, l, ctx, events, "rueckfrage");
  if (l.bezugNr) return bezugAufloesen(d, l, ctx, events);
  return d;
}

/**
 * Entwurf als Nicht-Meldung (Invariante E3): nichts auf der Karte, nichts verschoben – `pos`, `where`, `cells`, `nai`,
 * `unit`, `count`, `dir` fehlen, `side` = blau, `sym` = einheit; genannte Orte in `orte`; Ortsprobleme entfallen.
 * Empfänger/Absender/Frist/Vbk aus `readArt`. Zeit: nur eine Zeit am Anfang zählt («bis 1200», «ab 2200» sind Inhalt).
 */
function asNonLageDraft(d: Draft, l: ArtLesung, core: CoreParse, ctx: JournalContext): Draft {
  const art = d.art;
  const lesung = l.art === art ? l : readArt(d.text, { blau: ctx.units.blau });
  const same = lesung.art === art;
  const orte = orteOf(d);
  let problems = (d.problems ?? []).filter((p) => p.kind !== "ort" && p.kind !== "orte");
  // Zeitregel: ohne Zeit am Anfang gilt jetzt
  let time: Partial<Draft> = {};
  if (d.timeFromText && !core.lead) {
    const day = d.dayFromText ? d.day : ctx.dayFromClock ? localDay(ctx.now) : ctx.day;
    const minutes = ctx.now.getHours() * 60 + ctx.now.getMinutes();
    time = { minutes, day, t: isoOf(day, minutes), timeFromText: false, timeToken: undefined };
    problems = problems.filter((p) => !core.zeitWahl.includes(p));
  }
  const an = same ? lesung.an : undefined;
  let melder = d.melder;
  if (art === "orientierung") melder = "";
  else if ((art === "auftrag" || art === "rueckfrage") && an && melder && sameUnitName(an, melder) && !/erhalt/i.test(d.text)) melder = "";
  else if (art === "vbk" && !melder && an) melder = an;
  const e = catalogEntry("einheit")!;
  const { pos: _p, where: _w, cells: _c, nai: _n, count: _k, dir: _d, dirLabel: _dl, from: _f, fromLabel: _fl, roadHint: _r, placeQuery: _q, echelon: _e, desc: _ds, unknownWord: _u, problems: _pr, kindHint: _kh, ...rest } = d;
  const t = (time.t ?? d.t);
  const day = time.day ?? d.day;
  let out: Draft = {
    ...rest, ...time, kind: "eigen", kindFrom: d.kindFrom === "vorgabe" ? "vorgabe" : "inhalt", side: "blau", aff: "F", unit: "", melder, sym: "einheit",
    sidc: buildSidc(e, "F"), status: "present",
    ...(an && art !== "vbk" ? { an } : {}),
    ...(same && lesung.quelle ? { quelle: lesung.quelle } : {}),
    ...(same && lesung.frist && art === "auftrag" ? { frist: fristIso(day, t, lesung.frist) } : {}),
    ...(art === "vbk" && same && lesung.vbk ? { vbk: lesung.vbk } : {}),
    ...(orte.length ? { orte } : {}),
    ...(problems.length ? { problems } : {}),
  };
  if (time.timeToken === undefined && "timeToken" in time) delete out.timeToken;
  const events = ctx.events ?? ctx.ex?.events;
  // Quittung ohne Nummer → jüngster offener Auftrag an diesen Trupp (Entscheid 5); «Quittung 42» → Nr 42
  if (same && lesung.bezugArt === "quittung") out = bezugAufloesen(out, lesung, ctx, events, "auftrag");
  else if (same && lesung.bezugNr) out = bezugAufloesen(out, lesung, ctx, events);
  return out;
}

/** «… aufgehoben»: Ziel am Ort suchen (Kap. 3.5); genau eines → Aufhebung, sonst Kandidaten (gelb) */
function aufhebLesen(d: Draft, events: LageEvent[]): Draft {
  if (!istAufhebbar({ sym: d.sym })) return d;
  const ziele = aufhebZiele(events, d, lvzIndex(events));
  if (ziele.length === 1) return aufhebDraft(d, ziele[0]!);
  return { ...d, hebtAufKandidaten: ziele.map((e) => e.id) };
}

/** Name des Zeichens für «Sperre aufgehoben» */
const zeichenWort = (sym: string) => { const c = catalogEntry(sym); return c?.noun ?? c?.name.replace(/\s*\(.*?\)\s*/g, " ").split(" / ")[0]!.trim() ?? "Zeichen"; };

/**
 * Entwurf als Aufhebung von `ziel` (Kap. 3.5): Art Meldung ohne Ort und Element, `sym` einheit, `desc` «Sperre
 * aufgehoben», Ort nur als Text (`orte`) – zeichnet weder in MVP 1 noch MVP 3. Auch für die Wahl bei mehreren Zielen.
 */
export function aufhebDraft(d: Draft, ziel: LageEvent): Draft {
  const orte = [...new Set([...orteOf(d), placeLabel(ziel)].filter(Boolean))];
  const e = catalogEntry("einheit")!;
  const { pos: _p, where: _w, cells: _c, nai: _n, count: _k, dir: _d, dirLabel: _dl, from: _f, fromLabel: _fl, roadHint: _r, placeQuery: _q, echelon: _e, unknownWord: _u, hebtAufKandidaten: _hk, ...rest } = d;
  const problems = (d.problems ?? []).filter((p) => p.kind !== "ort" && p.kind !== "orte");
  return {
    ...rest, unit: "", sym: "einheit", sidc: buildSidc(e, d.aff), status: "present", desc: `${zeichenWort(ziel.sym)} aufgehoben`, hebtAuf: ziel.id,
    ...(orte.length ? { orte } : {}), problems: problems.length ? problems : undefined,
  };
}

/**
 * Knopf «Aufgehoben (jetzt)» an der Zeile (Kap. 3.5): neue Meldung «Sperre AG13 aufgehoben» mit `hebtAuf`, Melder
 * leer, Lagezeit `o.t` (sonst jetzt). Rückgängig = diese Meldung streichen.
 */
export function aufhebEvent(ziel: LageEvent, device: string, now = new Date(), o: { t?: string; nr?: number; kuerzel?: string } = {}): LageEvent {
  const ort = placeLabel(ziel);
  const wort = zeichenWort(ziel.sym);
  const t = o.t ?? localIso(now);
  const e = catalogEntry("einheit")!;
  return {
    id: newEventId(now.getTime()), rev: 1, device, updatedAt: now.toISOString(), createdAt: now.toISOString(), tReported: localIso(now), t, tOffset: offsetFor(t, now),
    side: ziel.side, unit: "", text: `${wort}${ort ? ` ${ort}` : ""} aufgehoben`, sym: "einheit", aff: ziel.aff, sidc: buildSidc(e, ziel.aff), desc: `${wort} aufgehoben`,
    source: { kind: "text" }, confirmed: true, art: "meldung", hebtAuf: ziel.id, ...(ort ? { orte: [ort] } : {}),
    ...(o.nr !== undefined ? { nr: o.nr, von: device } : {}), ...(o.kuerzel ? { erfasstVon: o.kuerzel } : {}),
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
  // (MVP 3) eigene Verwundete mit Sanitätsanforderung («H05 1 Verwundeter, Sanität angefordert»): eigene Lage, nicht Unklar
  if (entry.key === "verletzte" && o.melder && !o.enemy && !ENEMY_RE.test(text) && !STRONG_ENEMY_RE.test(text) && SAN_REQ_RE.test(text) && !/(?<![\p{L}])ziv/iu.test(text)) return "eigen";
  // eigene Anlage bezogen/eingerichtet (z. B. «H05 Checkpoint AK7 bezogen»): eigene Lage
  if (o.melder && !o.enemy && !ENEMY_RE.test(text) && entry.kind === "anlage" && OWN_SETUP_RE.test(text)) return "eigen";
  if (o.enemy || ENEMY_RE.test(text) || entry.lean === "feind") return "feind";
  return "unklar";
}

/**
 * Verben, mit denen ein Melder eine eigene Anlage meldet. «errichtet», «aufgebaut» sind mehrdeutig (meist Sichtung:
 * «Checkpoint errichtet») und zählen nicht; «eingerichtet» nur mit «wir» («wir haben Checkpoint eingerichtet»).
 */
/** Sanität angefordert / benötigt (eigene Verwundete) */
const SAN_REQ_RE = /(?<![\p{L}])san(?:ität|itäter|\.)?\s+(?:angefordert|anfordern|benötigt|nötig|dringend)(?![\p{L}])/iu;

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

/** (P4) gemerkte Lagen je Ereignisliste (Identität des Arrays) und (t, maxAge) – höchstens wenige je Liste */
const SITUATION_CACHE = new WeakMap<LageEvent[], { snap: LageEvent[]; byKey: Map<string, { units: UnitState[]; loose: LageEvent[] }> }>();
const SITUATION_MAX = 8;

/**
 * Lage zur Zeit `t`: je Element die letzte Meldung mit Standort, dazu lose Zeichen (Sichtungen ohne Element,
 * Tätigkeiten am Ort). Nur Lage-Einträge (`isLage`: Art Meldung, nicht gestrichen, keine Aufhebung); aufgehobene
 * Zeichen (Sperre, Checkpoint …, `liftMap`) fehlen ab der Zeit der Aufhebung – der Rückblick davor zeigt sie.
 * Ergebnis gemerkt je (`events`-Array, `t`, `maxAgeMin`) – nicht verändern.
 * @param maxAgeMin Meldungen ohne Element werden nur so lange gezeigt (Minuten)
 */
export function situationAt(events: LageEvent[], t: string, maxAgeMin = Infinity): { units: UnitState[]; loose: LageEvent[] } {
  const key = `${t}|${maxAgeMin}`;
  let memo = SITUATION_CACHE.get(events);
  // Array von aussen verändert (push, Ersatz eines Elements)? Dann neu rechnen
  if (memo && (memo.snap.length !== events.length || memo.snap.some((e, i) => e !== events[i]))) memo = undefined;
  const hit = memo?.byKey.get(key);
  if (hit) return hit;
  const r = situationCompute(events, t, maxAgeMin);
  if (!memo) { memo = { snap: events.slice(), byKey: new Map() }; SITUATION_CACHE.set(events, memo); }
  if (memo.byKey.size >= SITUATION_MAX) memo.byKey.delete(memo.byKey.keys().next().value!);
  memo.byKey.set(key, r);
  return r;
}

function situationCompute(events: LageEvent[], t: string, maxAgeMin: number): { units: UnitState[]; loose: LageEvent[] } {
  const live = events.filter((e) => e.t <= t && isLage(e)).sort(compareEvents);
  const lifts = liftMap(events);
  const lifted = (e: LageEvent) => { const l = lifts.get(e.id); return !!l && l.t <= t; };
  const byUnit = new Map<string, UnitState>();
  const loose: LageEvent[] = [];
  const tMin = Date.parse(t) - maxAgeMin * 60000;
  for (let e of live) {
    if (!e.unit) {
      if (e.pos && Date.parse(e.t) >= tMin && !lifted(e)) loose.push(e);
      continue;
    }
    const k = unitKey(e.side, e.unit);
    const cur = byUnit.get(k);
    // Tätigkeit / Ereignis (Kontakt, Sperre, Explosion …): als eigenes Zeichen am Ort; das Element behält sein Zeichen.
    // Eigene Meldungen damit verschieben den Melder nicht (nur Einheiten-Meldungen und eigene Lage wie Stellung).
    const cat = catalogEntry(e.sym);
    if (cat ? cat.activity : symbolDef(e.sym).activity) {
      const pos = e.pos ?? cur?.pos;
      if (pos && Date.parse(e.t) >= tMin && !lifted(e)) loose.push({ ...e, pos });
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

/** «Eigene», «Feind», «Unklar» (bzw. «UL»); Notiz ohne Zeichen («Rückfrage …») → «Notiz» */
export function kindLabel(e: Pick<LageEvent, "side" | "aff"> & { notiz?: boolean }): string {
  if (e.notiz) return "Notiz";
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

/** «hh:mm» lokal zu einem Zeitpunkt (ISO UTC) */
const localHhmm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** Status einer Meldung für Journal-Export und Liste: «gestrichen» (gelöscht), «korrigiert 07:34» oder leer */
export function journalStatus(e: Pick<LageEvent, "deleted" | "history" | "correctedAt">): string {
  if (e.deleted) return "gestrichen";
  if (e.history?.length) return e.correctedAt ? `korrigiert ${localHhmm(e.correctedAt)}` : "korrigiert";
  return "";
}

/** frühere Fassungen in einer Zeile, z. B. «vorher: 1 Fz in NAI 2 Rtg N (NAI 2)»; Konflikt-Fassungen mit «Konflikt, nicht übernommen: …» */
export function historyText(e: Pick<LageEvent, "history">): string {
  const line = (r: NonNullable<LageEvent["history"]>[number]) => { const p = placeLabel(r); return `${r.t.slice(11, 16)} ${r.text}${p ? ` (${p})` : ""}${r.von ? ` – ${r.von}` : ""}`; };
  const h = (e.history ?? []).filter((r) => !r.deleted && !r.conflict);
  const k = (e.history ?? []).filter((r) => !r.deleted && r.conflict);
  const parts: string[] = [];
  if (h.length) parts.push("vorher: " + h.map(line).join(" | "));
  // Konflikt beim Zusammenführen: unterlegene Fassung des anderen Geräts (nichts geht verloren)
  if (k.length) parts.push("Konflikt, nicht übernommen: " + k.map(line).join(" | "));
  return parts.join(" · ");
}

/**
 * Journal als CSV (Excel, «;»). Gelöschte Meldungen erscheinen als «gestrichen» (Journalführung: nichts verschwindet),
 * korrigierte mit «korrigiert hh:mm» und den früheren Fassungen (`gestrichen: false` lässt Gelöschte weg).
 *
 * MVP 3: Spalte «Art» zeigt die Eintragsart in Worten («Auftrag an H01», Meldung wie bisher «Feind»/«Eigene»/«Unklar»);
 * neue Spalten **hinten** (bestehende Auswertungen per Spaltenname bleiben): Nr · Eingang · An/Quelle · Erfasst von ·
 * Dringend · Stand (offen/erledigt/quittiert/beantwortet/aufgehoben) · Massnahme · Weitergemeldet · Bezug · Hebt auf.
 */
export function journalToCsv(events: LageEvent[], days: string[], o: { gestrichen?: boolean } = {}): string {
  const head = ["Tag", "Zeit", "Art", "Element", "Melder", "Meldung", "Zeichen", "Ort", "Planquadrat", "NAI", "E", "N", "Status", "Fassungen", "Form",
    "Nr", "Eingang", "An/Quelle", "Erfasst von", "Dringend", "Stand", "Massnahme", "Weitergemeldet", "Bezug", "Hebt auf"];
  const ex = { events };
  const idx = lvzIndex(events);
  const byId = new Map(events.map((e) => [e.id, e]));
  const tagOf = (t: string) => { const d = t.slice(0, 10); return days.indexOf(d) >= 0 ? `T${days.indexOf(d) + 1}` : d; };
  const nrOfId = (id?: string) => { const z = id ? byId.get(id) : undefined; return z ? nrLabel(z, ex) : id ? "?" : ""; };
  const rows = events.filter((e) => !e.deleted || o.gestrichen !== false).sort(compareEvents).map((e) => {
    const v = vermerkeOf(e, idx);
    const eingang = e.tReported ? (e.tReported.slice(0, 10) === e.t.slice(0, 10) ? e.tReported.slice(11, 16) : `${tagOf(e.tReported)} ${e.tReported.slice(11, 16)}`) : "";
    const stand = [
      v.status === "erledigt" ? `erledigt${v.erledigtUm ? ` ${localHhmm(v.erledigtUm)}` : ""}` : v.status ?? "",
      v.quittiert ? `quittiert ${v.quittiert.t.slice(11, 16)}` : "",
      v.beantwortet ? `beantwortet ${v.beantwortet.t.slice(11, 16)} (Nr ${nrOfId(v.beantwortet.id)})` : "",
      v.aufgehoben ? `aufgehoben ${v.aufgehoben.t.slice(11, 16)} (Nr ${nrOfId(v.aufgehoben.id)})` : "",
    ].filter(Boolean).join(", ");
    return [tagOf(e.t), e.t.slice(11, 16), e.art || e.notiz ? artText(e) : kindLabel(e), e.unit, e.melder ?? "", e.text, e.sym, e.where ?? (e.orte ?? []).join(" "), (e.cells ?? []).join(" "), e.nai ?? "",
      e.pos ? String(Math.round(e.pos.e)) : "", e.pos ? String(Math.round(e.pos.n)) : "", `${journalStatus(e)}${e.deleted && e.geaendertVon ? ` ${e.geaendertVon}` : ""}`, historyText(e), shapeCsv(e),
      nrLabel(e, ex), eingang, e.an ?? e.quelle ?? "", e.erfasstVon ?? "", v.dringend ? "dringend" : "", stand, v.massnahme ?? "",
      v.weiter ? `${v.weiter.an} ${v.weiter.um.slice(11, 16)}` : "", nrOfId(e.bezug), nrOfId(e.hebtAuf)];
  });
  return "\uFEFF" + [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}

/**
 * Neuer Journaleintrag aus einer erkannten Meldung. `now` = Eingang: `tReported` (lokal, Minute) und `createdAt`
 * (genauer Zeitpunkt, UTC) – getrennt von der Ereigniszeit `t` («1015 …» um 10:40 eingetragen: t 10:15, Eingang 10:40).
 *
 * MVP 3: `o.nr` = laufende Nummer (`nextNr`, setzt auch `von` = Gerät), `o.kuerzel` = «erfasst von». Nicht-Meldungen
 * (`d.art ≠ meldung`) bekommen `art`, `notiz: true` und **nie** pos/unit/cells/nai/shape (Invariante E3).
 */
export function eventFromDraft(d: Draft, device: string, now = new Date(), o: { nr?: number; kuerzel?: string } = {}): LageEvent {
  const art = d.art ?? (d.kindHint === "notiz" ? "notiz" : "meldung");
  const ev = eventFromDraftBase(d, device, now);
  const mvp3: Partial<LageEvent> = {
    ...(o.nr !== undefined ? { nr: o.nr, von: device } : {}),
    ...(o.kuerzel ? { erfasstVon: o.kuerzel } : {}),
    ...(d.an ? { an: d.an } : {}), ...(d.quelle ? { quelle: d.quelle } : {}), ...(d.frist ? { frist: d.frist } : {}), ...(d.vbk ? { vbk: d.vbk } : {}),
    ...(d.bezug ? { bezug: d.bezug, ...(d.bezugArt ? { bezugArt: d.bezugArt } : {}) } : {}),
    ...(d.hebtAuf ? { hebtAuf: d.hebtAuf } : {}), ...(d.orte?.length ? { orte: [...d.orte] } : {}), ...(d.felder ? { felder: { ...d.felder } } : {}),
    ...(d.dringend ? { lvz: { dringend: { v: true, at: now.toISOString(), device, ...(o.kuerzel ? { von: o.kuerzel } : {}) } } } : {}),
  };
  if (art === "meldung" && !d.hebtAuf) return { ...ev, ...mvp3 };
  if (art === "meldung") {
    // Aufhebung: zeichnet nie (kein Ort, kein Element) – Ort nur als Text in `orte`
    const { pos: _p, cells: _c, nai: _n, shape: _s, where: _w, count: _k, dir: _d, label: _l, ...rest } = ev;
    return { ...rest, ...mvp3, unit: "", sym: "einheit" };
  }
  // Nicht-Meldung: kein Zeichen, nichts auf der Karte; MVP-1-App zeigt sie als «Notiz»
  const { pos: _p, cells: _c, nai: _n, shape: _s, where: _w, count: _k, dir: _d, label: _l, ...rest } = ev;
  return { ...rest, ...mvp3, unit: "", art, notiz: true };
}

function eventFromDraftBase(d: Draft, device: string, now: Date): LageEvent {
  return {
    id: newEventId(now.getTime()),
    rev: 1,
    device,
    updatedAt: now.toISOString(),
    createdAt: now.toISOString(),
    tReported: localIso(now),
    t: d.t,
    tOffset: offsetFor(d.t, now),
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
    ...(d.kindHint === "notiz" ? { notiz: true } : {}),
  };
}

/** Änderung an einem Eintrag (Revision hochzählen, für den späteren Abgleich zwischen Geräten). */
export function reviseEvent(e: LageEvent, patch: Partial<LageEvent>, device: string, now = new Date()): LageEvent {
  // neue Ereigniszeit: Offset dazu neu bestimmen (Sommerzeit), ausser er wird mitgegeben
  const off = patch.t && patch.t !== e.t && !("tOffset" in patch) ? { tOffset: offsetFor(patch.t, now) } : {};
  return { ...e, ...patch, ...off, rev: e.rev + 1, device, updatedAt: now.toISOString() };
}

/**
 * Korrektur einer Meldung (Spez. MVP 1, Kap. 3.3): alte Fassung kommt in `history` (älteste zuerst), Revision steigt,
 * `correctedAt` = jetzt. Die Ereigniszeit `t` bleibt, ausser `patch.t` nennt eine neue; Eingang (`tReported`,
 * `createdAt`) und ID ändern nie. Rückgängig unmittelbar danach: `undoCorrection`.
 */
export function correctEvent(e: LageEvent, patch: Partial<LageEvent>, device: string, now = new Date()): LageEvent {
  const { id: _id, rev: _rev, history: _h, createdAt: _c, tReported: _r, device: _d, updatedAt: _u, correctedAt: _k, ...rest } = patch;
  const history = [...(e.history ?? []), revisionOf(e)];
  return { ...reviseEvent(e, rest, device, now), history, correctedAt: now.toISOString() };
}

/**
 * Rückgängig einer eben gespeicherten Korrektur (Leiste «Korrigiert: … · Rückgängig»): die Fassung `before` gilt
 * wieder – mit ihrer Historie, aber höherer Revision als `cur` (damit sie beim Zusammenführen gewinnt).
 */
export function undoCorrection(cur: LageEvent, before: LageEvent, device: string, now = new Date()): LageEvent {
  return { ...before, rev: Math.max(cur.rev, before.rev) + 1, device, updatedAt: now.toISOString() };
}

/** Ort einer Meldung in Worten (für «vorher NAI 2», «NAI 2 → AK9»), z. B. «AK9», «NAI 2», «Karte (AK9)» */
export function placeLabel(e: Pick<LageEvent, "where" | "cells" | "nai" | "pos">): string {
  if (e.where === "Karte") return e.cells?.[0] ? `Karte (${e.cells[0]})` : "Karte";
  return e.where ?? e.cells?.[0] ?? e.nai ?? (e.pos ? "Koordinate" : "");
}

/** Was hat eine Korrektur geändert? Kurz in Worten, z. B. «NAI 2 → AK9» (höchstens zwei Teile), sonst «Text geändert». */
export function correctionSummary(before: Pick<LageEvent, "text" | "t" | "side" | "aff" | "melder" | "where" | "cells" | "nai" | "pos" | "sym" | "count">, after: typeof before): string {
  const out: string[] = [];
  const pb = placeLabel(before) || "ohne Ort", pa = placeLabel(after) || "ohne Ort";
  if (pb !== pa) out.push(`${pb} → ${pa}`);
  if (before.t !== after.t) out.push(`${before.t.slice(11, 16)} → ${after.t.slice(11, 16)}`);
  const kb = kindLabel(before), ka = kindLabel(after);
  if (kb !== ka) out.push(`${kb} → ${ka}`);
  if ((before.melder ?? "") !== (after.melder ?? "")) out.push(`von ${before.melder || "?"} → ${after.melder || "?"}`);
  if (!out.length && (before.count ?? 0) !== (after.count ?? 0)) out.push(`Anzahl ${before.count ?? "–"} → ${after.count ?? "–"}`);
  if (!out.length) out.push(before.text !== after.text ? "Text geändert" : "Zeichen geändert");
  return out.slice(0, 2).join(" · ");
}
