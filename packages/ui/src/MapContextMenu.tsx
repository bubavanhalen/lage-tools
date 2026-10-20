/**
 * Rechtsklick (lange drücken) auf die Karte: Koordinate, Planquadrat, Meldung hier – PLATZHALTER, wird ersetzt.
 */
import L from "leaflet";
import type { LV95, RasterSheet } from "@lage/core";

export function MapContextMenu(_p: { map: L.Map; sheets: RasterSheet[]; onReportHere: (pos: LV95) => void }) {
  return null;
}
