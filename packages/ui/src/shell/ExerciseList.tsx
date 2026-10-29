/**
 * «Übung wechseln …» (Spez. MVP 1, Kap. 1.2, 1.3): Liste der Übungen auf diesem Gerät mit Name, Datum (letzte
 * Änderung) und Anzahl Meldungen, Öffnen per Klick, Löschen mit Rückgängig (8 s, Ctrl+Z). Gelöscht wird erst nach
 * Ablauf der Frist – wer vorher die Seite schliesst, verliert nichts. Die offene Übung lässt sich nicht löschen.
 */
import { useEffect, useState } from "react";
import type { Exercise } from "@lage/core";
import { EVENT_STORE, db, deleteExercise, eventRange, type EventRec, type HullRec } from "../store";
import { dropWal } from "../persist";
import { UNDO_MS } from "../undo";
import { Dialog } from "./Dialog";
import "./shell.css";

export interface ExerciseInfo { id: string; name: string; at: string | null; n: number }

/** Übungen mit Datum und Anzahl (nicht gelöschte) Meldungen, neueste zuerst */
export async function listExerciseInfos(): Promise<ExerciseInfo[]> {
  try {
    const d = await db();
    const hulls = (await d.getAll("exercises")) as HullRec[];
    const out: ExerciseInfo[] = [];
    for (const h of hulls) {
      const recs = (await d.getAll(EVENT_STORE, eventRange(h.id))) as EventRec[];
      const evs = recs.map((r) => r.ev).concat(h.events ?? []);
      const live = evs.filter((e) => !e.deleted);
      const at = evs.reduce<string | null>((m, e) => (e.updatedAt && (!m || e.updatedAt > m) ? e.updatedAt : m), (h as Exercise).createdAt ?? null);
      out.push({ id: h.id, name: h.name, at, n: new Set(live.map((e) => e.id)).size });
    }
    return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  } catch {
    return [];
  }
}

/** Löschen mit Frist: gemerkt bis zum Ablauf, Rückgängig hebt auf */
const pendingDelete = new Map<string, number>();
function scheduleDelete(id: string, done: () => void) {
  window.clearTimeout(pendingDelete.get(id));
  pendingDelete.set(id, window.setTimeout(() => {
    pendingDelete.delete(id);
    dropWal(id);
    void deleteExercise(id).then(done);
  }, UNDO_MS));
}
function cancelDelete(id: string) { window.clearTimeout(pendingDelete.get(id)); pendingDelete.delete(id); }

const dateText = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
};

export interface ExerciseListProps {
  currentId: string;
  onOpen(id: string): void;
  onClose(): void;
  /** globales Rückgängig (Band + Ctrl+Z) */
  offerUndo(label: string, restore: () => void): void;
  /** Liste der Übungen hat sich geändert (Workspace führt `saved` nach) */
  onChanged?(): void;
}

export function ExerciseList({ currentId, onOpen, onClose, offerUndo, onChanged }: ExerciseListProps) {
  const [list, setList] = useState<ExerciseInfo[] | null>(null);
  const [gone, setGone] = useState<ExerciseInfo | null>(null);
  useEffect(() => { void listExerciseInfos().then(setList); }, []);
  const visible = (list ?? []).filter((x) => !pendingDelete.has(x.id));
  const del = (x: ExerciseInfo) => {
    scheduleDelete(x.id, () => { onChanged?.(); setGone((g) => (g?.id === x.id ? null : g)); });
    setGone(x);
    const restore = () => { cancelDelete(x.id); setGone((g) => (g?.id === x.id ? null : g)); setList((l) => (l ? [...l] : l)); };
    offerUndo(`Übung «${x.name}» gelöscht`, restore);
  };
  return (
    <Dialog title="Übung wechseln" onClose={onClose}>
      {list === null ? <p className="dlg-p">Wird geladen …</p> : !visible.length ? <p className="dlg-p">Keine weiteren Übungen auf diesem Gerät.</p> : (
        <ul className="xl">
          {visible.map((x) => (
            <li key={x.id} className={x.id === currentId ? "cur" : ""}>
              <button type="button" className="xl-open" onClick={() => (x.id === currentId ? onClose() : onOpen(x.id))}>
                <b>{x.name}</b>
                <span>{[dateText(x.at), `${x.n} ${x.n === 1 ? "Meldung" : "Meldungen"}`, x.id === currentId ? "offen" : ""].filter(Boolean).join(" · ")}</span>
              </button>
              {x.id !== currentId && <button type="button" className="xl-del" onClick={() => del(x)} aria-label={`Übung «${x.name}» löschen`}>Löschen</button>}
            </li>
          ))}
        </ul>
      )}
      {gone && pendingDelete.has(gone.id) && (
        <div className="xl-undo" role="status">
          <span>Übung «{gone.name}» gelöscht</span>
          <button type="button" onClick={() => { cancelDelete(gone.id); setGone(null); }}>Rückgängig</button>
        </div>
      )}
      <p className="dlg-note">Übungen bleiben auf diesem Gerät. Für ein anderes Gerät: Menü → Daten → «Datei für anderes Gerät …».</p>
    </Dialog>
  );
}
