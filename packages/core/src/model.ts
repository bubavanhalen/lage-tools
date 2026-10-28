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
/** Hinweis auf die Strassenart aus dem Text: «auf Hauptstrasse» → haupt, «auf Autobahn / A1» → autobahn */
export type RoadHint = "haupt" | "autobahn";

/** Form eines Flächen- oder Linienzeichens (siehe `LageEvent.shape`) */
export interface EventShape {
  kind: "flaeche" | "linie";
  /** Eckpunkte (Fläche, ohne Wiederholung des ersten Punkts) bzw. Linienzug, LV95 */
  pts: LV95[];
  /** aus dem Ort berechnet (Planquadrat, NAI, Strasse); von Hand gezeichnete Formen nie überschreiben */
  auto?: boolean;
}

export interface SourceRef {
  kind: "text" | "image" | "audio" | "import";
  /** Dateiname, Asset-ID oder Originaltext */
  ref?: string;
}

/** Anhang (Foto, Sprachmemo) – Metadaten im Ereignis bzw. in der Übung, Inhalt (Blob) im Gerätespeicher */
export interface Attachment {
  id: string;
  kind: "foto" | "audio";
  /** MIME-Typ, z. B. «image/jpeg», «audio/webm» */
  mime: string;
  /** ISO-Zeit der Aufnahme */
  createdAt: string;
  /** Grösse in Bytes */
  size?: number;
  /** Bild: Breite/Höhe in px; Audio: Dauer in s */
  width?: number;
  height?: number;
  duration?: number;
  /** erkannter Text (Foto: Texterkennung, Audio: Transkript, roh) */
  text?: string;
  /** womit erkannt, z. B. «ocr-offline», «whisper-offline», «browser», «ki» */
  engine?: string;
  /** auch an ein Planquadrat gehängt, z. B. «AG13» */
  cell?: string;
}

export interface LageEvent {
  id: string;
  /** Revision: steigt bei jeder Änderung */
  rev: number;
  /** Gerät, das die letzte Änderung gemacht hat */
  device: string;
  updatedAt: string;
  /** Anhänge (IDs in `Exercise.attachments`), z. B. Foto des Meldezettels, Sprachmemo */
  attachments?: string[];
  deleted?: boolean;

  /** Zeitpunkt der Beobachtung / Handlung (ISO, lokale Zeit der Übung `Exercise.tz`, ohne Offset) */
  t: string;
  /** Eingang der Meldung im Journal (ISO lokal, Minute, wie `t`) – beim Eintragen gesetzt, ändert bei Korrekturen nicht */
  tReported?: string;
  /** genauer Zeitpunkt der Erfassung (ISO UTC mit «Z»), unabhängig von Zeitzone und Sommerzeit; ändert nie */
  createdAt?: string;
  side: Side;
  /** Element auf der Karte, z. B. «H04», «Det 2» (leer bei Sichtungen ohne bekanntes Element) */
  unit: string;
  /** Eigenes Element, das gemeldet hat (Lageverfolgung) */
  melder?: string;
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
  /** vollständiger SIDC (APP-6/2525C) inkl. Stufe und Status – hat Vorrang vor `sym` + `aff` */
  sidc?: string;
  /** Stufe, z. B. «hz» (Halbzug) */
  echelon?: import("./catalog").Echelon;
  /** «anticipated» = vermutet/geplant (gestrichelter Rahmen), z. B. «mögliche IED» */
  status?: import("./catalog").Status;
  /** ausgeschriebener Sinn, z. B. «1 gegnerischer Halbzug Infanterie» */
  desc?: string;
  /** Ausrichtung im Gelände in Grad (0 = Nord), z. B. Strassenrichtung bei einer Sperre */
  angle?: number;
  /** Strasse, auf die das Zeichen gelegt wurde */
  road?: string;
  /** «Kein Strassenbezug» gewählt: nicht automatisch auf eine Strasse legen */
  roadNone?: boolean;
  /**
   * Flächen- oder Linienzeichen (z. B. Minenfeld, Stacheldraht): Umriss bzw. Linienzug in LV95.
   * `auto` = aus dem Ort berechnet (darf bei Ortsänderung neu berechnet werden), sonst von Hand gezeichnet.
   */
  shape?: EventShape;
  /** Strassenart aus dem Text («auf Hauptstrasse», «auf Autobahn») für die Lage auf der Strasse */
  roadHint?: RoadHint;
  /** Herkunft in Grad (0 = Nord), z. B. «Schuss aus Rtg O» → 90; keine Bewegungsrichtung */
  from?: number;
  /** Herkunft als Text, wenn keine Himmelsrichtung, z. B. «aus Rtg Bern» */
  fromLabel?: string;
  source?: SourceRef;
  /** «ki» = Text stammt aus einem übernommenen KI-Vorschlag (Handschrift auf Foto, «KI deuten») – für Kennzeichnung und PDF-Vermerk */
  via?: "ki";
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
  /** NAI: zugeteiltes eigenes Element (Beob Trupp), z. B. «H03» */
  trupp?: string;
  /** NAI: Geländetyp – steuert Hinweise (z. B. Engnis → Hinterhalt-Gefahr) */
  typ?: NaiTyp;
}

