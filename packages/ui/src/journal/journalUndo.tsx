/**
 * Rückgängig im Journal (Spez. MVP 1, Kap. 3.2–3.4): eine Leiste für Löschen, Korrektur und verworfene Meldung (Esc).
 * Ein gemeinsamer Stapel für die ganze Seite (Modul, kein React-Zustand), damit Meldungsfeld und Liste nie zwei
 * Leisten mit «Rückgängig» gleichzeitig zeigen – die Leiste zeigt das Letzte, Ctrl+Z / ⌘Z nimmt nacheinander zurück.
 * Ctrl+Z gilt ausserhalb von Eingabefeldern und im leeren Meldungsfeld (dort hat das Feld nichts zurückzunehmen).
 * Der Stapel verfällt `UNDO_MS` (8 s) nach dem letzten Schritt.
 *
 * Verwendung: `offerUndo(label, restore)`; `<JournalUndoBar />` genau einmal einhängen (EntryBox tut das).
 */
import { useEffect, useSyncExternalStore } from "react";
import { UNDO_MS, UndoStack, type UndoOffer } from "../undo";
import "./journal.css";

let list: UndoOffer[] = [];
const subs = new Set<() => void>();
const stack = new UndoStack((l) => { list = l; subs.forEach((f) => f()); });
let timer: number | undefined;

function arm() {
  if (typeof window === "undefined") return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => stack.clear(), UNDO_MS);
}

/** Rückgängig anbieten (z. B. «Meldung 07:20 H03 gelöscht»); `restore` stellt wieder her */
export function offerUndo(label: string, restore: () => void): void {
  stack.push(label, restore);
  arm();
}
/** letzten Schritt zurücknehmen; false = nichts da */
export function runUndo(): boolean {
  const ok = stack.pop();
  if (ok) arm();
  return ok;
}
/** Stapel leeren (z. B. Übungswechsel) */
export function clearUndo(): void { stack.clear(); }
export const undoSize = () => stack.size;

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => list;

/** Leiste «… · Rückgängig» (fest unten in der Mitte) und Ctrl+Z */
export function JournalUndoBar() {
  const l = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (!stack.size || !(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey || ev.key.toLowerCase() !== "z") return;
      const el = ev.target as HTMLElement | null;
      const field = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      // im Eingabefeld gilt dessen Rückgängig – ausser im leeren Meldungsfeld
      if (field && !(el.tagName === "TEXTAREA" && el.hasAttribute("data-meldungsfeld") && !(el as HTMLTextAreaElement).value)) return;
      ev.preventDefault();
      runUndo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const cur = l[l.length - 1];
  if (!cur) return null;
  const more = l.length - 1;
  return (
    <div className="undobar wsundo jundo" role="status">
      <span>{cur.label}{more > 0 ? <span className="undomore"> · davor {more} {more === 1 ? "weitere Änderung" : "weitere Änderungen"} rückgängig machbar</span> : null}</span>
      <button type="button" onClick={() => runUndo()}>Rückgängig</button>
    </div>
  );
}
