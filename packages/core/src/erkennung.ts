/**
 * Erkennung «nie still falsch» – Bausteine für `parseMeldung` (journal.ts):
 * - getippte Funk-/Sprechsprache sicher normalisieren («Hotel 4 meldet zwei Fahrzeuge in Alpha Kilo 7» → «H04 … 2 Fz in AK7»),
 * - unbekannte Orte («AK77», «ZZ3», «NAI 9») und ungültige Zeiten («13:70») als Problem melden statt still zu ersetzen,
 * - eigene Lage nur mit Standortwort (eine Sichtung verschiebt nie den Melder),
 * - Teile einer Aufzählung nicht verlieren («ein Auto, ein Lastwagen und 3 Pers»).
 * Ohne Laufzeit-Abhängigkeiten; alle Beispiele fiktiv (Raum Bern).
 */
import type { Area } from "./model";
import { catalogEntry, closestTerm, ersatzWort, isKnownTerm, isTacticalWord, readTactical, type CatalogEntry, type TacticalReading } from "./catalog";
import { isCountNoun, looksSpoken, normalizeSpoken, spokenNumber } from "./funk";
import type { FoundCell, RasterSheet } from "./raster";
import { findTimes, type FoundTime } from "./time";
import type { DraftProblem } from "./journal";

const L = "\\p{L}";

// ---------------------------------------------------------------------------------------------------------------
// Getippter Text: sichere Normalisierung

export interface TypedNorm {
  /** Text für die Erkennung */
  text: string;
  /** wurde etwas verändert? (dann bleibt der Originaltext im Journal, `Draft.normalized` zeigt die Lesart) */
  changed: boolean;
}

/**
 * Getippten Text für die Erkennung vorbereiten. Kurzmeldungen bleiben unverändert; Funk-/Sprechsprache (siehe
 * `looksSpoken`) geht durch `normalizeSpoken`. Dazu: «Unterquadrant C» → Quadrant am Planquadrat, «Trupp 4» am Anfang →
 * eindeutiges eigenes Element mit dieser Nummer (z. B. «H04»), Uhrzeit in Worten ohne Tageszeit → näher bei `now`
 * («viertel nach zehn» um 21:00 → 22:15).
 */
export function normalizeTyped(input: string, o: { blau?: string[]; now?: Date } = {}): TypedNorm {
  let text = input;
  if (looksSpoken(text)) {
    const n = normalizeSpoken(text, { typed: true });
    let t = n.text.replace(/\s*\n\s*/g, " ").trim();
    // Uhrzeit aus Worten («viertel nach zehn» → 1015): 12-h-Mehrdeutigkeit mit der Uhr auflösen
    if (o.now) {
      const nowMin = o.now.getHours() * 60 + o.now.getMinutes();
      for (const c of n.changes) {
        if (!/^\d{4}$/.test(c.to) || !/\p{L}/u.test(c.from) || /\b(?:uhr|null)\b/i.test(c.from) && /^\d/.test(c.from)) continue;
        const h = +c.to.slice(0, 2), m = +c.to.slice(2);
        // Stundenwort: «zwanzig nach acht» → «acht», «halb zehn» → «zehn», «neun Uhr» → «neun»
        const hourWord = /(?:nach|vor)\s+(?:halb\s+)?(\S+)\s*$/i.exec(c.from)?.[1] ?? /^halb\s+(\S+)/i.exec(c.from)?.[1] ?? c.from.split(/\s+/)[0]!;
        if (h < 1 || h > 12 || /(?:zwölf|dreizehn|vierzehn|fünfzehn|sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|null|^\d)/i.test(hourWord)) continue;
        const a = h * 60 + m, b = ((h + 12) % 24) * 60 + m;
        const dist = (x: number) => Math.min(Math.abs(x - nowMin), 1440 - Math.abs(x - nowMin));
        if (dist(b) < dist(a)) t = t.replace(c.to, `${String((h + 12) % 24).padStart(2, "0")}${c.to.slice(2)}`);
      }
    }
    if (t) text = t;
  }
  // «NAI drei», «NAI-zwo», «BNB eins» → «NAI 3» (Funksprache, auch ohne Buchstabieralphabet)
  text = text.replace(/(?<![\p{L}\d])(NAI|BNB)\s*-?\s*([\p{L}]+)(?![\p{L}\d])/giu, (m, a: string, w: string) => {
    const n = spokenNumber(w);
    return n !== undefined && n >= 1 && n <= 99 && w.toLowerCase() !== "ein" ? `${a.toUpperCase()} ${n}` : m;
  });
  // «AK7 Unterquadrant C», «AK7, Quadrant C», «AK7 UQ C» → «AK7 C»
  text = text.replace(new RegExp(`(?<![${L}\\d])([A-Za-z]{1,2}\\s?\\d{1,2})\\s*,?\\s*(?:unterquadrant|unter-quadrant|quadrant|uq)\\s*:?\\s*([ABCDabcd])(?![${L}\\d])`, "giu"), (_, c: string, q: string) => `${c} ${q.toUpperCase()}`);
  // «Trupp 4 meldet …» → eindeutiges eigenes Element mit Nummer 4 («H04»)
  const tm = /^(\s*(?:T\s?\d[\s,:]+)?(?:\d{1,2}[:.h]?\d{2}\s+)?)(?:trupp|trp)\.?\s?0*(\d{1,2})(?![\p{L}\d])/iu.exec(text);
  if (tm && o.blau?.length) {
    const nr = +tm[2]!;
    const cand = o.blau.filter((u) => { const m = /^\D*0*(\d{1,3})$/.exec(u.replace(/\s/g, "")); return !!m && +m[1]! === nr; });
    if (cand.length === 1) text = tm[1] + cand[0]! + text.slice(tm[0].length);
  }
  return { text, changed: text !== input };
}

/** Kind-Wörter am Anfang (wie in journal.ts) – für den Originaltext ohne führende Zeit/Seite */
const LEAD_KIND_RE = /^(?:(?:seite\s+)?(?:rot|gegner|feind|fe|blau|eigen|eig)|unklar|unbekannt)\b[:,]?\s*/i;

