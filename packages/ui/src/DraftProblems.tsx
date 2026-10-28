/**
 * Probleme eines Entwurfs (`Draft.problems`, Kern): roter Chip in der Vorschau und Klartext, weshalb Eintragen
 * gesperrt ist. Nie still falsch: ein unbekannter Ort («AK77», «NAI 9») wird nicht durch «bei Melder» ersetzt.
 * Ausweg Ort: «Ort auf Karte» setzen (dann gilt das Ort-Problem als gelöst); sonst Text korrigieren.
 * Unbekannter Trupp («H13» bei H01–H05): Text korrigieren oder ausdrücklich «als neuen Trupp aufnehmen» (`onAddUnit`).
 * Zwei Orte in einer Meldung: als einzelne Meldungen eintragen («Ort auf Karte» löst das nicht).
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
  const fixes: string[] = [];
  if (ort && zeit) fixes.push("Ort und Zeit im Text korrigieren (oder «Ort auf Karte»)");
  else if (ort) fixes.push("Text korrigieren oder «Ort auf Karte» setzen");
  else if (zeit) fixes.push(verb === "Speichern" ? "Zeit korrigieren (Feld «Zeit» oder Text)" : "Zeit im Text korrigieren");
  if (ps.some((p) => p.kind === "melder")) fixes.push(fixes.length ? "Trupp korrigieren oder als neuen Trupp aufnehmen" : "Trupp im Text korrigieren oder als neuen Trupp aufnehmen");
  if (ps.some((p) => p.kind === "orte")) fixes.push(fixes.length ? "eine Meldung pro Ort eintragen" : "Eine Meldung pro Ort eintragen");
  return `${verb} gesperrt: ${what}. ${fixes.join("; ")}.`;
}

const TITLE: Record<DraftProblem["kind"], string> = {
  ort: "Diesen Ort gibt es in Raster/NAI nicht – Text korrigieren oder Ort auf der Karte setzen",
  zeit: "Zeitangabe ungültig oder ungenau – bitte im Text korrigieren",
  melder: "Diesen Trupp gibt es in der Übung nicht – im Text korrigieren (z. B. «H01 3 Pers») oder als neuen Trupp aufnehmen",
  orte: "Die Karte zeigt pro Meldung nur einen Ort – eine Zeile pro Ort eintragen",
};

/**
 * Rote Chips «… – bitte prüfen»; bei unbekanntem Trupp mit `onAddUnit` zusätzlich «… als neuen Trupp aufnehmen»
 * (ausdrücklich, nie still).
 */
export function ProblemChips({ problems, onAddUnit }: { problems: DraftProblem[]; onAddUnit?: (unit: string) => void }) {
  if (!problems.length) return null;
  return (
    <>
      {problems.map((p, i) => (
        <span key={`${p.kind}-${i}`} className="chip problem" role="alert" title={TITLE[p.kind]}>
          <b aria-hidden="true">!</b> {p.text} – bitte prüfen
        </span>
      ))}
      {onAddUnit && problems.filter((p) => p.kind === "melder" && p.token).map((p) => (
        <button key={`add-${p.token}`} type="button" className="chipbtn" title={`«${p.token}» als eigenes Element der Übung aufnehmen – danach gilt die Meldung`}
          onClick={() => onAddUnit(p.token!)}>«{p.token}» als neuen Trupp aufnehmen</button>
      ))}
    </>
  );
}

/** Zeile unter der Vorschau: weshalb Eintragen gesperrt ist */
export function BlockNote({ problems, verb }: { problems: DraftProblem[]; verb?: string }) {
  if (!problems.length) return null;
  return <p className="blocknote" role="status">{blockText(problems, verb)}</p>;
}
