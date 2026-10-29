/**
 * Eintragsarten im Journal (Spez. MVP 3, Kap. 3.1): Meldung · Auftrag · Orientierung · Rückfrage ·
 * Verbindungskontrolle · Notiz. Nur «Meldung» zeichnet auf der Karte und zählt für Hinweise und Kräfte Rot (Invariante
 * E3: Nicht-Meldungen haben nie pos/unit/cells/nai/shape und tragen `notiz: true`, damit die MVP-1-App sie als
 * «Notiz» zeigt).
 *
 * Phase 0: Verträge mit einer ersten, getesteten Erkennung (`readArt`). Paket A baut die Erkennung nach Kap. 3.1 und
 * 8.1 aus und verdrahtet sie in `parseMeldung`. Kein Import aus journal.ts (journal.ts wird arten.ts importieren).
 */
import { catalogEntry, isTacticalWord, readTactical } from "./catalog";
import { QUITTUNG_ART } from "./entscheide";
import type { EntryArt, LageEvent } from "./model";

/** Art eines Eintrags; alte Einträge ohne `art`: «notiz» wenn `notiz === true`, sonst «meldung» */
export function artOf(e: Pick<LageEvent, "art" | "notiz">): EntryArt {
  return e.art ?? (e.notiz ? "notiz" : "meldung");
}

/** zählt als Lage (Karte, Hinweise, Kräfte): Art Meldung, nicht gestrichen, keine Aufhebung */
export function isLage(e: Pick<LageEvent, "art" | "notiz" | "deleted" | "hebtAuf">): boolean {
  return !e.deleted && !e.hebtAuf && artOf(e) === "meldung";
}

/**
 * Trupp, für den der Eintrag ein Lebenszeichen ist: Melder einer Meldung, einer Rückfrage, einer Quittung bzw. einer
 * Verbindungskontrolle (ausser Ergebnis «keine»); sonst null. Gestrichene zählen nicht.
 */
export function lebenszeichen(e: LageEvent): string | null {
  if (e.deleted) return null;
  const m = (e.melder ?? "").trim();
  if (!m) return null;
  switch (artOf(e)) {
    case "meldung": return m;
    case "rueckfrage": return m;
    case "vbk": return e.vbk === "keine" ? null : m;
    // Quittung; Antwort (Entscheid MVP 3 Nachbesserung: übernimmt den Trupp der Rückfrage = Lebenszeichen)
    case "notiz": return e.bezugArt === "quittung" || e.bezugArt === "antwort" ? m : null;
    default: return null;
  }
}

export const ART_LABEL: Record<EntryArt, string> = {
  meldung: "Meldung",
  auftrag: "Auftrag",
  orientierung: "Orientierung",
  rueckfrage: "Rückfrage",
  vbk: "Verbindungskontrolle",
  notiz: "Notiz",
};

/** «Eigene», «Feind», «Unklar» wie `kindLabel` (journal.ts) – hier ohne Import, damit es keinen Kreis gibt */
function lageWort(e: Pick<LageEvent, "side" | "aff">): string {
  if (e.side === "blau") return "Eigene";
  if (e.side === "ul") return "UL";
  return e.aff === "U" ? "Unklar" : e.aff === "N" ? "Neutral" : "Feind";
}

const VBK_WORT: Record<NonNullable<LageEvent["vbk"]>, string> = { gut: "gut", schlecht: "schlecht", keine: "keine" };

/**
 * «Auftrag an H01», «Orientierung Bat», «Rückfrage von H04», «Verbindung H02 gut», «Antwort von H05», «Antwort an H04»,
 * «Notiz»; Meldung → wie `kindLabel` («Aufhebung» bei `hebtAuf`)
 */
export function artText(e: LageEvent): string {
  switch (artOf(e)) {
    case "meldung": return e.notiz ? "Notiz" : e.hebtAuf ? "Aufhebung" : lageWort(e);
    case "auftrag": return e.an ? `Auftrag an ${e.an}` : "Auftrag";
    case "orientierung": return e.quelle ? `Orientierung ${e.quelle}` : "Orientierung";
    case "rueckfrage": return e.an ? `Rückfrage an ${e.an}` : e.melder ? `Rückfrage von ${e.melder}` : "Rückfrage";
    case "vbk": return ["Verbindung", e.melder, e.vbk ? VBK_WORT[e.vbk] : ""].filter(Boolean).join(" ");
    case "notiz": return e.bezugArt === "antwort" ? (e.an ? `Antwort an ${e.an}` : e.melder ? `Antwort von ${e.melder}` : "Antwort") : "Notiz";
  }
}

