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
    // (MVP 3.5 Fix, H2) Rückfrage von oben («Bat fragt: wo ist H01?»): der genannte Trupp ist Inhalt, nie Melder – auch
    // in früher gespeicherten Einträgen mit Melder
    case "rueckfrage": return e.quelle && !e.an ? null : m;
    // «H03 keine Verbindung zu H04»: H03 meldet (lebt), H04 ist betroffen (`an`)
    case "vbk": return e.vbk === "keine" ? (e.an && !sameName(e.an, m) ? m : null) : m;
    case "notiz":
      if (e.bezugArt === "quittung") return m;
      // Antwort: nur eine Antwort **vom** Trupp ist ein Lebenszeichen («H05 Antwort …», Rückfrage ging an den Trupp);
      // eine Antwort **an** den Trupp (Rückfrage kam vom Trupp, «Antwort an H02») nicht (MVP 3 Fix 3)
      if (e.bezugArt === "antwort") return e.an && sameName(e.an, m) ? null : m;
      return null;
    default: return null;
  }
}

const sameName = (a: string, b: string) => a.replace(/[\s.]/g, "").replace(/(\D)0+(\d)/g, "$1$2").toLowerCase() === b.replace(/[\s.]/g, "").replace(/(\D)0+(\d)/g, "$1$2").toLowerCase();

// ---------------------------------------------------------------------------------------------------------------------
// Unscharfe Schlüsselwörter (MVP 3 Fix 3): «Auftarg», «antwrt», «aufgehobn», «Auftr.» … werden erkannt, aber **immer nur
// gelb** («Auftrag gemeint? «Auftarg»») – ein unsicheres Wort setzt nie still ein Zeichen und verschiebt nie einen Trupp.
// ---------------------------------------------------------------------------------------------------------------------

/** ae/oe/ue → ä/ö/ü, klein, ohne Punkt am Ende («geraeumt» = «geräumt», «Auftr.» → «auftr») */
export function normWort(w: string): string {
  return w.toLowerCase().replace(/\.$/, "").replace(/ae/g, "ä").replace(/oe/g, "ö").replace(/ue/g, "ü");
}

