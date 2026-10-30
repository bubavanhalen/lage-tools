/**
 * Lagejournal: Meldungen so eingeben, wie man sie mitschreibt, z. B.
 *   «1015 Rot 2 Fz in NAI 3 Rtg N»   «0955 Blau H04 Beo Stao AB12 C»   «T2 0315 Det 4 angekommen Wabern»
 * Erkannt werden Zeit (und Übungstag), Seite, Element, Ort, Zeichen, Anzahl und Richtung.
 * Die Erkennung macht nur Vorschläge; der Originaltext bleibt immer erhalten.
 */
import { pointInRing, ringCentroid } from "./geo";
import { findCoordinates, type LV95 } from "./lv95";
import { newEventId, revisionOf, type Area, type EntryArt, type Exercise, type LageEvent, type MeldeFelder, type Place, type RoadHint, type Side } from "./model";
import { ART_LABEL, artOf, artText, isLage, istDringend, readArt, unscharfTreffer, type ArtLesung } from "./arten";
import { readMeldeFelder, felderZuText } from "./felder";
import { aufhebZiele, bezugAufloesen as lvzBezugAufloesen, istAufhebbar, liftMap, lvzIndex, vermerkeOf, type BezugWahl } from "./lvz";
import { findByNr, nrLabel } from "./nummer";
import { boundsCenter, cellAtAny, cellBounds, findCells, type FoundCell, type RasterSheet } from "./raster";
import { buildSidc, catalogEntry, describeTactical, isCountableWord, isTacticalWord, readTactical, type CatalogEntry, type Echelon, type Status } from "./catalog";
import { symbolDef, type Affiliation } from "./symbols";
import { findTimes } from "./time";
import { addDays, compareEvents, lesart, localDay, localIso, nearestDay, offsetFor, offsetsAt, umstellTage, zeitBis, zeitCmp, zeitMs, zeitTeile } from "./clock";
import { schichtZuordnung } from "./schichtwahl";
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
  // ---- MVP 3.5 (Spez. MVP 3.5, Kap. 5.4) ----
  /** IANA-Zone für Lesart und Offset (fehlt → Zone des Geräts); Tests geben «Europe/Zurich» an */
  zone?: string;
  /** «nicht abschliessen» gewählt (Vorschau, gilt wie `kind` bis der Text gelöscht wird) – D2 */
  abschlussAus?: boolean;
  /** gewählter Bezug (ID) bei mehreren Kandidaten («64a …» / «Nr 66 …» angetippt) – D2 */
  bezugWahl?: string;
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
  /**
   * (MVP 3 Nachbesserung) Weshalb eine Meldung zur Notiz wurde (gelb, 2. Enter = Notiz): «kein-ziel» = «… aufgehoben»
   * ohne aktives Ziel (Aufheben zeichnet nie), «weg» = «Feind weg aus AK9» ohne Gesehenes («Kein Zeichen?»).
   */
  notizGrund?: "kein-ziel" | "weg" | "kein-zeichen";
  /**
   * (MVP 3 Fix 3) Art bzw. Aufheben nur aus einem unscharfen Wort gelesen («Auftarg», «antwrt», «Batt», «aufgehobn»):
   * `wort` = gemeinte Sache in Klartext («Auftrag», «Antwort», «Orientierung von Bat», «Aufheben»), `token` wie getippt.
   * `entryState`: immer gelb «Auftrag gemeint? «Auftarg»» – nie grün ein Zeichen, nie eine Trupp-Verschiebung.
   */
  unscharf?: { wort: string; token: string };
  /**
   * (MVP 3 Fix 3) Antwort mit Sichtung und Ort («H03 Antwort 3 Pers AN7»): gelb «Sichtung in der Antwort – als Meldung
   * eintragen?» (Ausweg Feind/Eigene/Unklar wählen); 2. Enter trägt die Antwort ohne Zeichen ein.
   */
  sichtung?: boolean;

  // ---- MVP 3.5 «Feinschliff» (Spez. MVP 3.5, Kap. 5.4) – Phase 0: nur Verträge, gesetzt von den Paketen C/D ----
  /** Offset der Ereigniszeit aus der Lesart (`lesart`, clock.ts); `eventFromDraft` übernimmt ihn (fehlt → `offsetFor`) */
  tOffset?: string;
  /** C7/C11: eigene Meldung mit Begehren (Nachschub, Sanität, Mun-Stand) – kein neues Zeichen, Trupp bleibt */
  begehren?: { was: string };
  /** C6: Aufteilung in zwei Einträge (Texte, je mit Melder vorne) – Knopf «Als zwei Einträge» (E) */
  teile?: [string, string];
  /** D2: mehrere mögliche Bezüge (IDs) – Knöpfe «64a …»/«Nr 66 …» (E), Grund `bezug-wahl`/`auftrag-wahl` */
  bezugKandidaten?: string[];
  /** D2/D1.7: dieser Eintrag schliesst einen Auftrag ab («schliesst Auftrag Nr 66 ab»); null = keiner */
  abschluss?: { id: string; nr: string; text: string } | null;
  /** «nicht abschliessen» gewählt (Vorgabe aus dem Feld, wie `kindOverride`) */
  abschlussAus?: boolean;
  /** C1: Vorschlag für die unbekannte Textstelle («Persohnen» → «Personen»), Knopf «‹Wort› übernehmen» (E) */
  ersatz?: { token: string; wort: string };
  /** C12: unbekannter Trupp («H06») – nur Anzeige/Knopf «H06 als Trupp aufnehmen», `melder` bleibt leer */
  truppNeu?: string;
  /** (D2, additiv) Wahl-Knöpfe zu `bezugKandidaten` (Grund, Text, Beschriftungen) – `entryState` → `EntryReason.choices` */
  wahl?: BezugWahl;

  // ---- MVP 3.5, Paket C (additiv): Gründe der Erkennung für die Vorschau (`entryState`, Texte Kap. 4) ----
  /**
   * C8: Ereignis am ausdrücklich genannten eigenen Trupp («H05 hat Kontakt», «Drohne über H05», «2 Fz fahren an H02
   * vorbei»): Ort «bei H05 (AQ11 C)» ist sicher – kein gelbes `ort-bei-trupp`.
   */
  amTrupp?: boolean;
  /**
   * C7/C11: eigene Meldung ohne neues Zeichen – «verwundet» (eigene Verwundete, Ort nur als Text) bzw. «begehren»
   * (Nachschub, Mun-Stand): Trupp bleibt, kein «Ort fehlt», nie ein Zeichen auf der Karte.
   */
  ohneZeichen?: "verwundet" | "begehren";
  /** C13: genannter, aber unbekannter Ort («erreicht Checkpoint 2», «bei der Brücke») – kein Ersatzort, gelb `ort` */
  ortUnbekannt?: string;
  /** C5: eigener Trupp ohne Standortverb an einen Ort («H01 Rückzug nach AC5») – gelb `seite` «H01 selbst nach AC5?» */
  seiteFrage?: { trupp: string; ort: string };
  /** C6: zwei Orte (Bewegung des Trupps + Sichtung) – gelb `zwei-orte`; der Entwurf ist die Sichtung, `teile` die Aufteilung */
  zweiOrte?: { trupp: string; ziel: string; sicht: string; seite: string; bleibt?: string };
  /** S23: getippte Uhrzeit gibt es an diesem Tag nicht (Uhr vorgestellt) – rot `zeit-fehlt`, Vorschlag «0330» */
  zeitFehlt?: { zeit: string; vorschlag: string; von: string; bis: string };
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

/** Absender von oben – nie Melder */
const QUELLE_RE = /^(?:kp|kdt|bat|rgt|br|s2)$/i;

