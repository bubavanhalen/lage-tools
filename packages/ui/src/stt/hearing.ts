/**
 * Typische Hörfehler der Spracherkennung bei Funksprache korrigieren – bevor `normalizeSpoken` (Kern) übersetzt.
 * Nur im Zusammenhang mit dem Buchstabieralphabet, Zahlen oder «Richtung», damit normale Wörter unberührt bleiben.
 * Beobachtet mit Whisper (Testsätze per Sprachausgabe): «Hote 04», «Alpha Tilo 7 Schalli», «Alper Fox droht 1-2 Delta»,
 * «Alpha Golf 1/3», «Alpha Golf 1, 3», «November Alpha Indian 3», «Richtunatost», «Richtung Naht», «dignerisch»,
 * «Alpha-Charlie-Phenf», «nach Resten», «Einlastwagen», «Feinsicht».
 */
const NATO = "alpha|alfa|bravo|charlie|charly|delta|echo|foxtrot|golf|hotel|india|juliett?|kilo|lima|mike|november|oscar|oskar|papa|quebec|romeo|sierra|tango|uniform|victor|viktor|whiskey|whisky|x-?ray|yankee|zulu";
const W = `(?:${NATO})`;
/** Mengenwort nach einer Zahl: dann ist die Zahl eine Anzahl, kein Teil des Planquadrats/Elements */
const QTY = "(?:fahrzeug|fz\\b|person|pers\\b|mann\\b|soldat|lastw|lkw|pw\\b|panzer|spz|kpz|schützenpanzer|stück|mal\\b|minute|min\\b|meter|m\\b|km\\b)";
/** Richtungswort, wie Whisper es manchmal hört */
const NORD = "(?:nord|nort|noat|naht|nat|nad|nacht|north)";