/** Originaltext ohne führenden Tag, führende Uhrzeit und Seite («T2 1015 Rot …» → «…») */
export function stripLead(input: string): string {
  let s = input.trim().replace(/^T\s?\d\b[\s,:]*/i, "");
  const lead = findTimes(s).find((x) => x.index <= 2);
  if (lead) s = (s.slice(0, lead.index) + s.slice(lead.index + lead.raw.length)).replace(/^[\s,:\-–]+/, "");
  return s.replace(LEAD_KIND_RE, "").trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Zeit

/** Zeitangabe direkt nach dem Melder am Anfang («H04 13:15 …», «H04: 1315 …», «Det 2 0820 …») */
export function isLeadTimeAfterElement(rest: string, index: number): boolean {
  return new RegExp(`^\\s*[${L}]{1,6}\\.?\\s?\\d{0,3}\\s*[:,]?\\s+$`, "u").test(rest.slice(0, index)) && index <= 12;
}

const UNIT_AFTER_RE = /^\s*(?:m|km|meter\w*|mann|pers\w*|leute|sdt|soldat\w*|fz|fahrzeug\w*|stk|stück|liter|l|kg|t|franken|chf|fr|x|%|mal)(?![\p{L}])/iu;
/** davor: keine Meldezeit, sondern Zusammenhang («bis 1100», «vor 0900», «für 1h30») bzw. Zahl («Distanz 1500», «Nr 1234») */
const CONTEXT_BEFORE_RE = /(?<![\p{L}])(?:vor|nach|bis|für|während|innert|von|distanz|entfernung|abstand|höhe|kote|nr|nummer|kennzeichen|kontrollschild|schild|tel|natel|telefon)\.?\s*:?\s*$/iu;
/** Kontrollschild («BE 1234»), nicht nach «Rtg» («Rtg SO 1015») */
const PLATE_BEFORE_RE = /(?<![\p{L}])(?<!(?:[Rr]tg|[Rr]ichtung)\.?\s)(?:AG|AI|AR|BE|BL|BS|FR|GE|GL|GR|JU|LU|NE|NW|OW|SG|SH|SO|SZ|TG|TI|UR|VD|VS|ZG|ZH|FL)\s?$/u;
/** davor: ausdrücklich Meldezeit («um 1015», «Zeit 1015», «ab 1015», «punkt 0900») */
const TIME_PREP_BEFORE_RE = /(?<![\p{L}])(?:um|zeit|uhrzeit|wann|gegen|ca|circa|punkt|genau|ab|seit)\.?\s*:?\s*$/iu;

/** Ist die gefundene Uhrzeit eine mögliche Meldezeit (nicht Distanz, Menge, Dauer, Datum, Kontrollschild)? */
function clockCandidate(rest: string, t: FoundTime): boolean {
  if (t.relative) return false;
  const before = rest.slice(0, t.index);
  const after = rest.slice(t.index + t.raw.length);
  // «1h30» ist meist eine Dauer («seit 1h30»); «10h15» bzw. «um 1h30» gelten als Zeit
  if (/^\d[h]/i.test(t.raw) && !/(?<![\p{L}])um\s*$/iu.test(before)) return false;
  if (/^[.:]\d/.test(after) || UNIT_AFTER_RE.test(after)) return false;
  if (CONTEXT_BEFORE_RE.test(before) || PLATE_BEFORE_RE.test(before)) return false;
  return true;
}

export interface TimePick {
  /** verwendete Zeitangabe (Ereigniszeit) */
  used?: FoundTime;
  /** am Anfang bzw. direkt nach dem Melder (wird aus dem Meldungstext genommen) */
  lead: boolean;
  /** Textstelle der verwendeten Zeit inkl. «um»/«Zeit» davor (für die Erkennung ausblenden) */
  span?: [number, number];
  /** gefunden, aber nicht verwendet (zweite, andere Zeitangabe) */
  problems: DraftProblem[];
}

/**
 * Ereigniszeit irgendwo im Satz: am Anfang, nach dem Melder, nach «um/Zeit/ab/punkt», am Ende («H04 2 Fz AK7 1015»).
 * Zusammenhang («bis 1100», «seit 1h30», «Distanz 1500», «1250 m») ist keine Meldezeit. Eine weitere, andere
 * Zeitangabe wird nicht still übergangen: Problem «zeit».
 */
export function pickTime(rest: string, times: FoundTime[]): TimePick {
  const cands = times.filter((t) => clockCandidate(rest, t));
  const lead = (x: FoundTime) => x.index <= 2 || isLeadTimeAfterElement(rest, x.index);
  const prep = (x: FoundTime) => TIME_PREP_BEFORE_RE.test(rest.slice(0, x.index));
  const used = cands.find(lead) ?? cands.find(prep) ?? cands[0];
  if (!used) return { lead: false, problems: [] };
  const pm = TIME_PREP_BEFORE_RE.exec(rest.slice(0, used.index));
  const from = pm && !/^(?:ab|seit)/i.test(pm[0]) ? pm.index : used.index;
  const problems: DraftProblem[] = [];
  for (const c of cands) {
    if (c === used || c.minutes === used.minutes) continue;
    problems.push({ kind: "zeit", text: `«${c.raw.trim()}»: zweite Zeitangabe`, token: c.raw.trim() });
  }
  return { used, lead: lead(used), span: [from, used.index + used.raw.length], problems };
}

/** Ungültige Uhrzeiten («13:70», «25:10», am Anfang auch «1370 H04 …») → Problem statt still «jetzt» */
export function timeProblems(rest: string): DraftProblem[] {
  const out: DraftProblem[] = [];
  const bad = (h: number, m: number) => h > 23 || m > 59;
  for (const m of rest.matchAll(/(?<![\d'’.:/])(\d{1,2})[:h](\d{2})(?![\d'’]|\s*(?:m|km|%)\b)/gi)) {
    if (bad(+m[1]!, +m[2]!)) out.push({ kind: "zeit", text: `«${m[0]}» ist keine gültige Uhrzeit`, token: m[0] });
  }
  // vierstellig am Anfang oder direkt nach dem Melder, gefolgt von Text («1370 H04 …», «H04 1370 2 Fz»)
  const lm = new RegExp(`^(?:[${L}]{1,6}\\.?\\s?\\d{0,3}\\s*[:,]?\\s+)?(\\d{2})(\\d{2})(?=\\s+[${L}\\d])`, "u").exec(rest);
  if (lm && bad(+lm[1]!, +lm[2]!) && !out.length) {
    const tok = lm[1]! + lm[2]!;
    // nur wenn danach keine Einheit folgt («1250 m», «2500 Pers» sind Mengen)
    if (!new RegExp(`^${tok}\\s+(?:m|km|meter|pers|mann|fz)\\b`, "i").test(rest.slice(lm.index + lm[0].length - tok.length))) {
      out.push({ kind: "zeit", text: `«${tok}» ist keine gültige Uhrzeit`, token: tok });
    }
  }
  // vierstellig am Ende («H04 2 Fz AK7 2510»), nicht Kontrollschild/Menge
  const em = /(?<![\d'’.:/])(\d{2})(\d{2})\s*[.!]?\s*$/.exec(rest);
  if (em && bad(+em[1]!, +em[2]!) && !out.length) {
    const before = rest.slice(0, em.index);
    if (!CONTEXT_BEFORE_RE.test(before) && !PLATE_BEFORE_RE.test(before)) out.push({ kind: "zeit", text: `«${em[1]}${em[2]}» ist keine gültige Uhrzeit`, token: em[1]! + em[2]! });
  }
  return out;
}

/** folgt eine Anzahl/Einheit («4 Pers», «Fz», «m»)? Dann ist die Zahl davor keine Minute bzw. Stunde */
function countAfter(after: string): boolean {
  return UNIT_AFTER_RE.test(after) || isCountNoun(/^\s*([\p{L}][\p{L}\-]*)/u.exec(after)?.[1]);
}

/**
 * Uhrzeiten mit Ziffern-Stunde, die `findTimes` nicht liest: «7 Uhr», «um 19 Uhr», «19 Uhr 30», «um 715», «um 7».
 * Ziffern gelten wie geschrieben (24-Stunden-Uhr, «7 Uhr» = 07:00). Was sich mit `have` überschneidet, fällt weg.
 * «9 Uhr 4 Pers»: die Zahl nach «Uhr» ist die Anzahl, nicht die Minute.
 */
export function hourTimes(rest: string, have: FoundTime[] = []): FoundTime[] {
  const out: FoundTime[] = [];
  const free = (a: number, b: number) => ![...have, ...out].some((t) => a < t.index + t.raw.length && b > t.index);
  const push = (minutes: number, raw: string, index: number) => { if (free(index, index + raw.length)) out.push({ minutes, raw, index }); };
  // «7 Uhr», «07 Uhr», «19 Uhr 30»
  for (const m of rest.matchAll(/(?<![\d'’.:/\p{L}])([01]?\d|2[0-4])\s*uhr(?![\p{L}])/giu)) {
    let raw = m[0];
    let minutes = (+m[1]! % 24) * 60;
    const after = rest.slice(m.index! + raw.length);
    const mm = /^\s+([0-5]?\d)(?![\d'’.:])/.exec(after);
    if (mm && !countAfter(after.slice(mm[0].length))) { raw += mm[0]; minutes += +mm[1]!; }
    push(minutes, raw, m.index!);
  }
  // «um 715», «Zeit 715», «ab 930»: dreistellig nur nach einem Zeitwort
  for (const m of rest.matchAll(/(?<![\p{L}])(?:um|gegen|ca\.?|circa|zeit|uhrzeit|punkt|genau|ab)\s*:?\s+(\d)([0-5]\d)(?![\d'’.:])/giu)) {
    const raw = m[1]! + m[2]!;
    const index = m.index! + m[0].length - raw.length;
    if (countAfter(rest.slice(index + raw.length))) continue;
    push(+m[1]! * 60 + +m[2]!, raw, index);
  }
  // «um 7», «um 19»: Stunde ohne «Uhr» nur nach «um» und ohne Anzahl/Einheit danach
  for (const m of rest.matchAll(/(?<![\p{L}])um\s+([01]?\d|2[0-3])(?![\d'’.:\p{L}])/giu)) {
    const raw = m[1]!;
    const index = m.index! + m[0].length - raw.length;
    if (countAfter(rest.slice(index + raw.length))) continue;
    push(+raw * 60, raw, index);
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Stunde aus Ziffer oder Zahlwort («9», «neun», «zwölf»), 0–24; sonst undefined */
function hourOf(w: string): number | undefined {
  const n = /^\d{1,2}$/.test(w) ? +w : spokenNumber(w);
  return n !== undefined && n >= 0 && n <= 24 ? n : undefined;
}

export interface LooseTime {
  /** verwendete Zeit (relativ zu `now` bzw. ungefähr) */
  used?: FoundTime;
  /** Textstelle (für die Erkennung ausblenden) */
  span?: [number, number];
  /** liegt vor Mitternacht des Meldetags («vor 20 min» um 00:10) */
  dayBefore?: boolean;
  /** ungefähre Zeit ohne genaue Uhrzeit («kurz nach acht») → Problem «zeit» */
  problems: DraftProblem[];
}

const REL_RE = /(?<![\p{L}])vor\s+(?:(\d{1,3}|[\p{L}]+)\s*(min(?:uten?|ute|\.)?|'|std\.?|stunden?|h)|(?:einer|1)\s+(halben\s+stunde|viertelstunde|viertel\s+stunde|stunde|minute))(?![\p{L}])/iu;
const APPROX_RE = /(?<![\p{L}])(?:gegen|ca\.?|circa|etwa|ungefähr)\s+(?:um\s+)?(\d{1,2}|[\p{L}]+)(?=\s*$|\s*[,.;!)–-]|\s+(?:H\d|Det\b|Zug\b|Gr\b|Trp\b|Pat\b|in\b|bei\b|im\b|[A-Z]{2}\s?\d))/u;
const VAGUE_TIME_RE = /(?<![\p{L}])kurz\s+(?:nach|vor)\s+(?:halb\s+)?(\d{1,2}|[\p{L}]+)(?:\s*uhr)?(?![\p{L}\d])/iu;

/**
 * Zeit ohne Uhrzeit-Form – nur wenn sonst keine Zeit gefunden wurde:
 * - relativ: «vor 10 min», «vor zehn Minuten», «vor einer halben Stunde», «vor 2 Std» → jetzt minus Dauer;
 * - ungefähr mit Stunde: «gegen neun», «ca. 9» → 09:00 (12-Stunden-Lesart näher bei `now`: «gegen neun» um 20:00 → 21:00);
 * - ungenau: «kurz nach acht», «kurz vor zehn» → Problem «zeit» (nie still «jetzt»).
 */
export function looseTime(rest: string, nowMin: number): LooseTime {
  const r = REL_RE.exec(rest);
  if (r) {
    let n: number | undefined;
    if (r[3]) n = /halb/i.test(r[3]) ? 30 : /viertel/i.test(r[3]) ? 15 : /stunde/i.test(r[3]) ? 60 : 1;
    else {
      const v = /^\d+$/.test(r[1]!) ? +r[1]! : /^(?:einer|ein|eine)$/i.test(r[1]!) ? 1 : spokenNumber(r[1]!);
      if (v !== undefined) n = /^(?:std|stunde|h)/i.test(r[2]!) ? v * 60 : v;
    }
    if (n !== undefined && n > 0 && n <= 24 * 60) {
      const t = nowMin - n;
      return { used: { minutes: (t % 1440 + 1440) % 1440, raw: r[0], index: r.index, relative: true }, span: [r.index, r.index + r[0].length], dayBefore: t < 0, problems: [] };
    }
  }
  const a = APPROX_RE.exec(rest);
  const h = a ? hourOf(a[1]!) : undefined;
  if (a && h !== undefined && !countAfter(rest.slice(a.index + a[0].length))) {
    let hh = h % 24;
    if (h >= 1 && h <= 12) {
      const dist = (x: number) => Math.min(Math.abs(x - nowMin), 1440 - Math.abs(x - nowMin));
      if (dist(((h + 12) % 24) * 60) < dist(hh * 60)) hh = (h + 12) % 24;
    }
    return { used: { minutes: hh * 60, raw: a[0], index: a.index }, span: [a.index, a.index + a[0].length], problems: [] };
  }
  const v = VAGUE_TIME_RE.exec(rest);
  if (v && hourOf(v[1]!) !== undefined) {
    const tok = v[0].trim();
    return { problems: [{ kind: "zeit", text: `«${tok}»: ungefähre Zeit – bitte Uhrzeit angeben (z. B. 0805)`, token: tok }] };
  }
  return { problems: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Ort

/** Wörter, die wie ein Planquadrat aussehen («KP 2», «MG 3»), aber keines sind */
const NOT_CELL = new Set(["NAI", "BNB", "PQ", "UQ", "KP", "AO", "AB", "HS", "KM", "CA", "UM", "IM", "IN", "AM", "AN", "AUF", "TO", "VO", "NO", "NE", "SO", "SE", "SW", "NW", "UL", "OK"]);

/**
 * Planquadrate und NAI, die es nicht gibt («AK77», «ZZ3», «NAI 9»), bzw. Planquadrat ohne Führungsraster.
 * @param locText Ortsteil der Meldung (Richtung/Herkunft schon ausgeblendet)
 * @param found gefundene (gültige) Planquadrate
 * @param exclude Elementnamen («H04», «Det 2») – nie ein Ort
 */
export function placeProblems(locText: string, o: { sheets: RasterSheet[]; areas: Area[]; found: FoundCell[]; exclude: string[] }): DraftProblem[] {
  const out: DraftProblem[] = [];
  const seen = new Set<string>();
  const add = (token: string, text: string) => { if (!seen.has(token)) { seen.add(token); out.push({ kind: "ort", text, token }); } };
  const n = (s: string) => s.toLowerCase().replace(/[\s.\-_]/g, "").replace(/(\D)0+(\d)/g, "$1$2");
  // NAI mit Nummer, die es nicht gibt
  for (const m of locText.matchAll(/(?<![\p{L}\d])(NAI|BNB)\s?-?\s?0*(\d{1,3})(?![\p{L}\d])/giu)) {
    const name = `${m[1]!.toUpperCase()} ${+m[2]!}`;
    if (!o.areas.some((a) => n(a.name) === n(name))) add(name, `«${name}» gibt es nicht`);
  }
  // Planquadrat-ähnlich: zwei Buchstaben + Zahl («AK77», «ZZ3», «AK 77 C»); klein nur ohne Leerzeichen («zz3»)
  const letterLabels = new Set(o.sheets.flatMap((s) => (s.labelOrder === "col-row" ? s.colLabels : s.rowLabels).map((x) => x.toUpperCase())));
  const excl = new Set(o.exclude.map((x) => x.toUpperCase().replace(/\s/g, "")));
  const covered = (a: number, b: number) => o.found.some((f) => a < f.index + f.raw.length && b > f.index);
  const re = /(?<![\p{L}\d'’.:/])(?:([A-Z]{2})\s?-?\s?(\d{1,3})|([a-z]{2})(\d{1,3}))(?:\s?([ABCD]))?(?![\p{L}\d'’])/gu;
  for (const m of locText.matchAll(re)) {
    const letters = (m[1] ?? m[3]!).toUpperCase();
    const num = m[2] ?? m[4]!;
    const a = m.index!, b = a + m[0].length;
    if (covered(a, b) || NOT_CELL.has(letters) || excl.has(letters + num) || excl.has(letters + +num)) continue;
    // Begriff wie «Mg 3», «Pw 2» – nur wenn die Buchstaben kein Raster-Buchstabe sind
    if (isTacticalWord(letters.toLowerCase(), ["e", "ech"]) && !letterLabels.has(letters)) continue;
    const label = `${letters}${+num}${m[5] ? ` ${m[5]}` : ""}`;
    if (!o.sheets.length) add(label, `«${label}»: kein Führungsraster vorhanden`);
    else add(label, `«${label}» gibt es nicht`);
  }
  return out;
}

/** Ortsangaben, die keine Ortsnamen sind («bei Kreuzung», «beim Waldrand») – nicht online suchen, nicht sperren */
const GENERIC_PLACE = new Set([
  "kreuzung", "strasse", "straße", "weg", "waldrand", "wald", "brücke", "bruecke", "dorf", "haus", "häuser", "hof", "bauernhof",
  "kirche", "schule", "tankstelle", "parkplatz", "kreisel", "einfahrt", "ausfahrt", "abzweigung", "verzweigung", "hügel", "hang",
  "feld", "wiese", "bach", "fluss", "ufer", "unterführung", "überführung", "tunnel", "bahnübergang", "gebäude", "scheune",
  "lichtung", "waldweg", "feldweg", "dorfeingang", "dorfausgang", "ortseingang", "ortsausgang", "eingang", "ausgang", "ende",
  "anfang", "mitte", "nähe", "rand", "stellung", "deckung", "checkpoint", "sperre", "fahrzeug", "fz", "posten",
]);

/** Ist die Ortsabfrage nur ein Gattungswort («Kreuzung», «Waldrand»)? */
export function isGenericPlace(q: string | undefined): boolean {
  if (!q) return false;
  return q.toLowerCase().split(/\s+/).every((w) => GENERIC_PLACE.has(w));
}

/**
 * Ortsname mit Ortspräposition («in Wabern», «bei Bümpliz», «Dorfeingang Wabern»; bei eigener Lage auch «nach Wabern»):
 * Dann ist der Ort genannt – kein Ersatzort («bei H04», «letzter Standort»), bis er gefunden oder auf der Karte gesetzt ist.
 * Richtung («Rtg Bern», «Richtung Bern») ist kein Ort.
 */
export function namesPlace(locText: string, placeQuery: string | undefined, own: boolean): boolean {
  if (!placeQuery) return false;
  const first = placeQuery.split(/\s+/)[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const preps = own ? "in|im|bei|beim|an|am|auf|vor|höhe|nach|bis|(?:orts|dorf)?(?:ein|aus)gang" : "in|im|bei|beim|an|am|auf|vor|höhe|(?:orts|dorf)?(?:ein|aus)gang";
  return new RegExp(`(?<![\\p{L}])(?:${preps})\\.?\\s+${first}`, "iu").test(locText);
}

// ---------------------------------------------------------------------------------------------------------------
// Eigene Lage oder Sichtung

/**
 * Standortwörter: nur damit verschiebt eine Meldung den eigenen Trupp auf einen genannten Ort.
 * «in Stellung», «bezogen», «ist in», «Stao», «erreicht», «angekommen», «verschiebt nach», «eig», «wir» …
 */
const OWN_POS_RE = new RegExp(
  `(?<![${L}])(?:` +
    [
      "stellung\\w*", "bezogen", "bezieht", "beziehen", "bezug", "stao", "standort\\w*", "position", "pos", "beo", "eig", "eigen\\w*", "wir", "uns",
      "erreicht\\w*", "angekommen", "eingetroffen", "wechselt", "wechseln", "gewechselt", "trifft\\s+ein", "treffen\\s+ein", "ankunft", "verschieb\\w*", "verschoben", "verlegt", "verlegen",
      "rollt\\s+ab", "rollen\\s+ab", "abgerollt", "marsch\\w*", "unterwegs", "ablösung", "abgelöst", "befindet\\s+sich", "befinden\\s+(?:sich|uns)",
      "(?:ist|sind)\\s+(?:jetzt\\s+|nun\\s+|neu\\s+|wieder\\s+)?(?:in|im|bei|beim|am|an|auf|zurück)", "frei", "gesichert", "besetzt\\s+(?:durch\\s+)?(?:uns|eig)",
    ].join("|") +
    `)(?![${L}])`,
  "iu",
);

/** Sicht-/Meldeverben zwischen zwei eigenen Elementen («H02 sieht H04 in AK9», «H02 meldet H04 bei NAI 1») */
const SEE_RE = /^\s*[:,]?\s*(?:sieht|sah|beobachtet|meldet|hat|erkennt|gesichtet|sichtet)\b/i;

/**
 * Wird ein anderes eigenes Element gesehen/gemeldet («H02 sieht H04 in AK9»)? Dann ist dieses Element (nicht der Melder)
 * am genannten Ort.
 */
export function observedOwn(text: string, hits: Array<{ u: string; side: string | null; index: number; len: number }>, blau: string[]): string | undefined {
  const own = hits.filter((h) => h.side === "blau" || (h.side === null && blau.some((b) => b.replace(/\s/g, "").toLowerCase() === h.u.replace(/\s/g, "").toLowerCase())));
  if (own.length < 2) return undefined;
  const [a, b] = [own[0]!, own[1]!];
  return SEE_RE.test(text.slice(a.index + a.len, b.index)) ? b.u : undefined;
}

/**
 * Bleibt eine «eigene» Meldung mit genanntem Ort eigene Lage? Ja mit Standortwort, mit eigenem Zeichen (Stellung, Beo
 * Stao …) oder als blosse Standortmeldung («H01 AF12», «H02 in AK9», «Zug 1 Rtg N AE6»). Sonst ist es eine Sichtung am
 * Ort («schwarzer Golf fährt langsam vorbei, AN6, H03») – der Melder bleibt, wo er ist.
 * @param rest Text ohne Melder, Ortsangaben und Richtung
 */
export function staysOwn(text: string, rest: string, reading: TacticalReading | null, entry: CatalogEntry): boolean {
  if (reading?.aff === "F") return true;
  if (entry.kind !== "einheit" && entry.kind !== "geraet") return true;
  if (OWN_POS_RE.test(text)) return true;
  // nichts ausser Füllwörtern übrig → reine Standortmeldung
  const left = rest.toLowerCase().replace(/(?<![\p{L}])(?:in|im|bei|beim|am|an|auf|nach|jetzt|neu|nun|hier|ist|sind|steht|stehen|meldet|meldung|planquadrat|pq|raum|nähe|ca|rtg|richtung)(?![\p{L}])/gu, " ");
  return !/[\p{L}]{2,}/u.test(left);
}

// ---------------------------------------------------------------------------------------------------------------
// Zeichen: Ziel, Bedarf, Ort statt Gegenstand

/** Ankunftsverben: was danach steht, ist das Ziel des Elements, nicht die Sichtung («H04 erreicht Checkpoint 2») */
const ARRIVE_RE = /(?<![\p{L}])(?:erreicht|erreichen|angekommen(?:\s+(?:in|im|bei|beim|am|an|auf))?|eingetroffen(?:\s+(?:in|im|bei|beim|am|an|auf))?|trifft\s+(?:in|im|bei|beim|am)\s+)(?![\p{L}])/iu;
/** Präpositionen mit Ortsangabe: «bei der Brücke», «beim Checkpoint» – eine Anlage dahinter ist der Ort, nicht die Sichtung */
const AT_RE = /(?<![\p{L}])(?:bei|beim|an|am|auf|vor|hinter|neben|nahe|unter|über)\s+(?:der|dem|den|die|das)?\s*([\p{L}][\p{L}\-]*)/giu;

/**
 * Textstellen, die die Zeichenerkennung überspringen soll:
 * - nach einem Ankunftsverb eines Elements (Ziel, z. B. «Checkpoint 2»),
 * - eine Anlage nach einer Ortspräposition («Det 1 gesichtet bei der Brücke»), wenn davor ein Element steht.
 */
export function placeSpans(text: string, hasElementBefore: (index: number) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const am = ARRIVE_RE.exec(text);
  if (am && hasElementBefore(am.index)) {
    const from = am.index + am[0].length;
    const end = text.slice(from).search(/[,;]|(?<![\p{L}])(?:und|dann|danach)(?![\p{L}])/u);
    const to = end < 0 ? text.length : from + end;
    // nur Anlagen («Checkpoint 2», «Brücke»); Linien und Räume («erreicht Phasenlinie») bleiben eigenes Zeichen
    const r = readTactical(text.slice(from, to));
    if (r && catalogEntry(r.key)?.kind === "anlage") out.push([from, to]);
  }
  for (const m of text.matchAll(AT_RE)) {
    const w = m[1]!;
    const r = readTactical(w);
    const e = r ? catalogEntry(r.key) : undefined;
    if (e?.kind === "anlage" && hasElementBefore(m.index!)) out.push([m.index! + m[0].length - w.length, m.index! + m[0].length]);
  }
  return out;
}

/** Bedarf / Anforderung («Mun Nachschub benötigt», «brauchen Wasser»): Logistik ohne Ort ist eine Notiz, kein Lagerzeichen */
const NEED_RE = /(?<![\p{L}])(?:benötig\w*|brauch\w*|bedarf|bedürfnis|anforder\w*|fordert?\s+\S+\s+an|fehlt|fehlen|nachschub|bitte\s+um|wünsch\w*)(?![\p{L}])/iu;

/** Ist die Erkennung nur ein Bedarf (Logistik/Anlage)? Dann kein Zeichen (Munitionslager o. ä.) setzen. */
export function isNeedNote(text: string, reading: TacticalReading | null): boolean {
  if (!reading || !NEED_RE.test(text)) return false;
  const e = catalogEntry(reading.key);
  return !!e && (e.category === "Führung und Logistik" || e.kind === "anlage");
}

// ---------------------------------------------------------------------------------------------------------------
// Aufzählung

const PART_NOUN = /^(autos?|pws?|personenwagen|lws?|lastwagen|lkws?|lieferwagen|fz|fahrzeuge?|motorr(?:ad|äder)|töffs?|velos?|traktor(?:en)?|busse?|jeeps?|drohnen?|pers(?:onen)?|personen|leute|männer|frauen|mann|sdt|soldaten|kinder|hunde?|kpz|spz|panzer)$/i;
const PART_NAME: Record<string, [string, string]> = {
  auto: ["Auto", "Autos"], autos: ["Auto", "Autos"], pw: ["Personenwagen", "Personenwagen"], pws: ["Personenwagen", "Personenwagen"],
  personenwagen: ["Personenwagen", "Personenwagen"], lw: ["Lastwagen", "Lastwagen"], lws: ["Lastwagen", "Lastwagen"], lastwagen: ["Lastwagen", "Lastwagen"],
  lkw: ["Lastwagen", "Lastwagen"], lkws: ["Lastwagen", "Lastwagen"], fz: ["Fahrzeug", "Fahrzeuge"], fahrzeug: ["Fahrzeug", "Fahrzeuge"], fahrzeuge: ["Fahrzeug", "Fahrzeuge"],
  pers: ["Person", "Personen"], person: ["Person", "Personen"], personen: ["Person", "Personen"], mann: ["Mann", "Mann"], sdt: ["Soldat", "Soldaten"],
  soldaten: ["Soldat", "Soldaten"], männer: ["Mann", "Männer"], frauen: ["Frau", "Frauen"], leute: ["Person", "Personen"],
  lieferwagen: ["Lieferwagen", "Lieferwagen"], motorrad: ["Motorrad", "Motorräder"], motorräder: ["Motorrad", "Motorräder"],
  drohne: ["Drohne", "Drohnen"], drohnen: ["Drohne", "Drohnen"], panzer: ["Panzer", "Panzer"], kpz: ["Kampfpanzer", "Kampfpanzer"], spz: ["Schützenpanzer", "Schützenpanzer"],
};

/**
 * Aufzählung mit mehreren Anzahlen («1 Auto 1 Lw und 3 Pers», «2 Pw, 1 Lw»): alle Teile als Text, damit nichts verloren geht.
 * Liefert nichts bei nur einem Teil oder wenn alle Teile dasselbe sind.
 */
export function listParts(text: string, skip: Array<[number, number]> = [], cells?: Array<{ index: number; label: string }>): string | undefined {
  const parts: Array<{ n: number; w: string; index: number }> = [];
  for (const m of text.matchAll(/(?<![\p{L}\d'’.:])(\d{1,3})\s+([\p{L}]+)(?:\s+([\p{L}]+))?/gu)) {
    if (skip.some(([a, b]) => m.index! < b && m.index! + m[1]!.length > a)) continue;
    // Nomen direkt nach der Zahl, sonst nach einem Beschreibungswort («2 schwarze Pw»)
    const w = [m[2], m[3]].map((x) => x?.toLowerCase()).find((x) => x && PART_NOUN.test(x));
    if (!w) continue;
    parts.push({ n: +m[1]!, w, index: m.index! });
  }
  if (parts.length < 2 || new Set(parts.map((p) => PART_NAME[p.w]?.[0] ?? p.w)).size < 2) return undefined;
  // Ort je Teil: erstes Planquadrat nach dem Teil (vor dem nächsten Teil) – nur wenn die Teile an verschiedenen Orten sind
  const at = parts.map((p, k) => cells?.find((c) => c.index > p.index && c.index < (parts[k + 1]?.index ?? Infinity))?.label);
  const withPlace = new Set(at.filter(Boolean)).size > 1;
  return parts.map((p, k) => {
    const nm = PART_NAME[p.w];
    const name = nm ? nm[p.n === 1 ? 0 : 1] : p.w[0]!.toUpperCase() + p.w.slice(1);
    return `${p.n} ${name}${withPlace && at[k] ? ` in ${at[k]}` : ""}`;
  }).join(", ");
}

/** «Fz in AK7, 2 Stück» – Anzahl mit «Stück»/«Stk» */
export function stueckCount(text: string): number | undefined {
  const m = /(?<![\p{L}\d'’.:])(\d{1,3})\s*(?:stück|stk\.?)(?![\p{L}])/iu.exec(text);
  return m ? +m[1]! : undefined;
}


// ---------------------------------------------------------------------------------------------------------------
// Anzahl in Worten (getippt): «ein Panzer», «ein Dutzend Soldaten», «ein paar Leute»

/** Artikel «ein/eine/einen» als Anzahl nur vor diesen Wörtern (Fahrzeuge, Personen, Geräte, Elemente) */
const ART_NOUN_RE = /^(?:fahrzeug|fz|fzg|person|pers|mann|soldat|sdt|typ|kerl|pinz|pinzgauer|mowag|pw|personenwagen|lw|lastwagen|lieferwagen|kastenwagen|transporter|drohne|spz|schützenpanzer|kpz|kampfpanzer|panzer|motorrad|töff|velo|traktor|auto|lkw|bus|kleinbus|jeep|pick-?up|geländewagen|duro|zivilist|zivilperson|bewaffnete[rn]?|helikopter|heli|minenwerfer|mw|mg|maschinengewehr|raketenwerfer|lenkwaffe|pzaw)$/i;
const ZAHLWORT: Record<string, number> = { zwei: 2, zwo: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12 };
const SMALL_WORD: Record<string, number> = { ein: 1, eine: 1, einen: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10 };
/** unbestimmte Mengen: keine Anzahl, bleiben im Sinn («ein paar gegnerische Soldaten») */
const VAGUE_RE = /(?<![\p{L}])(ein\s+paar|einige|mehrere|etliche|viele|wenige|zahlreiche)(?![\p{L}])/iu;

/**
 * Anzahl in Worten für die Erkennung lesbar machen (nur intern, der Meldungstext bleibt): «ein Panzer» → «1 Panzer»,
 * «einen weissen Lieferwagen» → «1 weissen Lieferwagen», «ein Dutzend» → «12», «zwei Dutzend» → «24», «ein halbes Dutzend» → «6».
 * «ein paar» bleibt unbestimmt (keine Anzahl, siehe `vagueAmount`).
 */
export function countWords(text: string): string {
  let out = text.replace(/(?<![\p{L}\d])(?:(ein|eine|einem|\d{1,2}|zwei|zwo|drei|vier|fünf|sechs|sieben|acht|neun|zehn)\s+)?(halbes\s+)?dutzend(?![\p{L}])/giu, (m, n: string | undefined, half: string | undefined) => {
    const f = !n ? 1 : /^\d/.test(n) ? +n : SMALL_WORD[n.toLowerCase()] ?? 1;
    return String(half ? f * 6 : f * 12);
  });
  const base = (w: string) => w.toLowerCase().replace(/(?:en|e|n|s)$/, "");
  const noun = (w: string | undefined) => !!w && (ART_NOUN_RE.test(w) || ART_NOUN_RE.test(base(w)) || isCountNoun(w));
  // (MVP 3.5, C2) Zahlwort vor einem Gegenstand («drei Typen», «zwei Pinz», «zwei schwarze Pw») – nur intern, der Text bleibt
  out = out.replace(/(?<![\p{L}\d])(zwei|zwo|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)\s+(?=([\p{L}][\p{L}\-]*)(?:\s+([\p{L}][\p{L}\-]*))?)/giu, (m, n: string, w1: string, w2: string | undefined) =>
    noun(w1) || (/^[\p{Ll}]/u.test(w1) && noun(w2)) ? `${ZAHLWORT[n.toLowerCase()]} ` : m);
  out = out.replace(/(?<![\p{L}\d])(ein|eine|einen|einem|einer)\s+(?=([\p{L}][\p{L}\-]*)(?:\s+([\p{L}][\p{L}\-]*))?)/giu, (m, _a: string, w1: string, w2: string | undefined) => {
    if (/^paar$/i.test(w1)) return m;
    // Nomen direkt danach oder nach einem kleingeschriebenen Beschreibungswort («einen weissen Lieferwagen»)
    if (noun(w1) || (/^[\p{Ll}]/u.test(w1) && noun(w2))) return "1 ";
    return m;
  });
  return out;
}

/** Unbestimmte Menge im Text («ein paar», «einige», «mehrere») – für den Sinn, keine Anzahl */
export function vagueAmount(text: string): string | undefined {
  const m = VAGUE_RE.exec(text);
  return m ? m[1]!.toLowerCase().replace(/\s+/g, " ") : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Zeitfeld (Bearbeiten)

/**
 * Zeitfeld beim Bearbeiten («1015», «10:15», «10.15», «9:05»): Minuten seit Mitternacht; leer = unverändert (null);
 * ungültig («25:70», «abc») = Problem – nie still auf 23:59 kappen.
 */
export function clockField(value: string): number | null | DraftProblem {
  const v = value.trim();
  if (!v) return null;
  const m = /^(\d{1,2})[:.h]?(\d{2})$/.exec(v);
  if (!m || +m[1]! > 23 || +m[2]! > 59) return { kind: "zeit", text: `«${v}» ist keine gültige Uhrzeit`, token: v };
  return +m[1]! * 60 + +m[2]!;
}


// ---------------------------------------------------------------------------------------------------------------
// Melder

/** «H04» → ["H", 4]; «Zug 1» → ["ZUG", 1]; ohne Nummer undefined */
function unitKey(u: string): [string, number] | undefined {
  const m = /^([\p{L}]+)\.?\s?0*(\d{1,3})$/u.exec(u.trim());
  return m ? [m[1]!.toUpperCase(), +m[2]!] : undefined;
}
const sameUnit = (a: string, b: string) => { const x = unitKey(a), y = unitKey(b); return x && y ? x[0] === y[0] && x[1] === y[1] : a.replace(/\s/g, "").toLowerCase() === b.replace(/\s/g, "").toLowerCase(); };

/**
 * Funksprache «Hotel eins drei Personen» wird zu «H13 Pers» – gibt es H13 in der Übung nicht, aber H01, dann ist
 * gemeint: H01 mit 3 Pers («H01 3 Pers»). Ebenso «H21 Panzer» → «H02 1 Panzer», «H44 Fz» → «H04 4 Fz».
 * Nur wenn direkt danach ein zählbares Wort ohne eigene Zahl steht.
 */
export function splitMelderCount(text: string, blau: string[]): string {
  if (!blau.length) return text;
  return text.replace(/(?<![\p{L}\d])H(\d)([1-9])(?=\s+([\p{L}][\p{L}\-]*))/gu, (m, a: string, b: string, w: string) => {
    if (blau.some((u) => sameUnit(u, m)) || !isCountNoun(w)) return m;
    const cand = blau.filter((u) => sameUnit(u, `H${a}`));
    return cand.length === 1 ? `${cand[0]} ${b}` : m;
  });
}

/**
 * Eigenes Element (Melder bzw. gesehenes eigenes Element), das es in der Übung nicht gibt und das nach
 * zusammengezogenen Ziffern aussieht: «H13», wenn die Übung H01 kennt, H13 aber nicht («Hotel eins drei …» =
 * H01 + 3?). → Problem «melder» (Eintragen gesperrt; Ausweg: Trupp im Text korrigieren oder ausdrücklich als neues
 * Element aufnehmen).
 * Ein sonst neuer Trupp («H06» bei H01–H05, «H02» nach H01 in einer neuen Übung) wird weiter gelernt – die Übung
 * kennt ihre Trupps nur aus den Meldungen, sonst wäre jede neue Übung nach der ersten Meldung gesperrt.
 */
export function melderProblems(names: string[], blau: string[]): DraftProblem[] {
  const out: DraftProblem[] = [];
  for (const n of names) {
    const k = unitKey(n);
    if (!k || k[1] < 10 || k[1] > 99 || blau.some((u) => sameUnit(u, n)) || out.some((p) => p.token === n)) continue;
    const kin = blau.filter((u) => unitKey(u)?.[0] === k[0]).sort((x, y) => unitKey(x)![1] - unitKey(y)![1]);
    const head = kin.find((u) => unitKey(u)![1] === Math.floor(k[1] / 10));
    if (!head) continue;
    const list = kin.length <= 6 ? kin.join(", ") : `${kin[0]}–${kin[kin.length - 1]}`;
    out.push({ kind: "melder", text: `«${n}» gibt es in der Übung nicht (bekannt: ${list}) – gemeint «${head} ${k[1] % 10} …»?`, token: n });
  }
  return out;
}

/**
 * Mehrere Anzahlen an verschiedenen Orten in einer Meldung («2 Fz AK7 und 3 Pers AL8»): Orte der Teile (≥ 2
 * verschiedene) – die Karte zeigt nur einen Ort, also Problem «orte» (als einzelne Meldungen eintragen).
 */
export function partPlaces(text: string, skip: Array<[number, number]>, cells: Array<{ index: number; label: string }>): string[] {
  if (cells.length < 2) return [];
  const parts: number[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\d'’.:])(\d{1,3})\s+([\p{L}]+)(?:\s+([\p{L}]+))?/gu)) {
    if (skip.some(([a, b]) => m.index! < b && m.index! + m[1]!.length > a)) continue;
    if ([m[2], m[3]].some((x) => x && (PART_NOUN.test(x) || isCountNoun(x)))) parts.push(m.index!);
  }
  if (parts.length < 2) return [];
  const at = parts.map((p, k) => cells.find((c) => c.index > p && c.index < (parts[k + 1] ?? Infinity))?.label);
  const uniq = [...new Set(at.filter((x): x is string => !!x))];
  return uniq.length > 1 && at.every(Boolean) ? uniq : [];
}

/** Gleiches Element trotz Schreibweise? «H3» = «h03» = «H03», «Det 2» = «det2» */
export function sameUnitName(a: string, b: string): boolean {
  return sameUnit(a, b);
}

/** Kurzformen von Elementnamen in der üblichen Schreibweise («det 2» → «Det 2», «zug1» bleibt Name) */
const UNIT_CASE: Record<string, string> = { det: "Det", zug: "Zug", gr: "Gr", trp: "Trp", pat: "Pat", patr: "Patr", z: "Z" };

/**
 * Melder in der Schreibweise der Übung: «h3» → «H03», wenn H03 bekannt ist; sonst H-Namen gross und mit führender Null wie
 * die bekannten Trupps (keine bekannten: zweistellig, «h3» → «H03»; bekannt «H1», «H2»: ohne Null, «h3» → «H3»).
 * Andere Namen: bekannter Name in dessen Schreibweise, sonst Kürzel gross («det 2» → «Det 2»).
 */
export function normalizeMelder(name: string, known: string[] = []): string {
  const n = name.trim();
  if (!n) return n;
  const hit = known.find((u) => sameUnit(u, n));
  if (hit) return hit;
  const h = /^h\s?0*(\d{1,3})$/i.exec(n);
  if (h) {
    const num = +h[1]!;
    const hs = known.map((u) => /^H(\d{1,3})$/.exec(u.trim())?.[1]).filter((x): x is string => !!x);
    const width = hs.length ? Math.max(...hs.map((x) => x.length)) : 2;
    return `H${String(num).padStart(width, "0")}`;
  }
  const m = /^([\p{L}]+)(\.?\s?)(\d{1,3})$/u.exec(n);
  if (m && UNIT_CASE[m[1]!.toLowerCase()]) return `${UNIT_CASE[m[1]!.toLowerCase()]}${m[2]}${m[3]}`;
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Richtung auf eigene Kräfte, Rückfrage/Auftrag, unbekannte Wörter

/**
 * Richtung auf eigene Kräfte («Rtg eigene Stellung», «Richtung eig Stao», «Rtg unsere Pos», «Rtg uns»): das ist das Ziel
 * einer (meist gegnerischen) Bewegung – weder Ort noch Zeichen, und es macht die Meldung nicht zur eigenen Lage.
 * Liefert die Textstelle und die Beschriftung («Rtg eigene Stellung»).
 */
const OWN_DIR_RE = new RegExp(
  `(?<![${L}])(?:in\\s+)?(?:rtg|richtung|fahrtrichtung)\\.?\\s+(?:auf\\s+|zur?\\s+|der\\s+|die\\s+|den\\s+|das\\s+)?` +
    `((?:eigene[nrs]?|eig\\.?|unsere[nrs]?|uns|wir)(?![${L}])(?:\\s+(?:stellung\\w*|stao|standort\\w*|stp|stützpunkt\\w*|pos(?:ition\\w*)?|kp|beo(?:\\s*stao)?|truppe\\w*|kräfte|leute|linie\\w*|sperre\\w*|checkpoint\\w*|posten|element\\w*|trupp\\w*|zug|gruppe|h\\d{1,3}))?)(?![${L}])`,
  "iu",
);

export function ownDirection(text: string): { span: [number, number]; label: string } | undefined {
  const m = OWN_DIR_RE.exec(text);
  if (!m) return undefined;
  const words = m[1]!.replace(/\s+/g, " ").trim();
  return { span: [m.index, m.index + m[0].length], label: `Rtg ${words}` };
}

/**
 * Rückfrage, Auftrag, Befehl oder Frage («H04 Rückfrage: Standort Det 2?», «Auftrag an H01: Beo NAI 1», «… ?»): keine
 * Lage – Vorschlag «als Notiz ohne Zeichen». `to` = Empfänger nach «an» («H01»), dann ist er nicht der Melder.
 */
const NOTE_RE = new RegExp(`(?<![${L}])(rückfrage|rueckfrage|frage|auftrag\\s+(?:an|für)|befehl\\s+(?:an|für))(?![${L}])`, "iu");
const NOTE_TO_RE = new RegExp(`(?<![${L}])(?:rückfrage|rueckfrage|anfrage|frage|auftrag|befehl)\\s+(?:an|für)\\s+(?:den\\s+|die\\s+)?([${L}]{1,6}\\.?\\s?\\d{0,3})(?![${L}\\d])`, "iu");

/** @deprecated MVP 3: `readArt` (arten.ts) liest die Art; bleibt nur für ältere Aufrufer */
export function noteIntent(text: string): { word: string; to?: string } | undefined {
  const t = text.trim();
  const m = NOTE_RE.exec(t);
  if (!m && !/\?\s*$/.test(t)) return undefined;
  const to = NOTE_TO_RE.exec(t)?.[1]?.trim();
  return { word: m ? m[1]!.replace(/\s+/g, " ") : "?", ...(to ? { to } : {}) };
}

/** Wörter nach einer Zahl, die kein gesehener Gegenstand sind (Einheiten, Zeit, Präpositionen, Richtungen) */
const NOT_SUBJECT = new RegExp(
  `^(?:x|mal|min|minuten?|sek|sekunden?|std|stunden?|h|uhr|m|km|meter|kilometer|grad|tage?|nächte?|stück|stk|prozent|` +
    `in|im|bei|beim|an|am|auf|nach|von|vom|aus|mit|ohne|und|oder|bis|vor|hinter|neben|über|unter|ca|circa|rtg|richtung|` +
    // (MVP 3.5, C1) «pers…» nur in den richtigen Formen – «Persohnen» ist ein Tippfehler, kein Personenwort
    `n|no|ne|o|e|so|se|s|sw|w|nw|nord\\w*|ost\\w*|süd\\w*|west\\w*|uq|pq|nai|bnb|pers|pers\\.|person|personen|personal|fz|leute|stellung\\w*|meter|` +
    `geschätzt|gezählt|gesehen|gemeldet|beobachtet|gesichtet|erkannt|weitere|andere|davon|total|insgesamt|zusätzlich|neu|neue|mehr|weniger|wörter|zeichen|stellen|zeilen|seiten)$`,
  "iu",
);

export interface UnknownWord {
  /** Textstelle wie getippt, z. B. «schützenpnzr» */
  token: string;
  /** Anzahl davor («2 schützenpnzr» → 2) */
  count?: number;
  /** Vorschlag aus dem Katalog (Schlüssel), z. B. «spz» – nur Vorschlag, nie still übernommen */
  suggest?: string;
  /** Vorschlag in Worten = Ersatzwort für die Textstelle, z. B. «Schützenpanzer», «Personen» (MVP 3.5: Wort wie im Katalog) */
  suggestLabel?: string;
}

/** Ersatz aus dem Katalog (Schlüssel und Wort) */
function ersatzOf(w: string): { suggest: string; suggestLabel: string } | undefined {
  const c = ersatzWort(w);
  return c ? { suggest: c.entry.key, suggestLabel: c.wort } : undefined;
}

/** gewöhnliche Wörter einer Meldung, die nie ein verstümmelter Begriff sind (ohne Anzahl, C1) */
const COMMON_WORD = new RegExp(
  `^(?:hier|meldet|meldung|sieht|sehe|sehen|gesehen|gesichtet|fährt|fahren|fuhr|fahrend|langsam|schnell|vorbei|steht|stehen|stehend|geht|gehen|läuft|laufen|` +
    `ist|sind|war|waren|hat|haben|wird|werden|wurde|wir|uns|ihr|sie|der|die|das|den|dem|des|ein|eine|einen|einem|einer|und|oder|mit|ohne|` +
    `jetzt|neu|neue|neues|nichts|alles|ruhig|keine|kein|keinen|nicht|mehr|noch|schon|wieder|weiter|bitte|dringend|sofort|` +
    `zwei|zwo|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|etwa|circa|ungefähr|vermutlich|möglich\\w*|` +
    `richtung|nord\\w*|ost\\w*|süd\\w*|west\\w*|links|rechts|vorne|hinten|oben|unten|strasse|weg|wald|waldrand|dorf|haus|feld|` +
    `bewegung\\w*|lage|unverändert|verbindung|funk|meldet|melden|gemeldet|erfolgt|beendet|bereit|alle|allen|gut|schlecht|` +
    `schwarz\\w*|weiss\\w*|rot\\w*|blau\\w*|grün\\w*|grau\\w*|gelb\\w*|braun\\w*|gross\\w*|klein\\w*)$`,
  "iu",
);

/**
 * Unbekanntes bzw. verstümmeltes Wort an der Stelle des Gesehenen – statt einer geratenen Art:
 * - nach einer Anzahl («2 schützenpnzr», «3 Persohnen»): weder Begriff noch bekanntes Sichtungswort, aber nahe an einem
 *   Katalogbegriff;
 * - als Wortteil gelesen («schützenpnzr» enthält «schützen» → Infanterie), obwohl ein anderer Begriff viel näher liegt;
 * - (MVP 3.5, C1) ohne Anzahl, wenn sonst nichts Gesehenes erkannt ist (`o.ohneAnzahl`): ein Wort nahe an einem
 *   Katalogbegriff («H01 Lastwagn AE5», «H05 drohen über AQ11»).
 * Wörter ohne nahen Begriff («2 Golf», «Militärfahrzeug») bleiben wie bisher.
 * @param skip Elementnamen und Orte (nicht prüfen)
 * @param isSightWord bekanntes Sichtungswort ohne Katalogbegriff («Lieferwagen», «Velo», «Wanderer»)
 */
export function unknownSubject(text: string, reading: TacticalReading | null, skip: Array<[number, number]> = [], isSightWord: (w: string) => boolean = () => false, o: { ohneAnzahl?: boolean } = {}): UnknownWord | undefined {
  const free = (a: number, b: number) => !skip.some(([x, y]) => a < y && b > x);
  // Wortteil-Treffer: gelesener Begriff ist kein ganzes Wort («schützenpnzr» als «schützen» gelesen)
  for (const [a, b] of reading?.spans ?? []) {
    const w = text.slice(a, b);
    if (!/^[\p{L}]{6,}$/u.test(w) || isKnownTerm(w) || !free(a, b)) continue;
    const c = closestTerm(w);
    if (!c || c.entry.key === reading!.key) continue;
    const cnt = /(?<![\p{L}\d'’.:])(\d{1,3})\s*$/u.exec(text.slice(0, a))?.[1];
    return { token: w, ...(cnt ? { count: +cnt } : {}), ...ersatzOf(w) };
  }
  // nach einer Anzahl
  // Zahl nach einem Namen («NAI 1», «Det 2», «Zug 3») ist keine Anzahl
  for (const m of text.matchAll(/(?<![\p{L}\d'’.:])(?<!(?<![\p{L}])(?:NAI|BNB|PQ|Det|Zug|Gr|Trp|Pat|Patr|Kp|Nr|Ziff)\.?\s?)(\d{1,3})\s+([\p{L}][\p{L}\-]*)(?![\p{L}\d])(?:\s+([\p{L}][\p{L}\-]*)(?![\p{L}\d]))?/giu)) {
    if (!free(m.index!, m.index! + m[0].length)) continue;
    const w1 = m[2]!, w2 = m[3];
    const ok = (w: string | undefined) => !!w && (isKnownTerm(w) || isCountNoun(w) || NOT_SUBJECT.test(w) || PART_NOUN.test(w) || isSightWord(w));
    if (ok(w1) || (/^[\p{Ll}]/u.test(w1) && ok(w2))) continue;
    const c = closestTerm(w1);
    if (!c || (reading && c.entry.key === reading.key)) continue;
    return { token: w1, count: +m[1]!, ...ersatzOf(w1) };
  }
  // ohne Anzahl (C1): nur wenn nichts Gesehenes erkannt ist – das erste Wort an der Stelle des Gesehenen (nach dem Melder,
  // gewöhnliche Wörter übersprungen) nahe an einem Zeichenbegriff; sonst nichts (nie ein Wort mitten im Satz raten)
  if (o.ohneAnzahl && !reading) {
    const ab = skip.length ? Math.min(...skip.map(([x]) => x)) : 0;
    const start = ab <= 3 ? Math.max(...skip.filter(([x]) => x === ab).map(([, y]) => y)) : 0;
    // nur bis zum ersten Komma/Strichpunkt nach dem ersten Wort («H01 alles ruhig, keine Bewegung» prüft nur «alles ruhig»)
    const vorn = text.slice(start).replace(/^[\s:,;.–-]+/, (x) => " ".repeat(x.length));
    const ende = vorn.search(/[,;]/);
    for (const m of (ende < 0 ? vorn : vorn.slice(0, ende)).matchAll(/(?<![\p{L}\d'’.:])([\p{L}][\p{L}\-]*)(?![\p{L}\d])/gu)) {
      const i = start + m.index!;
      if (!free(i, i + m[0].length)) continue;
      const w = m[1]!;
      if (w.length < 4 || COMMON_WORD.test(w) || OWN_POS_RE.test(w)) continue;
      if (isKnownTerm(w) || isCountNoun(w) || NOT_SUBJECT.test(w) || PART_NOUN.test(w) || isSightWord(w)) break;
      const c = ersatzOf(w);
      if (c) return { token: w, ...c };
      break;
    }
  }
  return undefined;
}
