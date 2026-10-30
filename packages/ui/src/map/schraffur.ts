/**
 * Schraffur für Unklar-Flächen (Spez. MVP 3.5, S11, B2): Linien 45°, Abstand 6 px, 1.5 px in `KARTE.unklar` statt
 * gelber Füllung – Unklar wiegt so nicht mehr schwerer als Feind, und Deutan sieht beide verschieden. Das Muster liegt
 * als `<pattern>` in der SVG der jeweiligen Leaflet-Ebene (einmal je SVG).
 */
import { LAGE_KARTE } from "../colors";

/** Muster der Lage-Ebene (Planquadrate), Testhaken `pattern#lt-schraffur-unklar` */
export const SCHRAFFUR_ID = "lt-schraffur-unklar";
/** Muster der Flächen-Ebene (gezeichnete Unklar-Flächen) */
export const SCHRAFFUR_FLAECHE_ID = "lt-schraffur-unklar-f";

/** `<pattern>` als Text (Abstand 6 px, Linie 1.5 px, 45°) */
export function schraffurPattern(id: string, farbe: string = LAGE_KARTE.unklar): string {
  return `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
    + `<line x1="0" y1="0" x2="0" y2="6" stroke="${farbe}" stroke-width="1.5"/></pattern>`;
}

/** Muster in die SVG einsetzen, falls es dort fehlt */
export function ensureSchraffur(svg: SVGSVGElement | null | undefined, id: string = SCHRAFFUR_ID): void {
  if (!svg || svg.querySelector(`#${id}`)) return;
  let defs = svg.querySelector("defs");
  if (!defs) { defs = document.createElementNS("http://www.w3.org/2000/svg", "defs"); svg.insertBefore(defs, svg.firstChild); }
  defs.insertAdjacentHTML("beforeend", schraffurPattern(id));
}
