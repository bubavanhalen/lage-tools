/**
 * Datenmodell, gemeinsam für Lagejournal und Übungsauswertung.
 *
 * Alle Änderungen sind Einträge mit eindeutiger ID, Revision und Gerätekennung.
 * So lassen sich Journale später konfliktfrei von Gerät zu Gerät zusammenführen (vNext).
 */
import type { LV95 } from "./lv95";
import type { RasterSheet } from "./raster";
import type { Affiliation } from "./symbols";

export type Side = "rot" | "blau" | "ul";

export interface SourceRef {
  kind: "text" | "image" | "audio" | "import";
  /** Dateiname, Asset-ID oder Originaltext */
  ref?: string;
}

export interface LageEvent {
  id: string;
  /** Revision: steigt bei jeder Änderung */
  rev: number;
  /** Gerät, das die letzte Änderung gemacht hat */
  device: string;
  updatedAt: string;
  deleted?: boolean;

  /** Zeitpunkt der Beobachtung / Handlung (ISO, lokale Zeit) */
  t: string;
  /** Zeitpunkt der Meldung (ISO), falls abweichend */
  tReported?: string;
  side: Side;
  /** Element, z. B. «H04», «Det 2», «LVZ» */
  unit: string;
  /** Meldungstext (Originaltext bleibt erhalten) */
  text: string;
  /** Kurzbeschriftung auf der Karte, z. B. «2×G» */
  label?: string;
  /** Zeichen-Schlüssel aus dem Katalog */
  sym: string;
  aff: Affiliation;
  pos?: LV95;
  /** Planquadrate, z. B. ["O20 C"] */
  cells?: string[];
  /** NAI / Raum, z. B. «NAI 5» */
  nai?: string;
  /** Anzahl (z. B. 2 Fahrzeuge), wird beim Zeichen angeschrieben */
  count?: number;
  /** Bewegungsrichtung in Grad (0 = Nord) */
  dir?: number;
  /** Herkunft des Standorts, z. B. «NAI 3», «UK7 C», «Koordinate», «Karte» */
  where?: string;
  source?: SourceRef;
  /** Vom Benutzer bestätigt (sonst Vorschlag der Erkennung) */
  confirmed: boolean;
  note?: string;
}

export interface Area {
  id: string;
  name: string;
  kind: "nai" | "ao" | "stao" | "other";
  /** Umriss in LV95 */
  ring: LV95[];
  color?: string;
}

/** Georeferenziertes Bild (z. B. BNB-Skizze, Kartenausschnitt) */
export interface Overlay {
  id: string;
  name: string;
  /** Bild als Data-URL (JPEG/PNG) */
  dataUrl: string;
  width: number;
  height: number;
  /** Bildpixel (x nach rechts, y nach unten) → LV95 (x = E, y = N) */
  affine: import("./geo").Affine;
  opacity: number;
  visible: boolean;
}

/** Bekannter Ort (Standort, nachgeschlagener Ortsname) */
export interface Place {
  name: string;
  pos: LV95;
}

export interface Exercise {
  id: string;
  name: string;
  /** Übungstage, z. B. ["2026-10-19", "2026-10-20"] */
  days: string[];
  sheets: RasterSheet[];
  areas: Area[];
  overlays?: Overlay[];
  units: { rot: string[]; blau: string[]; ul: string[] };
  /** Lagejournal */
  events?: LageEvent[];
  places?: Place[];
}

/** Sortierbare, eindeutige ID (Zeit + Zufall), ohne Abhängigkeiten. */
export function newEventId(now = Date.now()): string {
  const time = now.toString(36).padStart(9, "0");
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("");
  return `${time}${rand}`;
}

/** Gerätekennung (einmal pro Gerät erzeugen und speichern). */
export function newDeviceId(): string {
  return "dev-" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Führt zwei Journale zusammen: pro ID gewinnt die höhere Revision,
 * bei gleicher Revision die spätere Änderung, dann die Gerätekennung (deterministisch).
 */
export function mergeEvents(a: LageEvent[], b: LageEvent[]): LageEvent[] {
  const map = new Map<string, LageEvent>();
  for (const e of [...a, ...b]) {
    const cur = map.get(e.id);
    if (!cur || wins(e, cur)) map.set(e.id, e);
  }
  return [...map.values()].sort((x, y) => x.t.localeCompare(y.t) || x.id.localeCompare(y.id));
}

function wins(x: LageEvent, y: LageEvent): boolean {
  if (x.rev !== y.rev) return x.rev > y.rev;
  if (x.updatedAt !== y.updatedAt) return x.updatedAt > y.updatedAt;
  return x.device > y.device;
}
