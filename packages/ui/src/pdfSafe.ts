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
  // (MVP 3.5) am Zeilenanfang zeichnet `safePdf` Vektorzeichen; mitten im Text Klartext statt «+ »/«o »/«! »
  [/✓\s*/g, "ja "], [/[✗✕]\s*/g, "nein "], [/○\s*/g, ""], [/⚠\s*/g, "Achtung: "], [/[⛔ⓘ✎📍⏎⌕☰⌘⌫]\s*/g, ""],
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

// ---------- Vektorzeichen statt Ersatztext (Spez. MVP 3.5, Kap. 2.9, D8) ----------

export type GlyphArt = "punkt" | "haken" | "warn" | "kreuz";
export interface PdfBox { seite: number; x: number; y: number; w: number; h: number; pt: number; text: string }
export interface PdfFill { seite: number; x: number; y: number; w: number; h: number; farbe: string }
type Doc = jsPDF & { __winAnsi?: boolean; __zeilen?: string[]; __boxes?: PdfBox[]; __fills?: PdfFill[]; __glyphen?: Record<GlyphArt, number>; __roh?: { text: (...a: unknown[]) => jsPDF } };

/** Grösse eines Zeichens in mm zur aktuellen Schrift (Höhe der Grossbuchstaben ≈ 0.7 × Schriftgrösse) */
const emMm = (doc: jsPDF) => doc.getFontSize() / doc.internal.scaleFactor;
/** Platz, den ein Vektorzeichen vor dem Text braucht (mm) */
export const glyphBreite = (doc: jsPDF) => emMm(doc) * 0.95;
const zaehle = (doc: jsPDF, g: GlyphArt) => { const d = doc as Doc; if (d.__glyphen) d.__glyphen[g]++; };
/** Strichfarbe/-breite merken und nach dem Zeichnen zurück (jsPDF hat keinen Zustandsstapel für Strichbreite) */
function mitStift(doc: jsPDF, f: (s: number) => void): void {
  const lw = doc.getLineWidth();
  const draw = doc.getDrawColor();
  const fill = doc.getFillColor();
  const tc = doc.getTextColor();
  doc.setDrawColor(tc); doc.setFillColor(tc);
  f(emMm(doc));
  doc.setLineWidth(lw); doc.setDrawColor(draw); doc.setFillColor(fill);
}
/** Aufzählungspunkt • an der Grundlinie `y` (x = linker Rand des Zeichens) */
export function glyphPunkt(doc: jsPDF, x: number, y: number): void {
  mitStift(doc, (s) => { doc.circle(x + s * 0.3, y - s * 0.26, s * 0.13, "F"); });
  zaehle(doc, "punkt");
}
/** Haken ✓ */
export function glyphHaken(doc: jsPDF, x: number, y: number): void {
  mitStift(doc, (s) => { doc.setLineWidth(s * 0.09); doc.lines([[s * 0.2, s * 0.22], [s * 0.42, -s * 0.62]], x + s * 0.06, y - s * 0.3, [1, 1], "S"); });
  zaehle(doc, "haken");
}
/** Warnung ⚠ (Dreieck mit Ausrufezeichen) */
export function glyphWarn(doc: jsPDF, x: number, y: number): void {
  mitStift(doc, (s) => {
    doc.setLineWidth(s * 0.07);
    doc.triangle(x + s * 0.04, y + s * 0.02, x + s * 0.74, y + s * 0.02, x + s * 0.39, y - s * 0.66, "S");
    doc.setLineWidth(s * 0.09);
    doc.line(x + s * 0.39, y - s * 0.44, x + s * 0.39, y - s * 0.2);
    doc.circle(x + s * 0.39, y - s * 0.1, s * 0.045, "F");
  });
  zaehle(doc, "warn");
}
/** Kreuz ✗ */
export function glyphKreuz(doc: jsPDF, x: number, y: number): void {
  mitStift(doc, (s) => {
    doc.setLineWidth(s * 0.09);
    doc.line(x + s * 0.1, y - s * 0.58, x + s * 0.62, y - s * 0.02);
    doc.line(x + s * 0.62, y - s * 0.58, x + s * 0.1, y - s * 0.02);
  });
  zaehle(doc, "kreuz");
}
const GLYPH: Record<GlyphArt, (doc: jsPDF, x: number, y: number) => void> = { punkt: glyphPunkt, haken: glyphHaken, warn: glyphWarn, kreuz: glyphKreuz };
/** Zeichen am Zeilenanfang, die als Vektorzeichen gezeichnet werden («• », «✓ », «⚠ », «✗ ») */
const GLYPH_ANFANG = /^\s*([•✓✔⚠✗✕])\s*/u;
const glyphVon = (c: string): GlyphArt => (c === "•" ? "punkt" : c === "✓" || c === "✔" ? "haken" : c === "⚠" ? "warn" : "kreuz");

/** Vektorzeichen `g` vor dem Text zeichnen und den Text dahinter setzen (eine oder mehrere Zeilen, hängend eingerückt) */
export function textMitGlyph(doc: jsPDF, g: GlyphArt, t: string | string[], x: number, y: number, o?: Record<string, unknown>): void {
  GLYPH[g](doc, x, y);
  doc.text(t, x + glyphBreite(doc), y, o);
}

