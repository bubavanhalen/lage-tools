/**
 * Übung aus einer Datei (MVP 3.5 Nachbesserung, Review 6 Feld H2; Entscheid «Online nie still ein»): eine neue oder
 * ersetzte Übung aus einer Datei startet immer mit Online-Diensten **aus**. Waren in der Datei welche an, fragt die
 * Rückmeldung «Öffnen» einmal «In der Datei waren Ortsnamen/Strassen an – hier einschalten?» (`MergeInfo.online`).
 * Beim Zusammenführen gilt ohnehin «lokal gewinnt» (Kern `mergeExercise`).
 */
import { onlineAllowed, type Exercise } from "@lage/core";

/** Namen der Online-Dienste für die Frage «In der Datei waren … an» */
const ONLINE_NAMEN: Record<"ortssuche" | "strassen" | "sprache", string> = { ortssuche: "Ortsnamen", strassen: "Strassen", sprache: "Spracherkennung des Browsers" };

/**
 * Übung aus einer Datei ohne eingeschaltete Online-Dienste (Feld H2, Entscheid «Online nie still ein»): gibt die Übung mit
 * allen Diensten aus zurück und – falls in der Datei welche an waren – deren Wahl samt Namen («Ortsnamen/Strassen»).
 */
export function ohneOnline(x: Exercise): { file: Exercise; online: { dienste: NonNullable<Exercise["onlineDienste"]>; namen: string } | null } {
  const an = (Object.keys(ONLINE_NAMEN) as Array<keyof typeof ONLINE_NAMEN>).filter((d) => onlineAllowed(x, d));
  if (!x.onlineDienste) return { file: x, online: null };
  const { onlineDienste, ...rest } = x;
  const file = rest as Exercise;
  if (!an.length) return { file, online: null };
  const dienste: NonNullable<Exercise["onlineDienste"]> = {};
  for (const d of an) dienste[d] = true;
  return { file, online: { dienste, namen: an.map((d) => ONLINE_NAMEN[d]).join("/") } };
}