/** Geländetyp eines NAI */
export type NaiTyp = "strasse" | "engnis" | "siedlung" | "bruecke" | "wald" | "offen" | "anlage";

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
  /** Übungstage (Lokalzeit), z. B. ["2026-10-19", "2026-10-20"] */
  days: string[];
  /** Zeitzone beim Anlegen (IANA + Offset), z. B. { zone: "Europe/Zurich", offset: "+01:00" } – Zeiten `t` gelten darin */
  tz?: import("./clock").ZoneInfo;
  /** Anlegezeitpunkt (ISO UTC) */
  createdAt?: string;
  sheets: RasterSheet[];
  areas: Area[];
  overlays?: Overlay[];
  units: { rot: string[]; blau: string[]; ul: string[] };
  /** Lagejournal */
  events?: LageEvent[];
  places?: Place[];
  /** Anhänge (nur Metadaten; Inhalt im Gerätespeicher, beim Export als Datei mitgegeben) */
  attachments?: Attachment[];
  /** KI für diese Übung (nur nach ausdrücklichem Einschalten; Schlüssel liegt nie in der Übung, nur auf dem Gerät) */
  ki?: { enabled: boolean; /** ISO-Zeit des Einschaltens */ since?: string };
  /** Feindannahme in Kurzschrift, z. B. «2 Det, 14 Pers, 5 Fz, 1 Drohne» (erwartete Stärke Rot) */
  feindannahme?: string;
  /** Entscheide zu Hinweisen (Hinweis-ID → bestätigt/verworfen) */
  hintDecisions?: Record<string, HintDecision>;
  /**
   * Online-Dienste dieser Übung (Standard: alles an). `ortssuche`: Ortsnamen bei swisstopo nachschlagen (Meldungsfeld,
   * Kartensuche); `strassen`: Strassennetz (TLM) für Hindernisse & Co. laden. Aus = kein Request (siehe `onlineAllowed`).
   */
  onlineDienste?: { ortssuche?: boolean; strassen?: boolean };
}

/** Entscheid des Benutzers zu einem Hinweis */
export interface HintDecision {
  state: "bestaetigt" | "verworfen";
  /** ISO-Zeit des Entscheids */
  at: string;
  note?: string;
  /** Regel des Hinweises beim Entscheid (z. B. «C1») – damit der Entscheid bei ID-Wechsel haftet (`decisionFor`) */
  rule?: string;
  /** Auslöser-Meldungen (IDs) beim Entscheid – für die Zuordnung nach Nachträgen (`decisionFor`) */
  events?: string[];
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
