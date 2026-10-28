/**
 * Übung speichern und mit anderen Fenstern abgleichen (für `Workspace`):
 * - jede Änderung sofort speichern (`persister.save`, ohne Verzögerung), auch beim Verlassen der Seite;
 * - Nachrichten anderer Fenster: geänderte Meldungen/Hülle nachlesen und einmischen (`mergeEvents`) – kein Überschreiben;
 * - «Ersetzen» in einem anderen Fenster: neu laden.
 */
import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { mergeEvents, mergeHull, type Exercise } from "@lage/core";
import { listExercises } from "./store";
import { hasPending, onSync, openStored, persister, readChanges, requestPersist, setLatest } from "./persist";

interface Opts {
  ex: Exercise | null;
  exRef: MutableRefObject<Exercise | null>;
  setEx: Dispatch<SetStateAction<Exercise | null>>;
  setSaved: (l: Array<{ id: string; name: string }>) => void;
  say: (t: string) => void;
  /** nicht speichern (z. B. leere Ersatz-Übung bei blockierter Datenbank) */
  skip: (ex: Exercise) => boolean;
}

export function useExerciseStore({ ex, exRef, setEx, setSaved, say, skip }: Opts) {
  const skipRef = useRef(skip);
  skipRef.current = skip;
  const sayRef = useRef(say);
  sayRef.current = say;
  // Liste der Übungen nachführen, wenn eine Hülle (Name) geschrieben wurde
  useEffect(() => {
    persister.onSaved = (_id, hull) => { if (hull) void listExercises().then(setSaved); };
    // gleichzeitig in zwei Fenstern geändert: zusammengeführte Hülle übernehmen (nichts verlieren)
    persister.onMergedHull = (id, hull) => setEx((x) => (x && x.id === id ? { ...mergeHull(x, { ...(hull as Exercise), events: [] }).ex, events: x.events } : x));
    // in der Datenbank lag eine neuere Fassung (anderes Fenster): übernehmen
    persister.onNewer = (id, evs) => setEx((x) => (x && x.id === id ? { ...x, events: mergeEvents(x.events ?? [], evs) } : x));
    setLatest(() => { const x = exRef.current; return x && !skipRef.current(x) ? x : null; });
    return () => { persister.onSaved = null; persister.onMergedHull = null; persister.onNewer = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sofort speichern
  const asked = useRef(false);
  useEffect(() => {
    if (!ex || skip(ex)) return;
    persister.save(ex);
    // erste Meldung dieser Sitzung: Browser um dauerhaften Speicher bitten
    if (!asked.current && (ex.events ?? []).length) { asked.current = true; void requestPersist(); }
  }, [ex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Andere Fenster
  useEffect(() => onSync(async (m) => {
    const cur = exRef.current;
    if (m.t === "replaced") {
      if (cur?.id === m.ex) {
        const r = await openStored(m.ex).catch(() => null);
        if (r) { setEx(r.ex); sayRef.current("Übung wurde in einem anderen Fenster ersetzt – neu geladen"); }
      }
      void listExercises().then(setSaved);
      return;
    }
    if (m.hull) void listExercises().then(setSaved);
    if (!cur || cur.id !== m.ex) return;
    try {
      const { events, hull } = await readChanges(m.ex, m.ids, m.hull);
      // eigene Änderungen noch unterwegs → Hülle zusammenführen (sonst gälte die fremde Fassung ganz)
      const pending = hasPending();
      const takeHull = hull && hull.rev > persister.rev(m.ex) ? hull : undefined;
      persister.markStored(m.ex, events, pending ? undefined : takeHull);
      setEx((x) => {
        if (!x || x.id !== m.ex) return x;
        let out: Exercise = events.length ? { ...x, events: mergeEvents(x.events ?? [], events) } : x;
        if (takeHull) out = pending ? { ...mergeHull(out, { ...(takeHull.ex as Exercise), events: [] }).ex, events: out.events } : { ...(takeHull.ex as Exercise), events: out.events };
        return out;
      });
    } catch { /* Speicher nicht verfügbar – nächstes Mal */ }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
}
