/**
 * Gelbes Aufblitzen auf der Karte (Spez. 4.6): Rahmen `#F2B705`, 4 px, 2,5 s.
 * Für Planquadrat/Unterquadrant (Rechteck), Flächen (Umriss) und Punkte (Ring).
 * Pro Karte ist höchstens ein Aufblitzen sichtbar; ein neues ersetzt das alte.
 */
import L from "leaflet";
import type { Bounds, LV95 } from "@lage/core";
import { toLatLng } from "./swissmap";

export const FLASH_COLOR = "#F2B705";
export const FLASH_MS = 2500;

const active = new WeakMap<L.Map, { layer: L.Layer; timer: number }>();

/** Eigene Ebene über den Zeichen (markerPane 600), unter Tooltips (650). */
export function overlayPane(map: L.Map, name = "ltFlash", z = 630): string {
  if (!map.getPane(name)) {
    const p = map.createPane(name);
    p.style.zIndex = String(z);
    p.style.pointerEvents = "none";
  }
  return name;
}

const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Entfernt ein laufendes Aufblitzen. */
export function clearFlash(map: L.Map): void {
  const a = active.get(map);
  if (!a) return;
  window.clearTimeout(a.timer);
  map.removeLayer(a.layer);
  active.delete(map);
}

function show(map: L.Map, layer: L.LayerGroup, ms: number): void {
  clearFlash(map);
  layer.addTo(map);
  // dreimal pulsieren, am Ende ausblenden (nur Deckkraft; ohne Bewegung bei «weniger Bewegung»)
  if (!reduceMotion()) {
    layer.eachLayer((l) => {
      const el = (l as L.Path).getElement?.() as SVGElement | undefined;
      el?.animate?.(
        [{ opacity: 1 }, { opacity: 0.35, offset: 0.12 }, { opacity: 1, offset: 0.24 }, { opacity: 0.35, offset: 0.36 }, { opacity: 1, offset: 0.48 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }],
        { duration: ms, easing: "ease-in-out", fill: "forwards" },
      );
    });
  }
  const timer = window.setTimeout(() => {
    if (active.get(map)?.layer === layer) active.delete(map);
    map.removeLayer(layer);
  }, ms);
  active.set(map, { layer, timer });
}

/** Rahmen mit dunkler Unterlage, damit Gelb auch auf hellen Kacheln/Luftbild klar sichtbar ist. */
function ringLayer(map: L.Map, lls: L.LatLng[]): L.LayerGroup {
  const pane = overlayPane(map);
  return L.layerGroup([
    L.polygon(lls, { pane, color: "#101414", weight: 7, opacity: 0.35, fill: false, interactive: false }),
    L.polygon(lls, { pane, color: FLASH_COLOR, weight: 4, opacity: 1, fill: false, interactive: false }),
  ]);
}

/** Lässt ein Rechteck in LV95 (z. B. Planquadrat) aufblitzen. */
export function flashBounds(map: L.Map, b: Bounds, ms = FLASH_MS): void {
  const lls = [
    { e: b.minE, n: b.maxN }, { e: b.maxE, n: b.maxN }, { e: b.maxE, n: b.minN }, { e: b.minE, n: b.minN },
  ].map(toLatLng);
  show(map, ringLayer(map, lls), ms);
}

/** Lässt einen Umriss (z. B. NAI) aufblitzen. */
export function flashRing(map: L.Map, ring: LV95[], ms = FLASH_MS): void {
  if (ring.length < 2) return;
  show(map, ringLayer(map, ring.map(toLatLng)), ms);
}

/** Lässt einen Punkt (Koordinate, Element, Ort) als Ring aufblitzen. */
export function flashPoint(map: L.Map, p: LV95, ms = FLASH_MS): void {
  const ll = toLatLng(p);
  const pane = overlayPane(map);
  show(map, L.layerGroup([
    L.circleMarker(ll, { pane, radius: 18, color: "#101414", weight: 7, opacity: 0.35, fill: false, interactive: false }),
    L.circleMarker(ll, { pane, radius: 18, color: FLASH_COLOR, weight: 4, opacity: 1, fill: false, interactive: false }),
    L.circleMarker(ll, { pane, radius: 3, color: "#fff", weight: 1.5, fillColor: "#101414", fillOpacity: 1, interactive: false }),
  ]), ms);
}
