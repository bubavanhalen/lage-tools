/**
 * Angefangene Meldung im Meldungsfeld überlebt Neuladen, Reiterwechsel und Absturz – **pro Fenster und Übung**:
 * Jedes Fenster hat eine eigene Kennung (im `sessionStorage`, bleibt beim Neuladen desselben Fensters gleich); der
 * Entwurf liegt im `localStorage` unter Übung + Fenster. Zwei Fenster mit derselben Übung überschreiben oder löschen
 * sich die Entwürfe also nicht gegenseitig. Nur Text, kein Ort/keine Zeichenwahl. Jeder Zugriff in try/catch
 * (privates Fenster, Speicher gesperrt). Entwürfe geschlossener Fenster werden nach `DRAFT_KEEP_MS` aufgeräumt.
 *
 * MVP 3.5 (Spez. MVP 3.5, E7, S26): Jedes Fenster schreibt alle 10 s ein Lebenszeichen
 * (`localStorage["lage-tools.fenster.lebt.<winId>"] = Date.now()`, beim `pagehide` gelöscht). Startet ein Fenster ohne
 * eigenen Entwurf, übernimmt es den jüngsten **verwaisten** Entwurf derselben Übung (Fenster > 30 s ohne Lebenszeichen,
 * z. B. Browser abgestürzt oder Tablet neu gestartet): der Schlüssel wird umgeschrieben, das Meldungsfeld meldet
 * «Entwurf von 07:31 wiederhergestellt · Verwerfen». Zwei offene Fenster übernehmen nie den Entwurf des anderen.
 */
import { useEffect, useRef } from "react";

const PREFIX = "lage-tools.entwurf.";
const WIN_KEY = "lage-tools.fenster";
/** Entwürfe so lange aufbewahren (danach beim nächsten Start gelöscht) */
export const DRAFT_KEEP_MS = 3 * 86400000;

let winId: string | null = null;
/** Kennung dieses Fensters (bleibt beim Neuladen gleich, neues Fenster = neue Kennung) */
export function windowId(): string {
  if (winId) return winId;
  try {
    winId = sessionStorage.getItem(WIN_KEY);
    if (!winId) { winId = Math.random().toString(36).slice(2, 10); sessionStorage.setItem(WIN_KEY, winId); }
  } catch { winId = Math.random().toString(36).slice(2, 10); }
  return winId;
}

const KEY = (exId: string) => `${PREFIX}${exId}.${windowId()}`;
/** Lebenszeichen eines Fensters (ms seit 1970) */
export const LEBT_KEY = (win: string) => `lage-tools.fenster.lebt.${win}`;
/** Takt des Lebenszeichens */
export const LEBT_MS = 10000;
/** ein Fenster ohne Lebenszeichen seit so lange gilt als geschlossen (sein Entwurf ist verwaist) */
export const VERWAIST_MS = 30000;

let beat: ReturnType<typeof setInterval> | null = null;
/** Lebenszeichen dieses Fensters schreiben (sofort, dann alle 10 s; beim Verlassen der Seite löschen) */
export function startLebenszeichen(now: () => number = Date.now): void {
  const write = () => { try { localStorage.setItem(LEBT_KEY(windowId()), String(now())); } catch { /* Speicher gesperrt */ } };
  write();
  if (beat || typeof window === "undefined") return;
  beat = setInterval(write, LEBT_MS);
  window.addEventListener("pagehide", () => { try { localStorage.removeItem(LEBT_KEY(windowId())); } catch { /* egal */ } });
  // zurück aus dem Zwischenspeicher des Browsers (bfcache): wieder lebendig
  window.addEventListener("pageshow", write);
}

/**
 * Jüngsten verwaisten Entwurf der Übung übernehmen (nur wenn dieses Fenster keinen eigenen hat): Fenster ohne
 * Lebenszeichen seit > `VERWAIST_MS`. Schreibt den Entwurf unter dieses Fenster um und gibt ihn zurück, sonst null.
 */
