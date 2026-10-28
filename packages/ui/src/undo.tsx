/**
 * Rückgängig für Löschen (Raster, NAI/Flächen): Band «… gelöscht · Rückgängig» für 8 s, dazu Ctrl+Z / ⌘Z
 * (ausserhalb von Eingabefeldern – dort gilt das Rückgängig des Feldes).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import "./persist.css";

export const UNDO_MS = 8000;

interface Offer { label: string; restore: () => void; n: number }

export function useUndo(): { offer: (label: string, restore: () => void) => void; bar: ReactNode } {
  const [cur, setCur] = useState<Offer | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const curRef = useRef<Offer | null>(null);
  curRef.current = cur;
  const offer = useCallback((label: string, restore: () => void) => {
    window.clearTimeout(timer.current);
    const o = { label, restore, n: Date.now() };
    setCur(o);
    timer.current = window.setTimeout(() => setCur((x) => (x === o ? null : x)), UNDO_MS);
  }, []);
  const run = useCallback(() => {
    const o = curRef.current;
    if (!o) return;
    window.clearTimeout(timer.current);
    setCur(null);
    o.restore();
  }, []);
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (!curRef.current || !(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey || ev.key.toLowerCase() !== "z") return;
      const el = ev.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      ev.preventDefault();
      run();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [run]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const bar = cur ? (
    <div className="undobar wsundo" role="status">
      <span>{cur.label}</span>
      <button onClick={run} title="Rückgängig (Ctrl+Z)">Rückgängig</button>
    </div>
  ) : null;
  return { offer, bar };
}