export interface ArtLesung {
  art: EntryArt;
  /** starker Hinweis (grün) oder schwacher (gelb); bei «meldung» immer true */
  stark: boolean;
  /** Textstelle des Hinweises (zum Hervorheben) */
  token?: string;
  an?: string;
  quelle?: string;
  /** Frist «hhmm» */
  frist?: string;
  vbk?: LageEvent["vbk"];
  /** «zu 42», «Antwort 57» → Nummer wie geschrieben («42», «12a» bei doppelter Nummer) */
  bezugNr?: string;
  bezugArt?: LageEvent["bezugArt"];
  /** Textstelle des Bezugs («Antwort zu 57», «zu 42») – parseMeldung liest die Meldung ohne sie */
  bezugToken?: string;
  /** Text ohne Art-Hinweis (für die weitere Erkennung) */
  rest: string;
}

/** Element-Namen («H01», «Det 2», «Zug 1», «Kp», …) – für Empfänger/Absender */
const EL = String.raw`(?:H\d{1,3}|Det\.?\s?\d{1,2}|Zug\s?\d{1,2}|Gr\.?\s?\d{1,2}|Trp\.?\s?\d{1,2}|Pat\.?\s?\d{1,2}|Zfhr|Kdt|Kp|Bat|LVZ)`;
const L = "[\\p{L}\\d]";
const re = (s: string, f = "iu") => new RegExp(s, f);

/** «H1» → «H01» in der Schreibweise der Übung, sonst unverändert (Leerzeichen vereinheitlicht) */
function unitName(raw: string, blau: string[]): string {
  const u = raw.replace(/\.\s?|\s+/g, " ").trim();
  const flat = (s: string) => s.toLowerCase().replace(/[\s.]/g, "").replace(/(\D)0+(\d)/g, "$1$2");
  return blau.find((b) => flat(b) === flat(u)) ?? u;
}

const FRIST_RE = re(String.raw`(?<!${L})bis\s+(\d{1,2})[:.]?(\d{2})(?!${L})`);
/**
 * Bezug auf eine Nummer: «Antwort zu/auf 42» und «Quittung 42» überall; «zu 42», «Nr 42», «Bezug 42» nur am Anfang
 * (bzw. nach dem Melder) oder mit Doppelpunkt danach – sonst wäre «fährt zu 2 Häusern» ein Bezug (nie still falsch).
 */
const NRW = String.raw`(?:nr\.?\s*)?(\d{1,4}[a-z]?)(?!${L})`;
const BEZUG_RES = [
  re(String.raw`(?<!${L})(?:antwort|rückfrage|rueckfrage)\s+(?:zu|auf)\s+${NRW}`),
  re(String.raw`(?<!${L})(?:quittung|quittiert)\s+(?:zu\s+|für\s+)?(?:auftrag\s+)?${NRW}`),
  re(String.raw`^(?:(?:${EL})\s*[:,]?\s+)?(?:zu|bezug|nr\.?)\s*${NRW}`),
  re(String.raw`(?<!${L})(?:zu|bezug)\s+${NRW}\s*:`),
];
/** «Antwort: …», «H05 Antwort: …», «Antwort an H02: …» (Empfänger in Gruppe 1) */
const ANTWORT_RE = re(String.raw`^(?:(?:${EL})\s*[:,]?\s+)?antwort(?:\s+an\s+(${EL}))?(?!${L})\s*[:,]?`);
/** Absender von oben am Anfang (Entscheid: mit oder ohne Doppelpunkt): «Bat …», «Kp: …», «Kdt …», «Rgt …», «Br …» */
const OBEN_RE = re(String.raw`^(bat|kp|kdt|rgt|br)\.?(?!${L})\s*[:,]?\s*(?=\S)`);
/** Trupp-ähnliche Empfänger für «Auftrag H02 …» ohne «an» (nicht Kp/Bat/LVZ) */
const TRUPP = String.raw`(?:H\d{1,3}|Det\.?\s?\d{1,2}|Zug\s?\d{1,2}|Gr\.?\s?\d{1,2}|Trp\.?\s?\d{1,2}|Pat\.?\s?\d{1,2})`;
/**
 * Schwache Rückfrage ohne «?» (Entscheid: gelb «Rückfrage?»): «… bekannt» am Ende, «bestätigen», «wo ist/sind/steht …»
 */
