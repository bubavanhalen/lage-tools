/**
 * Meldungsqualität (Texte Spez. MVP 1, Kap. 4.1/4.2): E1 nur «von 2 Trupps gesehen» (zweite Quelle) als Marke –
 * «nur 1 Trupp» wäre an fast jeder Sichtung Rauschen (dafür Suche «nur 1 Trupp»); E2 «Fehlt noch: … – nachfragen».
 * Die Journal-Liste (journal/JournalList.tsx) zeigt dieselben Texte selbst; diese Marken bleiben für andere Ansichten.
 */
import { useMemo } from "react";
import { eventFromDraft, eventQuality, isLage, type Draft, type EventQuality, type Exercise, type LageEvent } from "@lage/core";
import "./hints.css";

const AEIOU = "Rückfrage nach AEIOU: Wann · Wer tut was · Wie · Wo · Umwelt";

export function QualityMarks({ e, q, events }: { e: LageEvent; q?: EventQuality; events: LageEvent[] }) {
  // MVP 3: nur Meldungen (Lage) haben Qualität – Auftrag, Rückfrage, Notiz, Aufhebung nie «Fehlt noch»
  if (!q || !isLage(e)) return null;
  // E1 nur bei Sichtungen (Feind/Unklar): der Kern setzt dann `status`
  const enemy = q.status !== undefined || (e.side === "rot" && !!q.confirmedBy?.length);
  // «ohne Ort» steht schon in der Zeile
  const missing = (q.missing ?? []).filter((m) => !(m === "Ort" && !e.cells?.length && !e.nai && !e.where));
  const by = (q.confirmedBy ?? []).map((id) => events.find((x) => x.id === id)).filter((x): x is LageEvent => !!x && !x.deleted);
  return (
    <>
      {enemy && (q.status === "bestaetigt" || by.length > 0) && (
        <span className="qmark ok" title={by.length ? `auch gesehen von ${by.map((x) => `${x.melder ?? x.unit ?? "?"} ${x.t.slice(11, 16)}`).join(", ")}` : "von einer zweiten Quelle gesehen"}>von {Math.max(2, by.length + 1)} Trupps gesehen</span>
      )}
      {missing.length > 0 && <span className="qmark inc" title={`${missing.join(", ")} fehlt – ${AEIOU}`}>Fehlt noch: {missing.join(", ")} – nachfragen</span>}
    </>
  );
}

/** E2 für die Vorschau: was der erkannten Meldung fehlt (z. B. ["Ort"]) */
export function useDraftMissing(draft: Draft | null, ex: Exercise): string[] {
  return useMemo(() => {
    if (!draft) return [];
    const tmp = eventFromDraft(draft, "vorschau");
    if (!isLage(tmp)) return [];
    const m = eventQuality([tmp], tmp.t, ex);
    return m.get(tmp.id)?.missing ?? [];
  }, [draft, ex]);
}
