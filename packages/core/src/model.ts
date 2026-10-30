/**
 * Datenmodell, gemeinsam für Lagejournal und Übungsauswertung.
 *
 * Alle Änderungen sind Einträge mit eindeutiger ID, Revision und Gerätekennung.
 * So lassen sich Journale später konfliktfrei von Gerät zu Gerät zusammenführen (vNext).
 */
import { compareEvents } from "./clock";
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

// ---------- MVP 3 «LVZ-Betrieb»: Eintragsarten, Vermerke, Schichten (Spez. MVP 3, Kap. 5.1) ----------

/**
 * Art eines Journaleintrags. Fehlt `art`: «notiz» wenn `notiz === true`, sonst «meldung» (`artOf`, arten.ts).
 * MVP 3.5: + «ausgang» (Meldung/Weitermeldung/Antwort nach oben, kein Zeichen; `an` = Empfänger, `notiz: true`).
 */
export type EntryArt = "meldung" | "auftrag" | "orientierung" | "rueckfrage" | "vbk" | "notiz" | "ausgang";
export const ENTRY_ARTEN: readonly EntryArt[] = ["meldung", "auftrag", "orientierung", "rueckfrage", "vbk", "notiz", "ausgang"];

/** Wert mit Zeitstempel (Zusammenführen pro Feld: späteres `at` gilt, gleich: grösseres `device`) */
export interface Stamp<T> {
  v: T;
  /** ISO UTC */
  at: string;
  device: string;
  /** Kürzel der Schicht */
  von?: string;
}

/** LVZ-Vermerke einer Meldung – ändern `rev` nicht, zählen nie als Konflikt (`contentSig` ohne `lvz`) */
export interface LvzVermerke {
  dringend?: Stamp<boolean>;
  status?: Stamp<"offen" | "erledigt">;
  massnahme?: Stamp<string>;
  /** weitergemeldet an wen, wann (ISO lokal); `null` = zurückgenommen */
  weiter?: Stamp<{ an: string; um: string } | null>;
}

/** Felder einer Meldung im Schema AEIOU oder als Meldezettel (Wann/Wer/Was/Wo), wie gelesen (felder.ts) */
export interface MeldeFelder {
  schema: "aeiou" | "formular";
  wann?: string;
  wer?: string;
  was?: string;
  wie?: string;
  wo?: string;
  /** U / Umwelt / Bemerkung – nie ausgewertet */
  umwelt?: string;
  melder?: string;
}

/** Schichtbeginn oder Übergabe (pro Übung gesammelt, Vereinigung nach ID) */
export interface SchichtWechsel {
  id: string;
  art: "beginn" | "uebergabe";
  /** ISO UTC */
  at: string;
  /** Lagezeit (ISO lokal, Minute) */
  t: string;
  /** Kürzel ab jetzt */
  an: string;
  /** Übergabe: Kürzel, das übergeben hat */
  von?: string;
  device: string;
  /** Übergabe: Stand beim Abschliessen */
  stand?: { offen: number; neu: number };
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
  /**
   * UTC-Offset zur Ereigniszeit `t` («+02:00» Sommerzeit, «+01:00» Winterzeit) – damit die Reihenfolge bei der
   * Rückstellung (doppelte Stunde 02:00–02:59) stimmt; fehlt bei älteren Meldungen. Reihenfolge: `compareEvents` (clock.ts).
   */
  tOffset?: string;
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
  /**
   * Notiz ohne Zeichen (Rückfrage, Auftrag, Befehl, Frage – bestätigt im Meldungsfeld, siehe `Draft.kindHint`): ohne Ort
   * und Element, also nie auf der Karte und ohne Wirkung auf Lage/Hinweise; Art im Journal «Notiz».
   */
  notiz?: boolean;
  /**
   * Frühere Fassungen (älteste zuerst), gefüllt von `correctEvent` – für «korrigiert 07:34», Detail, PDF/CSV.
   * Fehlt bei nie korrigierten Meldungen. `mergeEvents`: die höhere Revision gewinnt samt Historie.
   */
  history?: EventRevision[];
  /** letzte Korrektur (ISO UTC), gesetzt von `correctEvent` – für «korrigiert 07:34» */
  correctedAt?: string;

