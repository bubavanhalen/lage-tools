/**
 * Aktionen an Journal-Zeilen (Spez. MVP 1, Kap. 3.4): Löschen mit Rückgängig. Für die Verdrahtung (`onDelete`
 * der Liste, Taste Entf). Löschen ist eine Revision mit `deleted` (geht beim Zusammenführen mit), nie rot.
 */
import { reviseEvent, type Exercise, type LageEvent } from "@lage/core";
import { offerUndo } from "./journalUndo";

/** Ereignis «Meldung in diesem Fenster gelöscht» – eine laufende Korrektur dieser Meldung bricht ab (EntryBox) */
export const DELETED_EVENT = "lage:meldung-geloescht";

/** «Meldung 07:20 H03 gelöscht» */
export function deletedLabel(e: Pick<LageEvent, "t" | "melder" | "unit">): string {
  const who = e.melder || e.unit;
  return `Meldung ${e.t.slice(11, 16)}${who ? ` ${who}` : ""} gelöscht`;
}

/** Meldung löschen, Leiste «Meldung 07:20 H03 gelöscht · Rückgängig» (8 s, Ctrl+Z) */
export function deleteEvent(update: (f: (x: Exercise) => Exercise) => void, ex: Exercise, id: string, device: string): void {
  const e = (ex.events ?? []).find((x) => x.id === id);
  if (!e || e.deleted) return;
  const set = (deleted: boolean) => update((x) => { x.events = (x.events ?? []).map((y) => (y.id === id ? reviseEvent(y, { deleted }, device) : y)); return x; });
  set(true);
  try { window.dispatchEvent(new CustomEvent(DELETED_EVENT, { detail: id })); } catch { /* egal */ }
  offerUndo(deletedLabel(e), () => set(false));
}
