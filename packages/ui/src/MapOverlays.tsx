/**
 * Über der Karte: Band mit der gewählten Meldung, Legende – PLATZHALTER, wird ersetzt.
 */
import type { LageEvent } from "@lage/core";
import type { LayerFlags } from "./layers";

export function EventBanner(_p: { event: LageEvent | null; days: string[]; onClose: () => void }) {
  return null;
}

export function Legend(_p: { events: LageEvent[]; t: string; flags: LayerFlags }) {
  return null;
}
