/**
 * Verträge zwischen den Paketen A–D (Spez. MVP 1, Kap. 6.3). Nur Typen und reine Funktionen, kein React.
 * Änderungen hier nur nach Absprache (siehe README.md im selben Ordner): wer etwas braucht, ergänzt optional
 * (`?`), entfernt oder benennt nichts um.
 *
 * Kern-Verträge liegen in @lage/core: `EntryState`/`entryState` (entrystate.ts), `EventRevision`/`LageEvent.history`
 * (model.ts), `correctEvent` (journal.ts), `coaHeadline`/`indicatorSummary`/`windowText` (klartext.ts),
 * `Hint.headline?`/`Hint.todo?` (hints.ts), `RedCoa.headline?` (coa.ts).
 *
 * MVP 3 «LVZ-Betrieb» (Spez. MVP 3, Kap. 5.4): Abschnitte «MVP 3» unten; Kern-Verträge in arten.ts, felder.ts,
 * nummer.ts, lvz.ts, schicht.ts, entscheide.ts (Entscheide des Kunden), demolang.ts.
 *
 * MVP 3.5 «Feinschliff» (Spez. MVP 3.5, Kap. 5.7): Abschnitt «MVP 3.5» unten; Kern-Verträge in clock.ts (Zeit mit
 * Offset), nummer.ts (`nrText`, `findAllByNr`), zaehlen.ts, lvz.ts (`bezugAufloesen`), entscheide.ts; Module
 * `betrieb/` (Paket A) und `map/symbolSize.ts` (Paket B).
 */
import type L from "leaflet";
import type { EntryArt, EventQuality, Exercise, Hint, Kind, LageEvent, LV95, OffenItem, RedCoa } from "@lage/core";
import type { LayerFlags } from "../layers";
import type { LageRotState } from "../lageRot";
import type { Bounds, TileLayer } from "../tiles";
import type { SwimTimelineProps } from "../SwimTimeline";

export type { EntryState, EntryReason, EntryReasonCode, EntryLevel, EntryStateOptions, EventRevision } from "@lage/core";

// ---------- Arbeitsweise (Paket A) ----------
export type Modus = "lage" | "vorbereiten";
/** pro Gerät in `localStorage["lage-tools.arbeitsweise"]`; Erststart `{ modus: "lage", experte: false }` */
export interface Arbeitsweise { modus: Modus; experte: boolean }
export const ARBEITSWEISE_KEY = "lage-tools.arbeitsweise";
export const ARBEITSWEISE_START: Arbeitsweise = { modus: "lage", experte: false };

// ---------- Zeit (Paket C) ----------
/** «Zeige letzte» in Minuten; null = alles. Nie gespeichert. (MVP 3: + 360 = 6 h, Standard ab 200 Meldungen) */
export type ShowLast = 30 | 60 | 120 | 360 | null;
export type LageZeit = { kind: "live" } | { kind: "rueckblick"; t: string; playing: boolean };
export type GoLiveGrund = "knopf" | "taste" | "eintragen" | "zeitablauf" | "ende";
export interface ZeitApi {
  zeit: LageZeit;
  /** Lagezeit (ISO lokal «YYYY-MM-DDTHH:MM»): LIVE = jetzt, Rückblick = t */
  tNow: string;
  /** Anfang von «Zeige letzte» (ISO lokal) oder null */
  from: string | null;
  showLast: ShowLast;
  setShowLast(s: ShowLast): void;
  lookBack(t: string): void;
  setPlaying(p: boolean): void;
  goLive(grund: GoLiveGrund): void;
  /** R4: Timer ruht, solange irgendein Schlüssel an ist (Präsentation, Dialoge, Menü) */
  suspend(key: string, on: boolean): void;
  /** Sekunden bis zur automatischen Rückkehr nach LIVE, null = kein Timer */
  remaining: number | null;
  /** (C, ergänzt) LIVE-Zeit (ISO lokal): jetzt bzw. letzte Meldung, wenn die Übung vorbei ist – für «vor 1 h 55 min» */
  tLive?: string;
  /** (C, ergänzt) nur Experte: fester Anfang «ab 05:30» (Griff im Zeitstrahl ziehen); schliesst «Zeige letzte» aus */
  ab?: string | null;
  setAb?(t: string | null): void;
  /**
   * (MVP 3.5, S22) Geräteuhr als Lagezeit mit Offset («2030-05-15T07:31+02:00») – für die Anzeige «LIVE 07:31», Übergabe
   * «Stand», Druck «Stand». Phase 0: gesetzt (`jetztLagezeit`); `tNow`/`tLive` tragen den Offset erst mit Paket E.
   */
  tUhr: string;
}

