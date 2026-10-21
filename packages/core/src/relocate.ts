/**
 * Ort einer Meldung von Hand korrigieren (Zeichen auf der Karte verschoben):
 * neuer Ort, Herkunft «Karte», Planquadrat neu aus dem Raster, Strassenlage entfernt.
 */
import { pointInRing } from "./geo";
import { unitKey } from "./journal";
import type { LV95 } from "./lv95";
import type { Area, LageEvent, Side } from "./model";
import { cellAtAny, type RasterSheet } from "./raster";
import { eventShape } from "./shapes";

/** Felder, die beim Verschieben geändert werden (für Rückgängig) */
export const RELOCATE_FIELDS = ["pos", "where", "cells", "nai", "angle", "road", "shape"] as const;
export type RelocateFields = Pick<LageEvent, (typeof RELOCATE_FIELDS)[number]>;

/** Änderung für `reviseEvent`: Ort neu, Planquadrat neu, Strasse/Ausrichtung weg, automatische Form mitverschoben */
export function relocatePatch(e: LageEvent, pos: LV95, sheets: RasterSheet[], areas: Area[] = []): Partial<LageEvent> {
  const p = { e: Math.round(pos.e), n: Math.round(pos.n) };
  const cell = cellAtAny(sheets, p);
  const patch: Partial<LageEvent> = { pos: p, where: "Karte", cells: cell ? [cell.label] : undefined, angle: undefined, road: undefined };
  // NAI nur behalten, wenn der neue Ort noch darin liegt
  if (e.nai) {
    const a = areas.find((x) => x.name === e.nai);
    if (!a || !pointInRing({ x: p.e, y: p.n }, a.ring.map((q) => ({ x: q.e, y: q.n })))) patch.nai = undefined;
  }
  // Form (Fläche/Linie) mit dem Zeichen mitverschieben: die angezeigte Form – bei automatischer Form also zuerst aus dem
  // bisherigen Ort berechnen (Feld, NAI, Mehrfeld-Achse), sonst würde nach dem Verschieben ein Kreis daraus.
  // Bleibt `auto: true` (darf bei einer späteren Ortsänderung neu berechnet werden), von Hand gezeichnete bleibt von Hand.
  const shape = e.pos ? eventShape(e, { sheets, areas }) : undefined;
  if (shape && e.pos) {
    const dx = p.e - e.pos.e, dy = p.n - e.pos.n;
    patch.shape = { ...shape, pts: shape.pts.map((q) => ({ e: q.e + dx, n: q.n + dy })) };
    if (shape.auto) patch.shape.auto = true;
  }
  return patch;
}

/** Werte der verschobenen Felder (für Rückgängig) */
export function relocateSnapshot(e: LageEvent): Partial<LageEvent> {
  const out: Partial<LageEvent> = {};
  for (const k of RELOCATE_FIELDS) (out as Record<string, unknown>)[k] = e[k];
  return out;
}

/**
 * Meldung, die den angezeigten Standort eines Elements liefert (die letzte Meldung des Elements
 * bis `t` mit genau diesem Ort). Ohne Treffer die letzte Meldung des Elements mit Ort.
 */
export function positionSource(events: LageEvent[], side: Side, unit: string, t: string, pos?: LV95): LageEvent | undefined {
  const k = unitKey(side, unit);
  let best: LageEvent | undefined;
  let any: LageEvent | undefined;
  const later = (a: LageEvent, b?: LageEvent) => !b || a.t > b.t || (a.t === b.t && a.id > b.id);
  for (const e of events) {
    if (e.deleted || !e.pos || !e.unit || e.t > t || unitKey(e.side, e.unit) !== k) continue;
    if (later(e, any)) any = e;
    if (pos && e.pos.e === pos.e && e.pos.n === pos.n && later(e, best)) best = e;
  }
  return best ?? any;
}