  // ---- MVP 3 (alle optional, additiv; alte Meldungen: abgeleitet über `artOf`, `nrLabel`, `vermerkeOf`) ----
  /** Art (fehlt = abgeleitet, `artOf`). Nicht-Meldungen: nie pos/unit/cells/nai/shape, immer `notiz: true` */
  art?: EntryArt;
  /**
   * laufende Nummer (eine gemeinsame Folge für alle Geräte, beim Erfassen vergeben, **nie geändert**). Doppelte aus
   * parallelem Erfassen offline werden nur in der Anzeige gekennzeichnet («12a», «12b», `nrLabel`, nummer.ts).
   */
  nr?: number;
  /** Gerät, das den Eintrag erfasst hat (ändert nie, anders als `device` = letzte Änderung) */
  von?: string;
  /** Kürzel der Schicht beim Erfassen */
  erfasstVon?: string;
  /** Kürzel der letzten Korrektur / Streichung */
  geaendertVon?: string;
  /** Auftrag/Rückfrage: Empfänger («H01»); Vbk: Trupp steht in `melder` */
  an?: string;
  /** Orientierung: Absender («Bat», «Kp») */
  quelle?: string;
  /** Auftrag: Frist (ISO lokal) aus «bis 1200» */
  frist?: string;
  /** Vbk: Ergebnis */
  vbk?: "gut" | "schlecht" | "keine";
  /** ID eines früheren Eintrags: Antwort auf Rückfrage, Quittung/Ausführung eines Auftrags, «zu 42» */
  bezug?: string;
  /**
   * Art des Bezugs (für Status): Antwort, Quittung, ausgeführt, Verweis; MVP 3.5 + «weiter»: ein Ausgang meldet die
   * Meldung `bezug` weiter (Vermerk «weitergemeldet» abgeleitet, `vermerkeOf`)
   */
  bezugArt?: "antwort" | "quittung" | "ausgefuehrt" | "verweis" | "weiter";
  /** (MVP 3.5 Fix) weitere Bezüge mit derselben Art («Nr 55 und 56 an Bat weitergemeldet» → bezug 55, bezugAuch [56]) */
  bezugAuch?: string[];
  /** diese Meldung hebt die Meldung mit dieser ID auf (Sperre, Checkpoint, Fläche, Linie) */
  hebtAuf?: string;
  /** genannte Orte bei Nicht-Meldungen und Aufhebungen – nur Text (Liste, Suche, PDF), nie Karte */
  orte?: string[];
  /** AEIOU / Meldezettel, wie gelesen */
  felder?: MeldeFelder;
  /** LVZ-Vermerke (dringend, Status, Massnahme, weitergemeldet) – eigenes Zusammenführen pro Feld (`mergeLvz`) */
  lvz?: LvzVermerke;

  // ---- MVP 3.5 «Feinschliff» (Spez. MVP 3.5, Kap. 5.1; alle optional, additiv) ----
  // `tOffset` besteht seit MVP 3 – ab 3.5 bei jeder Erfassung und Korrektur gesetzt; fehlt er: `offsetOf` (clock.ts).
  // Ausgang (`art: "ausgang"`): `an` = Empfänger («Bat»), `notiz: true`, nie pos/unit/cells/nai/shape (Invariante E3).
  // Rückfrage von oben: `art: "rueckfrage"`, `quelle` = «Bat»/«Kdt», `an` leer.
  /** eigene Meldung mit Begehren (Nachschub, Sanität, Mun-Stand): offen bis erledigt (`vermerkeOf`), kein neues Zeichen */
  begehren?: { was: string };
  /** vom System geschriebener Eintrag (nicht getippt): Übergabe (S20, `art: "notiz"`) */
  system?: "uebergabe";
  /** zu `system: "uebergabe"`: ID des `SchichtWechsel` */
  schichtId?: string;
}

