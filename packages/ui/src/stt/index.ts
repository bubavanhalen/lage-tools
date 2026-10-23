/**
 * Spracherkennung: Auswahl der Engine, Einstellungen pro Gerät und Zustand des Offline-Modells.
 * - «offline» (empfohlen): Whisper im Browser – einmal laden (small ≈ 250 MB, base ≈ 77 MB), danach ohne Netz.
 * - «browser»: Erkennung des Browsers – schnell, nur online, Ton geht an Google/Microsoft/Apple.
 *   Nur nach ausdrücklichem Einschalten (`browserOk`).
 */
import { useEffect, useState } from "react";
import { WHISPER_MODELS, abortError, clearWhisper, modelMb, whisperEngine, type WhisperSize } from "./whisper";
import { browserSttAvailable } from "./browser";

export interface LoadProgress {
  phase: "laden" | "starten";
  /** Bytes */
  loaded: number;
  total: number;
  file?: string;
}

export interface TranscribeOptions {
  signal?: AbortSignal;
  /** «starten» = Modell wird in den Arbeitsspeicher geladen (aus dem Zwischenspeicher), «erkennen» = rechnet (Länge in s) */
  onPhase?: (p: "starten" | "erkennen", sec?: number) => void;
}

/** Schnittstelle für Engines, die ein fertiges Memo erkennen (Whisper, Ersatz für Tests) */
export interface SttEngine {
  /** wird am Anhang als `engine` vermerkt */
  id: string;
  label: string;
  /** Modell vorhanden (ohne zu laden)? */
  ready(): Promise<boolean>;
  /** Modell schon im Arbeitsspeicher (nächstes Memo ohne Startzeit)? */
  warm(): boolean;
  /** Modell laden (beim ersten Mal Download) */
  load(onProgress?: (p: LoadProgress) => void): Promise<void>;
  /** `ms` = reine Rechenzeit (für die Schätzung der Restzeit) */
  transcribe(blob: Blob, o?: TranscribeOptions): Promise<{ text: string; ms: number }>;
  /** laufendes Laden abbrechen (Download) */
  abort?(): void;
}

// ---------- Einstellungen (pro Gerät, localStorage)

export interface SpeechPrefs {
  mode: "offline" | "browser";
  /** Offline-Modell: «small» genau (≈ 250 MB, Standard), «base» klein (≈ 77 MB) */
  model: WhisperSize;
  /** Browser-Erkennung ausdrücklich erlaubt (Hinweis «Ton geht an …» gelesen) */
  browserOk: boolean;
}
const PREFS_KEY = "lage.speech";
const DEFAULT_PREFS: SpeechPrefs = { mode: "offline", model: "small", browserOk: false };
const prefListeners = new Set<(p: SpeechPrefs) => void>();

export function getSpeechPrefs(): SpeechPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<SpeechPrefs>) };
    // ohne Zustimmung nie Browser-Erkennung
    if (p.mode === "browser" && !p.browserOk) p.mode = "offline";
    if (!(p.model in WHISPER_MODELS)) p.model = "small";
    return p;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setSpeechPrefs(p: Partial<SpeechPrefs>): SpeechPrefs {
  const prev = getSpeechPrefs();
  const next = { ...prev, ...p };
  if (!next.browserOk) next.mode = "offline";
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* privates Fenster: gilt bis zum Neuladen nicht */ }
  prefCache = next;
  prefListeners.forEach((f) => f(next));
  if (next.model !== prev.model) { engineCache = null; setModel({ status: "pruefen", loaded: 0, total: modelMb(next.model) * 1e6, error: undefined }); checkModel(); }
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

// ---------- Gerät: Download-Dauer und Empfehlung

/** Handy/Tablet oder wenig Arbeitsspeicher? (dann Hinweis: kleineres Modell, WLAN) */
export function smallDevice(): { small: boolean; mem?: number; touch: boolean } {
  try {
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const touch = !!window.matchMedia?.("(pointer: coarse)").matches;
    return { small: (mem !== undefined && mem <= 4) || touch, mem, touch };
  } catch {
    return { small: false, touch: false };
  }
}

/**
 * Geschätzte Download-Dauer: aus der vom Browser gemeldeten Bandbreite (Chrome meldet höchstens 10 Mbit/s),
 * sonst mit 10 Mbit/s gerechnet. Text z. B. «ca. 3 min» bzw. «ca. 40 s»; `mobile` = Mobilfunk gemeldet.
 */
