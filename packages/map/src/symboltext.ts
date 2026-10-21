/**
 * Deutsche Kurzzeichen in taktischen Zeichen (ohne Leaflet, damit testbar).
 *
 * milsymbol schreibt bei einigen 2525C-Zeichen englische Kürzel ins Zeichen (SOF, RIOT, TCP …). Diese werden hier
 * zentral durch die Kürzel der Schweizer Armee ersetzt; Karte, Liste, Zeichen-Auswahl und PDF gehen alle über
 * `germanPin` bzw. `symbolSvg` und zeigen deshalb dasselbe.
 *
 * Bleiben (international und in der Armee so gebräuchlich): «IED» (auch im Reglement und in der Ausbildung so).
 */

/** normierter Funktionsteil des SIDC: Stelle 1, 3 und 5–10 (ohne Zugehörigkeit/Status), «*» → «-» */
export const sidcFunction = (sidc: string): string => {
  const s = sidc.toUpperCase().padEnd(15, "-");
  return (s[0]! + s[2]! + s.slice(4, 10)).replace(/\*/g, "-");
};

interface TextRule {
  /** englisches Kürzel, wie milsymbol es schreibt */
  en: string;
  de: string;
  /** nur bei diesem Funktionsteil (Anfang von `sidcFunction`), z. B. für einzelne Buchstaben */
  fn?: string;
}

/**
 * Ersetzungen. Einzelbuchstaben nur mit Funktionsteil, damit z. B. ein «S» in einem anderen Zeichen bleibt.
 * Punkt-Grafiken mit eigener Kurzbeschriftung im Katalog (TCP → Vrk, CKP → Kontr …) ersetzt `germanPin` mit dem
 * Katalog-Kürzel; die Einträge hier gelten auch ohne Katalog (z. B. importierter SIDC).
 */
export const GERMAN_TEXT: TextRule[] = [
  { en: "SOF", de: "Spez" },
  { en: "EW", de: "EKF" },
  { en: "MP", de: "Mil Pol" },
  { en: "CSS", de: "Log" },
  { en: "DPRE", de: "Flü" },
  { en: "MASS", de: "Demo" },
  { en: "RIOT", de: "Krawall" },
  { en: "ACC", de: "Unf" },
  { en: "BOMB", de: "Spreng", fn: "EI" },
  { en: "BOMB", de: "Spr Obj" },
  { en: "TCP", de: "Vrk" },
  { en: "CKP", de: "Kontr" },
  { en: "ASP", de: "Mun" },
  { en: "CCP", de: "Verw" },
  { en: "EPW", de: "Gef" },
  { en: "LRP", de: "Log" },
  { en: "LU", de: "Überg" },
  { en: "RLY", de: "Smpl" },
  { en: "B", de: "Bus", fn: "SGEVUB" },
  { en: "D", de: "Zerst", fn: "GTD" },
  { en: "K", de: "Entf", fn: "OOK" },
  { en: "S", de: "Schaf", fn: "OVS" },
  { en: "U", de: "Trsp", fn: "SGUCVRU" },
];

/** Kürzel, die bewusst englisch bleiben (international gebräuchlich) */
export const KEEP_TEXT = ["IED"];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** ungefähre Breite (Arial fett) in Einheiten der Schriftgrösse */
const textWidth = (s: string) => [...s].reduce((w, c) => w + (c === " " ? 0.28 : /[A-ZÄÖÜ]/.test(c) ? 0.72 : /[il]/.test(c) ? 0.3 : 0.6), 0);

/** deutsches Kürzel für einen Text im Zeichen (oder undefined, wenn nichts zu ersetzen ist) */
export function germanTextFor(en: string, sidc: string): string | undefined {
  const fn = sidcFunction(sidc);
  return GERMAN_TEXT.find((r) => r.en === en && (!r.fn || fn.startsWith(r.fn)))?.de;
}

/**
 * Englische Kürzel im SVG von milsymbol ersetzen. Die Schrift wird verkleinert, wenn das deutsche Kürzel länger ist
 * (Platz wie das Original, mindestens 70 Einheiten breit), nie vergrössert.
 */
export function germanText(svg: string, sidc: string): string {
  return svg.replace(/<text([^>]*)>([^<]*)<\/text>/g, (all, attrs: string, raw: string) => {
    const de = germanTextFor(unesc(raw).trim(), sidc);
    if (!de) return all;
    const fs = +(/font-size="([\d.]+)"/.exec(attrs)?.[1] ?? 30);
    const room = Math.max(textWidth(raw) * fs, 70);
    const size = Math.max(10, Math.min(fs, Math.floor(room / textWidth(de))));
    return `<text${attrs.replace(/font-size="[\d.]+"/, `font-size="${size}"`)}>${esc(de)}</text>`;
  });
}

/**
 * Punkt-Grafiken (Stecknadel, 2525C G*SPP… / G*GPGPP) tragen englische Kürzel (TCP, ASP …) oder sind leer:
 * Kürzel durch das deutsche Kurzzeichen aus dem Katalog ersetzen (z. B. «Vrk», «Mun», «Draht»).
 * Übrige englische Kürzel (SOF, RIOT …) ersetzt `germanText`.
 */
export function germanPin(svg: string, sidc: string, tag?: string): string {
  if (!tag || !/^G.(SPP|GPGPP)/i.test(sidc)) return germanText(svg, sidc);
  const color = /<path[^>]*stroke="([^"]+)"/.exec(svg.replace(/<path[^>]*stroke-width="(?:[5-9]|\d\d)[^>]*>/g, ""))?.[1] ?? "black";
  const fs = Math.min(34, Math.floor(118 / Math.max(2, tag.length)));
  const txt = `<text x="100" y="-8" text-anchor="middle" font-size="${fs}" font-family="Arial" font-weight="bold" dominant-baseline="middle" fill="${color}">${esc(tag)}</text>`;
  return svg.replace(/<text[^>]*>[^<]*<\/text>/g, "").replace(/<\/svg>\s*$/, `${txt}</svg>`);
}
