/**
 * Verträge zwischen den Paketen A–D (Spez. MVP 1, Kap. 6.3). Nur Typen und reine Funktionen, kein React.
 * Änderungen hier nur nach Absprache (siehe README.md im selben Ordner): wer etwas braucht, ergänzt optional
 * (`?`), entfernt oder benennt nichts um.
 *
 * Kern-Verträge liegen in @lage/core: `EntryState`/`entryState` (entrystate.ts), `EventRevision`/`LageEvent.history`
 * (model.ts), `correctEvent` (journal.ts), `coaHeadline`/`indicatorSummary`/`windowText` (klartext.ts),
 * `Hint.headline?`/`Hint.todo?` (hints.ts), `RedCoa.headline?` (coa.ts).
 */
import type L from "leaflet";
import type { EventQuality, Exercise, Hint, Kind, LageEvent, LV95, RedCoa } from "@lage/core";
import type { LayerFlags } from "../layers";
import type { LageRotState } from "../lageRot";
import type { SwimTimelineProps } from "../SwimTimeline";

export type { EntryState, EntryReason, EntryReasonCode, EntryLevel, EntryStateOptions, EventRevision } from "@lage/core";

// ---------- Arbeitsweise (Paket A) ----------
export type Modus = "lage" | "vorbereiten";
/** pro Gerät in `localStorage["lage-tools.arbeitsweise"]`; Erststart `{ modus: "lage", experte: false }` */
export interface Arbeitsweise { modus: Modus; experte: boolean }
export const ARBEITSWEISE_KEY = "lage-tools.arbeitsweise";
export const ARBEITSWEISE_START: Arbeitsweise = { modus: "lage", experte: false };

// ---------- Zeit (Paket C) ----------
/** «Zeige letzte» in Minuten; null = alles. Nie gespeichert. */
export type ShowLast = 30 | 60 | 120 | null;
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
}
/** Suchfilter «Art»: Kind oder «einzeln» (= «nur 1 Trupp») */
export type SearchArt = Kind | "einzeln" | null;
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
} as const;