const DIRS: Record<string, number> = {
  N: 0, NORD: 0, NORDEN: 0, NO: 45, NE: 45, NORDOST: 45, NORDOSTEN: 45, O: 90, E: 90, OST: 90, OSTEN: 90,
  SO: 135, SE: 135, SÜDOST: 135, SÜDOSTEN: 135, S: 180, SÜD: 180, SÜDEN: 180, SW: 225, SÜDWEST: 225, SÜDWESTEN: 225,
  W: 270, WEST: 270, WESTEN: 270, NW: 315, NORDWEST: 315, NORDWESTEN: 315,
  // (MVP 3.5, C2) Kurzformen wie getippt: «Rtg Nrd», «Sd», «Wst»
  NRD: 0, NRDN: 0, SD: 180, WST: 270,
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
// ---- MVP 3.5, Paket C (Spez. MVP 3.5, Kap. 3.3): Regeln C3–C11
/** C8: Ereignis am Trupp – Kontakt, Beschuss, Angriff (grün «bei H05», wenn der Trupp genannt ist) */
const KONTAKT_AM_RE = /(?<![\p{L}])(kontakt|feuerkontakt|beschossen|beschuss|unter\s+feuer|angegriffen|überfallen|attackiert|feuerkampf|feuergefecht|gefecht|schusswechsel)(?![\p{L}])/iu;
/** C8: Wahrnehmung ohne Sicht («hört Schüsse», «Lärm von Motoren»): Ort beim Trupp bleibt nur angenommen (gelb) */
const HOER_RE = /(?<![\p{L}])(hört|höre|hören|gehört|lärm|motorenlärm|geräusch\p{L}*|motorengeräusch\p{L}*|knall)(?![\p{L}])/iu;
/** C10: Gefecht am Trupp → dringend */
const GEFECHT_RE = /(?<![\p{L}])(feuerkampf|feuergefecht|gefecht|schusswechsel|beschossen|unter\s+feuer|angegriffen|überfallen|attackiert)(?![\p{L}])/iu;
/** C7: Sanität (Wort) und Anforderung (in beiden Reihenfolgen: «San angefordert», «verlangt Sanität») */
const SAN_WORT_RE = /(?<![\p{L}])(san|sanität|sanitäter|sanitätsdienst|arzt|ambulanz)(?![\p{L}])/iu;
const ANFORDERN_RE = /(?<![\p{L}])(angefordert|anfordern|fordert|fordern|benötig\p{L}*|braucht|brauchen|verlangt|verlangen|nötig)(?![\p{L}])/iu;
/** C7: Bezug auf den eigenen Trupp («bei uns», «eig», «eigene Trp», «wir») */
const EIGEN_BEZUG_RE = /(?<![\p{L}])(bei\s+uns|eig|eigene[nrs]?|wir|unser\p{L}*)(?![\p{L}])/iu;
/** C7: Sichtung durch den Trupp («H03 sieht 2 Verletzte») – dann sind es nicht die eigenen */
const SICHT_VERB_RE = /(?<![\p{L}])(sieht|sah|sehen|beobachtet|gesichtet|sichtet|erkennt)(?![\p{L}])/iu;
/** C11: Begehren eines eigenen Trupps («benötigt», «Nachschub», «Mun Stand 60%», «fordert … an», «Bedarf») */
const BEGEHREN_RE = /(?<![\p{L}])(benötig\p{L}*|braucht|brauchen|\p{L}*nachschub|mun(?:itions)?[\s-]?stand|verlangt|verlangen|fordert\s+\S+(?:\s+\S+)?\s+an|angefordert|anfordern|bedarf)(?![\p{L}])/iu;
/** C11: Wörter, die im Begehren selbst nicht stehen («H05 Mun Nachschub benötigt» → «Mun Nachschub») */
const BEGEHREN_WEG_RE = /(?<![\p{L}])(benötig\p{L}*|braucht|brauchen|verlangt|verlangen|angefordert|anfordern|fordert|an|bitte|dringend|sofort|wir|uns|hier|meldet|meldung)(?![\p{L}])/giu;
/** C3: Verneinung/Abgang – ohne Gesehenes kein neues Zeichen («Feind hat AD7 verlassen», «Det 2 Standort unbekannt») */
const KEIN_ZEICHEN_RE = /(?<![\p{L}])(verlassen|weg\s+aus|nicht\s+mehr\s+(?:da|gesehen|sichtbar|in\s+sicht)|(?:standort|aufenthalt(?:sort)?)\s+unbekannt|keine\s+sicht|ausser\s+sicht|aus\s+der\s+sicht)(?![\p{L}])/iu;
/** C5: Ausweichen/Rückzug – kein Standortverb («H01 Rückzug nach AC5» → gelb «H01 selbst nach AC5?») */
const RUECKZUG_RE = /(?<![\p{L}])(rückzug|zurück\p{L}*|weich\p{L}*\s+(?:\p{L}+\s+)?aus|ausweichen|ausgewichen|absetzen|setz\p{L}*\s+(?:uns|sich)\s+ab)(?![\p{L}])/iu;
/** C2: Automarken ohne Zahl sind ein einzelnes Fahrzeug («schwarzer Golf» = 1 Personenwagen) */
const EINZEL_TYP = new Set(["golf", "passat"]);
/** C13: Ort mit Präposition und Artikel bzw. Gattungswort («bei der Brücke», «beim Waldrand») – genannt, aber kein Ortsname */
const ORT_PHRASE_RE = /(?<![\p{L}])(?:bei|beim|an|am|auf|vor|hinter|neben|nahe|im|in)\s+(?:der|dem|den|die|das)\s+([\p{L}][\p{L}\-]+(?:\s+\d{1,3})?)/iu;

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
  /** Zeit stand ganz am Anfang (nach dem Tag) */
  start: boolean;
  /** Zeitprobleme aus der Wahl der Zeit (zweite Zeitangabe, ungefähre Zeit) – entfallen bei Nicht-Meldungen ohne Zeit am Anfang */
  zeitWahl: DraftProblem[];
}

/** Begehren in Worten: Text ohne Melder und ohne Bedarfsverb («H05 Mun Nachschub benötigt» → «Mun Nachschub») */
function begehrenWas(text: string, hits: Array<{ index: number; len: number }>): string {
  let t = text;
  for (const h of hits) t = blank(t, h.index, h.index + h.len);
  return t.replace(BEGEHREN_WEG_RE, " ").replace(/\s+/g, " ").replace(/^[\s:,;.!–-]+|[\s:,;.!?–]+$/g, "").trim();
}
/** Bedarf an Logistik/Anlage («Mun», «Nachschub», «Sanität») – kein Lagezeichen */
const begehrenArt = (key: string) => { const c = catalogEntry(key); return !!c && (c.category === "Führung und Logistik" || c.kind === "anlage"); };
/**
 * (MVP 3.5, S23) Lesart der Ereigniszeit: Offset; doppelte Stunde → die Lesart, die nicht (mehr als die Toleranz) in der
 * Zukunft liegt; fehlende Stunde (Uhr vorgestellt) bei getippter Zeit → `zeitFehlt` (rot) mit Vorschlag. Der Offset steht
 * nur am Umstellungstag im Entwurf – sonst bestimmt ihn `eventFromDraft` wie bisher (`offsetFor`, gleiches Ergebnis).
 */
function zeitLesart(day: string, minutes: number, timeFromText: boolean, ctx: JournalContext): Pick<Draft, "tOffset" | "zeitFehlt"> {
  const lz = lesart(day, minutes, ctx.now, ctx.zone);
  if (lz.fehlt && timeFromText) {
    let von = minutes;
    while (von > minutes - 180 && !offsetsAt(isoOf(day, ((von - 1) % 1440 + 1440) % 1440), ctx.zone).length) von--;
    const vorschlag = lz.vorschlag ?? hhmmText(minutes + 60);
    const sprung = ((+vorschlag.slice(0, 2) * 60 + +vorschlag.slice(3)) - minutes + 1440) % 1440 || 60;
    return { zeitFehlt: { zeit: hhmmText(minutes), vorschlag: vorschlag.replace(":", ""), von: hhmmText(von), bis: hhmmText(von + sprung) } };
  }
  if (lz.off && (lz.mehrdeutig || umstellTage(ctx.zone ?? "", +day.slice(0, 4)).includes(day))) return { tOffset: lz.off };
  return {};
}

/** Peilung von a nach b in Grad, auf 45° gerundet (0 = Nord) */
const peilung = (a: LV95, b: LV95) => (Math.round(((Math.atan2(b.e - a.e, b.n - a.n) * 180) / Math.PI + 360) % 360 / 45) * 45) % 360;
const hhmmText = (min: number) => `${pad(Math.floor(((min % 1440) + 1440) % 1440 / 60))}:${pad((((min % 1440) + 1440) % 1440) % 60)}`;

