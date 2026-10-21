/**
 * Strassen im Gelände: Zeichen wie Sperre, Checkpoint, IED auf die wahrscheinlichste Strasse legen – GERÜST, wird ausgebaut.
 * Daten: swisstopo TLM (Objektart), in der App geladen und für offline gespeichert.
 */
import type { LV95 } from "./lv95";
import type { Bounds } from "./raster";

export interface RoadSegment {
  /** eindeutige Kennung (z. B. aus TLM) */
  id: string;
  name?: string;
  /** TLM-Objektart (Strassenklasse) */
  cls: number;
  /** Polylinie in LV95 */
  pts: LV95[];
}

export interface RoadPlacement {
  pos: LV95;
  /** Strassenrichtung in Grad (0 = Nord, im Uhrzeigersinn), 0–180 */
  angle: number;
  road?: string;
  cls: number;
  /** Wichtigkeit (höher = Hauptstrasse) */
  rank: number;
}

/** Wichtigkeit einer TLM-Objektart (höher = wichtiger) – GERÜST. */
export function roadRank(_cls: number): number {
  return 1;
}

/**
 * Legt einen Punkt auf die wahrscheinlichste Strasse im Zielgebiet (Planquadrat/Unterquadrant/NAI).
 * @param prefer bevorzugter Punkt (z. B. Mitte des Gebiets)
 * @returns null, wenn keine Strasse im Gebiet liegt – GERÜST.
 */
export function placeOnRoad(_target: Bounds, _roads: RoadSegment[], _prefer?: LV95): RoadPlacement | null {
  return null;
}
