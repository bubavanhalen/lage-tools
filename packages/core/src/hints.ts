/**
 * Hinweise zu Rot: Regeln über das Lagejournal (offline, ohne KI).
 * Das Lagejournal gibt Hinweise, keine Fakten – jeder Hinweis nennt Auslöser (Meldungen), Regel und Quelle.
 * Regeln in eigenen Worten; Quelle nur als Reglement-Nummer und Ziffer.
 */
import type { LV95 } from "./lv95";
import type { Exercise, LageEvent } from "./model";

/** Regelgruppe */
export type HintGroup = "normallage" | "praesenz" | "absicht" | "rotsiehtblau" | "qualitaet";

/** Wichtigkeit: hoch = Handeln prüfen, mittel = beobachten, info = Referenz */
export type HintLevel = "hoch" | "mittel" | "info";

export interface HintRule {
  /** z. B. «C1» */
  id: string;
  group: HintGroup;
  /** Kurzname, z. B. «Übergabe / Zusammenschluss» */
  name: string;
  /** Regel in eigenen Worten (ein Satz) */
  rule: string;
  /** Quelle als Reglement-Nummer und Ziffer, z. B. «53.005.25 Ziff 184» */
  source?: string;
}

export interface Hint {
  /** stabil über Neuberechnungen: Regel + sortierte Auslöser-IDs (bzw. NAI/Element) */
  id: string;
  rule: string;
  level: HintLevel;
  /** Titel, z. B. «Mögliche Übergabe in AK9» */
  title: string;
  /** Begründung in einem bis zwei Sätzen, mit Zeiten/Orten */
  text: string;
  /** Meldungen, die den Hinweis auslösen (IDs) */
  events: string[];
  /** Zeitpunkt, ab dem der Hinweis gilt (ISO) */
  t: string;
  /** Ort für Karte (Schwerpunkt der Auslöser) */
  pos?: LV95;
  cells?: string[];
  nai?: string;
  /** betroffenes eigenes Element, z. B. «H03» */
  unit?: string;
  /** Prognose, z. B. nächste Durchfahrt (ISO) */
  next?: string;
}

/** Qualität einer einzelnen Meldung (E1/E2) – an der Meldung anzeigen, nicht als Hinweis */
export interface EventQuality {
  /** E1: bestätigt durch zweite Quelle (ID der bestätigenden Meldung) */
  confirmedBy?: string[];
  /** E2: fehlende Angaben, z. B. ["Ort", "Melder"] */
  missing?: string[];
}

export interface HintOptions {
  /** Lagezeit (ISO): nur Meldungen bis dahin, Hinweise wie sie zu diesem Zeitpunkt erschienen wären */
  t: string;
  /** Regeln abschalten (IDs) */
  disabled?: string[];
}

export const HINT_RULES: HintRule[] = [];

/** Alle Hinweise zur Lagezeit, wichtigste zuerst, dann neueste */
export function computeHints(_ex: Exercise, _o: HintOptions): Hint[] {
  return [];
}

/** Qualität je Meldung (E1 bestätigt/unbestätigt, E2 unvollständig) bis zur Lagezeit */
export function eventQuality(_events: LageEvent[], _t: string, _ex?: Exercise): Map<string, EventQuality> {
  return new Map();
}