export function downloadEta(mb: number): { text: string; mobile: boolean } {
  let mbit = 10;
  let mobile = false;
  try {
    const c = (navigator as Navigator & { connection?: { downlink?: number; type?: string; effectiveType?: string } }).connection;
    if (c?.downlink && c.downlink > 0.2) mbit = c.downlink;
    if (c?.effectiveType && /^(slow-)?2g|3g$/.test(c.effectiveType)) mbit = Math.min(mbit, 1.5);
    mobile = c?.type === "cellular";
  } catch { /* egal */ }
  const s = (mb * 8) / mbit;
  return { text: s < 90 ? `ca. ${Math.max(10, Math.round(s / 10) * 10)} s` : `ca. ${Math.round(s / 60)} min`, mobile };
}

/** «225 MB, ca. 3 min» – vor jedem Download anzeigen */
export function downloadLabel(mb: number): string {
  const e = downloadEta(mb);
  return `${mb} MB, ${e.text}${e.mobile ? ", Mobilnetz – WLAN empfohlen" : ""}`;
}

// ---------- Restzeit: Rechenzeit dieses Geräts messen (pro Modell, localStorage)

/**
 * Whisper rechnet immer ein 30-s-Fenster (Encoder) plus Text (Decoder): Zeit ≈ Faktor × (OFFSET + Länge).
 * Der Faktor (ms je s) wird nach jeder Erkennung nachgeführt (gleitender Mittelwert).
 */
const OFFSET_S = 10;
const RATE_KEY = "lage.speech.rate";
/** Startwerte (gemessen in Chromium, WASM, 2 Kerne: small 19–23 s, base 9 s für 5 s Ton) – nach dem ersten Memo durch die Messung ersetzt */
const RATE0: Record<string, number> = { small: 1200, base: 450, mock: 60 };
/** auch ohne localStorage (privates Fenster) bis zum Neuladen merken */
let rateMem: Record<string, number> = {};
function rates(): Record<string, number> {
  try { return { ...rateMem, ...(JSON.parse(localStorage.getItem(RATE_KEY) ?? "{}") as Record<string, number>) }; } catch { return rateMem; }
}
const rateKey = () => (mockCfg() ? "mock" : (prefCache ?? getSpeechPrefs()).model);
/** geschätzte Rechenzeit in s für ein Memo der Länge `sec` */
export function estimateSecs(sec: number): number {
  const k = rates()[rateKey()] ?? RATE0[rateKey()] ?? 400;
  return (k * (OFFSET_S + Math.min(sec, 30) * Math.max(1, Math.ceil(sec / 30)))) / 1000;
}
export function recordRate(sec: number, ms: number) {
  if (!(ms > 0) || !(sec > 0)) return;
  const k = ms / (OFFSET_S + Math.min(sec, 30) * Math.max(1, Math.ceil(sec / 30)));
  const r = rates();
  const key = rateKey();
  r[key] = r[key] ? r[key]! * 0.6 + k * 0.4 : k;
  rateMem = r;
  try { localStorage.setItem(RATE_KEY, JSON.stringify(r)); } catch { /* egal */ }
}

// ---------- Offline-Modell: Zustand für alle Anzeigen (Offline-Box, Mikrofon-Knopf)

export type ModelStatus = "pruefen" | "fehlt" | "laedt" | "bereit" | "fehler";
export interface ModelState {
  status: ModelStatus;
  loaded: number;
  total: number;
  error?: string;
}
let modelState: ModelState = { status: "pruefen", loaded: 0, total: modelMb(getSpeechPrefs().model) * 1e6 };
const modelListeners = new Set<(s: ModelState) => void>();
const setModel = (s: Partial<ModelState>) => { modelState = { ...modelState, ...s }; modelListeners.forEach((f) => f(modelState)); };
let checked = false;
let loading: Promise<void> | null = null;
export const modelReady = () => modelState.status === "bereit";
export const modelLoading = () => modelState.status === "laedt";

