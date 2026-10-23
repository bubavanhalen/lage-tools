/**
 * Spracherkennung des Browsers (Web Speech API, `SpeechRecognition`/`webkitSpeechRecognition`).
 * Schnell und mit Zwischenergebnissen – aber nur online: der Ton geht an Google (Chrome, Edge: Microsoft, Safari: Apple).
 * Deshalb nur nach ausdrücklichem Einschalten in den Einstellungen.
 */

interface SrAlternative { transcript: string; confidence: number }
interface SrResult { isFinal: boolean; length: number; [i: number]: SrAlternative }
interface SrEvent { resultIndex: number; results: { length: number; [i: number]: SrResult } }
interface SrErrorEvent { error: string; message?: string }
interface Sr {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SrEvent) => void) | null;
  onerror: ((e: SrErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SrCtor = new () => Sr;

function ctor(): SrCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SrCtor; webkitSpeechRecognition?: SrCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Bietet dieser Browser eine eigene Spracherkennung an? (Firefox: nein) */
export function browserSttAvailable(): boolean {
  return !!ctor();
}

/** Wohin geht der Ton? (für den Hinweis beim Einschalten) */
export function browserSttVendor(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Edg\//.test(ua)) return "Microsoft";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Apple";
  return "Google";
}

export interface LiveSession {
  /** beenden und Endergebnis abwarten */
  stop(): Promise<string>;
  /** sofort abbrechen, Ergebnis verwerfen */
  abort(): void;
}

/**
 * Live-Erkennung starten (läuft parallel zur Memo-Aufnahme).
 * `onPartial` erhält den bisher erkannten Text (endgültig + vorläufig) zur Live-Anzeige.
 */
export function startLive(onPartial: (text: string) => void, onError?: (msg: string) => void, lang = "de-CH"): LiveSession | null {
  const C = ctor();
  if (!C) return null;
  let finalText = "";
  let interim = "";
  let ended = false;
  let endWaiters: Array<() => void> = [];
  let triedFallback = false;
  let stopping = false;

  const make = (l: string): Sr => {
    const r = new C();
    r.lang = l;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const t = res[0]?.transcript ?? "";
        if (res.isFinal) finalText = `${finalText} ${t}`.trim();
        else interim += t;
      }
      onPartial(`${finalText} ${interim}`.trim());
    };
    r.onerror = (e) => {
      // «de-CH» nicht unterstützt → Hochdeutsch versuchen
      if (e.error === "language-not-supported" && !triedFallback) {
        triedFallback = true;
        rec = make("de-DE");
        try { rec.start(); } catch { /* egal */ }
        return;
      }
      if (e.error === "no-speech" || e.error === "aborted") return;
      onError?.(
        e.error === "not-allowed" || e.error === "service-not-allowed" ? "Browser-Erkennung nicht erlaubt (Mikrofon oder Dienst gesperrt)."
          : e.error === "network" ? "Browser-Erkennung braucht Netz – Memo ist gespeichert, später erkennen."
            : `Browser-Erkennung: ${e.error}`,
      );
    };
    r.onend = () => {
      // Chrome beendet nach Pausen von selbst – solange nicht gestoppt, weiterhören
      if (r !== rec) return; // durch Rückfall «de-DE» ersetzt
      if (!stopping) { try { r.start(); return; } catch { /* fertig */ } }
      ended = true;
      endWaiters.forEach((f) => f());
      endWaiters = [];
    };
    return r;
  };
  // eslint-disable-next-line prefer-const
  let rec: Sr = make(lang);
  try { rec.start(); } catch { return null; }

  return {
    stop() {
      stopping = true;
      return new Promise<string>((resolve) => {
        const done = () => resolve(`${finalText} ${interim}`.trim());
        if (ended) { done(); return; }
        endWaiters.push(done);
        try { rec.stop(); } catch { done(); }
        // Sicherheit: nicht ewig auf das Ende warten
        window.setTimeout(done, 2500);
      });
    },
    abort() {
      stopping = true;
      try { rec.abort(); } catch { /* egal */ }
    },
  };
}
