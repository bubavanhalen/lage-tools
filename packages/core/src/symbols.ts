/**
 * Zeichenkatalog nach APP-6 / MIL-STD-2525C (SIDC, 15 Stellen) für milsymbol.
 * «?» im SIDC wird durch die Zugehörigkeit ersetzt: F = eigen, H = Feind, U = unbekannt, N = neutral.
 */

export type Affiliation = "F" | "H" | "U" | "N";

export interface SymbolDef {
  key: string;
  /** Anzeigename (Deutsch) */
  name: string;
  /** SIDC-Vorlage mit «?» für die Zugehörigkeit */
  sidc: string;
  /** Erkennungsbegriffe in Meldungen (reguläre Ausdrücke, ohne Gross/Klein) */
  keywords: string[];
  /** Als Dreieck darstellen (Späher / Beob Posten), nicht als milsymbol */
  triangle?: boolean;
}

/** Reihenfolge = Priorität der Erkennung (spezifisch vor allgemein). */
export const SYMBOLS: SymbolDef[] = [
  { key: "hinterhalt", name: "Hinterhalt", sidc: "G?OPVU----****X", keywords: ["hinterhalt", "überfall"] },
  { key: "sperre", name: "Strassensperre", sidc: "G?OPPR----****X", keywords: ["strassensperre", "sperre"] },
  { key: "kontrollposten", name: "Kontrollposten", sidc: "G?GPGPPK-------X", keywords: ["checkpoint", "kontrollposten", "kontrollpunkt", "\\bcp\\b"] },
  { key: "mun_lager", name: "Übergabe / Munitionslager", sidc: "G?OPVC----****X", keywords: ["übergabe", "munition", "\\bmun\\b", "gefangenenübergabe"] },
  { key: "kontakt", name: "Kurzer Kontakt", sidc: "G?CPOXUB--****X", keywords: ["kontakt mit", "feuerkontakt", "beschuss", "schüsse", "entdeckt"] },
  { key: "drohne", name: "Drohne", sidc: "S?APMFQ--------", keywords: ["drohne", "\\buav\\b"] },
  { key: "beob_aufkl", name: "Späher-Trupp (Beob Posten)", sidc: "G?CPMMPOR-****X", keywords: ["späher", "beob\\s?posten", "beobachtungsposten", "beob\\s?stao"], triangle: true },
  { key: "patrouille", name: "Patrouille", sidc: "G?OPPT----****X", keywords: ["patrouille", "\\bpatr\\b"] },
  { key: "lw", name: "Lastwagen", sidc: "S?GPEVUL-------", keywords: ["lastwagen", "\\blkw\\b", "\\bduro\\b"] },
  { key: "fz", name: "Fahrzeug", sidc: "S?GPEVU--------", keywords: ["g-?klasse", "g-?wagen", "fahrzeug", "\\bfz\\b", "\\bpw\\b", "\\bauto\\b", "puch"] },
  { key: "inf_gr", name: "Inf Gruppe", sidc: "S?GPUCI----B---", keywords: ["\\bgruppe\\b", "\\b(?:[89]|\\d{2,})\\s*(?:personen|pers\\.?|soldaten|mann)\\b"] },
  { key: "inf_trp", name: "Inf Trupp", sidc: "S?GPUCI----A---", keywords: ["personen", "\\bpers\\b", "soldaten", "\\bmann\\b", "zu fuss", "fussgänger"] },
  { key: "einheit", name: "Einheit (allg.)", sidc: "S?GPU----------", keywords: [] },
];

const byKey = new Map(SYMBOLS.map((s) => [s.key, s]));

export function symbolDef(key: string): SymbolDef {
  return byKey.get(key) ?? byKey.get("einheit")!;
}

export function sidcFor(key: string, aff: Affiliation): string {
  return symbolDef(key).sidc.replace("?", aff);
}

/** Erkennt das passendste Zeichen in einem Meldungstext. */
export function detectSymbol(text: string): string {
  const t = text.toLowerCase();
  for (const s of SYMBOLS) {
    if (s.keywords.some((k) => new RegExp(k, "i").test(t))) return s.key;
  }
  return "einheit";
}

/**
 * Erkennt die Zugehörigkeit des gemeldeten Elements.
 * Feind: «Gegner», «Seite Rot», «feindlich», Markierung «X».
 * Neutral: «Übungsleitung», «UL», «Zivil».
 * Unbekannt: «unklar», «unbekannt», «nicht erkennbar ob».
 */
export function detectAffiliation(text: string): Affiliation | null {
  const t = text.toLowerCase();
  if (/(nicht erkennbar ob|unklar ob|zugehörigkeit (unbekannt|unklar)|unbekannt|unklar)/.test(t)) return "U";
  if (/(gegner|seite rot|feind|\bfep\b|mit (x|kreuz) markiert|mit (x|kreuz)\b)/.test(t)) return "H";
  if (/(übungsleitung|\bul\b|zivil|spazier)/.test(t)) return "N";
  return null;
}
