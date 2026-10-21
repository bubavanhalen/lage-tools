/**
 * Darstellung eines Zeichens im Gelände an der Strasse: Sperrbalken, Schranke (Checkpoint) oder Punkt.
 * Reine Berechnung (ohne Leaflet), getestet in `packages/ui/test/roadmark.test.ts`.
 */
import { catalogEntry, type LageEvent } from "@lage/core";

/** Darstellung im Gelände an einer Strasse (nur mit `angle` und Katalog-Platzierung «strasse») */
export type RoadMark = "sperre" | "checkpoint" | "punkt";
const OLD_ROAD_KEYS = new Set(["sperre", "kontrollposten"]);
/** sperren die Strasse: Balken quer mit Zacken */
const BARRIER_KEYS = new Set(["sperre", "strassensperre", "panzersperre", "stacheldraht"]);
const GATE_KEYS = new Set(["kontrollposten", "verkehrsposten"]);
/** liegen nur an einem Punkt (kein Sperrbalken), auch wenn sie in der Kategorie «Hindernisse» stehen */
const POINT_RE = /ied|spreng|bombe|mine|unfall/;
export function roadMark(e: Pick<LageEvent, "sym" | "angle" | "pos">): RoadMark | null {
  if (e.angle === undefined || e.angle === null || !isFinite(e.angle) || !e.pos) return null;
  const cat = catalogEntry(e.sym);
  // Flächen- und Linienzeichen (Stacheldraht, Sperrlinie, Panzergraben …) zeichnet die Formebene quer zur Strasse
  if (cat?.geometry && cat.geometry !== "punkt") return null;
  if (cat?.placement !== "strasse" && !OLD_ROAD_KEYS.has(e.sym)) return null;
  if (BARRIER_KEYS.has(e.sym)) return "sperre";
  if (GATE_KEYS.has(e.sym)) return "checkpoint";
  // unbekannte/neue Schlüssel: nur nach Schlüssel und Name (nicht nach Kategorie – «Hindernisse» enthält auch IED)
  const k = `${e.sym} ${cat?.name ?? ""}`.toLowerCase();
  if (POINT_RE.test(k)) return "punkt";
  if (/sperr|barrik|blockade|graben|verhau|draht/.test(k)) return "sperre";
  if (/kontroll|checkpoint/.test(k)) return "checkpoint";
  return "punkt";
}