/** Eine frühere Fassung einer Meldung (Schnappschuss vor einer Korrektur). */
export interface EventRevision {
  /** Revision dieser Fassung (`LageEvent.rev` damals) */
  rev: number;
  /** wann diese Fassung entstand (`updatedAt` damals, ISO UTC) */
  at: string;
  /** Gerät, das diese Fassung geschrieben hat */
  device: string;
  text: string;
  t: string;
  melder?: string;
  unit: string;
  side: Side;
  aff: Affiliation;
  sym: string;
  sidc?: string;
  pos?: LV95;
  cells?: string[];
  nai?: string;
  where?: string;
  count?: number;
  dir?: number;
  desc?: string;
  deleted?: boolean;
  /**
   * unterlegene Fassung eines Konflikts beim Zusammenführen (gleiche Revision auf zwei Geräten, anderer Inhalt) – steht
   * neben der gewinnenden Fassung gleicher Revision; nichts geht verloren (`mergeEvents`)
   */
  conflict?: boolean;
  // ---- MVP 3 ----
  art?: EntryArt;
  an?: string;
  quelle?: string;
  frist?: string;
  vbk?: LageEvent["vbk"];
  bezug?: string;
  hebtAuf?: string;
  orte?: string[];
  /** Kürzel, das diese Fassung geschrieben hat */
  von?: string;
  // ---- MVP 3.5 ----
  begehren?: LageEvent["begehren"];
  tOffset?: string;
}

