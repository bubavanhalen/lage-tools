/**
 * Web Worker: Whisper (transformers.js, ONNX Runtime als WebAssembly, wenn vorhanden Encoder auf WebGPU) –
 * Spracherkennung offline im Browser.
 * Modell einmal vom Hugging Face Hub laden; danach liegt es im Browser-Zwischenspeicher («transformers-cache»)
 * und funktioniert ohne Netz. Laufzeit (WASM) kommt aus der eigenen App, nicht von einem CDN.
 *
 * Mehrere Threads: nur mit «cross-origin isolation» (setzt der Service Worker, siehe `sw.template.js`).
 * ONNX Runtime startet dann Hilfs-Worker («em-pthread») mit genau diesem Skript – diese dürfen unseren
 * Nachrichten-Empfang nicht übernehmen (siehe unten).
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { WorkerIn, WorkerOut } from "./whisper";

const g = self as unknown as { crossOriginIsolated?: boolean; name?: string; navigator: Navigator & { gpu?: { requestAdapter(): Promise<unknown> } } };
const IS_PTHREAD = !!g.name?.startsWith("em-pthread");

// nur Hub + Browser-Zwischenspeicher, keine «lokalen» Pfade (die würden in der App landen)
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
// WASM-Laufzeit: Pfad nicht auf das CDN setzen lassen – ONNX Runtime nimmt dann die mitgebaute Datei (Vite-Asset)
const wasm = env.backends.onnx.wasm as { wasmPaths?: unknown; numThreads?: number; proxy?: boolean };
delete wasm.wasmPaths;
/** Threads: ohne «cross-origin isolation» (z. B. erster Aufruf vor dem Service Worker) nur einer */
const THREADS = g.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2))) : 1;
wasm.numThreads = THREADS;

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let currentKey = "";
let device = "wasm";

const post = (m: WorkerOut, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []);

/** WebGPU vorhanden? (Chrome/Edge mit Grafik; im Zweifel nein) */
async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = g.navigator.gpu;
    if (!gpu) return false;
    const a = await Promise.race([gpu.requestAdapter(), new Promise((r) => setTimeout(() => r(null), 1500))]);
    return !!a;
  } catch {
    return false;
  }
}

type Make = (task: "automatic-speech-recognition", model: string, o: object) => Promise<AutomaticSpeechRecognitionPipeline>;

function load(m: Extract<WorkerIn, { type: "load" | "transcribe" }>): Promise<AutomaticSpeechRecognitionPipeline> {
  const key = `${m.model}|${JSON.stringify(m.dtype)}`;
  if (asr && currentKey === key) return asr;
  // anderes Modell gewählt: altes freigeben (Speicher)
  asr?.then((p) => p.dispose()).catch(() => { /* egal */ });
  currentKey = key;
  // immer erlaubt: zuerst wird der Browser-Zwischenspeicher gefragt; ohne Netz und ohne Datei kommt ein Netzfehler.
  // (false würde transformers.js mit «local and remote models are disabled» ganz verweigern – auch aus dem Zwischenspeicher)
  env.allowRemoteModels = true;
  // (Typen von `pipeline` sind für tsc zu komplex – Aufgabe hier fest)
  const make = pipeline as unknown as Make;
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === "progress" || p.status === "initiate" || p.status === "done") post({ type: "progress", file: p.file ?? "", loaded: p.loaded ?? 0, total: p.total ?? 0, status: p.status });
  };
  asr = (async () => {
    // Encoder (rechnet am meisten) auf WebGPU, Decoder in WASM – gleiche Dateien, kein zusätzlicher Download
    if (m.gpu && (await hasWebGpu())) {
      try {
        const p = await make("automatic-speech-recognition", m.model, { dtype: m.dtype, device: { encoder_model: "webgpu", decoder_model_merged: "wasm" }, progress_callback });
        device = "webgpu";
        return p;
      } catch { /* zurück auf WASM */ }
    }
    device = "wasm";
    return make("automatic-speech-recognition", m.model, { dtype: m.dtype, device: "wasm", progress_callback });
  })().catch((e) => { asr = null; currentKey = ""; throw e; });
  return asr;
}

if (!IS_PTHREAD) {
  self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
    const m = ev.data;
    try {
      if (m.type === "load") {
        const t0 = performance.now();
        await load(m);
        // geladene Laufzeit-Dateien melden, damit das Hauptfenster sie für offline ablegen kann
        const files = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /ort-wasm[^/]*\.wasm/.test(n));
        post({ type: "ready", id: m.id, wasm: files, device, threads: THREADS, ms: Math.round(performance.now() - t0) });
      } else if (m.type === "transcribe") {
        const p = await load(m);
        const long = m.audio.length > 16000 * 28;
        // Obergrenze der Ausgabe nach Länge (Funk ≈ 3 Wörter/s): verhindert endlose Wiederholungsschleifen
        const sec = m.audio.length / 16000;
        const maxTokens = Math.min(440, Math.ceil(Math.min(sec, 30) * 9) + 16);
        const t0 = performance.now();
        const out = await p(m.audio, { language: "german", task: "transcribe", max_new_tokens: maxTokens, ...(long ? { chunk_length_s: 30, stride_length_s: 5 } : {}) });
        const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text) ?? "";
        post({ type: "result", id: m.id, text, ms: Math.round(performance.now() - t0) });
      }
    } catch (e) {
      post({ type: "error", id: m.id, message: e instanceof Error ? e.message : String(e) });
    }
  };
}