// ---------- Kopf (Paket A) ----------
export interface SaveStatus { state: "gespeichert" | "speichert" | "fehler"; at?: number; text?: string }
export interface OfflineStatus {
  ready: boolean;
  net: boolean;
  parts: { app: boolean; karte: boolean; speicher: boolean };
  /** Klartext-Gründe, z. B. «Karte nicht gespeichert» (Kap. 4.6) */
  missing: string[];
}

// ---------- Meldungsfeld, Liste, Suche (Paket B) ----------
export interface EntryBoxProps {
  ex: Exercise;
  map: L.Map;
  device: string;
  experte: boolean;
  update(f: (x: Exercise) => Exercise): void;
  say(t: string): void;
  zeit: Pick<ZeitApi, "zeit" | "tNow">;
  /** nach Eintragen/Korrektur: A ruft `goLive("eintragen")` und wählt die Zeile */
  onCommitted(ids: string[]): void;
  /** Korrektur anfordern (n zählt hoch, damit dieselbe ID erneut auslöst) */
  correct: { id: string; n: number } | null;
  /** «Meldung hier» aus dem Kontextmenü der Karte */
  reportAt: { pos: LV95; n: number } | null;
  /** (MVP 3, C liefert) Kürzel/Schicht – Abfrage «Wer erfasst?» beim ersten Enter ohne Kürzel (Kap. 2.3) */
  schicht?: SchichtApi;
  /** (MVP 3, C liefert) nächste laufende Nummer: liest–erhöht–schreibt den Gerätezähler (`NR_KEY`) synchron, Kap. 3.3 */
  onNr?(): number;
  /**
   * (MVP 3.5, A liefert `useSchutzHinweis`, E zeigt) einmaliger Hinweis «Dieses Gerät schützt die Daten nicht dauerhaft.
   * [So geht’s] [OK]» unter dem Feld (`eb-notice`, S7). Phase 0: verdrahtet, `zeigen` immer false.
   */
  schutzHinweis?: SchutzHinweis;
}
export type JournalEmpty = "erststart" | "suche" | "zeige-letzte" | "rueckblick" | null;
export interface JournalListProps {
  ex: Exercise;
  /** schon nach Lagezeit, «Zeige letzte» und Suche gefiltert */
  events: LageEvent[];
  selected: string | null;
  onSelect(id: string | null): void;
  onCorrect(id: string): void;
  onDelete(id: string): void;
  quality?: Map<string, EventQuality>;
  empty: JournalEmpty;
  /** (MVP 3, C liefert) für «Mehr …» an der gewählten Zeile (B hängt `LvzMenu` selbst ein) */
  lvz?: Omit<LvzRowProps, "e" | "ex">;
  /** (MVP 3) Trenner «Neu in deiner Schicht ↑ · seit 06:00 (BSP)»; null = keiner (Rückblick, Suche, ohne Kürzel) */
  schichtSeit?: { seit: string; kuerzel: string } | null;
  /** (MVP 3) gestrichene Einträge zeigen («Gestrichene zeigen (n)») */
  gestrichene?: boolean;
  onGestrichene?(on: boolean): void;
}
/**
 * Suchfilter «Art»: Kind oder «einzeln» (= «nur 1 Trupp»); MVP 3: «gestrichen», «dringend», «offen» und die
 * Nicht-Meldungen (Auftrag, Orientierung, Rückfrage, Vbk, Notiz)
 */
export type SearchArt = Kind | "einzeln" | "gestrichen" | "dringend" | "offen" | Exclude<EntryArt, "meldung"> | null;
export interface UnifiedSearchProps {
  ex: Exercise;
  map: L.Map;
  onQuery(q: string, art: SearchArt): void;
  onPickEvent(id: string): void;
}

