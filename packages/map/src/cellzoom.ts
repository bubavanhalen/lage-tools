/**
 * Doppelklick in ein Feld des Führungsrasters: auf das Feld zoomen – PLATZHALTER, wird ersetzt.
 * @returns Funktion zum Abmelden
 */
import L from "leaflet";
import type { RasterSheet } from "@lage/core";

export function enableCellZoom(_map: L.Map, _getSheets: () => RasterSheet[]): () => void {
  return () => {};
}
