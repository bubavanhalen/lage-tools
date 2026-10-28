/**
 * KI-Zustand für die ganze Arbeitsfläche: eingeschaltet für diese Übung? Schlüssel vorhanden? online?
 * Stellt `send` bereit (mit Protokoll) und hält das Menü «KI (Claude)» sowie den Einwilligungsdialog.
 * Ohne Provider (z. B. Übungsauswertung) liefert `useKi()` null – dann erscheinen keine KI-Knöpfe.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Exercise, KiPurpose, KiRequest } from "@lage/core";
import { KiError, kiSend, kiSize, type KiResult } from "./client";
import { addKiLog, estimateUsd, KI_MODELS, kiConsented, setKiConsent, setSkip, skipPurposes, useKiSettings } from "./settings";
import { KiSettings } from "./KiSettings";
import { KiConsent } from "./KiConsent";

/**
 * aus = für diese Übung nicht eingeschaltet; einwilligung = in der Übung(sdatei) eingeschaltet, auf diesem Gerät aber
 * noch nicht eingewilligt (gilt wie aus, bis eingewilligt); schluessel = kein Schlüssel auf dem Gerät; offline = kein Netz
 */
export type KiState = "aus" | "einwilligung" | "schluessel" | "offline" | "bereit";

export interface KiApi {
  ex: Exercise;
  /** Lagezeit (ISO lokal) */
  t: string;
  state: KiState;
  /** wirklich eingeschaltet: in der Übung an und auf diesem Gerät eingewilligt */
  enabled: boolean;
  /** Einwilligungsdialog zeigen (z. B. beim ersten KI-Knopf auf einem neuen Gerät) */
  requestConsent: () => void;
  /** ID der Übung, die jetzt offen ist (für Antworten, die nach einem Übungswechsel eintreffen) */
  currentExId: () => string;
  online: boolean;
  /** Modell-ID für die nächste Anfrage */
  model: string;
  modelLabel: string;
  openSettings: () => void;
  /** KI für die Übung einschalten (beim ersten Mal mit Einwilligung) bzw. ausschalten */
  setEnabled: (on: boolean) => void;
  send: (req: KiRequest, signal?: AbortSignal) => Promise<KiResult>;
  skips: (p: KiPurpose) => boolean;
  setSkips: (p: KiPurpose, on: boolean) => void;
  /** Ergebnisse (z. B. ausformulierte Hinweise) bleiben, solange die Seite offen ist */
  memo: <T>(key: string) => T | undefined;
  setMemo: (key: string, v: unknown) => void;
}

const Ctx = createContext<KiApi | null>(null);
export const useKi = () => useContext(Ctx);

function useOnline() {
  const [on, set] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const f = () => set(navigator.onLine);
    window.addEventListener("online", f); window.addEventListener("offline", f);
    return () => { window.removeEventListener("online", f); window.removeEventListener("offline", f); };
  }, []);
  return on;
}

