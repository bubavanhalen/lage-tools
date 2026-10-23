/**
 * Mögliche Aktionen Rot (Feindmöglichkeiten): aus Hinweisen und Meldungen abgeleitet, offline.
 * Katalog typischer Möglichkeiten mit Indikatoren; je mehr Indikatoren zutreffen, desto wahrscheinlicher.
 * Es bleiben Hinweise, keine Fakten – jede Möglichkeit nennt ihre Indikatoren (erfüllt/offen) und die Auslöser.
 */
import type { Hint } from "./hints";
import type { LV95 } from "./lv95";
import type { Exercise } from "./model";

export type CoaKind = "ueberfall" | "hinterhalt" | "sperren" | "versorgung" | "aufklaerung" | "infiltration" | "absetzen";

export interface CoaIndicator {
  /** z. B. «Drohne über H05 02:50 (D1)» */
  text: string;
  met: boolean;
  /** Hinweis, der den Indikator erfüllt */
  hintId?: string;
  /** Meldungen, die den Indikator erfüllen */
  events?: string[];
}

export interface RedCoa {
  /** stabil: Art + Ziel (Element/PQ/NAI) */
  id: string;
  kind: CoaKind;
  /** Einordnung: wahrscheinlichste, gefährlichste, weitere */
  label: "wahrscheinlichste" | "gefaehrlichste" | "weitere";
  /** z. B. «Überfall auf Stao H05 (AQ11)» */
  title: string;
  /** Ziel der Aktion */
  target?: { pos: LV95; unit?: string; cell?: string; nai?: string };
  /** erwartete Annäherung (Achse) in LV95, Ausgangspunkt zuerst */
  approach?: LV95[];
  /** Beschreibung der Annäherung, z. B. «aus AP10 über Seftigenstrasse» */
  approachText?: string;
  /** erwarteter Zeitraum (ISO) */
  window?: { from: string; to: string };
  indicators: CoaIndicator[];
  /** 0–1: Anteil/Gewicht erfüllter Indikatoren */
  score: number;
  /** Gefährlichkeit 0–1 (für «gefährlichste») */
  danger: number;
  /** Was prüfen / tun (kurz, in eigenen Worten) */
  check: string[];
  /** alle auslösenden Meldungen */
  events: string[];
}

export interface CoaOptions {
  /** Lagezeit (ISO) */
  t: string;
  /** Hinweise zur Lagezeit (aus analyzeJournal) */
  hints: Hint[];
}

/** Höchstens drei Möglichkeiten: wahrscheinlichste, gefährlichste (falls verschieden), eine weitere */
export function computeRedCoas(_ex: Exercise, _o: CoaOptions): RedCoa[] {
  return [];
}
