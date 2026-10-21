/**
 * Meldungsqualität im Journal: E1 nur «bestätigt» (zweite Quelle) als Marke – «unbestätigt» wäre an fast jeder
 * Sichtung Rauschen (dafür Filter «Unbest.» in der Liste); E2 «unvollständig: …» (Rückfrage nach AEIOU) in Liste und Vorschau.
 */
import { useMemo } from "react";
import { eventFromDraft, eventQuality, type Draft, type EventQuality, type Exercise, type LageEvent } from "@lage/core";
import "./hints.css";

const AEIOU = "Rückfrage nach AEIOU: Wann · Wer tut was · Wie · Wo · Umwelt";

export function QualityMarks({ e, q, events }: { e: LageEvent; q?: EventQuality; events: LageEvent[] }) {
  if (!q) return null;
  // E1 nur bei Sichtungen (Feind/Unklar): der Kern setzt dann `status`
  const enemy = q.status !== undefined || (e.side === "rot" && !!q.confirmedBy?.length);
  // «ohne Ort» steht schon in der Zeile
  const missing = (q.missing ?? []).filter((m) => !(m === "Ort" && !e.cells?.length && !e.nai && !e.where));
  const by = (q.confirmedBy ?? []).map((id) => events.find((x) => x.id === id)).filter((x): x is LageEvent => !!x && !x.deleted);
  return (
    <>
      {enemy && (q.status === "bestaetigt" || by.length > 0) && (
        <span className="qmark ok" title={by.length ? `bestätigt durch ${by.map((x) => `${x.melder ?? x.unit ?? "?"} ${x.t.slice(11, 16)}`).join(", ")}` : "bestätigt durch zweite Quelle"}>bestätigt</span>
      )}
      {missing.length > 0 && <span className="qmark inc" title={`${missing.join(", ")} fehlt – ${AEIOU}`}>unvollständig: {missing.join(", ")}</span>}
    </>
  );
}

/** E2 für die Vorschau: was der erkannten Meldung fehlt (z. B. ["Ort"]) */
export function useDraftMissing(draft: Draft | null, ex: Exercise): string[] {
  return useMemo(() => {
    if (!draft) return [];
    const tmp = eventFromDraft(draft, "vorschau");
    const m = eventQuality([tmp], tmp.t, ex);
    return m.get(tmp.id)?.missing ?? [];
  }, [draft, ex]);
}
