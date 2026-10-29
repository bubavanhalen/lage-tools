/**
 * Gleiche Prüfregeln überall (Nachbesserung K2): Meldungsfeld, Foto-/Sprach-Übersicht (`BatchReview`) und
 * Eintrage-Weg für mehrere Meldungen (`commitTexts`) rufen `entryState` mit denselben Angaben zur Übung auf.
 * Ohne Browser testbar.
 */
import { entryState, type Draft, type EntryState, type EntryStateOptions, type Exercise } from "@lage/core";

export interface EntryEnv {
  /** Netz vorhanden und Ortssuche erlaubt (Standard: true – betrifft nur «bitte prüfen» bei Ortsnamen) */
  online?: boolean;
  now?: Date;
  placePending?: boolean;
  manualPos?: boolean;
  hasPos?: boolean;
  /** zusätzlich bekannter Trupp (Korrektur: Trupp der Meldung) */
  alsoKnown?: string;
}

/** Optionen für `entryState` aus der Übung: Raster, NAI, bekannte/vorbereitete Trupps, Übungstage */
export function entryOptions(ex: Pick<Exercise, "sheets" | "areas" | "units" | "days">, env: EntryEnv = {}): EntryStateOptions {
  return {
    hasRaster: ex.sheets.length > 0,
    online: env.online ?? true,
    placePending: !!env.placePending,
    manualPos: !!env.manualPos,
    hasPos: !!env.hasPos,
    now: env.now ?? new Date(),
    sheets: ex.sheets,
    areas: ex.areas,
    knownUnits: env.alsoKnown ? [...ex.units.blau, env.alsoKnown] : ex.units.blau,
    // Trupps vorbereitet (Vorbereiten, Schritt «Trupps», oder schon gelernt): ein neuer Name ist gelb «neu anlegen?»
    unitsPrepared: ex.units.blau.length > 0,
    days: ex.days,
  };
}

/** Zustand einer Meldung wie im Meldungsfeld */
export function stateOf(d: Draft, ex: Pick<Exercise, "sheets" | "areas" | "units" | "days">, env: EntryEnv = {}): EntryState {
  return entryState(d, entryOptions(ex, env));
}
