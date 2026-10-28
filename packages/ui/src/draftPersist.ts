/**
 * Angefangene Meldung im Meldungsfeld überlebt Neuladen, Reiterwechsel und Absturz – **pro Fenster und Übung**:
 * Jedes Fenster hat eine eigene Kennung (im `sessionStorage`, bleibt beim Neuladen desselben Fensters gleich); der
 * Entwurf liegt im `localStorage` unter Übung + Fenster. Zwei Fenster mit derselben Übung überschreiben oder löschen
 * sich die Entwürfe also nicht gegenseitig. Nur Text, kein Ort/keine Zeichenwahl. Jeder Zugriff in try/catch
 * (privates Fenster, Speicher gesperrt). Entwürfe geschlossener Fenster werden nach `DRAFT_KEEP_MS` aufgeräumt.
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
/** Format bis MVP 0 (ein Entwurf pro Übung für alle Fenster) */
const LEGACY = (exId: string) => `${PREFIX}${exId}`;

interface Stored { t: string; at: number }

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
  } catch { /* egal */ }
  return n;
}
let pruned = false;

/**
 * Entwurf der Übung laden (beim ersten Anzeigen und beim Wechsel der Übung) und jede Änderung sofort ablegen.
 * `onRestore` z. B. für die Höhe des Feldes.
 */
export function useDraftPersist(exId: string, text: string, setText: (t: string) => void, onRestore?: (t: string) => void): void {
  const owner = useRef<string | null>(null);
  useEffect(() => {
    if (owner.current !== exId) {
      owner.current = exId;
      if (!pruned) { pruned = true; pruneDrafts(); }
      const t = loadDraftText(exId);
      if (t !== text) { setText(t); if (t) onRestore?.(t); }
      return;
    }
    saveDraftText(exId, text);
  }, [exId, text]); // eslint-disable-line react-hooks/exhaustive-deps
}