const RUECKFRAGE_SCHWACH_RE = re(String.raw`(?<!${L})(?:bestätigen|bitte\s+bestätigen|wo\s+(?:ist|sind|steht|stehen|befindet|befinden)|bekannt(?=\s*[.!]?\s*$))(?!${L})`);
/** Tag und Zeit am Anfang («T2 0715 », «07:15 »): gehören nicht zum Art-Hinweis (Zeit liest parseMeldung) */
const LEAD_TIME_RE = re(String.raw`^(?:T\s?\d(?!\d)[\s,:]*)?(?:(?:[01]?\d|2[0-3])[:.h]?[0-5]\d(?:\s*uhr)?(?![\d'’]))?[\s,:]*`);

/** Wort nach «Kp»/«Bat» macht daraus eine Stufe: Kampf-/Unterstützungstruppe, Fahrzeug, Gefechtsstand (nicht Versorgung, San …) */
function stufeVor(word: string): boolean {
  if (!word || !isTacticalWord(word, ["e"])) return false;
  const k = readTactical(`1 ${word}`, {})?.key;
  const c = k ? catalogEntry(k) : undefined;
  return !!c && (c.key === "kdo_po" || (c.category !== "Führung und Logistik" && (c.kind === "einheit" || c.kind === "geraet")));
}

/** Frist «bis 1200» → «1200» (Stunde gültig) */
function fristOf(text: string): { frist?: string; token?: string } {
  const m = FRIST_RE.exec(text);
  if (!m || +m[1]! > 23 || +m[2]! > 59) return {};
  return { frist: `${m[1]!.padStart(2, "0")}${m[2]}`, token: m[0] };
}

/** Bezug «zu 42», «Antwort auf 12a», «Nr 42», «Quittung 42» → Nummer wie geschrieben (Endung klein) und Textstelle */
function bezugOf(text: string): { bezugNr?: string; bezugToken?: string } {
  for (const r of BEZUG_RES) {
    const m = r.exec(text);
    if (m) return { bezugNr: m[1]!.toLowerCase(), bezugToken: m[0].trim() };
  }
  return {};
}

const cut = (text: string, m: RegExpExecArray) => (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/\s+/g, " ").replace(/^[\s,:;–-]+/, "").trim();

/**
 * Art aus dem Text lesen (Kap. 3.1, Reihenfolge = Vorrang): Auftrag · Rückfrage · Orientierung · Verbindungskontrolle ·
 * Notiz · Meldung. Starke Hinweise stehen am Anfang (bzw. nach dem Melder), schwache irgendwo («befohlen», «?» am Ende).
 * `o.blau` = eigene Trupps der Übung (Schreibweise «H01»). Reine Funktion; Zeiten und Orte liest `parseMeldung`.
 */