/** Schnappschuss einer Meldung als `EventRevision` (nur gesetzte Felder). */
export function revisionOf(e: LageEvent): EventRevision {
  const r: EventRevision = { rev: e.rev, at: e.updatedAt, device: e.device, text: e.text, t: e.t, unit: e.unit, side: e.side, aff: e.aff, sym: e.sym };
  const opt = {
    melder: e.melder, sidc: e.sidc, pos: e.pos, cells: e.cells, nai: e.nai, where: e.where, count: e.count, dir: e.dir, desc: e.desc, deleted: e.deleted,
    // MVP 3: Art und Bezüge; `von` = Kürzel, das diese Fassung geschrieben hat (letzte Korrektur, sonst Erfassung)
    art: e.art, an: e.an, quelle: e.quelle, frist: e.frist, vbk: e.vbk, bezug: e.bezug, hebtAuf: e.hebtAuf, orte: e.orte, von: e.geaendertVon ?? e.erfasstVon,
    // MVP 3.5
    begehren: e.begehren, tOffset: e.tOffset,
  };
  for (const [k, v] of Object.entries(opt)) if (v !== undefined) (r as unknown as Record<string, unknown>)[k] = Array.isArray(v) ? [...v] : v && typeof v === "object" ? { ...v } : v;
  return r;
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
   * Online-Dienste dieser Übung. `ortssuche`: Ortsnamen bei swisstopo nachschlagen (Meldungsfeld, Kartensuche);
   * `strassen`: Strassennetz (TLM) für Hindernisse & Co. laden. Aus = kein Request (siehe `onlineAllowed`).
   * **Ab MVP 3.5 (Entscheid K2): nur `true` = an**, fehlt = `ONLINE_STANDARD` (aus) – alte Übungen gelten beim Öffnen als
   * aus, nichts wird geschrieben. `at` = letzte Wahl (ISO UTC). Zusammenführen einer Datei: lokal gewinnt (`mergeExercise`).
   */
  onlineDienste?: {
    ortssuche?: boolean; strassen?: boolean;
    /** (MVP 3.5 Nachbesserung, Feld M1) Spracherkennung des Browsers – der Ton geht an Google/Apple/Microsoft */
    sprache?: boolean;
    at?: string;
  };
  /**
   * Löschmarken für Raster, Flächen (NAI/AO …) und Bilder: ID → Zeitpunkt (ISO) des Löschens; `undone` = mit
   * Rückgängig wiederhergestellt. Die spätere Marke gilt. So taucht ein gelöschtes Element beim Zusammenführen
   * (zweites Fenster, ältere Datei) nicht wieder auf (`mergeHull`, `markRemovals` in sync.ts).
   */
  removed?: Record<string, { at: string; undone?: boolean }>;
  // ---- MVP 3 (optional, additiv) ----
  /** Klassifizierung der Übung (Ausdrucke); fehlt → `sheets[0].classification ?? "INTERN"` */
  klassifizierung?: string;
  /** Schichtbeginne und Übergaben (schicht.ts) */
  schichten?: SchichtWechsel[];
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
 * Führt zwei Journale zusammen: pro ID gewinnt die höhere Revision (samt Historie; ältere Fassungen der Verliererin
 * werden ergänzt). **Konflikt** = gleiche Revision, anderer Inhalt (zwei Geräte korrigieren dieselbe Meldung): es gewinnt
 * deterministisch die neuere Korrektur (`correctedAt`, dann `updatedAt`, dann Gerät), die unterlegene Fassung kommt mit
 * `conflict: true` in `history` – nichts geht verloren. Gezählt wird ein Konflikt nur, wenn die unterlegene Fassung
 * noch nicht in der Historie steht (wiederholtes Zusammenführen zählt nicht doppelt). Zählen: `mergeEventsDetailed`.
 */
export function mergeEvents(a: LageEvent[], b: LageEvent[]): LageEvent[] {
  return mergeEventsDetailed(a, b).events;
}

/** wie `mergeEvents`, dazu die IDs der Meldungen mit neuem Konflikt (gleiche Revision, anderer Inhalt) */
export function mergeEventsDetailed(a: LageEvent[], b: LageEvent[]): { events: LageEvent[]; conflicts: string[] } {
  const map = new Map<string, LageEvent>();
  const conflicts = new Set<string>();
  for (const e of [...a, ...b]) {
    const cur = map.get(e.id);
    if (!cur) { map.set(e.id, e); continue; }
    if (e === cur) continue;
    const [w, l] = wins(e, cur) ? [e, cur] : [cur, e];
    const r = mergePair(w, l);
    if (r.conflict) conflicts.add(e.id);
    map.set(e.id, r.ev);
  }
  return { events: [...map.values()].sort(compareEvents), conflicts: [...conflicts] };
}

/** Gewinnt Fassung `x` gegen `y` derselben Meldung? (höhere Revision; gleich: neuere Korrektur, später geändert, Gerät) */
export function eventWins(x: LageEvent, y: LageEvent): boolean {
  return wins(x, y);
}

/** JSON mit sortierten Schlüsseln (Reihenfolge der Felder egal), `undefined` fällt weg */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * Inhalt einer Meldung (ohne Revision, Zeitstempel, Gerät, Historie, LVZ-Vermerke) – gleich = kein Konflikt.
 * `lvz` hat eigene Zeitstempel pro Feld (`mergeLvz`); `nr` bleibt Inhalt (ändert nie).
 */
function contentSig(e: LageEvent): string {
  const { rev: _r, updatedAt: _u, device: _d, history: _h, correctedAt: _c, lvz: _l, ...rest } = e;
  return stableJson(rest);
}

/** Fassungen gleich? (Konfliktmarke zählt nicht) */
function sameRevision(x: EventRevision, y: EventRevision): boolean {
  const { conflict: _a, ...a } = x;
  const { conflict: _b, ...b } = y;
  return stableJson(a) === stableJson(b);
}

/** späterer Stempel gilt (gleiche Zeit: grösseres Gerät); gleiche Stempel → `a` (Identität bleibt) */
function laterStamp<T>(a: Stamp<T> | undefined, b: Stamp<T> | undefined): Stamp<T> | undefined {
  if (!a) return b;
  if (!b) return a;
  if (b.at !== a.at) return b.at > a.at ? b : a;
  return b.device > a.device ? b : a;
}

/**
 * LVZ-Vermerke zweier Fassungen zusammenführen: pro Feld der spätere Stempel (`at`, gleich: grösseres `device`).
 * Kommutativ und idempotent; ändert nichts, wenn `b` nichts Neueres hat (gibt dann `a` selbst zurück).
 * (Steht in model.ts statt lvz.ts, damit `mergeEvents` ohne zyklischen Import auskommt; Spez. MVP 3 Kap. 5.2.)
 */
export function mergeLvz(a?: LvzVermerke, b?: LvzVermerke): LvzVermerke | undefined {
  if (!b) return a;
  if (!a) return b;
  const keys = ["dringend", "status", "massnahme", "weiter"] as const;
  const out: LvzVermerke = {};
  let fromA = true, fromB = true;
  for (const k of keys) {
    const v = laterStamp<unknown>(a[k] as Stamp<unknown> | undefined, b[k] as Stamp<unknown> | undefined);
    if (v !== a[k]) fromA = false;
    if (v !== b[k]) fromB = false;
    if (v) (out as Record<string, unknown>)[k] = v;
  }
  return fromA ? a : fromB ? b : out;
}

/**
 * Zwei Fassungen genau einer Meldung zusammenführen (wie `mergeEvents` für eine ID) – für `persist.ts` (Abgleich der
 * Fenster, Schreiben über eine gleich alte Fassung) und Tests. Reihenfolge der Argumente egal.
 */
export function mergeEventPair(a: LageEvent, b: LageEvent): { ev: LageEvent; conflict: boolean } {
  if (a === b) return { ev: a, conflict: false };
  const [w, l] = wins(a, b) ? [a, b] : [b, a];
  return mergePair(w, l);
}

/** Gewinnerin `w` mit der Historie von `l` und – bei Konflikt – der unterlegenen Fassung `l` selbst; LVZ-Vermerke pro Feld */
function mergePair(w0: LageEvent, l: LageEvent): { ev: LageEvent; conflict: boolean } {
  const lvz = w0.lvz || l.lvz ? mergeLvz(w0.lvz, l.lvz) : undefined;
  const w = lvz === w0.lvz ? w0 : { ...w0, lvz };
  let out = withHistory(w, l);
  if (w.rev !== l.rev || contentSig(w) === contentSig(l)) return { ev: out, conflict: false };
  const lost = { ...revisionOf(l), conflict: true };
  if ((out.history ?? []).some((h) => sameRevision(h, lost))) return { ev: out, conflict: false };
  out = { ...out, history: [...(out.history ?? []), lost].sort((x, y) => x.rev - y.rev || (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)) };
  return { ev: out, conflict: true };
}

/** Historie der Gewinnerin `w`, ergänzt um ältere Fassungen und Konflikt-Fassungen aus `l` (nach Revision, ohne Doppel). */
function withHistory(w: LageEvent, l: LageEvent): LageEvent {
  const wh = w.history ?? [];
  const extra = (l.history ?? []).filter((r) => (r.conflict ? r.rev <= w.rev && !wh.some((x) => sameRevision(x, r)) : r.rev < w.rev && !wh.some((x) => x.rev === r.rev && !x.conflict)));
  if (!extra.length) return w;
  return { ...w, history: [...wh, ...extra].sort((x, y) => x.rev - y.rev || (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)) };
}

function wins(x: LageEvent, y: LageEvent): boolean {
  if (x.rev !== y.rev) return x.rev > y.rev;
  const cx = x.correctedAt ?? "", cy = y.correctedAt ?? "";
  if (cx !== cy) return cx > cy;
  if (x.updatedAt !== y.updatedAt) return x.updatedAt > y.updatedAt;
  return x.device > y.device;
}
