/**
 * Probleme eines Entwurfs (`Draft.problems`, Kern): roter Chip in der Vorschau und Klartext, weshalb Eintragen
 * gesperrt ist. Nie still falsch: ein unbekannter Ort («AK77», «NAI 9») wird nicht durch «bei Melder» ersetzt.
 * Ausweg Ort: «Ort auf Karte» setzen (dann gilt das Ort-Problem als gelöst); sonst Text korrigieren.
 */
import type { Draft, DraftProblem } from "@lage/core";
import "./journalfix.css";

/** Probleme, die (noch) sperren: ein von Hand auf der Karte gesetzter Ort löst ein Ort-Problem */
export function openProblems(d: Pick<Draft, "problems"> | null | undefined, o: { manualPos?: boolean } = {}): DraftProblem[] {
  return (d?.problems ?? []).filter((p) => !(p.kind === "ort" && o.manualPos));
}

/** Klartext für Hinweis/Statusmeldung beim Versuch einzutragen */
export function blockText(ps: DraftProblem[], verb = "Eintragen"): string {
  if (!ps.length) return "";
  const what = ps.map((p) => p.text).join(" · ");
  const ort = ps.some((p) => p.kind === "ort");
  const zeit = ps.some((p) => p.kind === "zeit");
  const fix = ort && zeit ? "Ort und Zeit im Text korrigieren (oder «Ort auf Karte»)" : ort ? "Text korrigieren oder «Ort auf Karte» setzen" : verb === "Speichern" ? "Zeit korrigieren (Feld «Zeit» oder Text)" : "Zeit im Text korrigieren";
  return `${verb} gesperrt: ${what}. ${fix}.`;
}

/** Rote Chips «… – bitte prüfen» */
export function ProblemChips({ problems }: { problems: DraftProblem[] }) {
  if (!problems.length) return null;
  return (
    <>
      {problems.map((p, i) => (
        <span key={`${p.kind}-${i}`} className="chip problem" role="alert" title={p.kind === "ort" ? "Diesen Ort gibt es in Raster/NAI nicht – Text korrigieren oder Ort auf der Karte setzen" : "Ungültige Zeitangabe – bitte im Text korrigieren"}>
          <b aria-hidden="true">!</b> {p.text} – bitte prüfen
        </span>
      ))}
    </>
  );
}

/** Zeile unter der Vorschau: weshalb Eintragen gesperrt ist */
export function BlockNote({ problems, verb }: { problems: DraftProblem[]; verb?: string }) {
  if (!problems.length) return null;
  return <p className="blocknote" role="status">{blockText(problems, verb)}</p>;
}
