/**
 * KI-Einstellungen pro Gerät (Schlüssel, Modell) und pro Übung auf dem Gerät («nicht mehr fragen», Protokoll).
 * Alles nur im Browser-Speicher dieses Geräts (localStorage, jeder Zugriff mit try/catch).
 * Der Schlüssel liegt nie in der Übung, im Export, im Protokoll oder in Fehlermeldungen.
 */
import { useEffect, useState } from "react";
import { estimateKiCost, kiBaseAllowed, KI_MODELS as CORE_MODELS, type Exercise, type KiPurpose } from "@lage/core";

const KEY = "lt-ki-key";
const MODEL = "lt-ki-model";
const BASE = "lt-ki-base";
const SKIP = "lt-ki-skip:";
const LOG = "lt-ki-log:";
const CONSENT = "lt-ki-consent:";

export type KiModelChoice = "standard" | "genauer" | "schneller";

const IDS: Record<KiModelChoice, string> = { standard: "claude-sonnet-5-5", genauer: "claude-opus-5-5", schneller: "claude-haiku-5-5" };
const TEXT: Record<KiModelChoice, string> = {
  standard: "schnell und günstig – für fast alles, auch Fotos",
  genauer: "liest schwierige Handschrift besser, dauert länger, kostet mehr",
  schneller: "am schnellsten und günstigsten – für kurze Texte, weniger genau",
};
/** Modelle (Anthropic, Stand Okt 2026) mit Klartext; Preise für die Schätzung aus dem Kern */
export const KI_MODELS: Record<KiModelChoice, { id: string; label: string; text: string }> = Object.fromEntries(
  (Object.keys(IDS) as KiModelChoice[]).map((k) => {
    const m = CORE_MODELS.find((x) => x.id === IDS[k]);
    return [k, { id: IDS[k], label: m?.label ?? k, text: TEXT[k] }];
  }),
) as Record<KiModelChoice, { id: string; label: string; text: string }>;
export const KI_MODEL_ORDER: KiModelChoice[] = ["standard", "genauer", "schneller"];
export const modelLabel = (id: string) => Object.values(KI_MODELS).find((m) => id.startsWith(m.id))?.label ?? id;

const isDev = (): boolean => { try { return !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV; } catch { return false; } };

/**
 * Basis-URL der API. Für Tests mit dem Mock-Server überschreibbar mit localStorage["lt-ki-base"] – aber nur auf
 * diesen Rechner (localhost/127.0.0.1) bzw. im Entwicklungsmodus; ein anderer Eintrag wird ignoriert, damit der
 * Schlüssel nie an einen fremden Server geht.
 */
export function kiBase(): string {
  let raw: string | null = null;
  try { raw = localStorage.getItem(BASE); } catch { /* egal */ }
  return kiBaseAllowed(raw, isDev()) ?? "https://api.anthropic.com";
}

// ---------- kleiner Speicher mit Benachrichtigung (alle Komponenten bleiben gleich) ----------
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string | null) => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* Speicher gesperrt: nur für diese Sitzung */ mem.set(k, v); }
  notify();
};
/** Ersatz, wenn localStorage gesperrt ist (privates Fenster) */
const mem = new Map<string, string | null>();
const read = (k: string): string | null => (mem.has(k) ? mem.get(k)! : get(k));

export function kiKey(): string { return (read(KEY) ?? "").trim(); }
export function setKiKey(v: string | null) { put(KEY, v && v.trim() ? v.trim() : null); }
export function kiModel(): KiModelChoice { const m = read(MODEL) as KiModelChoice | null; return m && m in KI_MODELS ? m : "standard"; }
export function setKiModel(m: KiModelChoice) { put(MODEL, m); }

/** Schlüssel für die Anzeige: «sk-ant-…a1B2» */
export function maskKey(k: string): string {
  if (!k) return "";
  return k.length <= 12 ? "•".repeat(k.length) : `${k.slice(0, 7)}…${k.slice(-4)}`;
}
/** Schlüssel (und alles, was danach aussieht) aus einem Text entfernen – für Fehlermeldungen und Protokoll */
export function scrub(s: string): string {
  const k = kiKey();
  let out = s;
  if (k) out = out.split(k).join("[Schlüssel]");
  return out.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[Schlüssel]");
}