/** Ersatz-Engine für Tests (Playwright: `window.__LAGE_STT_MOCK__ = { text, delayMs, recognizeMs }` vor dem Laden setzen) */
interface MockCfg { text: string | string[]; delayMs?: number; recognizeMs?: number; mb?: number }
function mockCfg(): MockCfg | null {
  const g = globalThis as unknown as { __LAGE_STT_MOCK__?: MockCfg };
  return g.__LAGE_STT_MOCK__ ?? null;
}
let mockLoaded = false;
let mockCall = 0;
let mockAbort: (() => void) | null = null;
const mockEngine = (cfg: MockCfg): SttEngine => ({
  id: "mock",
  label: "Ersatz (Test)",
  ready: async () => mockLoaded,
  warm: () => mockLoaded,
  abort() { mockAbort?.(); },
  async load(onProgress) {
    const total = (cfg.mb ?? modelMb((prefCache ?? getSpeechPrefs()).model)) * 1e6;
    for (let i = 1; i <= 10; i++) {
      await new Promise<void>((r, j) => { const t = setTimeout(r, (cfg.delayMs ?? 1500) / 10); mockAbort = () => { clearTimeout(t); j(abortError()); }; });
      onProgress?.({ phase: "laden", loaded: (total * i) / 10, total, file: i < 4 ? "onnx/encoder_model_q4.onnx" : "onnx/decoder_model_merged_quantized.onnx" });
    }
    mockLoaded = true;
  },
  async transcribe(_b, o = {}) {
    o.onPhase?.("erkennen", 5);
    const ms = cfg.recognizeMs ?? Math.min(800, cfg.delayMs ?? 600);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      o.signal?.addEventListener("abort", () => { clearTimeout(t); reject(abortError()); }, { once: true });
    });
    const t = cfg.text;
    return { text: Array.isArray(t) ? t[mockCall++ % t.length]! : t, ms };
  },
});

/** Engine für «offline» (Whisper, in Tests der Ersatz) */
export function offlineEngine(): SttEngine {
  const m = mockCfg();
  return m ? mockEngine(m) : whisperEngine((prefCache ?? getSpeechPrefs()).model);
}
let engineCache: SttEngine | null = null;
const engine = () => (engineCache ??= offlineEngine());
/** Modell im Arbeitsspeicher (nächstes Memo startet ohne Wartezeit)? */
export const engineWarm = () => engine().warm();

export function useModelState(): ModelState {
  const [s, setS] = useState<ModelState>(modelState);
  useEffect(() => {
    modelListeners.add(setS);
    setS(modelState);
    if (!checked) { checked = true; checkModel(); }
    return () => { modelListeners.delete(setS); };
  }, []);
  return s;
}

function checkModel() {
  const e = engine();
  e.ready().then((ok) => { if (modelState.status === "pruefen" && e === engineCache) setModel({ status: ok ? "bereit" : "fehlt" }); }, () => setModel({ status: "fehlt" }));
}

/** Modell laden (einmal; mehrere Aufrufe teilen sich den Download) */
export function ensureModel(): Promise<void> {
  if (loading) return loading;
  if (modelState.status === "bereit") return Promise.resolve();
  if (!navigator.onLine) return Promise.reject(new Error("Kein Netz – Modell später laden."));
  try { navigator.storage?.persist?.().catch(() => { /* egal */ }); } catch { /* egal */ }
  setModel({ status: "laedt", error: undefined });
  loading = engine()
    .load((p) => { if (modelState.status !== "bereit") setModel({ status: "laedt", loaded: p.loaded, total: p.total }); })
    .then(() => { setModel({ status: "bereit", loaded: modelState.total }); })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof Error && e.name === "AbortError") { setModel({ status: "fehlt", loaded: 0, error: undefined }); throw e; }
      setModel({ status: "fehler", error: /fetch|network|Failed/i.test(msg) ? "Download fehlgeschlagen – Netz prüfen und nochmals versuchen." : msg });
      throw e;
    })
    .finally(() => { loading = null; });
  return loading;
}

/** Laden (Download) abbrechen – bereits vollständig geladene Dateien bleiben im Zwischenspeicher */
export function cancelModelLoad() {
  if (loading) engine().abort?.();
}

/** Memo offline erkennen (Modell muss geladen sein – sonst vorher `ensureModel`) */
export async function transcribeOffline(blob: Blob, o: TranscribeOptions = {}): Promise<{ text: string; engine: string; ms: number }> {
  await ensureModel();
  const e = engine();
  const r = await e.transcribe(blob, o);
  return { text: r.text.trim(), engine: e.id, ms: r.ms };
}

/** Modell löschen */
export async function removeModel(): Promise<void> {
  if (mockCfg()) mockLoaded = false;
  else await clearWhisper((prefCache ?? getSpeechPrefs()).model);
  setModel({ status: "fehlt", loaded: 0 });
}

export { WHISPER_MODELS, detectGpu, modelMb, whisperCached, whisperInfo, type WhisperSize } from "./whisper";
export { browserSttAvailable, browserSttVendor, startLive, type LiveSession } from "./browser";