export function adoptOrphan(exId: string, now = Date.now()): Stored | null {
  try {
    if (localStorage.getItem(KEY(exId))) return null;
    const pre = `${PREFIX}${exId}.`;
    const me = windowId();
    let best: { k: string; v: Stored } | null = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(pre)) continue;
      const win = k.slice(pre.length);
      if (!win || win.includes(".") || win === me) continue;
      const lebt = Number(localStorage.getItem(LEBT_KEY(win)) ?? 0) || 0;
      if (now - lebt <= VERWAIST_MS) continue; // zeit-ok: Millisekunden, keine Lagezeit
      let v: Stored | null = null;
      try { v = JSON.parse(localStorage.getItem(k) ?? "") as Stored; } catch { continue; }
      if (!v?.t?.trim() || typeof v.at !== "number") continue;
      if (!best || v.at > best.v.at) best = { k, v }; // zeit-ok: Millisekunden
    }
    if (!best) return null;
    localStorage.removeItem(best.k);
    localStorage.setItem(KEY(exId), JSON.stringify(best.v));
    return best.v;
  } catch { return null; }
}
/** Format bis MVP 0 (ein Entwurf pro Übung für alle Fenster) */
const LEGACY = (exId: string) => `${PREFIX}${exId}`;

export interface Stored { t: string; at: number }

export function loadDraftText(exId: string): string {
  try {
    const raw = localStorage.getItem(KEY(exId));
    if (raw) return (JSON.parse(raw) as Stored).t ?? "";
    // alter Entwurf (ein Schlüssel für alle Fenster): einmal übernehmen
    const old = localStorage.getItem(LEGACY(exId));
    if (old) { localStorage.removeItem(LEGACY(exId)); saveDraftText(exId, old); return old; }
    return "";
  } catch { return ""; }
}
export function saveDraftText(exId: string, text: string): void {
  try {
    if (text.trim()) localStorage.setItem(KEY(exId), JSON.stringify({ t: text, at: Date.now() } satisfies Stored));
    else localStorage.removeItem(KEY(exId));
  } catch { /* Speicher gesperrt – Entwurf nur im Fenster */ }
}

/** alte Entwürfe (geschlossene Fenster) aufräumen */
export function pruneDrafts(now = Date.now()): number {
  let n = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(PREFIX)) keys.push(k); }
    for (const k of keys) {
      let v: unknown;
      try { v = JSON.parse(localStorage.getItem(k) ?? ""); } catch { continue; /* alter Entwurf (Klartext): beim Laden übernommen */ }
      const at = (v as Stored | null)?.at;
      if (typeof at !== "number") continue;
      if (now - at > DRAFT_KEEP_MS) { localStorage.removeItem(k); n++; }
    }
    // Lebenszeichen längst geschlossener Fenster (pagehide kam nicht) aufräumen
    const lebt: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith("lage-tools.fenster.lebt.")) lebt.push(k); }
    for (const k of lebt) if (now - (Number(localStorage.getItem(k)) || 0) > DRAFT_KEEP_MS) localStorage.removeItem(k);
  } catch { /* egal */ }
  return n;
}
let pruned = false;

/**
 * Entwurf der Übung laden (beim ersten Anzeigen und beim Wechsel der Übung) und jede Änderung sofort ablegen.
 * `onRestore` z. B. für die Höhe des Feldes; `onAdopt` meldet einen übernommenen verwaisten Entwurf (Zeit `at`).
 */
export function useDraftPersist(exId: string, text: string, setText: (t: string) => void, onRestore?: (t: string) => void, onAdopt?: (at: number) => void): void {
  const owner = useRef<string | null>(null);
  useEffect(() => {
    if (owner.current !== exId) {
      owner.current = exId;
      startLebenszeichen();
      if (!pruned) { pruned = true; pruneDrafts(); }
      const own = loadDraftText(exId);
      const adopted = own ? null : adoptOrphan(exId);
      const t = own || adopted?.t || "";
      if (t !== text) { setText(t); if (t) onRestore?.(t); }
      if (adopted) onAdopt?.(adopted.at);
      return;
    }
    saveDraftText(exId, text);
  }, [exId, text]); // eslint-disable-line react-hooks/exhaustive-deps
}
