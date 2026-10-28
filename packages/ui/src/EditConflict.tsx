/**
 * Konflikt beim Bearbeiten einer Meldung: während der Bearbeitung hat ein anderes Fenster dieselbe Meldung geändert
 * oder gelöscht (`editConflict` in persist.ts). Die Bearbeitung bleibt offen; Band mit der Wahl
 * «Trotzdem speichern» (eigene Fassung gilt, gelöschte Meldung kommt zurück) oder «Verwerfen» (andere Fassung gilt).
 */
import { useEffect, useRef } from "react";
import "./persist.css";

export function EditConflict({ kind, nudge, onForce, onDiscard }: {
  kind: "geaendert" | "geloescht" | null;
  /** zählt hoch, wenn trotz Konflikt gespeichert werden sollte (Band kurz hervorheben) */
  nudge: number;
  onForce: () => void;
  onDiscard: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!nudge || !ref.current) return;
    const el = ref.current;
    el.classList.remove("nudge"); void el.offsetWidth; el.classList.add("nudge");
    el.querySelector<HTMLButtonElement>("button")?.focus();
  }, [nudge]);
  if (!kind) return null;
  return (
    <div ref={ref} className="editconflict" role="alert">
      <span><b>{kind === "geloescht" ? "In einem anderen Fenster gelöscht" : "In einem anderen Fenster geändert"}</b>
        {kind === "geloescht" ? " – «Trotzdem speichern» stellt die Meldung mit dieser Korrektur wieder her." : " – «Trotzdem speichern» überschreibt die andere Änderung."}</span>
      <span className="editconflict-acts">
        <button type="button" className="primary" onClick={onForce}>Trotzdem speichern</button>
        <button type="button" onClick={onDiscard} title={kind === "geloescht" ? "Korrektur verwerfen, Meldung bleibt gelöscht" : "Korrektur verwerfen, die andere Fassung gilt"}>Verwerfen</button>
      </span>
    </div>
  );
}
