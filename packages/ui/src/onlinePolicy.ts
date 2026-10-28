/**
 * Online-Dienste der aktuellen Übung für Module ohne Zugriff auf die Übung (Strassennetz in `roadsource.ts`).
 * Gesetzt von der Werkzeugleiste der Karte (immer eingehängt, solange eine Karte da ist); Standard an.
 * Komponenten mit Übung verwenden direkt `onlineAllowed(ex, …)` aus dem Kern.
 */
import type { Exercise, OnlineDienst } from "@lage/core";

let current: Exercise["onlineDienste"];
export function setOnlinePolicy(o: Exercise["onlineDienste"]): void { current = o; }
export const onlineOn = (d: OnlineDienst): boolean => current?.[d] !== false;