/** Textbox einer `text`-Ausgabe (mm): Grundlinie `y`, Ausrichtung, mehrere Zeilen mit dem Zeilenabstand der Schrift */
function boxOf(doc: jsPDF, lines: string[], x: number, y: number, o: Record<string, unknown> | undefined): PdfBox | null {
  if (!lines.length || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const em = emMm(doc);
  const lh = em * (typeof o?.lineHeightFactor === "number" ? o.lineHeightFactor : doc.getLineHeightFactor());
  const w = Math.max(...lines.map((l) => doc.getTextWidth(l)));
  if (w <= 0) return null;
  const align = o?.align;
  const bx = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
  const base = o?.baseline;
  const top = base === "top" ? y : base === "middle" ? y - em * 0.36 : base === "bottom" ? y - em * 0.93 : y - em * 0.72;
  return {
    seite: doc.getCurrentPageInfo().pageNumber, x: +bx.toFixed(2), y: +top.toFixed(2), w: +w.toFixed(2), h: +((lines.length - 1) * lh + em * 0.93).toFixed(2),
    pt: +doc.getFontSize().toFixed(2), text: lines.join(" "),
  };
}

/**
 * `text` und `splitTextToSize` des Dokuments machen jeden Text WinAnsi-sicher (einmal je Dokument). Alle gesetzten
 * Texte werden zudem in `doc.__zeilen` gesammelt (Testhaken `window.__ltPdfInfo`, perf.ts).
 * MVP 3.5 (D8): «• », «✓ », «⚠ », «✗ » am Zeilenanfang werden als Vektorzeichen gezeichnet (nie mehr «+ »/«o »/«! »
 * als Ersatz); jede Textbox (`__boxes`), jede farbige Füllfläche von `rect`/`roundedRect` (`__fills`) und jedes
 * Vektorzeichen (`__glyphen`) wird gemeldet – Grundlage der Prüfung «keine Überlappung», «Farbe nur in Spalte Art».
 */
export function safePdf<T extends jsPDF>(doc: T): T {
  const d = doc as T & Doc;
  if (d.__winAnsi) return doc;
  d.__winAnsi = true;
  const zeilen: string[] = (d.__zeilen = []);
  const boxes: PdfBox[] = (d.__boxes = []);
  const fills: PdfFill[] = (d.__fills = []);
  d.__glyphen = { punkt: 0, haken: 0, warn: 0, kreuz: 0 };
  const text = doc.text.bind(doc) as (...a: unknown[]) => jsPDF;
  const split = doc.splitTextToSize.bind(doc);
  d.__roh = { text };
  (doc as { text: unknown }).text = (t: unknown, x: unknown, y: unknown, o?: unknown, ...rest: unknown[]) => {
    const opt = (o && typeof o === "object" && !Array.isArray(o) ? o : undefined) as Record<string, unknown> | undefined;
    // Vektorzeichen am Anfang (nur linksbündig, ohne Drehung)
    const first = typeof t === "string" ? t : Array.isArray(t) && typeof t[0] === "string" ? t[0] : null;
    const gm = first !== null && typeof x === "number" && typeof y === "number" && !opt?.align && !opt?.angle ? GLYPH_ANFANG.exec(first) : null;
    if (gm) {
      const rest0 = first!.slice(gm[0].length);
      const tt = typeof t === "string" ? rest0 : [rest0, ...(t as string[]).slice(1)];
      GLYPH[glyphVon(gm[1]!)](doc, x as number, y as number);
      return (doc.text as (...a: unknown[]) => jsPDF)(tt, (x as number) + glyphBreite(doc), y, o, ...rest);
    }
    const s = deep(t);
    const lines = typeof s === "string" ? s.split("\n") : Array.isArray(s) ? (s as unknown[]).filter((v): v is string => typeof v === "string") : [];
    if (typeof s === "string") zeilen.push(s);
    else if (Array.isArray(s)) zeilen.push(s.join(" "));
    if (typeof x === "number" && typeof y === "number") { const b = boxOf(doc, lines.filter((l) => l.trim()), x, y, opt); if (b) boxes.push(b); }
    return text(s, x, y, o, ...rest);
  };
  (doc as { splitTextToSize: unknown }).splitTextToSize = (t: unknown, ...rest: unknown[]) => (split as (...a: unknown[]) => unknown)(deep(t), ...rest);
  const meldeFlaeche = (x: unknown, y: unknown, w: unknown, h: unknown, style: unknown) => {
    if (typeof style !== "string" || !/F/i.test(style) || typeof x !== "number" || typeof y !== "number" || typeof w !== "number" || typeof h !== "number") return;
    const farbe = doc.getFillColor();
    if (/^#?f{6}$/i.test(farbe)) return;
    fills.push({ seite: doc.getCurrentPageInfo().pageNumber, x: +Math.min(x, x + w).toFixed(2), y: +Math.min(y, y + h).toFixed(2), w: +Math.abs(w).toFixed(2), h: +Math.abs(h).toFixed(2), farbe });
  };
  const rect = doc.rect.bind(doc) as (...a: unknown[]) => jsPDF;
  (doc as { rect: unknown }).rect = (x: unknown, y: unknown, w: unknown, h: unknown, style?: unknown) => { meldeFlaeche(x, y, w, h, style); return rect(x, y, w, h, style); };
  const rr = doc.roundedRect.bind(doc) as (...a: unknown[]) => jsPDF;
  (doc as { roundedRect: unknown }).roundedRect = (x: unknown, y: unknown, w: unknown, h: unknown, rx: unknown, ry: unknown, style?: unknown) => { meldeFlaeche(x, y, w, h, style); return rr(x, y, w, h, rx, ry, style); };
  return doc;
}

/** Testhaken: Textboxen, Füllflächen und Vektorzeichen eines Dokuments (nach `safePdf`) */
export function pdfMeldungen(doc: jsPDF): { boxes: PdfBox[]; fills: PdfFill[]; glyphen: Record<GlyphArt, number> } {
  const d = doc as Doc;
  return { boxes: (d.__boxes ?? []).slice(), fills: (d.__fills ?? []).slice(), glyphen: { ...(d.__glyphen ?? { punkt: 0, haken: 0, warn: 0, kreuz: 0 }) } };
}