// ---------- «Was Rot vorhaben könnte» (Paket D) ----------
export interface RedPanelProps {
  ex: Exercise;
  /** Lagezeit */
  t: string;
  from: string | null;
  hints: Hint[];
  lage: LageRotState;
  variant: "basis" | "experte";
  selHint: string | null;
  selCoa: string | null;
  onSelectHint(id: string | null): void;
  onSelectCoa(id: string | null): void;
  onMapHint(h: Hint): void;
  onMapCoa(c: RedCoa): void;
  onEvent(id: string): void;
  update(f: (x: Exercise) => Exercise): void;
  /** Rückblick: Lagezeit (ISO lokal) für den Streifen «Stand 05:30»; in LIVE weglassen (Paket D, additiv) */
  stand?: string | null;
}

// ---------- Live-Band (Paket C) ----------
export interface TimeBandProps {
  ex: Exercise;
  zeit: ZeitApi;
  experte: boolean;
  /** Zeit der letzten Meldung (ISO lokal) oder null */
  lastReport: string | null;
  /** nur Experte: ganzer Zeitstrahl */
  swim?: SwimTimelineProps;
}

// ---------- Kartenebenen (Paket A setzt um, C liest) ----------
/**
 * Wirksame Ebenen aus Arbeitsweise und Wahl des Benutzers (Kap. 3.7).
 * - Experte: Wahl des Benutzers unverändert.
 * - Basis: Flächen folgen Eigene/Feind; keine Wege, keine Fotos. `hinweise`/`aktionen` bleiben an, die Ebenen zeigen
 *   in der Basis aber nur das Gewählte (Option `onlySelected` in hintLayer/coaLayer, Paket C). `zeiten` bleibt an,
 *   die Beschriftungsregel (map/quiet.ts, Paket C) entscheidet, welche Zeichen ein Zeit-Fähnchen bekommen.
 * - Vorbereiten: Raster und NAI immer sichtbar (dort wird bearbeitet).
 */
export function effectiveFlags(a: Arbeitsweise, user: LayerFlags): LayerFlags {
  const f: LayerFlags = { ...user };
  if (!a.experte) {
    f.flaechen = user.eigene || user.feind;
    f.spuren = false;
    f.anhaenge = false;
    f.zeiten = true;
    f.hinweise = true;
    f.aktionen = true;
  }
  if (a.modus === "vorbereiten") {
    f.raster = true;
    f.nai = true;
  }
  return f;
}

/** Testhaken (stabil, nur lesen): Attributnamen für Abnahme und Inventar (Kap. 6.3, 7.2). */
export const TESTHAKEN = {
  /** an Segmenten/Chipreihen/Zoom: alle Elemente mit gleichem nächstem `data-zaehl` zählen als 1 */
  zaehl: "data-zaehl",
  /** am Vorschau-Block: «bereit» | «pruefen» | «geht-nicht» */
  zustand: "data-zustand",
  /** an `.app`: «live» | «rueckblick» */
  lagezeit: "data-lagezeit",
  /** (MVP 3) an `.jl-row`: Art des Eintrags (`EntryArt`) */
  art: "data-art",
  /** (MVP 3) an `.jl-row`: Anzeige-Nummer («54», «12a») */
  nr: "data-nr",
  /** (MVP 3) Übergabe-Seite: `role="dialog"` mit diesem `aria-label` (uebergabe.spec.ts liest Text und Wörter darin) */
  uebergabe: "Übergabe",
  /** (MVP 3) Trenner «Neu in deiner Schicht ↑» in der Liste: Klasse (kein `li`, zählt nicht als Zeile) */
  trenner: "jl-trenner",
} as const;

// =====================================================================================================================
// MVP 3 «LVZ-Betrieb» (Spez. MVP 3, Kap. 5.4) – nur Ergänzungen
// =====================================================================================================================

/** Ansicht der Spalte: Umschalter `Journal | Offen n | Was Rot` (AppShell.tsx re-exportiert) */
export type SideView = "journal" | "offen" | "rot";

// ---------- Schicht und Kürzel (Paket C, Kap. 3.6) ----------
/** `localStorage`-Schlüssel der Schicht dieses Geräts je Übung: `SchichtLokal` als JSON; Fenster gleichen über `storage` ab */
export const SCHICHT_KEY = (exId: string): string => `lage-tools.schicht.${exId}`;
export interface SchichtLokal {
  kuerzel: string | null;
  /** Beginn der eigenen Schicht (ISO UTC) */
  seit: string | null;
  /** ID des `SchichtWechsel` in `ex.schichten` */
  wechselId: string | null;
}
/** `localStorage`-Schlüssel des Gerätezählers der laufenden Nummer je Übung (Zahl als Text, Kap. 3.3, nummer.ts) */
export const NR_KEY = (exId: string): string => `lage-tools.nr.${exId}`;

