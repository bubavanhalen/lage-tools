/**
 * KI (Claude) – nur nach ausdrücklichem Einschalten pro Übung.
 * Kern: reine Funktionen ohne Netz – Anfragen bauen (Datensparsamkeit: nur das Nötige) und Antworten prüfen.
 * Das Senden (fetch an die Anthropic-API mit eigenem Schlüssel des Benutzers) liegt in der Oberfläche.
 */
import type { Hint } from "./hints";
import type { RedCoa } from "./coa";
import type { Exercise, LageEvent } from "./model";

/** Zweck eines KI-Aufrufs (für Anzeige, Protokoll und Einwilligung) */
export type KiPurpose = "handschrift" | "meldung" | "hinweis" | "lagerot" | "lagebericht";

export const KI_PURPOSE_LABEL: Record<KiPurpose, string> = {
  handschrift: "Handschrift erkennen",
  meldung: "Unklare Meldung deuten",
  hinweis: "Hinweis ausformulieren",
  lagerot: "Mögliche Aktion Rot begründen",
  lagebericht: "Lagebericht entwerfen",
};

/** Inhaltsteil (Anthropic Messages API) */
export type KiContent =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

/** Werkzeug für strukturierte Antworten (tool use) */
export interface KiTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Fertige Anfrage – die Oberfläche ergänzt Modell und sendet */
export interface KiRequest {
  purpose: KiPurpose;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: KiContent[] }>;
  /** strukturierte Antwort erzwingen */
  tool?: KiTool;
  max_tokens: number;
  /** Zusammenfassung für die Anzeige «Wird gesendet»: was genau das Gerät verlässt */
  disclosure: { summary: string; items: string[]; imageBytes?: number };
}

/** Übungskontext, der (gekürzt) mitgegeben werden darf */
export interface KiContext {
  ex: Exercise;
  /** Lagezeit (ISO) */
  t: string;
}

export function buildHandwritingRequest(_image: { base64: string; mime: string; bytes: number }, _ctx: KiContext): KiRequest {
  throw new Error("noch nicht umgesetzt");
}
/** Antwort → erkannte Zeilen (Meldungen in Kurzschrift oder wörtlich) */
export function parseHandwritingResponse(_toolInput: unknown): { lines: string[]; notes?: string } {
  throw new Error("noch nicht umgesetzt");
}

export function buildMeldungRequest(_text: string, _ctx: KiContext): KiRequest {
  throw new Error("noch nicht umgesetzt");
}
/** Antwort → Vorschlag in Kurzschrift (wird lokal mit parseMeldung geprüft) und Begründung */
export function parseMeldungResponse(_toolInput: unknown): { kurz: string; begruendung?: string; unsicher?: string[] } {
  throw new Error("noch nicht umgesetzt");
}

export function buildHintExplainRequest(_hint: Hint, _events: LageEvent[], _ctx: KiContext): KiRequest {
  throw new Error("noch nicht umgesetzt");
}
export function buildCoaExplainRequest(_coa: RedCoa, _events: LageEvent[], _ctx: KiContext): KiRequest {
  throw new Error("noch nicht umgesetzt");
}
export function buildLageberichtRequest(_ctx: KiContext, _o: { hints: Hint[]; coas: RedCoa[] }): KiRequest {
  throw new Error("noch nicht umgesetzt");
}
/** Freitext-Antwort prüfen/kürzen (keine erfundenen Fakten erkennbar markieren ist Aufgabe des Prompts) */
export function parseTextResponse(_text: string): string {
  throw new Error("noch nicht umgesetzt");
}
