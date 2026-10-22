/**
 * Web Worker: Whisper (transformers.js, ONNX Runtime als WebAssembly) – Spracherkennung offline im Browser.
 * Modell einmal vom Hugging Face Hub laden; danach liegt es im Browser-Zwischenspeicher («transformers-cache»)
 * und funktioniert ohne Netz. Laufzeit (WASM) kommt aus der eigenen App, nicht von einem CDN.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { WorkerIn, WorkerOut } from "./whisper";

// nur Hub + Browser-Zwischenspeicher, keine «lokalen» Pfade (die würden in der App landen)
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
// WASM-Laufzeit: Pfad nicht auf das CDN setzen lassen – ONNX Runtime nimmt dann die mitgebaute Datei (Vite-Asset)
const wasm = env.backends.onnx.wasm as { wasmPaths?: unknown; numThreads?: number; proxy?: boolean };
delete wasm.wasmPaths;
// ohne «cross-origin isolation» (GitHub Pages) nur ein Thread möglich
wasm.numThreads = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let currentModel = "";

const post = (m: WorkerOut, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []);

function load(model: string, allowRemote: boolean): Promise<AutomaticSpeechRecognitionPipeline> {
  if (asr && currentModel === model) return asr;
  currentModel = model;
  env.allowRemoteModels = allowRemote;
  asr = (pipeline("automatic-speech-recognition", model, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === "progress" || p.status === "initiate" || p.status === "done") post({ type: "progress", file: p.file ?? "", loaded: p.loaded ?? 0, total: p.total ?? 0, status: p.status });
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>).catch((e) => { asr = null; throw e; });
  return asr;
}

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const m = ev.data;
  try {
    if (m.type === "load") {
      await load(m.model, m.allowRemote);
      post({ type: "ready", id: m.id });
    } else if (m.type === "transcribe") {
      const p = await load(m.model, m.allowRemote);
      const long = m.audio.length > 16000 * 28;
      const out = await p(m.audio, { language: "german", task: "transcribe", ...(long ? { chunk_length_s: 30, stride_length_s: 5 } : {}) });
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text) ?? "";
      post({ type: "result", id: m.id, text });
    }
  } catch (e) {
    post({ type: "error", id: m.id, message: e instanceof Error ? e.message : String(e) });
  }
};
