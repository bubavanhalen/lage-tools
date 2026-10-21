/**
 * Zeichen für Listen, Auswahl, Vorschau-Chip, Legende und Banner: Flächen- und Linienzeichen als eigenes kleines Bild
 * (`shapeIconSvg`), alle übrigen als taktisches Zeichen (`symbolSvg`). Die Lagekarte zeichnet ihre Zeichen selbst.
 */
import type { Affiliation } from "@lage/core";
import { shapeIconSvg } from "./shapeicon";
import { symbolSvg, type SymbolGraphic, type SymbolText } from "./symbol";

export function iconSvg(key: string, aff: Affiliation, size = 14, text: SymbolText = {}): SymbolGraphic {
  return shapeIconSvg(key, aff, size, text) ?? symbolSvg(key, aff, size, text);
}
