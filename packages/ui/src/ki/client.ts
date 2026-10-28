/**
 * Senden an Claude (Anthropic Messages API) mit dem eigenen Schlüssel des Benutzers – direkt aus dem Browser.
 * Zeitlimit (Bild 60 s, Text 30 s), Abbrechen, eine Wiederholung bei «überlastet» (529), Fehler in Klartext.
 * POST wird vom Service Worker nicht angefasst; die API antwortet mit CORS – funktioniert auch mit COEP «credentialless».
 */
import { kiApiBody, kiPreviewText, readKiResponse, type KiRequest } from "@lage/core";
import { kiBase, scrub } from "./settings";

export type KiErrorCode =
  | "schluessel" | "berechtigung" | "guthaben" | "rate" | "ueberlastet" | "zugross" | "anfrage" | "server"
  | "offline" | "netz" | "zeit" | "abgebrochen" | "antwort";

/** Fehler in Klartext (ohne Fachbegriffe, ohne Schlüssel) */
export const KI_ERROR_TEXT: Record<KiErrorCode, string> = {
  schluessel: "Schlüssel ungültig – im Menü «KI» prüfen oder neu eingeben.",
  berechtigung: "Dieser Schlüssel darf das gewählte Modell nicht verwenden – anderes Modell wählen oder Schlüssel prüfen.",
  guthaben: "Kein Guthaben auf dem Anthropic-Konto – unter console.anthropic.com aufladen.",
  rate: "Zu viele Anfragen in kurzer Zeit – bitte eine Minute warten und nochmals versuchen.",
  ueberlastet: "Claude ist gerade überlastet – bitte gleich nochmals versuchen.",
  zugross: "Zu viel auf einmal (z. B. Foto zu gross) – Ausschnitt wählen und nochmals versuchen.",
  anfrage: "Die Anfrage wurde abgelehnt.",
  server: "Störung bei Anthropic – später nochmals versuchen.",
  offline: "Kein Netz – KI geht nur online. Alles andere funktioniert weiter.",
  netz: "Keine Verbindung zu Anthropic – Netz oder Firewall prüfen.",
  zeit: "Keine Antwort in der vorgesehenen Zeit – nochmals versuchen.",
  abgebrochen: "Abgebrochen.",
  antwort: "Die Antwort war unbrauchbar – nochmals versuchen.",
};

export class KiError extends Error {
  constructor(public code: KiErrorCode, public status?: number, detail?: string) {
    super(KI_ERROR_TEXT[code] + (detail ? ` (${scrub(detail).slice(0, 160)})` : ""));
    this.name = "KiError";
  }
}

export interface KiResult {
  /** Eingabe des erzwungenen Werkzeugs (strukturierte Antwort) */
  toolInput?: unknown;
  /** Freitext (alle Text-Teile) */
  text: string;
  model: string;
  ms: number;
  inTok?: number;
  outTok?: number;
  /** Antwort wurde wegen der Längenbegrenzung abgeschnitten */
  truncated?: boolean;
}

/** Rohinhalt für die Anzeige «Genauer Inhalt» (Foto nur als Platzhalter) */
export const kiBodyPreview = (req: KiRequest) => kiPreviewText(req);

/** Zeichen der Anfrage (Text) und Bildgrösse – für Protokoll */
export function kiSize(req: KiRequest): { chars: number; imageBytes?: number } {
  let chars = req.disclosure.chars ?? 0;
  if (!chars) { chars = req.system.length; for (const m of req.messages) for (const c of m.content) if (c.type === "text") chars += c.text.length; }
  return { chars, imageBytes: req.disclosure.imageBytes };
}

const hasImage = (req: KiRequest) => req.messages.some((m) => m.content.some((c) => c.type === "image"));

interface SendOpts { key: string; model: string; signal?: AbortSignal; timeoutMs?: number; base?: string }

