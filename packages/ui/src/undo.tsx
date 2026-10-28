/**
 * Rückgängig für Löschen (Raster, NAI/Flächen, Bilder) – mehrstufig: jedes Löschen kommt auf einen Stapel, das Band
 * «… gelöscht · Rückgängig» zeigt das letzte; Ctrl+Z / ⌘Z (ausserhalb von Eingabefeldern – dort gilt das Rückgängig
 * des Feldes) bzw. der Knopf stellt nacheinander wieder her. Der Stapel verfällt `UNDO_MS` nach dem letzten Schritt.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import "./persist.css";

export const UNDO_MS = 8000;
/** höchstens so viele Schritte merken */
export const UNDO_MAX = 20;

export interface UndoOffer { label: string; restore: () => void; n: number }

/** Stapel ohne React (testbar): `push` legt oben auf, `pop` nimmt das letzte, beide melden den neuen Stapel */
export class UndoStack {
  private list: UndoOffer[] = [];
  private seq = 0;
  constructor(private onChange: (list: UndoOffer[]) => void, private max = UNDO_MAX) {}
  push(label: string, restore: () => void) {
    this.list = [...this.list, { label, restore, n: ++this.seq }].slice(-this.max);
    this.onChange(this.list);
  }
  /** letzten Schritt rückgängig machen; false = nichts mehr da */
  pop(): boolean {
    const o = this.list[this.list.length - 1];
    if (!o) return false;
    this.list = this.list.slice(0, -1);
    this.onChange(this.list);
    o.restore();
    return true;
  }
  clear() { if (this.list.length) { this.list = []; this.onChange(this.list); } }
  get size() { return this.list.length; }
}

export function useUndo(): { offer: (label: string, restore: () => void) => void; bar: ReactNode } {
  const [list, setList] = useState<UndoOffer[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const stack = useRef<UndoStack | null>(null);
  stack.current ??= new UndoStack(setList);
  /** Stapel verfällt `UNDO_MS` nach dem letzten Schritt (Löschen oder Rückgängig) */
  const arm = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => stack.current!.clear(), UNDO_MS);
  }, []);
  const offer = useCallback((label: string, restore: () => void) => { stack.current!.push(label, restore); arm(); }, [arm]);
  const run = useCallback(() => { if (stack.current!.pop()) arm(); }, [arm]);
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (!stack.current!.size || !(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey || ev.key.toLowerCase() !== "z") return;
      const el = ev.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      ev.preventDefault();
      run();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [run]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const cur = list[list.length - 1];
  const more = list.length - 1;
  const bar = cur ? (
    <div className="undobar wsundo" role="status">
      <span>{cur.label}{more > 0 ? <span className="undomore"> · {more} {more === 1 ? "weiterer Schritt" : "weitere Schritte"}</span> : null}</span>
      <button onClick={run} title="Rückgängig (Ctrl+Z, mehrmals für weitere Schritte)">Rückgängig</button>
    </div>
  ) : null;
  return { offer, bar };
}