const RULES: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  // «Richtunatost», «Richt zu Nothost», «Richtung Nachtost», «Richtung Nordhorst / North-Host» → Richtung Nordost
  [/\bricht(?:ung|un|u)?\s*(?:zu\s+)?(?:n?at|n?ot|n?a|n?o|nord|nort|nacht|north)[\s-]*h?or?st\b/gi, "Richtung Nordost"],
  [/\bricht(?:ung|un|u)?\s*(?:zu\s+)?(?:süd|sued|züd)[\s-]*h?or?st\b/gi, "Richtung Südost"],
  // «Nordhorst», «Northhost» ohne «Richtung» davor
  [/\b(nord|north|süd|sued)[\s-]*h?or?st\b/gi, (_m: string, d: string) => (/^n/i.test(d) ? "Nordost" : "Südost")],
  // «Richtung Naht», «Rtg Nat» → Nord
  [new RegExp(`\\b(richtung|rtg)\\s+${NORD}\\b`, "gi"), (_m: string, r: string) => `${r} Nord`],
  // «nach Resten» → nach Westen (Bewegung)
  [/\bnach\s+(?:resten|vesten|festen)\b/gi, "nach Westen"],
  // «Richtung Autost», «Richtung Northost» → Nordost
  [/\brichtung\s+(?:autost|northost|nordhost|nordost)\b/gi, "Richtung Nordost"],
  // «dignerisch», «diken risch», «gegenrisch» → gegnerisch
  [/\b(?:dignerisch|diknerisch|digenrisch|diken\s*risch|gegenrisch|gegnärisch|degnerisch|gignerisch)\b/gi, "gegnerisch"],
  // «Feinsicht» → Feindsicht
  [/\bfeinsicht\b/gi, "Feindsicht"],
  // «Einlastwagen», «Vierfahrzeuge», «Dreifahrzeuge» → getrennt
  [/\b(ein|eine|zwei|zwo|drei|vier|fünf|sechs|sieben|acht|neun|zehn)(lastwagen|fahrzeuge?|panzer|schützenpanzer|personen|mann)\b/gi, (_m: string, n: string, w: string) => `${n} ${w}`],
  // «Planquartrat» → Planquadrat
  [/\bplanqua[rt]{1,2}rat\b/gi, "Planquadrat"],
  // «äh» als «E» zwischen Zahlen: «Hotel 01 E 2 Fahrzeuge» → «Hotel 01 2 Fahrzeuge»
  [/(\d)[\s,]+(?:e|äh|ähm|öh)[\s,]+(?=\d)/gi, "$1 "],
  // «Fox Trot», «Fox droht», «Fox trott» → Foxtrot
  [/\bfox[\s-]*(?:trot|trott|droht|trotz)\b/gi, "Foxtrot"],
  // «Hote 04», «Hodel 04», «Hottel 2», «Hôtel 03» → Hotel (nur vor Zahl)
  [/\b(?:hote|hodel|hodl|hottel|hoteln|hôtel|hohte)\b(?=[\s,]*\d)/gi, "Hotel"],
  // «Alper/Alfa» neben einem Buchstabierwort → Alpha
  [new RegExp(`\\b(?:alper|alpa|alfa)\\b(?=[\\s,-]+${W}\\b)`, "gi"), "Alpha"],
  [new RegExp(`(\\b${W}[\\s,-]+)(?:alper|alpa)\\b`, "gi"), "$1Alpha"],
  // «Hodel/Hôtel» nach Buchstabierwort → Hotel (Planquadrat AH)
  [new RegExp(`(\\b${W}[\\s,-]+)(?:hodel|hodl|hote|hôtel|hottel)\\b`, "gi"), "$1Hotel"],
  // «Tilo» nach Buchstabierwort → Kilo
  [new RegExp(`(\\b${W}[\\s,-]+)(?:tilo|kilos|chilo)\\b`, "gi"), "$1Kilo"],
  // «Ichho», «Etscho» nach Buchstabierwort → Echo
  [new RegExp(`(\\b${W}[\\s,-]+)(?:ichho|icho|etscho|ecko)\\b`, "gi"), "$1Echo"],
  // «Shalifenf», «Schaalifend» → Charlie fünf
  [new RegExp(`(\\b${W}[\\s,-]+)(?:schalli|scharli|schali|shali|schaali)[\\s-]*(?:fenf|fünf|phenf|fend|fanf)\\b`, "gi"), "$1Charlie fünf"],
  // «Schalli», «Scharli», «Schali», «Charly» nach Zahl oder Buchstabierwort → Charlie
  [new RegExp(`((?:\\d|\\b${W})[\\s,-]+)(?:schalli|scharli|schali|shali|schaly|tscharli|charly|charli)\\b`, "gi"), "$1Charlie"],
  [new RegExp(`\\b(?:schalli|scharli|schali|tscharli)(?=[\\s,-]+(?:${W}|\\d))`, "gi"), "Charlie"],
  // «Indian 3» → India
  [new RegExp(`(\\b${W}[\\s,-]+)indian\\b`, "gi"), "$1India"],
  // «Pravo», «Prawo» → Bravo
  [new RegExp(`\\b(?:pravo|prawo)\\b(?=[\\s,-]+(?:${W}|\\d))`, "gi"), "Bravo"],
  // Bindestriche zwischen Buchstabierwörtern / vor Zahl: «Alpha-Charlie-5» → «Alpha Charlie 5»
  [new RegExp(`\\b(${W})-(?=${W}\\b|\\d)`, "gi"), "$1 "],
  // «Phenf», «Fenf» nach Buchstabierwort → fünf
  [new RegExp(`(\\b${W}[\\s,-]+)(?:phenf|fenf|fümf|fünft)\\b`, "gi"), "$1fünf"],
  // Planquadrat: «Alpha Golf 1/3», «1-3», «1.3», «1, 3» → «1 3» (Zahlen gesprochen, nicht Bruch/Bereich/Aufzählung)
  [new RegExp(`(\\b${W}[\\s,-]+${W}[\\s,]+)(\\d{1,2})\\s*(?:[/.\\-]|,)\\s*(\\d{1,2})\\b(?![\\s,]*${QTY})`, "gi"), "$1$2 $3"],
  [new RegExp(`(\\b${W}[\\s,]+)(\\d{1,2})\\s*[/\\-]\\s*(\\d{1,2})(?=[\\s,]+${W}\\b)`, "gi"), "$1$2 $3"],
  // Element: «Hotel 0, 4», «Hotel 0.4», «Hotel 0-4» → «Hotel 04»
  [/\b(hotel)\s+0\s*[,./-]?\s*(\d)\b(?![\s,]*(?:fahrzeug|fz\b|person|pers\b|mann\b))/gi, "$1 0$2"],
];

export function fixHearing(text: string): string {
  let t = text;
  for (const [re, to] of RULES) t = typeof to === "string" ? t.replace(re, to) : t.replace(re, to as (...m: string[]) => string);
  return t;
}