export function useKiSettings(): { key: string; model: KiModelChoice } {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return { key: kiKey(), model: kiModel() };
}

// ---------- pro Übung (auf diesem Gerät) ----------
/** Zwecke, für die in dieser Übung nicht mehr nachgefragt wird (die Offenlegung bleibt sichtbar) */
export function skipPurposes(exId: string): KiPurpose[] {
  try { const v = JSON.parse(read(SKIP + exId) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function setSkip(exId: string, p: KiPurpose, on: boolean) {
  const cur = new Set(skipPurposes(exId));
  if (on) cur.add(p); else cur.delete(p);
  put(SKIP + exId, cur.size ? JSON.stringify([...cur]) : null);
}

/**
 * Einwilligung pro Gerät und Übung: Die Freigabe «KI für diese Übung» reist mit der Übungsdatei – auf einem anderen
 * Gerät gilt sie erst, wenn dort selbst eingewilligt wurde.
 */
export function kiConsented(exId: string): boolean { return !!read(CONSENT + exId); }
export function setKiConsent(exId: string, on: boolean) { put(CONSENT + exId, on ? new Date().toISOString() : null); }

export interface KiLogEntry {
  /** ISO-Zeit */
  at: string;
  purpose: KiPurpose;
  model: string;
  /** gesendeter Text (Zeichen) */
  chars: number;
  /** gesendetes Bild (Bytes) */
  imageBytes?: number;
  ms: number;
  ok: boolean;
  /** Fehler in Klartext (ohne Schlüssel) */
  error?: string;
  inTok?: number;
  outTok?: number;
  /** geschätzte Kosten in USD */
  usd?: number;
}
const LOG_MAX = 300;
export function kiLog(exId: string): KiLogEntry[] {
  try { const v = JSON.parse(read(LOG + exId) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function addKiLog(exId: string, e: KiLogEntry) {
  const list = [...kiLog(exId), { ...e, error: e.error ? scrub(e.error) : undefined }].slice(-LOG_MAX);
  put(LOG + exId, JSON.stringify(list));
}
export function clearKiLog(exId: string) { put(LOG + exId, null); }
export function useKiLog(exId: string): KiLogEntry[] {
  useKiSettings();
  return kiLog(exId);
}

/** geschätzte Kosten in USD aus den Einheiten der Antwort */
export function estimateUsd(modelId: string, inTok?: number, outTok?: number): number | undefined {
  if (inTok === undefined) return undefined;
  return estimateKiCost(modelId, { input_tokens: inTok, output_tokens: outTok });
}
export const usdText = (v?: number) => (v === undefined ? "–" : v < 0.01 ? "< 0.01 USD" : `${v.toFixed(2)} USD`);

/**
 * Vermerk für das Journal-PDF – aus den Meldungen selbst (gilt auf jedem Gerät): «2 Meldungen aus KI-Vorschlag
 * übernommen (im Journal mit «KI» markiert)»; dazu, was auf diesem Gerät sonst mit KI gemacht wurde (Protokoll).
 */
export function kiPdfNote(ex: Exercise, labels: Record<KiPurpose, string>): string | null {
  const n = (ex.events ?? []).filter((e) => !e.deleted && e.via === "ki").length;
  const parts: string[] = [];
  if (n) parts.push(`${n === 1 ? "1 Meldung" : `${n} Meldungen`} aus einem KI-Vorschlag übernommen (in der Tabelle mit «KI» markiert)`);
  const log = kiUsageSummary(ex.id, labels);
  if (log) parts.push(`auf diesem Gerät verwendet für: ${log}`);
  if (!parts.length) return null;
  return `KI (Claude, Anthropic): ${parts.join("; ")}. KI-Ergebnisse sind Vorschläge; Übernahme durch Benutzer.`;
}

/** Zusammenfassung des Geräte-Protokolls: «Handschrift erkennen (3×), Lagebericht entwerfen (1×)» */
export function kiUsageSummary(exId: string, labels: Record<KiPurpose, string>): string | null {
  const n = new Map<KiPurpose, number>();
  for (const e of kiLog(exId)) if (e.ok) n.set(e.purpose, (n.get(e.purpose) ?? 0) + 1);
  if (!n.size) return null;
  return [...n].map(([p, k]) => `${labels[p] ?? p} (${k}×)`).join(", ");
}
