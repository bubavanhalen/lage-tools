/**
 * Zeichen nach APP-6 / MIL-STD-2525C (SIDC, 15 Stellen) für milsymbol – Zugang über den Katalog (`catalog.ts`).
 * «?» im SIDC wird durch die Zugehörigkeit ersetzt: F = eigen, H = Feind, U = unbekannt, N = neutral.
 * Die alten Schlüssel (einheit, inf_gr, inf_trp, fz, lw, drohne, patrouille, beob_aufkl, kontakt, hinterhalt, sperre,
 * kontrollposten, mun_lager) sind Katalog-Einträge mit gleichem Schlüssel; gespeicherte Übungen bleiben gültig.
 */
import { CATALOG, buildSidc, catalogEntry, readTactical, type CatalogEntry } from "./catalog";

export type Affiliation = "F" | "H" | "U" | "N";

export interface SymbolDef {
  key: string;
  /** Anzeigename (Deutsch) */
  name: string;
  /** SIDC-Vorlage mit «?» für die Zugehörigkeit */
  sidc: string;
  /** Suchbegriffe / Kürzel (klein), aus dem Katalog */
  keywords: string[];
  /** Als Dreieck darstellen (Späher / Beob Posten), nicht als milsymbol */
  triangle?: boolean;
  /** Tätigkeit (Ereignis am Ort), nicht das Element selbst – z. B. Kontakt, Sperre */
  activity?: boolean;
  /** Kategorie im Katalog */
  category?: string;
  /** «strasse» = auf die Strasse legen */
  placement?: CatalogEntry["placement"];
}

const toDef = (e: CatalogEntry): SymbolDef => ({
  key: e.key,
  name: e.name,
  sidc: e.sidc,
  keywords: e.aliases,
  triangle: e.triangle,
  activity: e.activity,
  category: e.category,
  placement: e.placement,
});

/** Alle Zeichen (Katalog-Reihenfolge, nach Kategorien); alte Schlüssel ohne eigene Auswahl sind am Ende. */
export const SYMBOLS: SymbolDef[] = [...CATALOG.filter((e) => !e.hidden), ...CATALOG.filter((e) => e.hidden)].map(toDef);

const byKey = new Map(SYMBOLS.map((s) => [s.key, s]));

export function symbolDef(key: string): SymbolDef {
  return byKey.get(key) ?? byKey.get("einheit")!;
}

/** SIDC aus Schlüssel und Zugehörigkeit (inkl. Standard-Stufe des Eintrags, z. B. «Inf Gruppe»). */
export function sidcFor(key: string, aff: Affiliation): string {
  const e = catalogEntry(key) ?? catalogEntry("einheit")!;
  return buildSidc(e, aff);
}

/** Erkennt das passendste Zeichen in einem Meldungstext (Schlüssel aus dem Katalog). */
export function detectSymbol(text: string): string {
  return readTactical(text)?.key ?? "einheit";
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