/** Editierdistanz mit Vertauschung zweier Nachbarn (OSA): «auftarg» ↔ «auftrag» = 1 */
export function editDistanz(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * Wörter, die einem Schlüsselwort nahe sind, aber etwas anderes heissen – nie unscharf lesen («aufgebaut» ist das
 * Gegenteil von «abgebaut», «abgebogen» ist eine Bewegung).
 */
const ECHTE_WOERTER = new Set(["aufgebaut", "angebaut", "ausgebaut", "eingebaut", "umgebaut", "aufgezogen", "abgebogen", "ausgezogen", "angezogen", "eingezogen",
  "umgezogen", "aufgeboten", "aufgehalten", "abgeholt", "geräuschlos", "gesäumt", "geträumt", "entfernen", "entfernung", "entfernte", "entfernter", "entferntes",
  "antrag", "anträge", "vortrag", "beitrag", "betrag", "abtrag"]);

/**
 * Unscharfer Treffer eines Worts auf eines der Schlüsselwörter `keys` (klein, mit Umlauten): Editierdistanz ≤ 1 bei
 * 5–7 Zeichen, ≤ 2 ab 8 Zeichen («aufgehobn», «Auftarg», «antwrt», «gerämt»); Abkürzung = Anfang eines Schlüsselworts
 * mit mindestens `prefix` Zeichen («Auftr», «Antw», «aufgeh.»). Ein genauer Treffer ist kein unscharfer (null).
 */
export function unscharfTreffer(word: string, keys: readonly string[], o: { prefix?: number } = {}): string | null {
  const w = normWort(word);
  if (!/^[\p{L}]+$/u.test(w) || keys.includes(w) || ECHTE_WOERTER.has(w)) return null;
  const pre = o.prefix ?? 5;
  for (const k of keys) if (w.length >= pre && w.length < k.length && k.startsWith(w)) return k;
  if (w.length < 5) return null;
  const max = w.length >= 8 ? 2 : 1;
  let best: string | null = null, bd = max + 1;
  for (const k of keys) { const dd = editDistanz(w, k, max); if (dd < bd) { bd = dd; best = k; } }
  return bd <= max ? best : null;
}

export const ART_LABEL: Record<EntryArt, string> = {
  meldung: "Meldung",
  auftrag: "Auftrag",
  orientierung: "Orientierung",
  rueckfrage: "Rückfrage",
  vbk: "Verbindungskontrolle",
  notiz: "Notiz",
  /** MVP 3.5 (S17): Meldung, Weitermeldung oder Antwort nach oben – kein Zeichen */
  ausgang: "Ausgang",
};

/**
 * (MVP 3.5) Zeichen der Art in Liste und Vorschau: ✎ Auftrag, Orientierung, Rückfrage, Notiz · ⇄ Vbk · ↗ Ausgang ·
 * «» Meldung (Zeichen der Lage). Phase 0 fertig; Paket D/E zeigen es.
 */
export function artZeichen(a: EntryArt): string {
  return a === "meldung" ? "" : a === "vbk" ? "⇄" : a === "ausgang" ? "↗" : "✎";
}

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
    // (Fix M3) Auftrag von oben ohne Trupp: «Auftrag von Bat»
    case "auftrag": return e.an ? `Auftrag an ${e.an}` : e.quelle ? `Auftrag von ${e.quelle}` : "Auftrag";
    case "orientierung": return e.quelle ? `Orientierung ${e.quelle}` : "Orientierung";
    case "rueckfrage": return e.an ? `Rückfrage an ${e.an}` : e.quelle ? `Rückfrage von ${e.quelle}` : e.melder ? `Rückfrage von ${e.melder}` : "Rückfrage";
    case "vbk": return ["Verbindung", e.melder, e.vbk ? VBK_WORT[e.vbk] : ""].filter(Boolean).join(" ");
    case "notiz": return e.bezugArt === "antwort" ? (e.an ? `Antwort an ${e.an}` : e.melder ? `Antwort von ${e.melder}` : "Antwort") : "Notiz";
    // MVP 3.5 (Phase 0, Paket D baut aus): «Ausgang an Bat»
    case "ausgang": return e.an ? `Ausgang an ${e.an}` : "Ausgang";
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
  /** Bezug steht ganz am Anfang (nach dem Melder): «zu 57: ja» */
  bezugAnfang?: boolean;
  /**
   * (MVP 3 Fix 3) Art nur aus einem unscharfen Schlüsselwort («Auftarg», «antwrt», «Batt») – Textstelle wie geschrieben;
   * dann ist `stark` false (immer gelb «Auftrag gemeint? «Auftarg»»).
   */
  unscharf?: string;
  /** Text ohne Art-Hinweis (für die weitere Erkennung) */
  rest: string;
  /**
   * (MVP 3.5, D1.7) Meldung meldet «erledigt/ausgeführt» ohne das Wort «Auftrag» → Abschluss des offenen Auftrags an den
   * Melder vorschlagen (`bezugAufloesen`, lvz.ts).
   */
  abschluss?: boolean;
  /** (MVP 3.5 Fix, N) weitere Nummern («Nr 55 und 56 an Bat weitergemeldet» → bezugNr «55», bezugNrAuch ["56"]) */
  bezugNrAuch?: string[];
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
/** erstes Wort (nach einem Element): «H04 antwortet: …» → Element «H04», Wort «antwortet» */
const KOPF_RE = re(String.raw`^(?:(${EL})\s*[:,]?\s+)?([\p{L}]+\.?)(?![\p{L}\d])`);
/** «Antwort», «antwortet», «antworten» (genau) */
const ANTWORT_WORT_RE = /^antwort(?:e|et|en)?$/iu;
/**
 * Absender von oben am Anfang (Entscheid: mit oder ohne Doppelpunkt): «Bat …», «Kp: …», «Kdt …», «Rgt …», «Br …»; dazu
 * die richtigen Abkürzungen «Btl» (= Bat) und «Kdo» (MVP 3 Fix 3)
 */
const OBEN_RE = re(String.raw`^(bat|btl|kp|kdt|kdo|rgt|br)\.?(?!${L})\s*[:,]?\s*(?=\S)`);
/** Absender von oben, nur unscharf erkannt (gelb): «Batt …» (Bat? Batterie?) */
const OBEN_UNSCHARF_RE = re(String.raw`^(batt|bttl|batl|bataillion|batallion|bataillon)\.?(?!${L})\s*[:,]?\s*(?=\S)`);
/** «Btl» → «Bat», «Kdo» → «Kdo» */
const quelleOf = (q: string) => (q === "btl" || q.startsWith("bat") || q === "bttl" ? "Bat" : q === "s2" ? "S2" : q[0]!.toUpperCase() + q.slice(1));
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

// ---------------------------------------------------------------------------------------------------------------------
// MVP 3.5 (Spez. MVP 3.5, Kap. 3.4 D1): Auftrag und Rückfrage von oben, Ausgang nach oben, Quittung, Abschluss,
// Funkverbindung verloren. Laufen **vor** den bestehenden Regeln (Reihenfolge D1.1–D1.8).
// ---------------------------------------------------------------------------------------------------------------------

/** Absender bzw. Empfänger «oben» (nie ein eigener Trupp): Bat, Btl, Kp, Kdt, Rgt, Br, S2, Nachbar, «Kp 61/2» … */
const OBEN_Y = String.raw`(?:Kp\s?\d{1,3}\/\d{1,3}|Bat(?:aillon)?|Btl|Kp|Kdt|Kdo|Rgt|Br|S\s?[1-6]|Nachbar(?:\s+(?:links|rechts))?|Gfs)`;
/** Absender von oben am Anfang («Kp Kdt», «Bat», «S2») – Gruppe 1 */
const OBEN_ABS = String.raw`(?:Kp\s+)?(Kdt|Bat|Btl|Kp|Kdo|Rgt|Br|S\s?2)`;
/** Name von oben in der Schreibweise des Journals: «Btl»/«Bataillon» → «Bat», «S 2» → «S2», «kp 61/2» → «Kp 61/2» */
function obenName(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (/^(btl|bat)/i.test(s)) return "Bat";
  if (/^s\s?\d$/i.test(s)) return `S${s.slice(-1)}`;
  if (/^kp\s?\d/i.test(s)) return `Kp ${s.replace(/^kp\s?/i, "")}`;
  return s[0]!.toUpperCase() + s.slice(1).toLowerCase();
}
/** eigener Trupp: in den Trupps der Übung, ohne vorbereitete Trupps jedes «H…» */
function eigenerTrupp(raw: string, blau: string[]): boolean {
  return blau.length ? blau.some((b) => sameName(b, raw)) : /^H\d{1,3}$/i.test(raw.trim());
}
/** Tätigkeit eines Auftrags (D1.5): «Kdt: H05 sofort Stellungswechsel nach AR12» – Nennform/Hauptwort; «Bat: H02 verschiebt nach AL9» (Mitteilung) bleibt Orientierung */
const TAETIGKEIT_RE = re(String.raw`(?<!${L})(?:stellungswechsel|stellungsbezug|verschieben|verlegen|beo|beobachten|halten|überwachen|sperren|sichern|aufklären|erkunden|besetzen|beziehen|zurückziehen|rückzug|vorgehen|patrouillieren|kontrollieren|ablösen)(?!${L})`);
/** Quittung eines Trupps (D1.6): «H03 Auftrag erhalten», «H02 Verstanden», «H05 wird ausgeführt», «wilco» */
const QUITT_WORT_RE = re(String.raw`(?<!${L})(?:(?:auftrag|befehl)\s+erhalten|verstanden|wird\s+ausgeführt|wilco|roger)(?!${L})`, "giu");
/** Abschluss ohne das Wort «Auftrag» (D1.7) */
const ABSCHLUSS_RE = re(String.raw`(?<!${L})(?:erledigt|ausgeführt|erfüllt|abgeschlossen)(?!${L})`);
/** Bezug in einem Ausgang: «Nr 54», «zu 54», «zu Nr 54» */
const AUSGANG_NR_RE = re(String.raw`(?<!${L})(?:nr\.?\s*|zu\s+(?:nr\.?\s*)?)(\d{1,4}[a-z]?)(?!${L})`);

/** (Fix M3) Meldeauftrag von oben: Verb direkt nach dem Absender («Bat verlangt …», «Bat will wissen, …») */
const MA_VERB_RE = re(String.raw`^(?:verlangt|fordert|verlangen|will\s+wissen|möchte\s+wissen|wünscht|braucht|erwartet\s+(?:eine?\s+|die\s+)?(?:lage)?(?:meldung|bericht|antwort))(?!${L})`);
/** «… melden» als Auftrag («Standort H02 melden bis 0800»); nicht «gemeldet» */
const MELDEN_RE = re(String.raw`(?<!${L})(?:zu\s+)?melden(?!${L})`);
/** stehende Weisung («sofort melden», «laufend melden», «jede Sichtung melden») – ohne Frist kein Auftrag mit Abschluss */
const STEHEND_RE = re(String.raw`(?<!${L})(?:sofort|laufend|jede[nrs]?|alle|immer|stündlich|bei)(?!${L})`);

/** Absender von oben am Anfang wie bei der Orientierung (ohne Doppelpunkt nicht vor einer Truppengattung: «Kp Pz») */
function obenAm(t: string): { quelle: string; len: number } | null {
  const m = re(String.raw`^${OBEN_ABS}\.?(?!${L})\s*([:,])?\s*`).exec(t);
  if (!m) return null;
  const nach = /^[\p{L}][\p{L}\d-]*/u.exec(t.slice(m[0].length))?.[0] ?? "";
  if (!m[2] && (stufeVor(nach) || (/^kdo$/i.test(m[1]!) && /^(po|pos|posten|stao)$/i.test(nach)))) return null;
  return { quelle: obenName(m[1]!), len: m[0].length };
}

/** D1.1–D1.8 (null = keine der neuen Regeln trifft; dann gelten die bestehenden) */
function readArtOben(t: string, o: { blau: string[] }): ArtLesung | null {
  const blau = o.blau;
  // D1.1 «Kp Kdt: Auftrag an H03 …», «Bat: Befehl an H02 …», «Bat befiehlt: H02 Beo AK10 halten bis 1000»
  let m = re(String.raw`^${OBEN_ABS}\.?\s*[:,]?\s*(?:auftrag|befehl)\s+(?:an|für)\s+(${EL})(?!${L})\s*[:,]?`).exec(t);
  if (m && eigenerTrupp(m[2]!, blau)) return { art: "auftrag", stark: true, token: m[0].trim(), an: unitName(m[2]!, blau), quelle: obenName(m[1]!), ...fristOf(t), rest: cut(t, m) };
  m = re(String.raw`^${OBEN_ABS}\.?\s*(?:befiehlt|befahl)(?!${L})\s*[:,]?\s*(?:an\s+)?(${EL})(?!${L})\s*[:,]?`).exec(t);
  if (m && eigenerTrupp(m[2]!, blau)) return { art: "auftrag", stark: true, token: m[0].trim(), an: unitName(m[2]!, blau), quelle: obenName(m[1]!), ...fristOf(t), rest: cut(t, m) };
  // D1.2 «an H02: Stellungswechsel nach AH10 bis 0900», «An H01 Beo NAI 1» – nur am Anfang (nie «2 Fz fahren an H02 vorbei»)
  m = re(String.raw`^an\s+(${EL})(?!${L})\s*(?:[:,]\s*|\s+(?=\S))`).exec(t);
  if (m && eigenerTrupp(m[1]!, blau)) return { art: "auftrag", stark: true, token: m[0].trim(), an: unitName(m[1]!, blau), ...fristOf(t), rest: cut(t, m) };
  // D1.3 Ausgang nach oben: «Meldung an Bat: …», «An Bat: …», «Weitergemeldet an Bat: Nr 54», «Antwort an Bat: 2 Kpz»
  const ausgang = (mm: RegExpExecArray, y: string, antwort: boolean): ArtLesung => {
    const rest = cut(t, mm);
    const nr = AUSGANG_NR_RE.exec(rest);
    // (Fix N) weitere Nummern direkt dahinter: «Nr 55 und 56», «Nr 55, 56», «zu 55 + 56»
    const auch: string[] = [];
    if (nr) {
      const r = re(String.raw`^\s*(?:,|\+|&|und|sowie)\s*(?:nr\.?\s*)?(\d{1,4}[a-z]?)(?!${L})`);
      let pos = nr.index + nr[0].length;
      for (let x = r.exec(rest.slice(pos)); x; x = r.exec(rest.slice(pos))) { auch.push(x[1]!.toLowerCase()); pos += x[0].length; }
    }
    return {
      art: "ausgang", stark: true, token: mm[0].trim(), an: obenName(y),
      ...(nr ? { bezugNr: nr[1]!.toLowerCase(), bezugToken: nr[0].trim(), bezugArt: antwort ? "antwort" : "weiter" } : antwort ? { bezugArt: "antwort" } : {}),
      ...(auch.length ? { bezugNrAuch: auch } : {}),
      rest,
    };
  };
  m = re(String.raw`^(?:lvz\s*[:,]?\s*)?(meldung|lagemeldung|weitermeldung|lagebericht|antwort)\s+an\s+(${OBEN_Y})(?![\p{L}\d/])\s*[:,]?`).exec(t);
  if (m) return ausgang(m, m[2]!, /^antwort$/i.test(m[1]!));
  m = re(String.raw`^an\s+(${OBEN_Y})(?![\p{L}\d/])\s*[:,]`).exec(t);
  if (m) return ausgang(m, m[1]!, false);
  // (Fix M2) «An Bat gemeldet: H02 in AL9», «… an Bat übermittelt» – Ausgang, zeichnet nie
  m = re(String.raw`(?<!${L})(?:weiter(?:gemeldet|geleitet)|gemeldet)\s+an\s+(${OBEN_Y})(?![\p{L}\d/])\s*[:,]?`).exec(t)
    ?? re(String.raw`(?<!${L})an\s+(${OBEN_Y})\s+(?:weiter(?:gemeldet|geleitet)|gemeldet|übermittelt|durchgegeben)(?!${L})\s*[:,]?`).exec(t);
  if (m) return ausgang(m, m[1]!, false);
  // (Fix M2) Auftrag von oben ohne Trupp: «Auftrag Bat: Sperre AG13 halten bis 1000», «Bat Auftrag: …» – nie eine Sichtung
  m = re(String.raw`^(?:auftrag|befehl)\s+(?:von\s+|vom\s+)?${OBEN_ABS}\.?(?!${L})\s*[:,]?\s*`).exec(t)
    ?? re(String.raw`^${OBEN_ABS}\.?\s*[:,]?\s*(?:auftrag|befehl)(?!${L})\s*[:,]\s*`).exec(t);
  if (m) {
    const nach = t.slice(m[0].length);
    const xm = re(String.raw`^(?:an\s+)?(${EL})(?!${L})\s*[:,]?\s*`).exec(nach);
    const an = xm && eigenerTrupp(xm[1]!, blau) ? unitName(xm[1]!, blau) : undefined;
    return { art: "auftrag", stark: true, token: m[0].trim(), ...(an ? { an } : {}), quelle: obenName(m[1]!), ...fristOf(t), rest: cut(t, m) };
  }
  // D1.4 Rückfrage von oben: «Bat fragt: …», «Rückfrage Bat: …», «Rückfrage von Kdt: …», «Kdt: … ?»
  m = re(String.raw`^(?:rückfrage|rueckfrage|frage|anfrage)\s+(?:von\s+)?${OBEN_ABS}(?!${L})\s*[:,]`).exec(t);
  if (m) return { art: "rueckfrage", stark: true, token: m[0].trim(), quelle: obenName(m[1]!), rest: cut(t, m) };
  const ob = obenAm(t);
  if (ob) {
    const nach = t.slice(ob.len);
    const fm = re(String.raw`^(?:fragt(?:\s+an)?|frage|rückfrage|rueckfrage|anfrage)(?!${L})\s*[:,]?\s*`).exec(nach);
    if (fm) return { art: "rueckfrage", stark: true, token: t.slice(0, ob.len + fm[0].length).trim(), quelle: ob.quelle, rest: nach.slice(fm[0].length).trim() };
    if (/\?\s*$/.test(t) && /[:,]/.test(t.slice(0, ob.len))) return { art: "rueckfrage", stark: true, token: t.slice(0, ob.len).trim(), quelle: ob.quelle, rest: nach.replace(/\?\s*$/, "").trim() };
    // (Fix M3) Meldeauftrag von oben: «Bat verlangt Lagemeldung bis 0800», «Bat will wissen, …», «Bat: Standort H02 melden
    // bis 0800» → Auftrag von oben (ohne Empfänger-Trupp, Frist); ein genannter Trupp ist Inhalt. «sofort/laufend melden»
    // ohne Frist bleibt Orientierung (stehende Weisung)
    const verb = MA_VERB_RE.exec(nach);
    const melden = !verb && MELDEN_RE.test(nach) && (FRIST_RE.test(nach) || !STEHEND_RE.test(nach));
    if (verb || melden) return { art: "auftrag", stark: true, token: t.slice(0, ob.len + (verb?.[0].length ?? 0)).trim(), quelle: ob.quelle, ...fristOf(t), rest: nach.trim() };
    // D1.5 Absender von oben + eigener Trupp + Tätigkeit, ohne «Auftrag»: schwach (gelb «Auftrag an H05?»)
    const xm = re(String.raw`^(?:an\s+)?(${EL})(?!${L})\s*[:,]?\s*`).exec(nach);
    if (xm && eigenerTrupp(xm[1]!, blau) && TAETIGKEIT_RE.test(nach) && !re(String.raw`(?<!${L})(?:auftrag|befehl)`).test(nach)) {
      return { art: "auftrag", stark: false, token: t.slice(0, ob.len + xm[0].length).trim(), an: unitName(xm[1]!, blau), quelle: ob.quelle, ...fristOf(t), rest: t };
    }
  }
  // D1.6 Quittung eines Trupps ohne Ort/Sichtung: «H03 Auftrag erhalten», «H02 Verstanden» → Notiz, Bezug auf den Auftrag
  const kopf = re(String.raw`^(${EL})(?!${L})\s*[:,]?\s*`).exec(t);
  if (kopf && eigenerTrupp(kopf[1]!, blau)) {
    const nach = t.slice(kopf[0].length);
    QUITT_WORT_RE.lastIndex = 0;
    if (QUITT_WORT_RE.test(nach)) {
      QUITT_WORT_RE.lastIndex = 0;
      const uebrig = nach.replace(QUITT_WORT_RE, " ").replace(/(?<![\p{L}])(?:und|ok|danke|ist|wurde|hat)(?![\p{L}])/giu, " ").replace(/[\s,.;:!–-]+/g, "");
      if (!uebrig) return { art: QUITTUNG_ART, stark: true, token: nach.trim(), bezugArt: "quittung", rest: "" };
    }
    // D1.7 «H03 erledigt» (ohne «Auftrag»): bleibt Meldung, schlägt den Abschluss des offenen Auftrags vor (bezugAufloesen)
    if (ABSCHLUSS_RE.test(nach) && !re(String.raw`(?<!${L})(?:auftrag|befehl)`).test(nach)) {
      const bez = bezugOf(t);
      return { art: "meldung", stark: true, abschluss: true, ...bez, ...(bez.bezugNr ? { bezugArt: "ausgefuehrt" } : {}), rest: t };
    }
  }
  // D1.8 Funkverbindung verloren → Vbk «keine» mit diesem Trupp
  m = re(String.raw`(?<!${L})(?:funkkontakt|funkverbindung|verbindung)\s+verloren\s+(?:zu|mit)\s+(${EL})(?!${L})`).exec(t)
    ?? re(String.raw`(?<!${L})(?:funkkontakt|funkverbindung|verbindung)\s+(?:zu|mit)\s+(${EL})\s+(?:verloren|abgebrochen)(?!${L})`).exec(t)
    ?? re(String.raw`(?<!${L})keine\s+funkverbindung\s+(?:zu|mit)\s+(${EL})(?!${L})`).exec(t);
  if (m) return { art: "vbk", stark: true, token: m[0], vbk: "keine", an: unitName(m[1]!, blau), rest: cut(t, m) };
  return null;
}

/** D1.9 Art «Auftrag» gewählt, Text ohne Auftrag-Hinweis: «an H02» irgendwo im Text ist der Empfänger (nicht «An wen?») */
function anImText(t: string, blau: string[]): ArtLesung | null {
  const m = re(String.raw`(?<!${L})an\s+(${EL})(?!${L})`).exec(t);
  return m && eigenerTrupp(m[1]!, blau) ? { art: "auftrag", stark: true, token: m[0], an: unitName(m[1]!, blau), ...fristOf(t), rest: t } : null;
}

/** Text ohne die Stelle [a, b) (Satzzeichen am Anfang weg) */
const cutAt = (text: string, a: number, b: number) => (text.slice(0, a) + " " + text.slice(b)).replace(/\s+/g, " ").replace(/^[\s,:;–-]+/, "").trim();
const cut = (text: string, m: RegExpExecArray) => (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/\s+/g, " ").replace(/^[\s,:;–-]+/, "").trim();

/**
 * Art aus dem Text lesen (Kap. 3.1, Reihenfolge = Vorrang): Auftrag · Rückfrage · Orientierung · Verbindungskontrolle ·
 * Notiz · Meldung. Starke Hinweise stehen am Anfang (bzw. nach dem Melder), schwache irgendwo («befohlen», «?» am Ende).
 * `o.blau` = eigene Trupps der Übung (Schreibweise «H01»). Reine Funktion; Zeiten und Orte liest `parseMeldung`.
 * MVP 3.5 (D1): zuerst Auftrag/Rückfrage von oben, Ausgang, Quittung, Abschluss, Funkverbindung verloren (`readArtOben`);
 * `o.vorgabe` = gewählte Art («Auftrag» → «an H02» irgendwo ist der Empfänger, D1.9).
 */
export function readArt(text: string, o: { blau: string[]; vorgabe?: EntryArt }): ArtLesung {
  const t = text.trim().replace(LEAD_TIME_RE, "");
  const l = readArtOben(t, o) ?? readArtBisher(t, o);
  if (o.vorgabe === "auftrag" && l.art !== "auftrag") return anImText(t, o.blau) ?? l;
  return l;
}

/** Regeln aus MVP 3 (inkl. Nachbesserungen), nach den MVP-3.5-Regeln */
function readArtBisher(t: string, o: { blau: string[] }): ArtLesung {
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
  // unscharf («Auftarg an H03: …», «Auftr an H01», «Aufrag H02 …»): Auftrag, aber immer gelb – verschiebt nie einen Trupp
  const kopf = KOPF_RE.exec(t);
  if (kopf && unscharfTreffer(kopf[2]!, ["auftrag"])) {
    const after = t.slice(kopf[0].length);
    const mm = re(String.raw`^\s+(?:an|für)\s+(${EL})(?!${L})\s*[:,]?`).exec(after) ?? re(String.raw`^\s+(${TRUPP})(?!${L})\s*[:,]?`).exec(after) ?? /^\s*:/.exec(after);
    const end = kopf[0].length + (mm?.[0].length ?? 0);
    return {
      art: "auftrag", stark: false, unscharf: kopf[2]!, token: t.slice(0, end).trim(), ...(mm?.[1] ? { an: unitName(mm[1], o.blau) } : {}), ...fristOf(t),
      rest: cutAt(t, 0, end),
    };
  }
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
  m = re(String.raw`${L0}(bat|btl|kp|kdt|kdo|s2|rgt|ori|orientierung)\s*:`).exec(t);
  if (m) {
    const q = m[1]!.toLowerCase();
    const quelle = q === "ori" || q === "orientierung" ? undefined : quelleOf(q);
    return { art: "orientierung", stark: true, token: m[0].trim(), ...(quelle ? { quelle } : {}), rest: cut(t, m) };
  }
  // «Bat Lagerapport 1800», «Kp Verpflegung 1200» (ohne Doppelpunkt, ganz am Anfang bzw. nach der Zeit)
  m = OBEN_RE.exec(t);
  // ohne Doppelpunkt nicht vor einer Truppengattung/einem Gefechtsstand: «Kp Gfs», «Kp Pz», «Kp Inf», «Kdo Po» = Stufe/Zeichen
  const nach = (mm: RegExpExecArray | null) => (mm ? /^[\p{L}][\p{L}\d-]*/u.exec(t.slice(mm[0].length))?.[0] ?? "" : "");
  if (m && !/[:,]/.test(m[0]) && (stufeVor(nach(m)) || (/^kdo$/i.test(m[1]!) && /^(po|pos|posten|stao)$/i.test(nach(m))))) m = null;
  if (m) return { art: "orientierung", stark: true, token: m[0].trim(), quelle: quelleOf(m[1]!.toLowerCase()), rest: cut(t, m) };
  // unscharf «Batt: …» (Bat? Batterie?): Orientierung, aber gelb
  m = OBEN_UNSCHARF_RE.exec(t);
  if (m && !/^bataillon$/i.test(m[1]!) && !(!/[:,]/.test(m[0]) && stufeVor(nach(m)))) {
    return { art: "orientierung", stark: false, unscharf: m[1]!, token: m[0].trim(), quelle: "Bat", rest: cut(t, m) };
  }
  if (m) return { art: "orientierung", stark: true, token: m[0].trim(), quelle: "Bat", rest: cut(t, m) };
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
  // «antwortet», «Antwort 57: …» (Nummer mit Doppelpunkt); unscharf «Antw», «antwrt» (MVP 3 Fix 3): ebenso, aber gelb
  const k2 = KOPF_RE.exec(t);
  const aWort = k2?.[2] ?? "";
  const aUnscharf = k2 && !ANTWORT_WORT_RE.test(aWort) ? unscharfTreffer(aWort, ["antwort", "antwortet"], { prefix: 4 }) : null;
  if (k2 && (ANTWORT_WORT_RE.test(aWort) || aUnscharf)) {
    const start = k2[0].length - aWort.length;
    let pos = k2[0].length;
    const anM = re(String.raw`^\s+an\s+(${EL})(?!${L})`).exec(t.slice(pos));
    if (anM) pos += anM[0].length;
    const nrM = re(String.raw`^\s*[:,]?\s+(?:(?:zu|auf)\s+${NRW}|(?:nr\.?\s*)?(\d{1,4}[a-z]?)(?=\s*:))`).exec(t.slice(pos));
    if (nrM) pos += nrM[0].length;
    const span = t.slice(start, pos).trim();
    pos += /^\s*[:,]?/.exec(t.slice(pos))![0].length;
    const tok = nrM ? { bezugNr: (nrM[1] ?? nrM[2])!.toLowerCase(), bezugToken: span } : bez.bezugNr ? bez : { bezugToken: span };
    return {
      art: "notiz", stark: !aUnscharf, ...(aUnscharf ? { unscharf: aWort } : {}), token: t.slice(0, pos).trim(), bezugArt: "antwort", ...tok,
      ...(anM ? { an: unitName(anM[1]!, o.blau) } : {}), rest: t.slice(pos).replace(/^[\s,:;–-]+/, "").trim(),
    };
  }
  // «… Antwort zu 57 …» mitten im Text: ebenso Notiz mit Bezug
  if (bez.bezugToken && /^antwort/i.test(bez.bezugToken)) return { art: "notiz", stark: true, token: bez.bezugToken, bezugArt: "antwort", ...bez, rest: t.replace(bez.bezugToken, " ").replace(/\s+/g, " ").replace(/^[\s,:;–-]+/, "").trim() };

  // ---- Rückfrage schwach: Frage am Ende; «… bekannt», «bestätigen», «wo ist …» ohne «?»
  if (/\?\s*$/.test(t)) return { art: "rueckfrage", stark: false, token: "?", rest: t.replace(/\?\s*$/, "").trim() };
  m = RUECKFRAGE_SCHWACH_RE.exec(t);
  if (m) return { art: "rueckfrage", stark: false, token: m[0], rest: t };

  // ---- Meldung (mit Verweis «zu 42: …», «Nr 42 …», «Rückfrage zu 57» mitten im Text)
  const antwort = bez.bezugToken && /^(?:rückfrage|rueckfrage)/i.test(bez.bezugToken);
  // «zu 57: …» ganz am Anfang (nach dem Melder): parseMeldung liest das als Antwort, wenn Nr 57 eine Rückfrage ist
  const anfang = !!bez.bezugToken && t.slice(re(L0).exec(t)![0].length).toLowerCase().startsWith(bez.bezugToken.toLowerCase());
  return { art: "meldung", stark: true, ...bez, ...(bez.bezugNr ? { bezugArt: antwort ? "antwort" : "verweis" } : {}), ...(anfang ? { bezugAnfang: true } : {}), rest: t };
}

/** «ab sofort», «per sofort», «sofort melden» sind keine Dringlichkeit des Eintrags (MVP 3 Fix 3: «Kdt: ab sofort Funkstille») */
const SOFORT_NICHT_RE = re(String.raw`(?<!${L})(?:(?:ab|per)\s+sofort|sofort\s+(?:zu\s+)?melden)(?!${L})`, "giu");
const DRINGEND_RE = re(String.raw`(?<!${L})(dringend|sofort|eilt)(?!${L})|!!|(?<!${L})kontakt\s*!|(?<!${L})feuer\s+(?:auf|aus)(?!${L})|(?<!${L})san(?:ität)?\s+(?:angefordert|benötigt)(?!${L})`);
const VERLETZT_RE = re(String.raw`(?<!${L})(verwundet\p{L}*|verletzt\p{L}*|tot|tote[nr]?|gefallen\p{L}*)(?!${L})`);
/** (Fix N) Verluste beim Gegner («3 verwundete Feinde», «2 gegnerische Tote») sind nicht dringend für uns */
const FEIND_VERLUST_RE = re(String.raw`(?<!${L})(?:(?:verwundete?|verletzte?|tote?|gefallene?)\s+(?:feinde?n?|gegner\p{L}*)|(?:gegnerische?|feindliche?)\s+(?:verwundete|verletzte|tote|gefallene))(?!${L})`);

/**
 * Dringend vorbelegen (nur Vorschlag, Kap. 3.1): «dringend», «sofort», «eilt», «!!», «Kontakt!», «Feuer auf/aus»,
 * «San angefordert»; «verwundet/verletzt/tot» nur mit eigenem Melder. Nicht: «ab sofort», «per sofort», «sofort melden»
 * (Orientierung/Auftrag ab einem Zeitpunkt bzw. Anweisung, MVP 3 Fix 3).
 */
export function istDringend(text: string, o: { eigenerMelder: boolean }): boolean {
  const t = text.replace(SOFORT_NICHT_RE, " ");
  return DRINGEND_RE.test(t) || (o.eigenerMelder && VERLETZT_RE.test(t) && !FEIND_VERLUST_RE.test(t));
}
