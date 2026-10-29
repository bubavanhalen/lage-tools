/**
 * Übung speichern und mit anderen Fenstern abgleichen (für `Workspace`):
 * - jede Änderung sofort speichern (`persister.save`, ohne Verzögerung), auch beim Verlassen der Seite;
 * - Nachrichten anderer Fenster: geänderte Meldungen/Hülle nachlesen und einmischen (`mergeEvents`) – kein Überschreiben;
 *   was von dort kam, wird gemerkt (`noteForeign`), damit eine offene Bearbeitung den Konflikt zeigt;
 * - «Ersetzen» in einem anderen Fenster: neu laden.
 * Der Abgleich selbst steht ohne React in `applySync` (mit fake-indexeddb getestet).
 */
import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { maxNr, mergeEvents, mergeHull, type Exercise } from "@lage/core";
import { NR_KEY } from "./shell/contracts";
import { listExercises } from "./store";
import { hasPending, noteForeign, onSync, openStored, persister, readChanges, requestPersist, setLatest, type SyncMsg } from "./persist";

interface Opts {
  ex: Exercise | null;
  exRef: MutableRefObject<Exercise | null>;
  setEx: Dispatch<SetStateAction<Exercise | null>>;
  setSaved: (l: Array<{ id: string; name: string }>) => void;
  say: (t: string) => void;
  /** nicht speichern (z. B. leere Ersatz-Übung bei blockierter Datenbank) */
  skip: (ex: Exercise) => boolean;
}

export interface SyncDeps {
  /** angezeigte Übung */
  cur: () => Exercise | null;
  setEx: Dispatch<SetStateAction<Exercise | null>>;
  setSaved: (l: Array<{ id: string; name: string }>) => void;
  say: (t: string) => void;
}

/**
 * Gerätezähler der laufenden Nummer (`NR_KEY`) auf die höchste bekannte Nummer der Übung heben (Entscheid 1, Spez.
 * MVP 3 Kap. 3.3): nach Abgleich mit anderen Fenstern bzw. Zusammenführen einer Datei zählt das Gerät dort weiter.
 * Nummern werden nie geändert (keine Umnummerierung); nur der Zähler steigt, nie sinkt er.
 */
export function hebeNrZaehler(ex: Pick<Exercise, "id" | "events">): void {
  try {
    const k = NR_KEY(ex.id);
    const cur = Number(localStorage.getItem(k)) || 0;
    const m = maxNr(ex);
    if (m > cur) localStorage.setItem(k, String(m));
  } catch { /* Speicher gesperrt – nextNr nimmt ohnehin die höchste bekannte Nummer */ }
}

/** Nachricht eines anderen Fensters verarbeiten: nachlesen, einmischen, nichts überschreiben */
export async function applySync(m: SyncMsg, d: SyncDeps): Promise<void> {
  const cur = d.cur();
  if (m.t === "replaced") {
    if (cur?.id === m.ex) {
      const r = await openStored(m.ex).catch(() => null);
      if (r) { d.setEx(r.ex); d.say("Übung wurde in einem anderen Fenster ersetzt – neu geladen"); }
    }
    void listExercises().then(d.setSaved);
    return;
  }
  if (m.hull) void listExercises().then(d.setSaved);
  if (!cur || cur.id !== m.ex) return;
  try {
    const { events, hull } = await readChanges(m.ex, m.ids, m.hull);
    noteForeign(m.ex, events);
    // eigene Änderungen noch unterwegs → Hülle zusammenführen (sonst gälte die fremde Fassung ganz)
    const pending = hasPending();
    const takeHull = hull && hull.rev > persister.rev(m.ex) ? hull : undefined;
    persister.markStored(m.ex, events, pending ? undefined : takeHull);
    d.setEx((x) => {
      if (!x || x.id !== m.ex) return x;
      let out: Exercise = events.length ? { ...x, events: mergeEvents(x.events ?? [], events) } : x;
      if (takeHull) out = pending ? { ...mergeHull(out, { ...(takeHull.ex as Exercise), events: [] }).ex, events: out.events } : { ...(takeHull.ex as Exercise), events: out.events };
      if (events.length) hebeNrZaehler(out);
      return out;
    });
  } catch { /* Speicher nicht verfügbar – nächstes Mal */ }
}

/** Rückmeldungen des Speicherns an die Anzeige anschliessen (gibt das Abmelden zurück) */
export function connectPersister({ setEx, setSaved }: Pick<SyncDeps, "setEx" | "setSaved">): () => void {
  // Liste der Übungen nachführen, wenn eine Hülle (Name) geschrieben wurde
  persister.onSaved = (_id, hull) => { if (hull) void listExercises().then(setSaved); };
  // gleichzeitig in zwei Fenstern geändert: zusammengeführte Hülle übernehmen (nichts verlieren, Löschmarken gelten)
  persister.onMergedHull = (id, hull) => setEx((x) => (x && x.id === id ? { ...mergeHull(x, { ...(hull as Exercise), events: [] }).ex, events: x.events } : x));
  // in der Datenbank lag eine neuere Fassung (anderes Fenster): übernehmen
  persister.onNewer = (id, evs) => setEx((x) => {
    if (!x || x.id !== id) return x;
    const out = { ...x, events: mergeEvents(x.events ?? [], evs) };
    hebeNrZaehler(out);
    return out;
  });
  return () => { persister.onSaved = null; persister.onMergedHull = null; persister.onNewer = null; };
}

export function useExerciseStore({ ex, exRef, setEx, setSaved, say, skip }: Opts) {
  const skipRef = useRef(skip);
  skipRef.current = skip;
  const sayRef = useRef(say);
  sayRef.current = say;
  useEffect(() => {
    const off = connectPersister({ setEx, setSaved });
    setLatest(() => { const x = exRef.current; return x && !skipRef.current(x) ? x : null; });
    return off;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sofort speichern
  const asked = useRef(false);
  const seen = useRef<{ id: string; n: number } | null>(null);
  useEffect(() => {
    if (!ex || skip(ex)) return;
    persister.save(ex);
    // erste neue Meldung dieser Sitzung: Browser um dauerhaften Speicher bitten
    const n = (ex.events ?? []).length;
    if (!asked.current && seen.current?.id === ex.id && n > seen.current.n) { asked.current = true; void requestPersist(); }
    seen.current = { id: ex.id, n };
  }, [ex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Andere Fenster
  useEffect(() => onSync((m) => applySync(m, { cur: () => exRef.current, setEx, setSaved, say: (t) => sayRef.current(t) })), []); // eslint-disable-line react-hooks/exhaustive-deps
}