/**
 * Kürzel prüfen und schreiben wie gespeichert – **eine Regel für Kürzel und Visum** (MVP 3.5, S24; Phase 0 fertig):
 * Leerzeichen, Punkt, Bindestrich fallen weg, Ä/Ö/Ü → AE/OE/UE, gross; gültig sind 2–6 Zeichen A–Z und Ziffern
 * («mu» → «MU», «Wm M» → «WMM», «M-U» → «MU»), sonst null. Nie still abschneiden (kein `maxLength`).
 */
export function kuerzelNorm(k: string): string | null {
  const s = k.toUpperCase().replace(/[\s.\-‐–]/g, "").replace(/Ä/g, "AE").replace(/Ö/g, "OE").replace(/Ü/g, "UE");
  return /^[A-Z0-9]{2,6}$/.test(s) ? s : null;
}
/** Hinweis zur Eingabe (MVP 3.5): null = gültig, sonst «2–6 Zeichen: Buchstaben A–Z und Ziffern» (sichtbar, nie still) */
export function kuerzelHinweis(k: string): string | null {
  return kuerzelNorm(k) ? null : KUERZEL_HINWEIS;
}
export const KUERZEL_HINWEIS = "2–6 Zeichen: Buchstaben A–Z und Ziffern";

export interface SchichtApi {
  kuerzel: string | null;
  /** Beginn der eigenen Schicht (ISO UTC) */
  seit: string | null;
  /** Kürzel setzen = Schichtbeginn (neu: true) oder nur Schreibweise */
  setKuerzel(k: string, o?: { neu?: boolean }): void;
  /** Übergabe abschliessen: Wechsel in `ex.schichten`, Gerät übernimmt `an` */
  uebergeben(von: string, an: string, stand: { offen: number; neu: number }): void;
  /** Abfrage im Meldungsfeld in dieser Sitzung schon gezeigt */
  gefragt: boolean;
  setGefragt(): void;
}

// ---------- Zeile «Mehr …» (Paket B) ----------
export interface LvzRowProps {
  e: LageEvent;
  ex: Exercise;
  device: string;
  kuerzel: string | null;
  update(f: (x: Exercise) => Exercise): void;
  /** «Antwort eintragen»: Text ins Meldungsfeld setzen */
  onPrefill(text: string): void;
}

// ---------- Offen und Übergabe (Paket C) ----------
export interface OffenPanelProps {
  ex: Exercise;
  items: OffenItem[];
  hints: Hint[];
  selected: string | null;
  onSelect(key: string | null): void;
  /** Zur Meldung (Journal, Zeile gewählt) */
  onEvent(id: string): void;
  /** Ort setzen */
  onCorrect(id: string): void;
  /** Was Rot, Detail */
  onHint(id: string): void;
  /** Antwort/Vbk eintragen */
  onPrefill(text: string): void;
  onUebergabe(): void;
  update(f: (x: Exercise) => Exercise): void;
  device: string;
  kuerzel: string | null;
  rueckblick: boolean;
}
export interface UebergabeProps {
  ex: Exercise;
  tLive: string;
  hints: Hint[];
  lage: LageRotState;
  items: OffenItem[];
  schicht: SchichtApi;
  ki: boolean;
  onClose(): void;
  say(t: string): void;
  // ---- MVP 3.5 (Kap. 5.7, Phase 0 verdrahtet; Paket D nutzt sie) ----
  /** Geräteuhr mit Offset – «Stand T2 15.05.2030 07:31» (S22) */
  tUhr: string;
  /** Übergabe-Eintrag `system: "uebergabe"` schreiben (S20) */
  update(f: (x: Exercise) => Exercise): void;
  device: string;
  /** «Datei sichern …» = Menü «Datei für anderes Gerät …» (S9) */
  onSaveFile(): void;
  /** letzte Datei-Sicherung dieser Übung auf diesem Gerät (ISO UTC) oder null */
  dateiGesichert: string | null;
}

