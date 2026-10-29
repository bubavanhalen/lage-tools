/**
 * Text für die jsPDF-Standardschriften (Helvetica/Times/Courier, Kodierung WinAnsi = cp1252): Zeichen ohne Glyphe
 * ergeben im PDF Zeichensalat («N!”S» statt «N↔S»). `winAnsi` ersetzt Pfeile und Zeichen durch Klartext
 * («→» = «nach», «↑» = «Rtg N», «≥» = «mind.») und lässt danach kein Zeichen ausserhalb WinAnsi übrig.
 * `safePdf(doc)` hängt das an `text` und `splitTextToSize` eines Dokuments – so gilt es für alle PDF-Texte
 * (Journal, Anhang Lage Rot, Anhang Hinweise, Rasterdruck), auch für Meldungstexte der Benutzer.
 */
import type { jsPDF } from "jspdf";

/** cp1252 0x80–0x9F (belegte Stellen) */
const CP1252_HIGH = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/** liegt das Zeichen in WinAnsi (druckbar, inkl. Zeilenumbruch/Tab)? */
export function isWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  if (c === 9 || c === 10 || c === 13) return true;
  if (c >= 0x20 && c <= 0x7e) return true;
  if (c >= 0xa0 && c <= 0xff) return true;
  return CP1252_HIGH.includes(ch);
}

/** Ersetzungen in dieser Reihenfolge (Klartext statt Zeichen) */
const REPL: Array<[RegExp, string]> = [
  // Pfeile
  [/\s*(?:→|⇒|➔|➜|⟶)\s*/g, " nach "],
  [/\s*(?:←|⇐|⟵)\s*/g, " von "],
  [/([A-Za-zÄÖÜäöü0-9])↔([A-Za-zÄÖÜäöü0-9])/g, "$1–$2"],
  [/\s*(?:↔|⇔|⟷)\s*/g, " – "],
  [/↑\s*/g, "Rtg N "], [/↓\s*/g, "Rtg S "], [/↗\s*/g, "Rtg NO "], [/↘\s*/g, "Rtg SO "], [/↙\s*/g, "Rtg SW "], [/↖\s*/g, "Rtg NW "],
  [/[↶↺⟲]\s*/g, ""], [/[↻⟳]\s*/g, ""],
  // Zeichen der Oberfläche
  [/✓\s*/g, "+ "], [/[✗✕]\s*/g, "x "], [/○\s*/g, "o "], [/⚠\s*/g, "! "], [/[⛔ⓘ✎📍⏎⌕☰⌘⌫]\s*/g, ""],
  [/[◆◇■▪▲▴▶▸▾●◎❚━⋯✛⤓♪]\s*/g, ""],
  // Mathematik / Masse
  [/(\d)\s*′/g, "$1 min"], [/′/g, "'"], [/″/g, "\""],
  [/≈\s*/g, "ca. "], [/≥\s*/g, "mind. "], [/≤\s*/g, "höchstens "], [/≠\s*/g, "nicht "], [/−/g, "-"], [/√/g, "Wurzel "],
  [/∧/g, " und "], [/⌀\s*/g, "Durchmesser "], [/⅔/g, "2/3"], [/ﬁ/g, "fi"], [/ﬂ/g, "fl"], [/ẞ/g, "SS"],
  // Leerzeichen / Anführungszeichen
  [/[\u202F\u2009\u2007\u2002\u2003]/g, " "], [/[\u200B-\u200D\u2060\uFEFF]/g, ""], [/[‹›]/g, "'"], [/[„“]/g, "\""],
];

/** Text WinAnsi-sicher machen (siehe oben); Zeichen ohne Ersatz fallen weg */
export function winAnsi(s: string): string {
  let t = s.normalize("NFC");
  for (const [re, by] of REPL) t = t.replace(re, by);
  let out = "";
  for (const ch of t) {
    if (isWinAnsi(ch)) { out += ch; continue; }
    // Akzente zerlegen und Grundbuchstaben behalten («ı» → «i», «Ł» bleibt sonst weg)
    const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (base && [...base].every(isWinAnsi)) out += base;
    else if (ch === "ı") out += "i";
  }
  return out;
}

const deep = (v: unknown): unknown => (typeof v === "string" ? winAnsi(v) : Array.isArray(v) ? v.map(deep) : v);

/** `text` und `splitTextToSize` des Dokuments machen jeden Text WinAnsi-sicher (einmal je Dokument) */
export function safePdf<T extends jsPDF>(doc: T): T {
  const d = doc as T & { __winAnsi?: boolean };
  if (d.__winAnsi) return doc;
  d.__winAnsi = true;
  const text = doc.text.bind(doc);
  const split = doc.splitTextToSize.bind(doc);
  (doc as { text: unknown }).text = (t: unknown, ...rest: unknown[]) => (text as (...a: unknown[]) => jsPDF)(deep(t), ...rest);
  (doc as { splitTextToSize: unknown }).splitTextToSize = (t: unknown, ...rest: unknown[]) => (split as (...a: unknown[]) => unknown)(deep(t), ...rest);
  return doc;
}
