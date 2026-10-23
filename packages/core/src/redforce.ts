/**
 * Lage Rot: erkannte Kräfte (aus dem Journal geschätzt) gegenüber der Feindannahme (erwartet).
 * Offline, ohne Abhängigkeiten. Benannte Elemente zählen einmal; unbenannte Sichtungen werden über Zeit und Raum
 * abgeglichen: «min» = vorsichtig (Wiederholungen zusammengefasst), «max» = alle Sichtungen verschieden.
 */
import type { Exercise } from "./model";

/** Zeile der Stärke, z. B. Personen, Fahrzeuge, Kpz, Drohnen, Elemente (Det) */
export interface StrengthRow {
  /** Schlüssel: «pers», «fz», «elemente:det», oder Katalog-Schlüssel (z. B. «kpz», «drohne») */
  key: string;
  /** Anzeigename, z. B. «Personen», «Fahrzeuge», «davon Kpz», «Det» */
  name: string;
  /** Unterzeile von (z. B. «fz» bei Kpz) */
  parent?: string;
}

/** Feindannahme, aus Kurzschrift gelesen */
export interface StrengthSpec {
  rows: Array<StrengthRow & { count: number }>;
  /** nicht verstandene Teile der Eingabe */
  unknown: string[];
}

/** Erkannte Stärke einer Zeile */
export interface StrengthEstimate extends StrengthRow {
  min: number;
  max: number;
  /** benannte Elemente (z. B. «Det 1», «Det 2») */
  names?: string[];
  /** Meldungen, die zählen */
  events: string[];
}

export interface RedForce {
  rows: StrengthEstimate[];
  /** benannte Rot-Elemente, die seit längerer Zeit nicht mehr gemeldet wurden */
  notSeen: Array<{ unit: string; since: string; minutes: number; event: string }>;
}

/** Vergleich erkannt ↔ erwartet je Zeile */
export interface StrengthCompare {
  row: StrengthRow;
  found?: StrengthEstimate;
  expected?: number;
  /** «vollstaendig» (min ≥ erwartet), «teilweise» (Anteil), «fehlt» (0), «unerwartet» (gefunden, nicht erwartet), «mehr» (min > erwartet) */
  state: "vollstaendig" | "teilweise" | "fehlt" | "unerwartet" | "mehr" | "offen";
  /** Anteil min/erwartet (0–1+) */
  ratio?: number;
}

/** Feindannahme in Kurzschrift lesen, z. B. «2 Det, 14 Pers, 5 Fz (2 Kpz), 1 Drohne» */
export function parseStrength(_text: string): StrengthSpec {
  return { rows: [], unknown: [] };
}

/** Erkannte Kräfte Rot bis zur Lagezeit `t` */
export function estimateRedForce(_ex: Exercise, _t: string): RedForce {
  return { rows: [], notSeen: [] };
}

/** Erkannt ↔ erwartet zusammenführen (Zeilen aus beiden Seiten) */
export function compareStrength(_found: RedForce, _spec: StrengthSpec | null): StrengthCompare[] {
  return [];
}