/** eine Anfrage senden; wirft `KiError` */
export async function kiSend(req: KiRequest, o: SendOpts): Promise<KiResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new KiError("offline");
  const t0 = performance.now();
  const timeout = o.timeoutMs ?? (hasImage(req) ? 60000 : 30000);
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await once(req, o, timeout);
      return { ...r, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      // überlastet: einmal nach kurzer Pause wiederholen
      if (e instanceof KiError && e.code === "ueberlastet" && attempt === 0 && !o.signal?.aborted) {
        await pause(1500, o.signal);
        continue;
      }
      throw e;
    }
  }
}

function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((res, rej) => {
    const t = window.setTimeout(res, ms);
    signal?.addEventListener("abort", () => { window.clearTimeout(t); rej(new KiError("abgebrochen")); }, { once: true });
  });
}

async function once(req: KiRequest, o: SendOpts, timeout: number): Promise<Omit<KiResult, "ms">> {
  const ctl = new AbortController();
  let timedOut = false;
  const tm = window.setTimeout(() => { timedOut = true; ctl.abort(); }, timeout);
  const onAbort = () => ctl.abort();
  if (o.signal?.aborted) throw new KiError("abgebrochen");
  o.signal?.addEventListener("abort", onAbort, { once: true });
  let res: Response;
  try {
    res = await fetch(`${o.base ?? kiBase()}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": o.key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(kiApiBody(req, o.model)),
      signal: ctl.signal,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  } catch {
    if (timedOut) throw new KiError("zeit");
    if (o.signal?.aborted) throw new KiError("abgebrochen");
    throw new KiError(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "netz");
  } finally {
    window.clearTimeout(tm);
    o.signal?.removeEventListener("abort", onAbort);
  }
  let j: unknown;
  try { j = await res.json(); } catch { j = null; }
  if (!res.ok) throw errorOf(res.status, j);
  if (!j || typeof j !== "object" || !Array.isArray((j as { content?: unknown }).content)) throw new KiError("antwort");
  const r = readKiResponse(j, req);
  if (req.tool && r.toolInput === undefined) throw new KiError("antwort");
  if (!req.tool && !r.text) throw new KiError("antwort");
  const model = (j as { model?: unknown }).model;
  return {
    toolInput: r.toolInput, text: r.text, model: typeof model === "string" ? model : o.model,
    inTok: r.usage?.input_tokens, outTok: r.usage?.output_tokens, truncated: r.truncated,
  };
}

/** HTTP-Status und Fehlerart der API → Klartext */
export function errorOf(status: number, j: unknown): KiError {
  const err = (j as { error?: { type?: string; message?: string } } | null)?.error;
  const type = err?.type ?? "";
  const msg = err?.message ?? "";
  if (status === 401 || type === "authentication_error") return new KiError("schluessel", status);
  if (/credit balance|billing|insufficient/i.test(msg) || status === 402) return new KiError("guthaben", status);
  if (status === 403 || type === "permission_error") return new KiError("berechtigung", status);
  if (status === 429 || type === "rate_limit_error") return new KiError("rate", status);
  if (status === 529 || type === "overloaded_error") return new KiError("ueberlastet", status);
  if (status === 413 || type === "request_too_large") return new KiError("zugross", status);
  if (status === 404 || type === "not_found_error") return new KiError("berechtigung", status, "Modell nicht gefunden");
  if (status >= 500) return new KiError("server", status);
  return new KiError("anfrage", status, msg);
}

/** Schlüssel prüfen: kleinster möglicher Aufruf (wenige Einheiten) */
export async function kiTestKey(key: string, model: string, signal?: AbortSignal): Promise<{ ms: number; inTok?: number; outTok?: number }> {
  const req: KiRequest = {
    purpose: "meldung", system: "Antworte nur mit: ok", max_tokens: 5,
    messages: [{ role: "user", content: [{ type: "text", text: "Test" }] }],
    disclosure: { summary: "Test", items: ["das Wort «Test»"] },
  };
  const r = await kiSend(req, { key, model, signal, timeoutMs: 20000 });
  return { ms: r.ms, inTok: r.inTok, outTok: r.outTok };
}