// ---------- Drucken (Paket D) ----------
export interface JournalDruck {
  /** `from`/`to` ISO lokal (Lagezeit); Vorwahl: `journalDruckVorwahl` (@lage/core, Entscheid 4) */
  /** `kuerzel`: Schicht mit festem Kürzel («Letzte Schicht BSP», sonst das Kürzel des Wechsels bis `to`) */
  /**
   * `at` (nur Schicht, MVP 3 Fix 3): Einträge nach Erfassung wählen – ab Schichtbeginn `von` bis vor dem Wechsel `bis`
   * (ISO UTC), wie Übergabe und CSV (`schichtEintraege`); `from`/`to` bleiben für Kopf und Anhänge
   */
  umfang: { art: "schicht" | "tag" | "alles" | "zeitraum"; from: string | null; to: string; kuerzel?: string; at?: { von: string | null; bis?: string | null } };
  anhang: { lageRot: boolean; hinweise: boolean; ohneGestrichene: boolean };
  klassifizierung: string;
  kuerzel: string | null;
}
export interface LagekarteDruck {
  paper: "A4" | "A3";
  ausschnitt: "karte" | "raster";
  /** LV95 */
  bounds: Bounds;
  t: string;
  from: string | null;
  klassifizierung: string;
  kuerzel: string | null;
  onProgress?(p: number): void;
}
/** Abdeckung des Kachel-Caches (offline.ts: `tileCoverage(b, z, layer?)`, nur `caches.match`) */
export interface TileCoverage { z: number; total: number; cached: number; share: number }
export type TileCoverageFn = (b: Bounds, z: number, layer?: TileLayer) => Promise<TileCoverage>;

/** Klassifizierung für Ausdrucke: Übung → erstes Raster → «INTERN» */
export const klassifizierungOf = (ex: Pick<Exercise, "klassifizierung" | "sheets">): string => ex.klassifizierung ?? ex.sheets[0]?.classification ?? "INTERN";

// ---------- Leistung (Paket D, Kap. 3.12) ----------
/** Übung für den Web Worker: ohne Bilder und Anhänge (werden nicht kopiert) */
export type AnalyseInput = Omit<Exercise, "overlays" | "attachments">;
/** analyse.worker.ts: Auftrag (ein neuerer ersetzt ältere, `gen` zählt hoch) */
export interface AnalyseAuftrag { gen: number; ex: AnalyseInput; t: string; from: string | null; conflictIds?: string[] }
/** analyse.worker.ts: Ergebnis (gleiche Formen wie `useHints`/`useLageRot`/`offenePunkte`) */
export interface AnalyseErgebnis { gen: number; hints: Hint[]; quality: Map<string, EventQuality>; all: Hint[]; lageRot: LageRotState; offen: OffenItem[] }

/**
 * Messpunkte `performance.mark(...)` (P1); `window.__ltPerf()` liefert die Abstände in ms. MVP 3.5: `lt:zeichen:start|ende`
 * (Neuaufbau bei Wechsel der Grössenklasse, Paket B), `lt:offline-pruefung:start|ende` (Kartenabdeckung, Paket A).
 */
export const PERF_MARK = { enter: "lt:enter", zeile: "lt:zeile", bereit: "lt:bereit", zeichen: "lt:zeichen", offlinePruefung: "lt:offline-pruefung" } as const;
export interface LtPerf {
  /** Navigation → erste Liste und Feld bedienbar */
  bereit?: number;
  /** letztes Enter → neue Zeile im DOM */
  enterZeile?: number;
  /** alle Enter → Zeile seit dem Laden */
  enterZeileAlle?: number[];
}
/** `window.__ltPdfInfo`: letztes erzeugtes PDF (nur lesen, auch im Produktivbau; keine Daten nach aussen) */
export interface LtPdfInfo {
  seiten: number; format: "a4" | "a3"; quer: boolean; zeilen: string[];
  /** (MVP 3.5, D8) jede gesetzte Textbox (mm, Seite ab 1) – Prüfung «keine Überlappung», Schriftgrösse */
  boxes?: Array<{ seite: number; x: number; y: number; w: number; h: number; pt: number; text: string }>;
  /** (MVP 3.5) Füllflächen mit Farbe ≠ weiss (Prüfung «Farbe nur in Spalte Art») */
  fills?: Array<{ seite: number; x: number; y: number; w: number; h: number; farbe: string }>;
  /** (MVP 3.5) gezeichnete Vektorzeichen (`glyphPunkt/glyphHaken/glyphWarn/glyphKreuz`, pdfSafe.ts) */
  glyphen?: { punkt: number; haken: number; warn: number; kreuz: number };
}
declare global {
  interface Window {
    __ltPerf?: () => LtPerf;
    __ltPdfInfo?: LtPdfInfo;
  }
}

