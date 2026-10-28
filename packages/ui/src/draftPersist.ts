/**
 * Angefangene Meldung im Meldungsfeld überlebt Neuladen, Reiterwechsel und Absturz: pro Übung im localStorage
 * (nur Text, kein Ort/keine Zeichenwahl). Jeder Zugriff in try/catch (privates Fenster, Speicher gesperrt).
 */
import { useEffect, useRef } from "react";

const KEY = (exId: string) => `lage-tools.entwurf.${exId}`;

export function loadDraftText(exId: string): string {
  try { return localStorage.getItem(KEY(exId)) ?? ""; } catch { return ""; }
}
export function saveDraftText(exId: string, text: string): void {
  try {
    if (text.trim()) localStorage.setItem(KEY(exId), text);
    else localStorage.removeItem(KEY(exId));
  } catch { /* Speicher gesperrt – Entwurf nur im Fenster */ }
}

/**
 * Entwurf der Übung laden (beim ersten Anzeigen und beim Wechsel der Übung) und jede Änderung sofort ablegen.
 * `onRestore` z. B. für die Höhe des Feldes.
 */
export function useDraftPersist(exId: string, text: string, setText: (t: string) => void, onRestore?: (t: string) => void): void {
  const owner = useRef<string | null>(null);
  useEffect(() => {
    if (owner.current !== exId) {
      owner.current = exId;
      const t = loadDraftText(exId);
      if (t !== text) { setText(t); if (t) onRestore?.(t); }
      return;
    }
    saveDraftText(exId, text);
  }, [exId, text]); // eslint-disable-line react-hooks/exhaustive-deps
}
