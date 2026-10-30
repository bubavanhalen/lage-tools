/**
 * Online-Dienste der aktuellen Übung für Module ohne Zugriff auf die Übung (Strassennetz in `roadsource.ts`).
 * Gesetzt von der Werkzeugleiste der Karte (immer eingehängt, solange eine Karte da ist). MVP 3.5 (K2): gleiche Regel
 * wie `onlineAllowed` – nur ausdrücklich eingeschaltet, sonst aus (`ONLINE_STANDARD`).
 * Komponenten mit Übung verwenden direkt `onlineAllowed(ex, …)` aus dem Kern.
 */
import { onlineAllowed, type Exercise, type OnlineDienst } from "@lage/core";

let current: Exercise["onlineDienste"];
export function setOnlinePolicy(o: Exercise["onlineDienste"]): void { current = o; }
export const onlineOn = (d: OnlineDienst): boolean => onlineAllowed({ onlineDienste: current }, d);