function parseCore(input: string, ctx: JournalContext, o: { teilen?: boolean } = {}): CoreParse {
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
  const ortSpans = placeSpans(text, elementBefore);
  let reading = readTactical(text, { skip: [...skip, ...ortSpans] });
  if (isNeedNote(text, reading)) reading = null;
  // unbekanntes / verstümmeltes Wort an der Stelle des Gesehenen («2 schützenpnzr»): keine geratene Art
  // (MVP 3.5, C1) auch ohne Anzahl, wenn sonst nichts Gesehenes da ist – nicht bei Begehren, Wahrnehmung, Verneinung
  const ohneAnzahl = !SIGHT_RE.test(text) && !BLOCKADE_RE.test(text) && !BEGEHREN_RE.test(text) && !HOER_RE.test(text) && !KEIN_ZEICHEN_RE.test(text);
  let unknown = note ? undefined : unknownSubject(text, reading, skip, (w) => SIGHT_RE.test(`1 ${w}`), { ohneAnzahl });
  if (unknown) reading = null;
  for (const m of text.matchAll(new RegExp(UNIT_RE.source, "gi"))) {
    if (reading?.spans.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
    const u = m[1]!.replace(/\.\s?|\s+/g, " ").replace(/^(\D+?)\s?(\d)/, (_, a: string, d: string) => (a.length > 1 ? `${a} ${d}` : a + d)).trim();
    if (!hits.some((h) => Math.abs(h.index - m.index!) < 2 || norm(h.u) === norm(u))) hits.push({ u, side: null, index: m.index!, len: m[1]!.length });
  }
  hits.sort((a, b) => a.index - b.index);
  // Absender von oben (Kp, Kdt, Bat …) ist nie Melder/Trupp (ausser die Übung führt ihn als eigenes Element)
  const melderHit = hits.find((h) => h.side !== "rot" && !(h.side === null && QUELLE_RE.test(h.u)));
  const enemyHit = hits.find((h) => h.side === "rot");
  // Melder in der Schreibweise der Übung («h3» → «H03»)
  const melder = melderHit ? (melderHit.side === null ? normalizeMelder(melderHit.u, ctx.units.blau) : melderHit.u) : "";
  // eigenes Element, das es in der Übung nicht gibt («H13» bei H01–H05): Problem statt still neuer Trupp
  problems.push(...melderProblems(hits.filter((h) => h.side === null).map((h) => h.u), ctx.units.blau));

  // ---- (MVP 3.5, C7/C11) eigene Meldung ohne neues Zeichen: eigene Verwundete, Begehren (nur bekannter Trupp, kein Feindwort)
  const melderBekannt = !!melder && ctx.units.blau.some((u) => sameUnitName(u, melder));
  const feindWort = !!enemyHit || STRONG_ENEMY_RE.test(text) || ENEMY_RE.test(text);
  let ohneZeichen: Draft["ohneZeichen"];
  let begehren: { was: string } | undefined;
  if (!note && (!ctx.kind || ctx.kind === "eigen") && melderBekannt && !feindWort) {
    // eigene Verwundete nur mit Bezug auf den Trupp: Sanität angefordert, «bei uns», «eig/eigene», «bei H02», «wir» –
    // «H02 2 Verletzte» allein bleibt eine Sichtung (unklar)
    const san = SAN_WORT_RE.test(text) && ANFORDERN_RE.test(text);
    const beiUns = EIGEN_BEZUG_RE.test(text) || new RegExp(`(?<![\\p{L}])(?:bei|beim)\\s+${melder.replace(/\s/g, "\\s?")}(?![\\p{L}\\d])`, "iu").test(text);
    if (reading?.key === "verletzte" && (san || beiUns) && !/(?<![\p{L}])ziv/iu.test(text) && !SICHT_VERB_RE.test(text)) {
      ohneZeichen = "verwundet";
      if (san) begehren = { was: "Sanität" };
    } else if (BEGEHREN_RE.test(text) && (!reading || begehrenArt(reading.key))) {
      ohneZeichen = "begehren";
      reading = null;
      unknown = undefined;
      begehren = { was: begehrenWas(text, hits) || "Nachschub" };
    }
  }

  // ---- Sichtung ohne Katalogbegriff («1 weisser Lieferwagen AO2»): Anzahl und allgemeines Zeichen
  let sight: { count: number; sym: string; civil: boolean } | undefined;
  if (!reading && !unknown && !ohneZeichen) {
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
  let count = unknown ? unknown.count : parts ? undefined : reading?.count ?? cmCount ?? sight?.count ?? stueckCount(text);
  // (C2) «schwarzer Golf»: Automarke ohne Zahl = ein Fahrzeug
  if (count === undefined && !parts && reading?.word && EINZEL_TYP.has(reading.word)) count = 1;
  let kindFrom: Draft["kindFrom"] = explicit ? "text" : "inhalt";
  if (ctx.kind) { kind = ctx.kind; kindFrom = "vorgabe"; }
  if (!kind) kind = kindOf(text, reading, entry, { melder, enemy: !!enemyHit, count: count ?? (parts ? 2 : undefined), civil: sight?.civil });
  // unbekanntes Wort: Zugehörigkeit nicht raten (ausser «gn», «Feind» im Text oder bekanntes Feindelement)
  if (unknown && kindFrom === "inhalt" && !enemyHit && !STRONG_ENEMY_RE.test(text) && !ENEMY_RE.test(text)) kind = "unklar";
  // (C7/C11) eigene Verwundete und Begehren sind eigene Lage (nie Feind/Unklar, nie in Rot-Zahlen)
  if (ohneZeichen && kindFrom === "inhalt") kind = "eigen";
  // «H02 sieht H04 in AK9»: das gesehene eigene Element ist am Ort, nicht der Melder
  const seenOwn = observedOwn(text, hits, ctx.units.blau);
  let side = sideOf(kind);
  let unit = kind === "eigen" ? seenOwn ?? melder : enemyHit?.u ?? "";

  // ---- Herkunft und Richtung: «aus Rtg O» = Herkunft (kein Pfeil), «Rtg N» = Bewegungsrichtung
  let locText = text;
  let from: number | undefined;
  let fromLabel: string | undefined;
  // (MVP 3.5, C9) erste Herkunftsangabe im Satz («Lärm von Motoren aus Rtg AP5» → «aus Rtg AP5»); «von AP5 her» ebenso
  for (const fm of text.matchAll(new RegExp(FROM_RE.source, "giu"))) {
    const w = fm[2]!.toUpperCase();
    const her = /^\s+her(?![\p{L}])/iu.exec(text.slice(fm.index! + fm[0].length));
    if (w in DIRS) from = DIRS[w];
    else if (fm[1]) fromLabel = `aus Rtg ${fm[2]}`;
    else if (her && /^(?:von)/i.test(fm[0]) && /^[A-Z]{1,2}\d/.test(w)) fromLabel = `aus Rtg ${fm[2]}`;
    if (from !== undefined || fromLabel) { locText = blank(locText, fm.index!, fm.index! + fm[0].length + (her ? her[0].length : 0)); break; }
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
  let amTrupp = false;
  let ortUnbekannt: string | undefined;
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
  // (MVP 3.5, C9) «von AK7 nach AM9»: eine Bewegung – Ort AK7, Richtung = Peilung AK7 → AM9, Zusatz «nach AM9»
  let vonNach: [FoundCell, FoundCell] | undefined;
  for (let i = 0; i + 1 < found.length; i++) {
    const a = found[i]!, b = found[i + 1]!;
    if (/(?<![\p{L}])von\s+$/iu.test(locText.slice(0, a.index)) && /^\s+nach\s+$/iu.test(locText.slice(a.index + a.raw.length, b.index))) { vonNach = [a, b]; break; }
  }
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
  let seiteFrage: Draft["seiteFrage"];
  // Sichtung verschiebt nie den Melder: «eigen» mit Ort, aber ohne Standortwort → Sichtung (unklar) am Ort
  if (kind === "eigen" && kindFrom === "inhalt" && pos && !seenOwn && !ohneZeichen) {
    let own = locText;
    for (const [a, b] of [...hits.map((h) => [h.index, h.index + h.len]), ...found.map((f) => [f.index, f.index + f.raw.length]),
      ...areaHits.map((x) => [x.m!.index, x.m!.index + x.m![0].length]), ...coords.map((c) => [c.index, c.index + c.raw.length]),
      ...(rm ? [[rm.index, rm.index + rm[0].length]] : []),
      ...(where?.kind === "ort" ? [flexRe(where.label).exec(locText)].filter((m) => !!m).map((m) => [m!.index, m!.index + m![0].length]) : [])] as Array<[number, number]>) {
      own = blank(own, a, Math.min(b, own.length));
    }
    // (MVP 3.5, C5) «H01 Rückzug nach AC5»: eigener Trupp an einen Ort ohne Standortverb – gelb fragen («H01 selbst nach
    // AC5?»), 2. Enter versetzt; «Gegner zieht sich zurück» bleibt Feind (Feindwort)
    const nachOrt = where?.kind === "raster" && !!found[0] && /(?<![\p{L}])nach\s+$/iu.test(locText.slice(0, found[0].index));
    if (!staysOwn(text, own, reading, entry)) {
      if (nachOrt && melderBekannt && !feindWort && RUECKZUG_RE.test(text)) seiteFrage = { trupp: melder, ort: where!.label };
      else { kind = "unklar"; side = sideOf(kind); unit = enemyHit?.u ?? ""; }
    }
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
    // (MVP 3.5, C13) genannter Ort ohne Treffer («erreicht Checkpoint 2», «bei der Brücke»): nie der letzte Standort eines
    // Feindelements als Ersatz; die eigene Lage bleibt offen (gelb «Ort unbekannt»)
    const ortGenannt = ortSpans.length ? text.slice(ortSpans[0]![0], ortSpans[0]![1]).trim() : ORT_PHRASE_RE.exec(locText)?.[1];
    // genannter, aber (noch) unbekannter Ort («in Wabern», «AK77»): kein Ersatzort – sonst Widerspruch «bei H04» ↔ Ort fehlt
    if (ortProblems.length || namesPlace(locText, placeQuery, kind === "eigen")) {
      // Ort bleibt offen: Ortssuche, Karte oder Korrektur
    } else if (kind === "eigen" && !ohneZeichen) {
      // Standort bleibt (Entscheid): Ort = bisheriger Standort des Trupps in Worten («AF12 A»), nie «letzter Standort»
      const last = melder ? ctx.lastPos?.(melder, "blau") : undefined;
      if (ortGenannt) ortUnbekannt = ortGenannt;
      else if (last) { pos = last; where = { kind: "zuletzt", label: lastPlaceLabel(ctx, "blau", melder, last) }; }
    } else if (!ohneZeichen) {
      // (C8) «2 Fz fahren an H02 vorbei», «Drohne über H05»: Ort beim ausdrücklich genannten eigenen Trupp (grün)
      const nahe = hits.find((h) => (h.side === "blau" || (h.side === null && ctx.units.blau.some((u) => sameUnitName(u, h.u))))
        && new RegExp(`(?<![\\p{L}])(?:bei|beim|über|an|neben)\\s+$`, "iu").test(text.slice(Math.max(0, h.index - 8), h.index)));
      const naheName = nahe ? (nahe.side === null ? normalizeMelder(nahe.u, ctx.units.blau) : nahe.u) : "";
      const atNahe = naheName ? ctx.lastPos?.(naheName, "blau") : undefined;
      // Sichtung ohne Ort: beim bekannten Feindelement (nicht, wenn ein anderer Ort genannt ist), sonst beim Melder
      const lastEnemy = unit && !ortGenannt ? ctx.lastPos?.(unit, "rot") : undefined;
      const atMelder = melder ? ctx.lastPos?.(melder, "blau") : undefined;
      if (atNahe) { pos = atNahe; where = { kind: "melder", label: `bei ${naheName}` }; amTrupp = true; }
      else if (lastEnemy) { pos = lastEnemy; where = { kind: "zuletzt", label: lastPlaceLabel(ctx, "rot", unit, lastEnemy) }; }
      else if (atMelder) {
        pos = atMelder; where = { kind: "melder", label: `bei ${melder}` };
        // (C8) Kontakt, Beschuss, Angriff am meldenden Trupp: der Ort ist sicher – Wahrnehmung («hört Schüsse») bleibt gelb
        if ((sym === "kontakt" || sym === "beschuss") && KONTAKT_AM_RE.test(text) && !HOER_RE.test(text)) amTrupp = true;
        // «Drohne über uns», «2 Pers bei uns»: ausdrücklich beim meldenden Trupp
        if (/(?<![\p{L}])(?:über|bei|beim)\s+uns(?![\p{L}])/iu.test(text) && !HOER_RE.test(text)) amTrupp = true;
      } else if (ortGenannt) ortUnbekannt = ortGenannt;
    }
  }

  // Fläche/Linie über mehrere Felder («Achse AN6 AL8 AJ10»): Punktzeichen in die Mitte der Form statt ins erste Feld
  if (where?.kind === "raster" && (cells?.length ?? 0) > 1 && entry.geometry && entry.geometry !== "punkt") {
    const sh = autoShape({ sym, pos, cells, where: where.label }, { sheets: ctx.sheets, areas: ctx.areas });
    if (sh) { const c = shapeCenter(sh); pos = { e: Math.round(c.e), n: Math.round(c.n) }; }
  }
  // (MVP 3.5, C7/C11) eigene Verwundete, Begehren: Trupp bleibt, wo er ist; genannte Orte nur als Text; kein neues Zeichen
  let orte: string[] | undefined;
  if (ohneZeichen) {
    const genannt = [...new Set([...(cells ?? []), ...(nai ? [nai] : [])])];
    if (genannt.length) orte = genannt;
    const last = ctx.lastPos?.(melder, "blau");
    kind = "eigen"; side = "blau"; unit = melder;
    // Verwundete: kein Ort (nichts auf der Karte, Standort des Trupps bleibt unberührt); Begehren: bisheriger Standort
    pos = ohneZeichen === "verwundet" ? undefined : last;
    // Ort: «bei H02», wo Hilfe hin muss (Sanität angefordert, «bei H02»/«bei uns»), sonst der bisherige Standort in Worten
    const beiTrupp = ohneZeichen === "verwundet" && (!!begehren || /(?<![\p{L}])bei\s+(?:uns|h\s?\d)/iu.test(text));
    where = beiTrupp ? { kind: "melder", label: `bei ${melder}` } : last ? { kind: "zuletzt", label: lastPlaceLabel(ctx, "blau", melder, last) } : undefined;
    cells = undefined; nai = undefined; placeQuery = undefined; seiteFrage = undefined; amTrupp = false; ortUnbekannt = undefined;
  }
  // (C9) Bewegung «von AK7 nach AM9»: Richtung = Peilung, wenn keine Richtung genannt ist
  if (vonNach && dir === undefined && !dirLabel) {
    const s0 = ctx.sheets.find((x) => x.id === vonNach![0].sheetId), s1 = ctx.sheets.find((x) => x.id === vonNach![1].sheetId);
    if (s0 && s1) dir = peilung(boundsCenter(cellBounds(s0, vonNach[0].col, vonNach[0].row, vonNach[0].quadrant)), boundsCenter(cellBounds(s1, vonNach[1].col, vonNach[1].row, vonNach[1].quadrant)));
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
  const desc2 = unknown ? `${unknown.count ? `${unknown.count} ` : ""}? («${unknown.token}»)` : desc1;
  // (C9) Ziel der Bewegung als Zusatz («2 gegnerische Fahrzeuge nach AM9»)
  const desc = vonNach && !ohneZeichen ? `${desc2 ?? catalogEntry(sym)?.name ?? ""} nach ${vonNach[1].label}`.trim() : desc2;
  // (C8/C10) Kontakt am eigenen Trupp, Feuerkampf, Gefecht: dringend (Wahrnehmung «hört Schüsse» nicht)
  const dringend = (sym === "kontakt" || sym === "beschuss") && !HOER_RE.test(text) && GEFECHT_RE.test(text);
  const { tOffset, zeitFehlt } = zeitLesart(day, minutes, timeFromText, ctx);
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
    // MVP 3.5 (Paket C)
    ...(unknown?.suggestLabel ? { ersatz: { token: unknown.token, wort: unknown.suggestLabel } } : {}),
    ...(tOffset ? { tOffset } : {}), ...(zeitFehlt ? { zeitFehlt } : {}),
    ...(amTrupp ? { amTrupp } : {}), ...(ohneZeichen ? { ohneZeichen } : {}), ...(begehren ? { begehren } : {}), ...(orte ? { orte } : {}),
    ...(ortUnbekannt ? { ortUnbekannt } : {}), ...(seiteFrage ? { seiteFrage } : {}), ...(dringend ? { dringend } : {}),
  };
  const core: CoreParse = { d: out, lead: !!tp.used && tp.lead, start: !!tp.used && tp.lead && tp.used.index <= 2, zeitWahl };
  return o.teilen === false ? core : zweiOrteTeilen(core, input, text, locText, found, areaHits.map((x) => ({ index: x.m!.index, len: x.m![0].length, label: x.a.name })), vonNach, melder, melderBekannt, ctx);
}

/**
 * (MVP 3.5, C6) Zwei Orte in einer Meldung: «H02 wir weichen aus nach AK11, Kontakt mit 4 Pers AK10» – der eigene Trupp
 * geht «nach PQ1», gesehen wird an PQ2. Der Entwurf wird die Sichtung (2. Enter trägt nur sie ein, der Trupp bleibt),
 * `teile` = beide Teile (je mit Melder vorne) für «Als zwei Einträge». «von PQ1 nach PQ2» ist eine Bewegung (C9).
 */
function zweiOrteTeilen(core: CoreParse, input: string, text: string, locText: string, found: FoundCell[], naiHits: Array<{ index: number; len: number; label: string }>,
  vonNach: [FoundCell, FoundCell] | undefined, melder: string, melderBekannt: boolean, ctx: JournalContext): CoreParse {
  if (!melderBekannt || found.length + naiHits.length < 2) return core;
  const orte = [...found.filter((f) => !vonNach?.includes(f)).map((f) => ({ index: f.index, len: f.raw.length, label: f.label })), ...naiHits].sort((a, b) => a.index - b.index);
  const ziel = orte.find((x) => /(?<![\p{L}])nach\s+$/iu.test(locText.slice(0, x.index)));
  const sicht = orte.find((x) => x !== ziel && x.label !== ziel?.label);
  if (!ziel || !sicht) return core;
  // Trennstelle zwischen den beiden Orten: Komma, Strichpunkt oder «und»
  const [a, b] = ziel.index < sicht.index ? [ziel, sicht] : [sicht, ziel];
  const zwischen = text.slice(a.index + a.len, b.index);
  const sep = /\s*(?:[,;]|\s(?:und|dann)\s)\s*/iu.exec(zwischen);
  if (!sep) return core;
  const cut = a.index + a.len + sep.index;
  const t1 = text.slice(0, cut).trim(), t2 = text.slice(cut + sep[0].length).trim();
  const lead = LEAD_DT_RE.exec(input.trim())?.[0] ?? "";
  const mitMelder = (t: string) => (new RegExp(`(?<![\\p{L}\\d])${melder.replace(/\s/g, "\\s?")}(?![\\p{L}\\d])`, "iu").test(t) ? t : `${melder} ${t}`);
  const [tz, ts] = ziel === a ? [t1, t2] : [t2, t1];
  const teilZiel = `${lead}${mitMelder(tz)}`.trim(), teilSicht = `${lead}${mitMelder(ts)}`.trim();
  const dz = parseCore(teilZiel, ctx, { teilen: false }).d;
  const sub = parseCore(teilSicht, ctx, { teilen: false });
  const ds = sub.d;
  // nur wenn der Ziel-Teil keine Sichtung ist und der andere Teil eine Sichtung mit Ort
  // nur wenn der Ziel-Teil eine Bewegung des eigenen Trupps ist («wir weichen aus nach AK11») und der andere Teil eine
  // Sichtung mit Ort («2 Fz AK7, fahren nach AK8» ist der Feind, der fährt – keine zwei Orte)
  if (dz.count !== undefined || dz.kind !== "eigen" || ds.kind === "eigen" || !ds.pos || ds.where?.kind === "melder") return core;
  const last = ctx.lastPos?.(melder, "blau");
  const bleibt = last ? lastPlaceLabel(ctx, "blau", melder, last) : undefined;
  const seite = ds.kind === "feind" ? "Feind" : "Unklar";
  return {
    ...sub,
    d: {
      ...ds, text: core.d.text, ...(core.d.normalized ? { normalized: core.d.normalized } : {}), teile: [teilZiel, teilSicht],
      zweiOrte: { trupp: melder, ziel: ziel.label, sicht: sicht.label, seite, ...(bleibt ? { bleibt } : {}) },
    },
  };
}

/** frühere Ersatzorte (vor MVP 3 Nachbesserung gespeichert) – nie als Ort zeigen */
export const isErsatzOrt = (where?: string | null): boolean => !!where && /^letzter Standort$/i.test(where);

/**
 * Bisheriger Standort eines Elements in Worten (für «H04 nichts Neues»): Ort der jüngsten Meldung dieses Elements an
 * genau dieser Lage (`placeLabel`), sonst Planquadrat der Lage, sonst «Koordinate» – nie «letzter Standort».
 */
function lastPlaceLabel(ctx: JournalContext, side: Side, unit: string, pos: LV95): string {
  const k = unitKey(side, unit);
  let best: LageEvent | undefined;
  for (const e of ctx.events ?? ctx.ex?.events ?? []) {
    if (e.deleted || !e.pos || !e.unit || e.pos.e !== pos.e || e.pos.n !== pos.n || unitKey(e.side, e.unit) !== k) continue;
    const l = placeLabel(e);
    if (!l || isErsatzOrt(l) || /^bei\s/i.test(l)) continue;
    if (!best || compareEvents(e, best) > 0) best = e;
  }
  if (best) return placeLabel(best);
  return cellAtAny(ctx.sheets, pos)?.label ?? "Koordinate";
}

/** «Bem: …» / «Bemerkung: …» am Ende einer Kurzmeldung: steht im Text, wird aber nie ausgewertet (wie U bei AEIOU) */
const BEM_RE = /(?<=^|\s)(?:bem|bemerkung|umwelt)\s*:.*$/isu;
/** Tag und Zeit am Anfang («T2 0725 », «07:25 ») */
const LEAD_DT_RE = /^(?:T\s?\d(?!\d)[\s,:]*)?(?:(?:[01]?\d|2[0-3])[:.h]?[0-5]\d(?:\s*uhr)?(?![\d'’])[\s,:]*)?/i;
/** Schlüsselwörter für unscharfes Aufheben (MVP 3 Fix 3: «aufgehobn», «aufgehben», «aufgeh.», «gerämt») */
const AUFHEB_KEYS = ["aufgehoben", "abgebaut", "entfernt", "geräumt", "freigegeben", "abgezogen", "verschwunden"] as const;
/** ae/oe/ue → ä/ö/ü («geraeumt» = «geräumt», genau) */
const umlaute = (s: string) => s.replace(/ae/g, "ä").replace(/oe/g, "ö").replace(/ue/g, "ü").replace(/Ae/g, "Ä").replace(/Oe/g, "Ö").replace(/Ue/g, "Ü");
/** «aufgehoben», «abgebaut», «geräumt», «frei», «abgezogen» … (Kap. 3.5, Entscheid MVP 3 Nachbesserung) */
const AUFHEB_RE = /(?<![\p{L}\d])(aufgehoben|abgebaut|entfernt|geräumt|wieder\s+frei|frei|freigegeben|abgezogen|verschwunden|nicht\s+mehr\s+(?:da|vorhanden|besetzt))(?![\p{L}\d])/iu;
/** «weg» als Adverb (klein, nicht «auf dem Weg», «Weg versperrt») */
const WEG_RE = /(?<![\p{L}\d])(?<!(?:der|den|dem|des|ein|einen|im|am|auf|vom|zum|über)\s)weg(?![\p{L}\d])/u;
/** «weg», «abgezogen», «nicht mehr da»: ohne Gesehenes kein Zeichen («Feind weg aus AK9») */
const WEG_ART_RE = /(?<![\p{L}\d])(abgezogen|verschwunden|nicht\s+mehr\s+(?:da|vorhanden))(?![\p{L}\d])/iu;
/**
 * Aufheben-Wort im Text: genau («aufgehoben», «geraeumt», «frei», «weg» …) oder unscharf (`unscharf` = Wort wie getippt,
 * `key` = gemeintes Wort) – unscharf ist immer nur gelb (MVP 3 Fix 3).
 */
function aufhebWort(text: string): { wort: "aufheben" | "weg"; unscharf?: string; key?: string } | null {
  const t = umlaute(text);
  if (WEG_RE.test(t) || WEG_ART_RE.test(t)) return { wort: "weg" };
  if (AUFHEB_RE.test(t)) return { wort: "aufheben" };
  for (const w of text.match(/[\p{L}]+\.?/gu) ?? []) {
    const k = unscharfTreffer(w, AUFHEB_KEYS, { prefix: 6 });
    if (k) return { wort: k === "abgezogen" || k === "verschwunden" ? "weg" : "aufheben", unscharf: w, key: k };
  }
  return null;
}

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
  let lesung: ArtLesung = readArt(les, { blau });
  const events = ctx.events ?? ctx.ex?.events;
  // «zu 57: ja noch besetzt» am Anfang: Antwort mit Bezug, wenn Nr 57 eine Rückfrage ist (MVP 3 Fix 3)
  if (lesung.art === "meldung" && lesung.bezugArt === "verweis" && lesung.bezugAnfang && lesung.bezugNr && lesung.bezugToken && /^zu\s/i.test(lesung.bezugToken) && events) {
    const z = findByNr(ctx.ex ?? { events }, lesung.bezugNr);
    if (z && artOf(z) === "rueckfrage") {
      const i = les.toLowerCase().indexOf(lesung.bezugToken.toLowerCase());
      const rest = les.slice(i + lesung.bezugToken.length).replace(/^[\s,:;–-]+/, "").trim();
      lesung = { ...lesung, art: "notiz", stark: true, token: les.slice(0, i + lesung.bezugToken.length).trim(), bezugArt: "antwort", rest };
    }
  }
  let art: EntryArt = "meldung";
  let artFrom: Draft["artFrom"] = "standard";
  let artStark = true;
  if (ctx.art) { art = ctx.art; artFrom = "vorgabe"; }
  else if (ctx.kind) { artFrom = "vorgabe"; }
  else if (lesung.art !== "meldung") { art = lesung.art; artFrom = lesung.stark ? "text" : "inhalt"; artStark = lesung.stark; }
  // Meldung mit Bezug («Antwort zu 57: Det 2 in AJ8», Feind gewählt): Bezug nicht als Inhalt lesen
  const ohneBezug = art === "meldung" && lesung.bezugToken ? les.replace(lesung.bezugToken, " ").replace(/\s+([:,])/g, "$1").replace(/(^|\s)[:,]\s*/, "$1").replace(/\s+/g, " ").trim() : les;
  // Feind/Eigene/Unklar von Hand gewählt, Text hat einen starken Art-Hinweis («Kp: 2 Fz in AK8», «Notiz: H02 sieht 2 Fz
  // AK8»): Text ohne Art-Hinweis lesen – Ort wird gefunden, die Quelle (Kp, Bat) wird kein Melder (Korrektur, Einsatz H3)
  const ohnePraefix = art === "meldung" && artFrom === "vorgabe" && lesung.art !== "meldung" && lesung.stark && lesung.token && lesung.bezugArt !== "antwort"
    ? `${LEAD_DT_RE.exec(les)?.[0] ?? ""}${lesung.rest}`.trim() : null;
  const core = parseCore(ohnePraefix || ohneBezug, ctx);
  let d: Draft = { ...core.d, art, artFrom, ...(art !== "meldung" || artFrom !== "standard" ? { artStark } : {}) };
  // Originaltext bleibt (Felder: ganz; Bezug/Art-Hinweis: ohne Tag/Zeit am Anfang, wie sonst)
  if (felder) d = { ...d, text: raw, normalized: les, felder };
  else if (ohnePraefix || ohneBezug !== les) d = { ...d, text: raw.replace(LEAD_DT_RE, "").trim() || raw };
  else if (les !== raw && !core.d.normalized) d = { ...d, text: `${d.text} ${raw.slice(les.length).trim()}`.trim() };
  if (felder) d = felderOrt(d, felder, ctx);
  if (lesung.unscharf && artFrom !== "vorgabe" && art !== "meldung") {
    const wort = art === "auftrag" ? "Auftrag" : art === "orientierung" ? `Orientierung von ${lesung.quelle ?? "oben"}` : art === "notiz" && lesung.bezugArt === "antwort" ? "Antwort" : ART_LABEL[art];
    d = { ...d, unscharf: { wort, token: lesung.unscharf } };
  }
  if (art !== "meldung") {
    d = asNonLageDraft(d, lesung, core, ctx);
    // Zeit nach dem Absender («Kp 1200 Verpflegung») ist Inhalt: Text wieder mit der Zeit
    if (core.lead && !d.timeFromText && !felder) d = { ...d, text: raw.replace(LEAD_DT_RE, "").trim() || raw };
    // Antwort mit Sichtung und Ort («H03 Antwort 3 Pers AN7»): nie still ohne Zeichen – gelb, Ausweg Feind/Eigene/Unklar
    if (art === "notiz" && d.bezugArt === "antwort" && artFrom !== "vorgabe" && !felder && lesung.rest) {
      const s = parseCore(lesung.rest, ctx).d;
      const ort = !!s.cells?.length || !!s.nai || (!!s.where && s.where.kind !== "zuletzt" && s.where.kind !== "melder");
      if (s.count !== undefined && s.count > 0 && ort) d = { ...d, sichtung: true };
    }
  } else d = meldungBezug(d, lesung, ctx, events);
  // Aufheben (Entscheid): erzeugt nie ein neues Zeichen – ein Ziel → Aufhebung, mehrere → Wahl, keines → Notiz
  const wort = art === "meldung" && events && !d.bezug ? aufhebWort(ohnePraefix || ohneBezug) : null;
  if (wort) {
    const d0 = d;
    d = aufhebLesen(d, events!, { wort: wort.wort, vorgabe: artFrom === "vorgabe", core, ctx });
    // unscharf («aufgehobn»): immer gelb, sobald das Wort etwas ändert (Aufhebung, Wahl, Notiz) – nie still aufheben; bleibt
    // es eine gewöhnliche Meldung («2 Pers entfernen sich»), zählt das Wort nicht
    if (wort.unscharf && artFrom !== "vorgabe" && d !== d0) d = { ...d, unscharf: { wort: wort.wort === "weg" ? wort.key![0]!.toUpperCase() + wort.key!.slice(1) : "Aufheben", token: wort.unscharf } };
  }
  // (MVP 3.5, C3) Verneinung/Abgang ohne Gesehenes («Feind hat AD7 verlassen», «Det 2 Standort unbekannt»): kein neues
  // Zeichen – gelb «Kein neues Zeichen?», 2. Enter = Notiz. Ein genanntes Element allein ist nichts Gesehenes.
  if (art === "meldung" && artFrom !== "vorgabe" && !d.hebtAuf && !d.hebtAufKandidaten && !d.notizGrund && !d.bezug && !d.ohneZeichen && KEIN_ZEICHEN_RE.test(ohnePraefix || ohneBezug)) {
    const gesehen = d.count !== undefined || d.sym !== "einheit" || !!d.unknownWord;
    if (!gesehen) d = alsNotiz(d, "kein-zeichen", core, ctx);
  }
  // MVP 3.5 (Phase 0 verdrahtet, Paket D baut `bezugAufloesen` aus): Nummer mit mehreren Einträgen, Abschluss eines
  // Auftrags («H03 erledigt»), «Antwort an Bat» ohne Nummer
  // (nur wenn die gelesene Art gilt – bei gewählter anderer Art kein Bezug aus dem Art-Hinweis)
  if (events && lesung.art === d.art) {
    const b = lvzBezugAufloesen(lesung, { events, ex: ctx.ex, melder: d.melder, t: d.t, abschlussAus: ctx.abschlussAus, bezugWahl: ctx.bezugWahl, blau });
    if (b.bezug) d = { ...d, bezug: b.bezug, ...(b.bezugArt ? { bezugArt: b.bezugArt } : {}), bezugFehlt: undefined };
    // mehrere Kandidaten: noch kein Bezug (gelb mit Wahl-Knöpfen, 2. Enter trägt ohne Bezug ein)
    if (b.kandidaten?.length) { const { bezug: _b, ...r } = d; d = { ...r, bezugKandidaten: b.kandidaten, ...(b.wahl ? { wahl: b.wahl } : {}) }; }
    if (b.abschluss !== undefined) d = { ...d, abschluss: b.abschluss };
  }
  if (ctx.abschlussAus) d = { ...d, abschlussAus: true };
  const melderEigen = !!d.melder && blau.some((u) => sameUnitName(u, d.melder));
  if (istDringend(les, { eigenerMelder: melderEigen })) d = { ...d, dringend: true };
  if (art !== "meldung" && !artStark) d = { ...d, kindHint: "notiz" };
  // (MVP 3.5, C12) unbekannter Trupp («H06» in einer Übung ohne H06): weder Melder noch Element – gelb `trupp-neu`, das
  // zweite Enter trägt ohne Trupp ein; nur der Knopf «H06 als Trupp aufnehmen» legt ihn an (nie still)
  if (d.melder && !blau.some((u) => sameUnitName(u, d.melder)) && !(d.problems ?? []).some((p) => p.kind === "melder") && !QUELLE_RE.test(d.melder)) {
    const neu = d.melder;
    d = { ...d, truppNeu: neu, melder: "", ...(d.unit && sameUnitName(d.unit, neu) ? { unit: "" } : {}) };
  }
  return d;
}

/** Meldezettel/AEIOU: Ort nur aus O/Wo (Ortsprobleme dort sperren wie sonst); ohne Melder nie ein Element aus E */
function felderOrt(d: Draft, f: MeldeFelder, ctx: JournalContext): Draft {
  let out = d;
  // Entscheid 2: E ist das Gesehene – ohne «Melder:»/«Von:»/Text vor dem ersten Feld gibt es keinen Melder
  if (!f.melder && d.melder) out = { ...out, melder: "" };
  const { pos: _p, where: _w, cells: _c, nai: _n, placeQuery: _q, ...rest } = out;
  const keep = (out.problems ?? []).filter((p) => p.kind !== "ort" && p.kind !== "orte");
  // ohne O/Wo: «Ort fehlt» (Spez. 3.2) – kein «bei H03»; nur die eigene Lage behält den bisherigen Standort
  if (!f.wo) {
    const fallback = out.where?.kind === "zuletzt" && out.kind === "eigen" && out.melder ? { pos: out.pos, where: out.where } : {};
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
  return zeitCmp(iso, t) < 0 ? isoOf(addDays(day, 1), min) : iso;
}

/** genannte Orte als Text (Nicht-Meldungen, Aufhebungen): Planquadrate, NAI, Ortsname */
function orteOf(d: Pick<Draft, "cells" | "nai" | "where" | "placeQuery">): string[] {
  // «AL» allein (Rasterspalte ohne Zahl) ist kein Ortsname
  const q = d.placeQuery && !/^[A-ZÄÖÜ]{1,2}$/.test(d.placeQuery) ? [d.placeQuery] : [];
  const out = [...(d.cells ?? []), ...(d.nai ? [d.nai] : []), ...(d.where?.kind === "ort" ? [d.where.label] : []), ...q];
  return [...new Set(out)];
}

/** jüngster offener Auftrag an `trupp` bzw. jüngste offene Rückfrage von/an `trupp` (vor `t`) */
function offenerBezug(events: LageEvent[], art: "auftrag" | "rueckfrage", trupp: string, t: string): LageEvent | undefined {
  if (!trupp) return undefined;
  const idx = lvzIndex(events);
  let best: LageEvent | undefined;
  for (const e of events) {
    if (e.deleted || artOf(e) !== art || zeitCmp(e, t) > 0) continue;
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
  if (l.bezugArt === "antwort") return antwortBezug(d, l, ctx, events);
  if (l.bezugNr) return bezugAufloesen(d, l, ctx, events);
  return d;
}

/**
 * Antwort: Bezug auf die Rückfrage (Nummer oder jüngste offene des Trupps). Ohne genannten Trupp: ging die Rückfrage an
 * den Trupp («Rückfrage an H02»), kommt die Antwort von ihm (Melder H02, Lebenszeichen); hat der Trupp gefragt
 * («H04 Rückfrage …»), antwortet das LVZ ihm: `an` = H04, kein Melder (kein Lebenszeichen, MVP 3 Fix 3).
 * «Antwort an H02»: H02 ist Empfänger, nicht Melder.
 */
function antwortBezug(d: Draft, l: ArtLesung, ctx: JournalContext, events: LageEvent[] | undefined): Draft {
  let melder = d.melder;
  if (d.an && melder && sameUnitName(d.an, melder)) melder = "";
  const r = bezugAufloesen({ ...d, melder: melder || d.an || "" }, l, ctx, events, "rueckfrage");
  let out: Draft = { ...r, melder };
  const z = out.bezug ? events?.find((e) => e.id === out.bezug) : undefined;
  if (z && artOf(z) === "rueckfrage" && !melder) {
    // Rückfrage ging an den Trupp → die Antwort kommt von ihm (Melder, Lebenszeichen); Rückfrage kam vom Trupp → das LVZ
    // antwortet ihm (`an`, kein Lebenszeichen, MVP 3 Fix 3)
    if (z.an && !l.an) out = { ...out, melder: z.an };
    else if (!z.an && z.melder) out = { ...out, melder: "", ...(!out.an ? { an: z.melder } : {}) };
    if (out.melder && out.kind === "eigen" && out.art === "meldung" && !out.unit) out = { ...out, unit: out.melder };
  }
  return out;
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
  // Zeitregel (Entscheid): nur eine Zeit am Anfang ist die Meldezeit (Orientierung: ganz am Anfang, «1534 Bat …»),
  // ohne sie gilt jetzt; jede weitere Zeit ist Inhalt – kein «zweite Zeitangabe», kein «Zukunft»
  let time: Partial<Draft> = {};
  const lead = art === "orientierung" ? core.start : core.lead;
  if (d.timeFromText && !lead) {
    const day = d.dayFromText ? d.day : ctx.dayFromClock ? localDay(ctx.now) : ctx.day;
    const minutes = ctx.now.getHours() * 60 + ctx.now.getMinutes();
    time = { minutes, day, t: isoOf(day, minutes), timeFromText: false, timeToken: undefined, tOffset: undefined, zeitFehlt: undefined, ...zeitLesart(day, minutes, false, ctx) };
  }
  problems = problems.filter((p) => !core.zeitWahl.includes(p));
  const an = same ? lesung.an : undefined;
  let melder = d.melder;
  if (art === "orientierung") melder = "";
  else if ((art === "auftrag" || art === "rueckfrage") && an && melder && sameUnitName(an, melder) && !/erhalt/i.test(d.text)) melder = "";
  else if (art === "vbk" && !melder && an) melder = an;
  const e = catalogEntry("einheit")!;
  const { pos: _p, where: _w, cells: _c, nai: _n, count: _k, dir: _d, dirLabel: _dl, from: _f, fromLabel: _fl, roadHint: _r, placeQuery: _q, echelon: _e, desc: _ds, unknownWord: _u, problems: _pr, kindHint: _kh,
    // MVP 3.5 (C): Gründe der Lage-Erkennung gelten nicht für Nicht-Meldungen (dringend bestimmt parseMeldung danach neu)
    amTrupp: _at, ohneZeichen: _oz, begehren: _bg, ortUnbekannt: _ou, seiteFrage: _sf, zweiOrte: _zo, teile: _te, ersatz: _er, dringend: _dr, ...rest } = d;
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
  if ("tOffset" in time && time.tOffset === undefined) delete out.tOffset;
  if ("zeitFehlt" in time && time.zeitFehlt === undefined) delete out.zeitFehlt;
  const events = ctx.events ?? ctx.ex?.events;
  // Quittung ohne Nummer → jüngster offener Auftrag an diesen Trupp (Entscheid 5); «Quittung 42» → Nr 42
  if (same && lesung.bezugArt === "quittung") out = bezugAufloesen(out, lesung, ctx, events, "auftrag");
  else if (same && lesung.bezugArt === "antwort") out = antwortBezug(out, lesung, ctx, events);
  else if (same && lesung.bezugNr) out = bezugAufloesen(out, lesung, ctx, events);
  return out;
}

/**
 * «… aufgehoben/geräumt/frei/weg/abgezogen» (Kap. 3.5, Entscheid MVP 3 Nachbesserung): zeichnet **nie** neu.
 * - Sperre, Checkpoint, Hindernis …: genau ein aktives Ziel am Ort → Aufhebung; mehrere → Kandidaten (rot, bis gewählt);
 *   keines → Notiz (gelb «Kein Ziel gefunden – als Notiz eintragen?»); Feind/Eigene/Unklar von Hand gewählt: bleibt rot.
 * - «weg», «abgezogen» ohne Gesehenes («Feind weg aus AK9», keine Anzahl, kein Zeichen, kein Element) → Notiz (gelb
 *   «Kein Zeichen?»), ausser die Einordnung ist von Hand gewählt.
 */
function aufhebLesen(d: Draft, events: LageEvent[], o: { wort: "aufheben" | "weg"; vorgabe: boolean; core: CoreParse; ctx: JournalContext }): Draft {
  if (istAufhebbar({ sym: d.sym })) {
    const ziele = aufhebZiele(events, d, lvzIndex(events));
    if (ziele.length === 1) return aufhebDraft(d, ziele[0]!);
    if (ziele.length > 1 || o.vorgabe) return { ...d, hebtAufKandidaten: ziele.map((e) => e.id) };
    return alsNotiz(d, "kein-ziel", o.core, o.ctx);
  }
  // Gesehenes: Element (nicht nur der Melder selbst), Anzahl, Zeichen, unbekanntes Wort. «H01 Strasse AC6 frei» ist keine
  // eigene Lage (verschiebt H01 nicht) – ohne Gesehenes wird es Notiz (gelb «Kein Zeichen?»), wie «Feind weg aus AK9»
  const nurMelder = d.kind === "eigen" && !!d.melder && sameUnitName(d.unit, d.melder);
  const gesehen = (!!d.unit && !nurMelder) || d.count !== undefined || d.sym !== "einheit" || !!d.unknownWord || (!!d.desc && /\d/.test(d.desc));
  if (!gesehen && !o.vorgabe) return alsNotiz(d, "weg", o.core, o.ctx);
  return d;
}

/** Meldung → Notiz ohne Zeichen (gelb, `notizGrund`): Aufheben ohne Ziel, «weg» ohne Gesehenes */
function alsNotiz(d: Draft, grund: NonNullable<Draft["notizGrund"]>, core: CoreParse, ctx: JournalContext): Draft {
  const n = asNonLageDraft({ ...d, art: "notiz" }, { art: "notiz", stark: false, rest: d.text }, core, ctx);
  const { bezug: _b, bezugArt: _ba, bezugNr: _bn, bezugFehlt: _bf, ...rest } = n;
  return { ...rest, ...(d.bezug ? { bezug: d.bezug, bezugArt: d.bezugArt, bezugNr: d.bezugNr } : {}), artFrom: "inhalt", artStark: false, notizGrund: grund };
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
  // (MVP 3.5, C8) Wahrnehmung ohne Gegenstand («H03 Lärm von Motoren»): Sichtung mit unklarer Zugehörigkeit, nie eigene Lage
  if (!reading && entry.key === "einheit" && HOER_RE.test(text)) return o.enemy || ENEMY_RE.test(text) ? "feind" : "unklar";
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
  // MVP 3.5 (S23): Zeitvergleiche über den Zeitpunkt (`zeitBis`, Lagezeit mit oder ohne Offset) – doppelte Stunde richtig
  const live = events.filter((e) => isLage(e) && zeitBis(e, t)).sort(compareEvents);
  const lifts = liftMap(events);
  const byId = lifts.size ? new Map(events.map((e) => [e.id, e])) : undefined;
  const lifted = (e: LageEvent) => { const l = lifts.get(e.id); if (!l) return false; const by = byId?.get(l.by); return zeitBis(by ?? { t: l.t }, t); };
  const byUnit = new Map<string, UnitState>();
  const loose: LageEvent[] = [];
  const tMin = maxAgeMin === Infinity ? -Infinity : zeitMs(t) - maxAgeMin * 60000;
  const frisch = (e: LageEvent) => tMin === -Infinity || zeitMs(e) >= tMin;
  for (let e of live) {
    if (!e.unit) {
      if (e.pos && frisch(e) && !lifted(e)) loose.push(e);
      continue;
    }
    const k = unitKey(e.side, e.unit);
    const cur = byUnit.get(k);
    // Tätigkeit / Ereignis (Kontakt, Sperre, Explosion …): als eigenes Zeichen am Ort; das Element behält sein Zeichen.
    // Eigene Meldungen damit verschieben den Melder nicht (nur Einheiten-Meldungen und eigene Lage wie Stellung).
    const cat = catalogEntry(e.sym);
    // (MVP 3.5, C7) eigene Verwundete: nie ein Zeichen, der Trupp bleibt (Meldung zählt als Lebenszeichen)
    if (e.side === "blau" && e.sym === "verletzte") continue;
    if (cat ? cat.activity : symbolDef(e.sym).activity) {
      const pos = e.pos ?? cur?.pos;
      if (pos && frisch(e) && !lifted(e)) loose.push({ ...e, pos });
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
    if (before && zeitCmp(e, before) > 0) continue;
    if (!best || zeitCmp(e, best) > 0) best = e;
  }
  return best?.pos;
}

// ---------- Export ----------

/** «Eigene», «Feind», «Unklar» (bzw. «UL»); Notiz ohne Zeichen («Rückfrage …») → «Notiz»; Aufhebung → «Aufhebung» */
export function kindLabel(e: Pick<LageEvent, "side" | "aff"> & { notiz?: boolean; hebtAuf?: string }): string {
  if (e.notiz) return "Notiz";
  if (e.hebtAuf) return "Aufhebung";
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
export function journalToCsv(events: LageEvent[], days: string[], o: { gestrichen?: boolean; schichten?: Exercise["schichten"] } = {}): string {
  const head = ["Tag", "Zeit", "Art", "Element", "Melder", "Meldung", "Zeichen", "Ort", "Planquadrat", "NAI", "E", "N", "Status", "Fassungen", "Form",
    "Nr", "Eingang", "An/Quelle", "Erfasst von", "Dringend", "Stand", "Massnahme", "Weitergemeldet", "Bezug", "Hebt auf", "Schicht",
    // MVP 3.5 (Kap. 5.8): «Begehren» hinten angefügt (Nachschub, Sanität …; leer ohne Begehren)
    "Begehren"];
  // Spalte «Schicht»: dieselbe Zuordnung wie Übergabe und Druck (`schichtEintraege`: erfasst ab Schichtbeginn bis zum Wechsel)
  const schichtVon = schichtZuordnung({ schichten: o.schichten });
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
      // «gestrichen 08:12 BSP» (Zeit des Streichens = letzte Änderung)
      e.pos ? String(Math.round(e.pos.e)) : "", e.pos ? String(Math.round(e.pos.n)) : "", `${journalStatus(e)}${e.deleted ? ` ${localHhmm(e.updatedAt)}` : ""}${e.deleted && e.geaendertVon ? ` ${e.geaendertVon}` : ""}`, historyText(e), shapeCsv(e),
      nrLabel(e, ex), eingang, e.an ?? e.quelle ?? "", e.erfasstVon ?? "", v.dringend ? "dringend" : "", stand, v.massnahme ?? "",
      v.weiter ? `${v.weiter.an} ${v.weiter.um.slice(11, 16)}` : "", nrOfId(e.bezug), nrOfId(e.hebtAuf), schichtVon(e)?.an ?? "", e.begehren?.was ?? ""];
  });
  return "\uFEFF" + [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}

/**
 * Neuer Journaleintrag aus einer erkannten Meldung. `now` = Eingang: `tReported` (lokal, Minute) und `createdAt`
 * (genauer Zeitpunkt, UTC) – getrennt von der Ereigniszeit `t` («1015 …» um 10:40 eingetragen: t 10:15, Eingang 10:40).
 *
 * MVP 3: `o.nr` = laufende Nummer (`nextNr`, setzt auch `von` = Gerät), `o.kuerzel` = «erfasst von». Nicht-Meldungen
 * (`d.art ≠ meldung`) bekommen `art`, `notiz: true` und **nie** pos/unit/cells/nai/shape (Invariante E3).
 * MVP 3.5: `tOffset` aus dem Entwurf (Lesart; fehlt → `offsetFor` wie bisher), `begehren`; Ausgang = Nicht-Meldung.
 * `t` ist immer die Lagezeit ohne Offset (16 Zeichen) – auch wenn der Entwurf eine Lagezeit mit Endung trägt.
 */
export function eventFromDraft(d: Draft, device: string, now = new Date(), o: { nr?: number; kuerzel?: string } = {}): LageEvent {
  const art = d.art ?? (d.kindHint === "notiz" ? "notiz" : "meldung");
  const ev = eventFromDraftBase(d, device, now);
  const mvp3: Partial<LageEvent> = {
    ...(o.nr !== undefined ? { nr: o.nr, von: device } : {}),
    ...(o.kuerzel ? { erfasstVon: o.kuerzel } : {}),
    ...(d.an ? { an: d.an } : {}), ...(d.quelle ? { quelle: d.quelle } : {}), ...(d.frist ? { frist: d.frist } : {}), ...(d.vbk ? { vbk: d.vbk } : {}),
    ...(d.bezug ? { bezug: d.bezug, ...(d.bezugArt ? { bezugArt: d.bezugArt } : {}) } : d.bezugArt === "antwort" && art === "notiz" ? { bezugArt: d.bezugArt } : {}),
    ...(d.hebtAuf ? { hebtAuf: d.hebtAuf } : {}), ...(d.orte?.length ? { orte: [...d.orte] } : {}), ...(d.felder ? { felder: { ...d.felder } } : {}),
    ...(d.dringend ? { lvz: { dringend: { v: true, at: now.toISOString(), device, ...(o.kuerzel ? { von: o.kuerzel } : {}) } } } : {}),
    ...(d.begehren ? { begehren: { ...d.begehren } } : {}),
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
    t: d.t.slice(0, 16),
    tOffset: zeitTeile(d.t).off ?? d.tOffset ?? offsetFor(d.t.slice(0, 16), now),
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
export function correctionSummary(before: Pick<LageEvent, "text" | "t" | "side" | "aff" | "melder" | "where" | "cells" | "nai" | "pos" | "sym" | "count"> & Partial<Pick<LageEvent, "art" | "notiz" | "hebtAuf" | "bezugArt">>, after: typeof before): string {
  const out: string[] = [];
  const pb = placeLabel(before) || "ohne Ort", pa = placeLabel(after) || "ohne Ort";
  if (pb !== pa) out.push(`${pb} → ${pa}`);
  if (before.t !== after.t) out.push(`${before.t.slice(11, 16)} → ${after.t.slice(11, 16)}`);
  // Art in Worten: «Feind → Rückfrage», «Notiz → Feind» (Nicht-Meldungen mit ihrer Art, nicht nur «Notiz»)
  const lab = (x: typeof before) => (x.art && x.art !== "meldung" ? (x.art === "notiz" && x.bezugArt === "antwort" ? "Antwort" : ART_LABEL[x.art]) : kindLabel(x));
  const kb = lab(before), ka = lab(after);
  if (kb !== ka) out.push(`${kb} → ${ka}`);
  if ((before.melder ?? "") !== (after.melder ?? "")) out.push(`von ${before.melder || "?"} → ${after.melder || "?"}`);
  if (!out.length && (before.count ?? 0) !== (after.count ?? 0)) out.push(`Anzahl ${before.count ?? "–"} → ${after.count ?? "–"}`);
  if (!out.length) out.push(before.text !== after.text ? "Text geändert" : "Zeichen geändert");
  return out.slice(0, 2).join(" · ");
}
