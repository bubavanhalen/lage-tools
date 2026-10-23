/**
 * Typische Hörfehler der Spracherkennung bei Funksprache korrigieren – bevor `normalizeSpoken` (Kern) übersetzt.
 * Nur im Zusammenhang mit dem Buchstabieralphabet bzw. Zahlen, damit normale Wörter unberührt bleiben.
 * Beobachtet mit Whisper (Testsätze per Sprachausgabe): «Hote 04», «Alpha Tilo 7 Schalli», «Alper Fox droht 1-2 Delta»,
 * «Alpha Golf 1/3», «November Alpha Indian 3».
 */
const NATO = "alpha|alfa|bravo|charlie|charly|delta|echo|foxtrot|golf|hotel|india|juliett?|kilo|lima|mike|november|oscar|oskar|papa|quebec|romeo|sierra|tango|uniform|victor|viktor|whiskey|whisky|x-?ray|yankee|zulu";
const W = `(?:${NATO})`;

const RULES: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  // «Richtung Nordhorst / Northhost» → Nordost (ebenso Süd)
  [/\b(nord|north|süd|sued)[\s-]*h?or?st\b/gi, (_m: string, d: string) => (/^n/i.test(d) ? "Nordost" : "Südost")],
  // «Fox Trot», «Fox droht», «Fox trott» → Foxtrot
  [/\bfox[\s-]*(?:trot|trott|droht|trotz)\b/gi, "Foxtrot"],
  // «Hote 04», «Hodel 04», «Hottel 2» → Hotel (nur vor Zahl)
  [/\b(?:hote|hodel|hottel|hoteln)\b(?=[\s,]*\d)/gi, "Hotel"],
  // «Alper/Alfa» neben einem Buchstabierwort → Alpha
  [new RegExp(`\\b(?:alper|alpa|alfa)\\b(?=[\\s,-]+${W}\\b)`, "gi"), "Alpha"],
  [new RegExp(`(\\b${W}[\\s,-]+)(?:alper|alpa)\\b`, "gi"), "$1Alpha"],
  // «Tilo» nach Buchstabierwort → Kilo
  [new RegExp(`(\\b${W}[\\s,-]+)(?:tilo|kilos|chilo)\\b`, "gi"), "$1Kilo"],
  // «Schalli», «Scharli», «Schali», «Charly» nach Zahl oder Buchstabierwort → Charlie
  [new RegExp(`((?:\\d|\\b${W})[\\s,-]+)(?:schalli|scharli|schali|schaly|tscharli|charly|charli)\\b`, "gi"), "$1Charlie"],
  [new RegExp(`\\b(?:schalli|scharli|schali|tscharli)(?=[\\s,-]+(?:${W}|\\d))`, "gi"), "Charlie"],
  // «Indian 3» → India
  [new RegExp(`(\\b${W}[\\s,-]+)indian\\b`, "gi"), "$1India"],
  // «Pravo», «Prawo» → Bravo
  [new RegExp(`\\b(?:pravo|prawo)\\b(?=[\\s,-]+(?:${W}|\\d))`, "gi"), "Bravo"],
  // Planquadrat: «Alpha Golf 1/3», «1-3», «1.3» → «1 3» (Zahlen gesprochen, nicht Bruch/Bereich)
  [new RegExp(`(\\b${W}[\\s,-]+${W}[\\s,]+)(\\d{1,2})\\s*[/.\\-]\\s*(\\d{1,2})\\b`, "gi"), "$1$2 $3"],
  [new RegExp(`(\\b${W}[\\s,]+)(\\d{1,2})\\s*[/\\-]\\s*(\\d{1,2})(?=[\\s,]+${W}\\b)`, "gi"), "$1$2 $3"],
];

export function fixHearing(text: string): string {
  let t = text;
  for (const [re, to] of RULES) t = typeof to === "string" ? t.replace(re, to) : t.replace(re, to as (...m: string[]) => string);
  return t;
}