export function KiProvider({ ex, t, update, say, children }: {
  ex: Exercise; t: string; update: (f: (x: Exercise) => Exercise) => void; say: (s: string) => void; children: ReactNode;
}) {
  const { key, model } = useKiSettings();
  const online = useOnline();
  const [settings, setSettings] = useState(false);
  const [consent, setConsent] = useState(false);
  const memoRef = useRef(new Map<string, unknown>());
  const [memoTick, setMemoTick] = useState(0);
  // andere Übung: Ergebnisse vergessen, offene Einwilligung schliessen
  useEffect(() => { memoRef.current.clear(); setMemoTick((n) => n + 1); setConsent(false); }, [ex.id]);
  const fileOn = !!ex.ki?.enabled;
  // Einwilligung pro Gerät und Übung (useKiSettings meldet Änderungen)
  const consented = kiConsented(ex.id);
  const enabled = fileOn && consented;
  const state: KiState = !fileOn ? "aus" : !consented ? "einwilligung" : !key ? "schluessel" : !online ? "offline" : "bereit";
  const m = KI_MODELS[model];

  const exRef = useRef(ex);
  exRef.current = ex;
  const send = useCallback(async (req: KiRequest, signal?: AbortSignal) => {
    const exId = exRef.current.id;
    const size = kiSize(req);
    const t0 = Date.now();
    try {
      const r = await kiSend(req, { key, model: m.id, signal });
      addKiLog(exId, { at: new Date().toISOString(), purpose: req.purpose, model: r.model, ...size, ms: r.ms, ok: true, inTok: r.inTok, outTok: r.outTok, usd: estimateUsd(m.id, r.inTok, r.outTok) });
      return r;
    } catch (e) {
      const err = e instanceof KiError ? e : new KiError("netz");
      addKiLog(exId, { at: new Date().toISOString(), purpose: req.purpose, model: m.id, ...size, ms: Date.now() - t0, ok: false, error: err.message });
      throw err;
    }
  }, [key, m.id]);

  const setEnabled = useCallback((on: boolean) => {
    if (on && !kiConsented(exRef.current.id)) { setConsent(true); return; }
    update((x) => { x.ki = { ...(x.ki ?? {}), enabled: on, since: x.ki?.since ?? new Date().toISOString() }; return x; });
    say(on ? "KI für diese Übung eingeschaltet" : "KI für diese Übung ausgeschaltet – alles andere funktioniert weiter");
  }, [update, say]);

  const api = useMemo<KiApi>(() => ({
    ex, t, state, enabled, online, model: m.id, modelLabel: m.label,
    openSettings: () => setSettings(true),
    requestConsent: () => setConsent(true),
    currentExId: () => exRef.current.id,
    setEnabled, send,
    skips: (p) => skipPurposes(ex.id).includes(p),
    setSkips: (p, on) => setSkip(ex.id, p, on),
    memo: <T,>(k: string) => memoRef.current.get(k) as T | undefined,
    setMemo: (k, v) => { if (v === undefined) memoRef.current.delete(k); else memoRef.current.set(k, v); setMemoTick((n) => n + 1); },
  }), [ex, t, state, enabled, online, m.id, m.label, setEnabled, send, memoTick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Ctx.Provider value={api}>
      {children}
      {settings && <KiSettings api={api} onClose={() => setSettings(false)} />}
      {consent && (
        <KiConsent hasKey={!!key}
          onCancel={() => setConsent(false)}
          onAgree={() => {
            setConsent(false);
            setKiConsent(exRef.current.id, true);
            update((x) => { x.ki = { ...(x.ki ?? {}), enabled: true, since: x.ki?.since ?? new Date().toISOString() }; return x; });
            say("KI für diese Übung eingeschaltet");
            if (!key) setSettings(true);
          }} />
      )}
    </Ctx.Provider>
  );
}

/** Knopf in der Kopfzeile: «KI» mit Zustand, öffnet das Menü */
export function KiMenuButton() {
  const ki = useKi();
  if (!ki) return null;
  const title = ki.state === "aus" ? "KI (Claude) – für diese Übung aus" : ki.state === "einwilligung" ? "KI aus – auf diesem Gerät noch nicht eingewilligt" : ki.state === "schluessel" ? "KI eingeschaltet – Schlüssel fehlt noch" : ki.state === "offline" ? "KI eingeschaltet – zurzeit offline" : `KI eingeschaltet (${ki.modelLabel})`;
  return (
    <button className={"ki-menubtn s-" + ki.state} onClick={ki.openSettings} title={title} aria-label={title}>
      <KiMark />
      <span className="ki-mb-l">KI</span>
      <span className="ki-mb-s">{ki.state === "aus" ? "aus" : ki.state === "einwilligung" ? "einwilligen?" : ki.state === "bereit" ? "an" : ki.state === "offline" ? "offline" : "Schlüssel?"}</span>
    </button>
  );
}

/** kleines Zeichen für KI-Funktionen (Funken) */
export function KiMark({ size = 14 }: { size?: number }) {
  return (
    <svg className="ki-mark" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5l1.5 4.2L13.8 7 9.5 8.4 8 12.6 6.5 8.4 2.2 7l4.3-1.3z" fill="currentColor" />
      <path d="M13 11l.6 1.6 1.6.6-1.6.6L13 15.4l-.6-1.6-1.6-.6 1.6-.6z" fill="currentColor" opacity=".7" />
    </svg>
  );
}
