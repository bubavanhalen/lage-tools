/**
 * Online-Dienste der aktuellen Übung für Module ohne Zugriff auf die Übung (Strassennetz in `roadsource.ts`, Kopf-Text
 * «Online an»). Gesetzt von der Werkzeugleiste der Karte (immer eingehängt, solange eine Karte da ist). MVP 3.5 (K2):
 * gleiche Regel wie `onlineAllowed` – nur ausdrücklich eingeschaltet, sonst aus (`ONLINE_STANDARD`).
 * Komponenten mit Übung verwenden direkt `onlineAllowed(ex, …)` aus dem Kern.
 */
import { useEffect, useState } from "react";
import { onlineAllowed, type Exercise, type OnlineDienst } from "@lage/core";

let current: Exercise["onlineDienste"];
const hoerer = new Set<() => void>();
const DIENSTE: OnlineDienst[] = ["ortssuche", "strassen", "sprache"];
const gleich = (a: Exercise["onlineDienste"], b: Exercise["onlineDienste"]) =>
  DIENSTE.every((d) => onlineAllowed({ onlineDienste: a }, d) === onlineAllowed({ onlineDienste: b }, d));

export function setOnlinePolicy(o: Exercise["onlineDienste"]): void {
  const alt = current;
  current = o;
  // Hörer erst nach dem Rendern benachrichtigen (wird während des Renderns der Werkzeugleiste gesetzt)
  if (!gleich(alt, o) && hoerer.size) queueMicrotask(() => { for (const h of hoerer) h(); });
}
export const onlineOn = (d: OnlineDienst): boolean => onlineAllowed({ onlineDienste: current }, d);

/** Online-Dienste der angezeigten Übung (folgt Änderungen) */
export function useOnlinePolicy(): { ortssuche: boolean; strassen: boolean; sprache: boolean } {
  const lies = () => ({ ortssuche: onlineOn("ortssuche"), strassen: onlineOn("strassen"), sprache: onlineOn("sprache") });
  const [v, setV] = useState(lies);
  useEffect(() => {
    const h = () => setV((alt) => { const n = lies(); return alt.ortssuche === n.ortssuche && alt.strassen === n.strassen && alt.sprache === n.sprache ? alt : n; });
    hoerer.add(h);
    h();
    return () => { hoerer.delete(h); };
  }, []);
  return v;
}