export function readArt(text: string, o: { blau: string[] }): ArtLesung {
  const t = text.trim().replace(LEAD_TIME_RE, "");
  const lead = String.raw`^(?:(${EL})\s*[:,]?\s+)?`;
  const L0 = String.raw`^(?:${EL}\s*[:,]?\s+)?`;
  const bez = bezugOf(t);

  // ---- Auftrag
  // L0: optional ein Element davor («H04 Auftrag an H01 …» – Trupp-Knopf setzt den Trupp vorne ein)
  let m = re(String.raw`${L0}(?:auftrag|befehl)\s+(?:an|für)\s+(${EL})(?!${L})\s*[:,]?`).exec(t);
  if (m) return { art: "auftrag", stark: true, token: m[0].trim(), an: unitName(m[1]!, o.blau), ...fristOf(t), rest: cut(t, m) };
  // «Auftrag H02 Beo NAI 1» (ohne «an»): Auftrag an H02 – verschiebt H02 nicht
  m = re(String.raw`${L0}(?:auftrag|befehl)\s+(${TRUPP})(?!${L})\s*[:,]?`).exec(t);
  if (m) return { art: "auftrag", stark: true, token: m[0].trim(), an: unitName(m[1]!, o.blau), ...fristOf(t), rest: cut(t, m) };
  m = re(String.raw`${L0}auftrag\s*:`).exec(t);
  if (m) return { art: "auftrag", stark: true, token: m[0].trim(), ...fristOf(t), rest: cut(t, m) };
  m = re(String.raw`^(${EL})\s+erhält\s+(?:den\s+|einen\s+)?auftrag(?!${L})\s*[:,]?`).exec(t);
  if (m) return { art: "auftrag", stark: true, token: m[0].trim(), an: unitName(m[1]!, o.blau), ...fristOf(t), rest: cut(t, m) };
  // ausgeführt / erledigt bleibt Meldung (setzt später den Bezug auf den offenen Auftrag dieses Trupps)
  m = re(String.raw`(?<!${L})auftrag\s+(?:ausgeführt|erledigt|erfüllt)(?!${L})`).exec(t);
  if (m) return { art: "meldung", stark: true, token: m[0], bezugArt: "ausgefuehrt", ...bez, rest: t };
  m = re(String.raw`(?<!${L})(befohlen|befehl\s+erhalten)(?!${L})`).exec(t);
  if (m) {
    const an = re(String.raw`^(${EL})(?!${L})`).exec(t)?.[1];
    return { art: "auftrag", stark: false, token: m[0], ...(an ? { an: unitName(an, o.blau) } : {}), ...fristOf(t), rest: t };
  }

  // ---- Rückfrage
  m = re(String.raw`${lead}(?:rückfrage|rueckfrage|anfrage)(?:\s+an\s+(${EL}))?(?!${L})\s*[:,]?`).exec(t);
  if (m) return { art: "rueckfrage", stark: true, token: m[0].trim(), ...(m[2] ? { an: unitName(m[2], o.blau) } : {}), rest: cut(t, m) };
  m = re(String.raw`${lead}frage\s+an\s+(${EL})(?!${L})\s*[:,]?`).exec(t);
  if (m) return { art: "rueckfrage", stark: true, token: m[0].trim(), an: unitName(m[2]!, o.blau), rest: cut(t, m) };
  // «H03 Frage: Ablösung wann» – schwach (gelb), wie MVP 1
  m = re(String.raw`${lead}frage\s*:`).exec(t);
  if (m) return { art: "rueckfrage", stark: false, token: m[0].trim(), rest: t };

  // ---- Orientierung (von oben)
  m = re(String.raw`${L0}(bat|kp|kdt|s2|rgt|ori|orientierung)\s*:`).exec(t);
  if (m) {
    const q = m[1]!.toLowerCase();
    const quelle = q === "ori" || q === "orientierung" ? undefined : q === "s2" ? "S2" : q[0]!.toUpperCase() + q.slice(1);
    return { art: "orientierung", stark: true, token: m[0].trim(), ...(quelle ? { quelle } : {}), rest: cut(t, m) };
  }
  // «Bat Lagerapport 1800», «Kp Verpflegung 1200» (ohne Doppelpunkt, ganz am Anfang bzw. nach der Zeit)
  m = OBEN_RE.exec(t);
  // ohne Doppelpunkt nicht vor einer Truppengattung/einem Gefechtsstand: «Kp Gfs», «Kp Pz», «Kp Inf» = Stufe (Sichtung)
  if (m && !/[:,]/.test(m[0]) && stufeVor(/^[\p{L}][\p{L}\d-]*/u.exec(t.slice(m[0].length))?.[0] ?? "")) m = null;
  if (m) { const q = m[1]!.toLowerCase(); return { art: "orientierung", stark: true, token: m[0].trim(), quelle: q[0]!.toUpperCase() + q.slice(1), rest: cut(t, m) }; }
  m = re(String.raw`${L0}orientierung\s+(?:von\s+)?(${EL})(?!${L})\s*[:,]?`).exec(t);
  if (m) return { art: "orientierung", stark: true, token: m[0].trim(), quelle: unitName(m[1]!, o.blau), rest: cut(t, m) };
  m = re(String.raw`${L0}info\s+(bat|kp)(?!${L})\s*[:,]?`).exec(t);
  if (m) return { art: "orientierung", stark: true, token: m[0].trim(), quelle: m[1]![0]!.toUpperCase() + m[1]!.slice(1).toLowerCase(), rest: cut(t, m) };

  // ---- Verbindungskontrolle
  m = re(String.raw`(?<!${L})keine\s+verbindung(?:\s+(?:mit|zu)\s+(${EL}))?(?!${L})`).exec(t);
  if (m) return { art: "vbk", stark: true, token: m[0], vbk: "keine", ...(m[1] ? { an: unitName(m[1], o.blau) } : {}), rest: cut(t, m) };
  m = re(String.raw`(?<!${L})(vbk|vk|verbindungskontrolle|funkcheck|sprechprobe|verbindung)(?!${L})`).exec(t);
  // «Verbindung gut», «Verbindung H03 keine», «Verbindung mit H02 schlecht»
  if (m && (m[1]!.toLowerCase() !== "verbindung" || re(String.raw`verbindung\s+(?:(?:mit|zu)\s+)?(?:${EL}\s+)?(gut|i\.?\s?o\.?|schlecht|keine|schwach)`).test(t))) {
    const after = t.slice(m.index + m[0].length);
    const vbk: LageEvent["vbk"] = re(String.raw`(?<!${L})(keine|nicht)(?!${L})`).test(after) ? "keine"
      : re(String.raw`(?<!${L})(schlecht|schwach|verrauscht|unverständlich)`).test(after) ? "schlecht" : "gut";
    return { art: "vbk", stark: true, token: m[0], vbk, rest: cut(t, m) };
  }

  // ---- Notiz (Quittung: Annahme A2, `QUITTUNG_ART`)
  m = re(String.raw`${L0}(?:notiz|nb|bem)\s*:`).exec(t);
  if (m) return { art: "notiz", stark: true, token: m[0].trim(), ...bez, rest: cut(t, m) };
  m = re(String.raw`(?<!${L})(?:quittung|quittiert)(?!${L})`).exec(t);
  if (m) return { art: QUITTUNG_ART, stark: true, token: m[0], bezugArt: "quittung", ...bez, rest: cut(t, m) };

  // ---- Antwort (Entscheid MVP 3 Nachbesserung): standardmässig Notiz mit Bezug – kein Zeichen, keine Feind-Zählung. Eine
  // Meldung wird sie nur, wenn Feind/Eigene/Unklar gewählt ist (`ctx.art = "meldung"`). Mit Nummer «Antwort zu 57: …»,
  // ohne Nummer «H04 Antwort: …» / «Antwort an H02: …» (→ jüngste offene Rückfrage des Trupps)
  const an0 = ANTWORT_RE.exec(t);
  if (an0) {
    const tok = bez.bezugNr ? bez : { bezugToken: an0[0].trim().replace(new RegExp(String.raw`^${EL}\s*[:,]?\s*`, "iu"), "") };
    return { art: "notiz", stark: true, token: an0[0].trim(), bezugArt: "antwort", ...tok, ...(an0[1] ? { an: unitName(an0[1], o.blau) } : {}), rest: cut(t, an0).replace(bez.bezugToken ? new RegExp(String.raw`^(?:zu|auf)\s+(?:nr\.?\s*)?\d{1,4}[a-z]?\s*[:,]?\s*`, "iu") : /^$/, "").trim() };
  }
  // «… Antwort zu 57 …» mitten im Text: ebenso Notiz mit Bezug
  if (bez.bezugToken && /^antwort/i.test(bez.bezugToken)) return { art: "notiz", stark: true, token: bez.bezugToken, bezugArt: "antwort", ...bez, rest: t.replace(bez.bezugToken, " ").replace(/\s+/g, " ").replace(/^[\s,:;–-]+/, "").trim() };

  // ---- Rückfrage schwach: Frage am Ende; «… bekannt», «bestätigen», «wo ist …» ohne «?»
  if (/\?\s*$/.test(t)) return { art: "rueckfrage", stark: false, token: "?", rest: t.replace(/\?\s*$/, "").trim() };
  m = RUECKFRAGE_SCHWACH_RE.exec(t);
  if (m) return { art: "rueckfrage", stark: false, token: m[0], rest: t };

  // ---- Meldung (mit Verweis «zu 42: …», «Nr 42 …», «Rückfrage zu 57» mitten im Text)
  const antwort = bez.bezugToken && /^(?:rückfrage|rueckfrage)/i.test(bez.bezugToken);
  return { art: "meldung", stark: true, ...bez, ...(bez.bezugNr ? { bezugArt: antwort ? "antwort" : "verweis" } : {}), rest: t };
}

const DRINGEND_RE = re(String.raw`(?<!${L})(dringend|sofort|eilt)(?!${L})|!!|(?<!${L})kontakt\s*!|(?<!${L})feuer\s+(?:auf|aus)(?!${L})|(?<!${L})san(?:ität)?\s+(?:angefordert|benötigt)(?!${L})`);
const VERLETZT_RE = re(String.raw`(?<!${L})(verwundet\p{L}*|verletzt\p{L}*|tot|tote[nr]?)(?!${L})`);

/**
 * Dringend vorbelegen (nur Vorschlag, Kap. 3.1): «dringend», «sofort», «eilt», «!!», «Kontakt!», «Feuer auf/aus»,
 * «San angefordert»; «verwundet/verletzt/tot» nur mit eigenem Melder.
 */
export function istDringend(text: string, o: { eigenerMelder: boolean }): boolean {
  return DRINGEND_RE.test(text) || (o.eigenerMelder && VERLETZT_RE.test(text));
}
