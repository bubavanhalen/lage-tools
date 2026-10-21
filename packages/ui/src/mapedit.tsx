/**
 * Zustand rund um die Lagekarte, ausgelagert aus dem Workspace:
 * - Zeitfenster pro Übung (gemerkt im Browser),
 * - Zeichen verschieben = Ort der Meldung korrigieren, mit Hinweis «Rückgängig» (12 s, steht still, solange Maus/Fokus darauf).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  inWindow, parseWindow, relocatePatch, relocateSnapshot, reviseEvent, WINDOW_ALL,
  type Exercise, type LageEvent, type LV95, type TimeWindow,
} from "@lage/core";
import { symbolName, echelonOf } from "./journalLayer";
import "./mapoverlays.css";

const winKey = (id: string) => `lage-tools.fenster.${id}`;

/** Zeitfenster der Übung `exId` (Standard «alles»), pro Übung im Browser gemerkt */
export function useTimeWindow(exId: string | undefined): [TimeWindow, (w: TimeWindow) => void] {
  const [state, setState] = useState<{ id?: string; w: TimeWindow }>({ w: WINDOW_ALL });
  useEffect(() => {
    let w: TimeWindow = WINDOW_ALL;
    try { if (exId) w = parseWindow(JSON.parse(localStorage.getItem(winKey(exId)) ?? "null")); } catch { /* egal */ }
    setState({ id: exId, w });
  }, [exId]);
  const set = useCallback((w: TimeWindow) => {
    setState({ id: exId, w });
    try { if (exId) localStorage.setItem(winKey(exId), JSON.stringify(w)); } catch { /* egal */ }
  }, [exId]);
  return [state.id === exId ? state.w : WINDOW_ALL, set];
}

interface Notice { id: string; text: string; undo: Partial<LageEvent>; n: number }
/** so lange steht der Hinweis mit «Rückgängig» */
const NOTICE_MS = 12000;

/**
 * Meldung verschieben (neuer Ort aus der Karte) mit Rückgängig. `update` wie im Workspace (Übung klonen und ändern).
 * Gibt die Funktion für die Kartenebene und den Hinweis (zum Einblenden über der Karte) zurück.
 */
export function useMoveEvent(update: (f: (x: Exercise) => Exercise) => void, device: string, ex: Exercise | null) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const exRef = useRef(ex);
  exRef.current = ex;
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const move = useCallback((e: LageEvent, pos: LV95) => {
    const x = exRef.current;
    const cur = x?.events?.find((y) => y.id === e.id) ?? e;
    if (!x) return;
    const patch = relocatePatch(cur, pos, x.sheets, x.areas);
    const undo = relocateSnapshot(cur);
    update((y) => { y.events = (y.events ?? []).map((z) => (z.id === cur.id ? reviseEvent(z, patch, device) : z)); return y; });
    const what = [cur.unit || (cur.side === "blau" ? cur.melder ?? "" : ""), symbolName(cur.sym, echelonOf(cur), cur.sidc)].filter(Boolean).join(" · ");
    const n = Date.now();
    setNotice({ id: cur.id, text: `Ort von ${cur.t.slice(11, 16)} ${what} geändert${patch.cells?.[0] ? ` → ${patch.cells[0]}` : ""}`, undo, n });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice((c) => (c?.n === n ? null : c)), NOTICE_MS);
  }, [update, device]);
  /** Maus oder Fokus auf dem Hinweis: nicht ausblenden; danach wieder volle Zeit */
  const hold = useCallback((on: boolean) => {
    window.clearTimeout(timer.current);
    if (on) return;
    timer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const undo = useCallback(() => {
    if (!notice) return;
    const { id, undo: snap } = notice;
    update((x) => { x.events = (x.events ?? []).map((y) => (y.id === id ? reviseEvent(y, snap, device) : y)); return x; });
    setNotice(null);
  }, [notice, update, device]);

  const view = notice ? <MoveNotice key={notice.n} text={notice.text} onUndo={undo} onClose={() => setNotice(null)} onHold={hold} /> : null;
  return { move, notice: view };
}

function MoveNotice({ text, onUndo, onClose, onHold }: { text: string; onUndo: () => void; onClose: () => void; onHold: (on: boolean) => void }) {
  // Ctrl/⌘+Z macht das Verschieben rückgängig, solange der Hinweis steht
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === "z") { ev.preventDefault(); onUndo(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onUndo]);
  return (
    <div className="mo-undo" role="status" aria-live="polite" style={{ ["--mo-ms" as string]: `${NOTICE_MS}ms` }}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") onHold(true); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") onHold(false); }}
      onFocus={() => onHold(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHold(false); }}>
      <span className="mo-undo-t" title={text}>{text}</span>
      <button type="button" className="mo-undo-b" onClick={onUndo} title="Alten Ort wiederherstellen (Ctrl+Z)">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5 2.5 6.5l3 3M3 6.5h6.5a4 4 0 0 1 0 8H7" /></svg>Rückgängig
      </button>
      <button type="button" className="mo-undo-x" onClick={onClose} aria-label="Hinweis schliessen">×</button>
    </div>
  );
}

/**
 * Hinweis über der Journalliste: «Zeitfenster 07:10–07:40 · 5 von 22 Meldungen bis 07:40 · Alle zeigen».
 * Gezählt wird wie die Liste darunter: Meldungen bis zur Lagezeit (spätere zeigt weder Karte noch Liste).
 */
export function WindowHint({ events, from, to, onClear }: { events: LageEvent[]; from: string; to: string; onClear?: () => void }) {
  const upto = events.filter((e) => !e.deleted && inWindow(e.t, null, to));
  const n = upto.filter((e) => inWindow(e.t, from, to)).length;
  return (
    <div className="mo-winhint" role="status">
      <span><b>Zeitfenster</b> <span className="tnum">{from.slice(11, 16)}–{to.slice(11, 16)}</span> · <span className="tnum">{n}</span> von <span className="tnum">{upto.length}</span> Meldungen bis <span className="tnum">{to.slice(11, 16)}</span></span>
      {onClear && <button type="button" onClick={onClear}>Alle zeigen</button>}
    </div>
  );
}