// =====================================================================================================================
// MVP 3.5 «Feinschliff» (Spez. MVP 3.5, Kap. 5.7) – nur Ergänzungen. Phase 0: Typen, Stubs mit Standardwerten in den
// genannten Modulen; «fertig» sind `kuerzelNorm`/`kuerzelHinweis` (oben) und `betrieb/dateiSichern.ts`.
// =====================================================================================================================

// ---------- Kürzel-Zeile beim Öffnen (Paket E, Kap. 2.2) ----------
export interface KuerzelZeileProps { exId: string; onSet(k: string): void }

// ---------- Meldungsfeld (Paket E): einmaliger Schutzhinweis (A liefert `useSchutzHinweis`, E zeigt ihn, S7) ----------
export interface SchutzHinweis { zeigen: boolean; ok(): void; mehr(): void }

// ---------- Suche (A liefert `SearchApi.online`, E zeigt die Vorschlagszeile, S3) ----------
/** Online-Ortssuche nur auf Klick «‹q› bei swisstopo suchen» – nie automatisch */
export interface SearchOnline {
  /** `onlineAllowed(ex, "ortssuche") && navigator.onLine && isPlaceName(q) && wantsPlaceLookup(q, local)` */
  moeglich: boolean;
  laeuft: boolean;
  /** fragt einmal ab; Treffer erscheinen wie heute als «Ort» */
  suchen(): void;
  fehler?: string;
}

// ---------- Betrieb (Paket A) – Ordner packages/ui/src/betrieb/ ----------
export interface BetriebStatus {
  /** App-Dateien im Zwischenspeicher (Service Worker) */
  app: boolean;
  /** Kartenabdeckung des Raster-Gebiets bis 5 m/px; `geprueft` = vollständig geprüft (keine Stichprobe, S8) */
  karte: { share: number; total: number; cached: number; geprueft: boolean };
  /** `navigator.storage.persisted()` */
  speicher: boolean;
  /** als App installiert (`display-mode: standalone` bzw. `navigator.standalone`) */
  installiert: boolean;
  /** Weg zur Installation: Knopf (`beforeinstallprompt`), Anleitung iOS, Anleitung sonst, schon installiert */
  install: "prompt" | "ios" | "manuell" | "fertig";
  /** Online-Dienste der Übung (`onlineAllowed`) */
  online: { ortssuche: boolean; strassen: boolean };
  /** letzte Datei-Sicherung dieser Übung auf diesem Gerät (ISO UTC) oder null */
  dateiGesichert: string | null;
  /** «Alles für offline laden» läuft: Fortschritt, sonst null */
  laden: { done: number; total: number } | null;
  net: boolean;
}
export interface OfflinePopoverProps {
  ex: Exercise;
  map: L.Map | null;
  status: BetriebStatus;
  /** Kopf-Knopf (Popover darunter, Fokus zurück beim Schliessen) */
  anker: HTMLElement | null;
  onClose(): void;
  onSaveFile(): void;
  say(t: string): void;
  /** (Phase 0, Übergang bis Paket A «Alles für offline laden» baut) zu Vorbereiten → Offline, wie bisher der Kopf-Knopf */
  onVorbereiten?(): void;
}
/** Bildschirm bleibt an (S5): Einstellung pro Gerät «an»|«aus», fehlt = an */
export const WAKE_KEY = "lage-tools.wachbleiben";
/** Datei-Sicherung je Übung auf diesem Gerät: ISO UTC (`betrieb/dateiSichern.ts`) */
export const DATEI_KEY = (exId: string): string => `lage-tools.datei.${exId}`;
/** einmaliger Schutzhinweis je Übung und Gerät (S7) */
export const SCHUTZHINWEIS_KEY = (exId: string): string => `lage-tools.schutzhinweis.${exId}`;

// ---------- Karte (Paket B) – packages/ui/src/map/ ----------
export type ZeichenStufe = "S" | "M" | "L";
export interface ZeichenGroesse { stufe: ZeichenStufe; praesentation: boolean }
/** Zeichengrösse pro Gerät («S»|«M»|«L», fehlt = M) */
export const ZEICHEN_KEY = "lage-tools.zeichengroesse";
/** Kandidat der Auswahlliste «Welches Zeichen?» (S12, `map/pick.ts`) */
export interface PickKandidat { id: string; kind: import("../journalLayer").ItemKind; label: string; zeit: string; dist: number }
