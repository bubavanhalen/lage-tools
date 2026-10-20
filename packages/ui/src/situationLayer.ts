/**
 * Lage auf der Karte zum Zeitpunkt t – PLATZHALTER, wird ersetzt.
 */
import L from "leaflet";
import { situationAt, type LageEvent, type RasterSheet } from "@lage/core";
import { journalLayer } from "./journalLayer";
import type { LayerFlags } from "./layers";

export interface SituationOptions {
  /** Zeitpunkt (ISO lokal), nie null – Live wird vorher aufgelöst */
  t: string;
  flags: LayerFlags;
  selectedId: string | null;
  sheets: RasterSheet[];
  onClick: (e: LageEvent) => void;
  /** Meldungen jünger als so viele Minuten kräftig, ältere blass (Standard 30) */
  recentMin?: number;
}

export function situationLayer(_map: L.Map, events: LageEvent[], o: SituationOptions): L.LayerGroup {
  const st = situationAt(events, o.t);
  return journalLayer(st, { tracks: o.flags.spuren, selectedId: o.selectedId, onClick: o.onClick });
}
