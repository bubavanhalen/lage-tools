/**
 * Gleiche Prüfregeln überall (Nachbesserung K2): Meldungsfeld, Foto-/Sprach-Übersicht (`BatchReview`) und
 * Eintrage-Weg für mehrere Meldungen (`commitTexts`) rufen `entryState` mit denselben Angaben zur Übung auf.
 * Ohne Browser testbar.
 */
import { clockDay, entryState, type Draft, type EntryState, type EntryStateOptions, type Exercise } from "@lage/core";

export interface EntryEnv {
  /** Netz vorhanden und Ortssuche erlaubt (Standard: true – betrifft nur «bitte prüfen» bei Ortsnamen) */
  online?: boolean;
  now?: Date;
  placePending?: boolean;
  manualPos?: boolean;
  hasPos?: boolean;
  /** zusätzlich bekannter Trupp (Korrektur: Trupp der Meldung) */
  alsoKnown?: string;
  /** (MVP 3) Tag folgt der Uhr (Standard: `clockDay(ex.days, now).follow`); Korrektur: true (Tag der Meldung gilt) */
  follow?: boolean;
  /** (MVP 3) Zeit der letzten Meldung (Standard: aus `ex.events`) – Vorschlag bei «Tag fremd» */
  lastReport?: string | null;
}

/** jüngste Lagezeit der Übung (nicht gestrichen), null ohne Einträge */
export function lastReportOf(ex: Pick<Exercise, "events">): string | null {
  let m: string | null = null;
  for (const e of ex.events ?? []) if (!e.deleted && (!m || e.t > m)) m = e.t;
  return m;
}

/** Optionen für `entryState` aus der Übung: Raster, NAI, bekannte/vorbereitete Trupps, Übungstage */
export function entryOptions(ex: Pick<Exercise, "sheets" | "areas" | "units" | "days"> & Partial<Pick<Exercise, "events">>, env: EntryEnv = {}): EntryStateOptions {
  const now = env.now ?? new Date();
  return {
    hasRaster: ex.sheets.length > 0,
    online: env.online ?? true,
    placePending: !!env.placePending,
    manualPos: !!env.manualPos,
    hasPos: !!env.hasPos,
    now,
    sheets: ex.sheets,
    areas: ex.areas,
    knownUnits: env.alsoKnown ? [...ex.units.blau, env.alsoKnown] : ex.units.blau,
    // Trupps vorbereitet (Vorbereiten, Schritt «Trupps», oder schon gelernt): ein neuer Name ist gelb «neu anlegen?»
    unitsPrepared: ex.units.blau.length > 0,
    days: ex.days,
    // MVP 3 (E17): heute kein Tag der Übung und der Text nennt keinen Tag → gelb «Tag fremd» mit Vorschlag
    follow: env.follow ?? clockDay(ex.days, now).follow,
    lastReport: env.lastReport !== undefined ? env.lastReport : lastReportOf(ex),
  };
}

/** Zustand einer Meldung wie im Meldungsfeld */
export function stateOf(d: Draft, ex: Pick<Exercise, "sheets" | "areas" | "units" | "days"> & Partial<Pick<Exercise, "events">>, env: EntryEnv = {}): EntryState {
  return entryState(d, entryOptions(ex, env));
}
