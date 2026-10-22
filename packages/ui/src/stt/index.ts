/**
 * Spracherkennung: Auswahl der Engine, Einstellungen pro Gerät und Zustand des Offline-Modells.
 * - «offline» (empfohlen): Whisper im Browser – einmal ca. 80 MB laden, danach ohne Netz.
 * - «browser»: Erkennung des Browsers – schnell, nur online, Ton geht an Google/Microsoft/Apple.
 *   Nur nach ausdrücklichem Einschalten (`browserOk`).
 */
import { useEffect, useState } from "react";
import { WHISPER_MB, clearWhisper, whisperCached, whisperEngine } from "./whisper";
import { browserSttAvailable } from "./browser";

export interface LoadProgress {
  phase: "laden" | "starten";
  /** Bytes */
  loaded: number;
  total: number;
  file?: string;
}

/** Schnittstelle für Engines, die ein fertiges Memo erkennen (Whisper, Ersatz für Tests) */
export interface SttEngine {
  /** wird am Anhang als `engine` vermerkt */
  id: string;
  label: string;
  /** Modell vorhanden (ohne zu laden)? */
  ready(): Promise<boolean>;
  /** Modell laden (beim ersten Mal Download) */
  load(onProgress?: (p: LoadProgress) => void): Promise<void>;
  transcribe(blob: Blob): Promise<string>;
}

// ---------- Einstellungen (pro Gerät, localStorage)

export interface SpeechPrefs {
  mode: "offline" | "browser";
  /** Browser-Erkennung ausdrücklich erlaubt (Hinweis «Ton geht an …» gelesen) */
  browserOk: boolean;
}
const PREFS_KEY = "lage.speech";
const DEFAULT_PREFS: SpeechPrefs = { mode: "offline", browserOk: false };
const prefListeners = new Set<(p: SpeechPrefs) => void>();

export function getSpeechPrefs(): SpeechPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<SpeechPrefs>) };
    // ohne Zustimmung nie Browser-Erkennung
    if (p.mode === "browser" && !p.browserOk) p.mode = "offline";
    return p;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setSpeechPrefs(p: Partial<SpeechPrefs>): SpeechPrefs {
  const next = { ...getSpeechPrefs(), ...p };
  if (!next.browserOk) next.mode = "offline";
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* privates Fenster: gilt bis zum Neuladen nicht */ }
  prefCache = next;
  prefListeners.forEach((f) => f(next));
  return next;
}
let prefCache: SpeechPrefs | null = null;

export function useSpeechPrefs(): SpeechPrefs {
  const [p, setP] = useState<SpeechPrefs>(() => prefCache ?? getSpeechPrefs());
  useEffect(() => { prefListeners.add(setP); return () => { prefListeners.delete(setP); }; }, []);
  return p;
}

/** Wird jetzt die Browser-Erkennung benutzt? (eingeschaltet, vorhanden, online) */
export function useBrowserNow(p: SpeechPrefs): boolean {
  return p.mode === "browser" && p.browserOk && browserSttAvailable() && navigator.onLine;
}

// ---------- Offline-Modell: Zustand für alle Anzeigen (Offline-Box, Mikrofon-Knopf)

export type ModelStatus = "pruefen" | "fehlt" | "laedt" | "bereit" | "fehler";
export interface ModelState {
  status: ModelStatus;
  loaded: number;
  total: number;
  error?: string;
}
let modelState: ModelState = { status: "pruefen", loaded: 0, total: WHISPER_MB * 1e6 };
const modelListeners = new Set<(s: ModelState) => void>();
const setModel = (s: Partial<ModelState>) => { modelState = { ...modelState, ...s }; modelListeners.forEach((f) => f(modelState)); };
let checked = false;
let loading: Promise<void> | null = null;

/** Ersatz-Engine für Tests (Playwright: `window.__LAGE_STT_MOCK__ = { text, delayMs }` vor dem Laden setzen) */
interface MockCfg { text: string | string[]; delayMs?: number; mb?: number }
function mockCfg(): MockCfg | null {
  const g = globalThis as unknown as { __LAGE_STT_MOCK__?: MockCfg };
  return g.__LAGE_STT_MOCK__ ?? null;
}
let mockLoaded = false;
let mockCall = 0;
const mockEngine = (cfg: MockCfg): SttEngine => ({
  id: "mock",
  label: "Ersatz (Test)",
  ready: async () => mockLoaded,
  async load(onProgress) {
    const total = (cfg.mb ?? WHISPER_MB) * 1e6;
    for (let i = 1; i <= 10; i++) {
      await new Promise((r) => setTimeout(r, (cfg.delayMs ?? 1500) / 10));
      onProgress?.({ phase: "laden", loaded: (total * i) / 10, total, file: i < 4 ? "onnx/encoder_model_quantized.onnx" : "onnx/decoder_model_merged_quantized.onnx" });
    }
    mockLoaded = true;
  },
  async transcribe() {
    await new Promise((r) => setTimeout(r, Math.min(800, cfg.delayMs ?? 600)));
    const t = cfg.text;
    return Array.isArray(t) ? t[mockCall++ % t.length]! : t;
  },
});

/** Engine für «offline» (Whisper, in Tests der Ersatz) */
export function offlineEngine(): SttEngine {
  const m = mockCfg();
  return m ? mockEngine(m) : whisperEngine;
}
let engineCache: SttEngine | null = null;
const engine = () => (engineCache ??= offlineEngine());

export function useModelState(): ModelState {
  const [s, setS] = useState<ModelState>(modelState);
  useEffect(() => {
    modelListeners.add(setS);
    if (!checked) {
      checked = true;
      engine().ready().then((ok) => { if (modelState.status === "pruefen") setModel({ status: ok ? "bereit" : "fehlt" }); });
    }
    return () => { modelListeners.delete(setS); };
  }, []);
  return s;
}

/** Modell laden (einmal; mehrere Aufrufe teilen sich den Download) */
export function ensureModel(): Promise<void> {
  if (loading) return loading;
  if (!navigator.onLine && modelState.status !== "bereit") return Promise.reject(new Error("Kein Netz – Modell später laden."));
  try { navigator.storage?.persist?.().catch(() => { /* egal */ }); } catch { /* egal */ }
  setModel({ status: modelState.status === "bereit" ? "bereit" : "laedt", error: undefined });
  loading = engine()
    .load((p) => { if (modelState.status !== "bereit") setModel({ status: "laedt", loaded: p.loaded, total: p.total }); })
    .then(() => { setModel({ status: "bereit", loaded: modelState.total }); })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      setModel({ status: "fehler", error: /fetch|network|Failed/i.test(msg) ? "Download fehlgeschlagen – Netz prüfen und nochmals versuchen." : msg });
      throw e;
    })
    .finally(() => { loading = null; });
  return loading;
}

/** Memo offline erkennen (lädt das Modell bei Bedarf, sofern online) */
export async function transcribeOffline(blob: Blob): Promise<{ text: string; engine: string }> {
  await ensureModel();
  const e = engine();
  return { text: (await e.transcribe(blob)).trim(), engine: e.id };
}

/** Modell löschen */
export async function removeModel(): Promise<void> {
  if (mockCfg()) mockLoaded = false;
  else await clearWhisper();
  setModel({ status: "fehlt", loaded: 0 });
}

export { WHISPER_MB, whisperCached } from "./whisper";
export { browserSttAvailable, browserSttVendor, startLive, type LiveSession } from "./browser";
