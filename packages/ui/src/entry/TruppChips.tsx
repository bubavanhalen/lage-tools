/**
 * «Wer meldet?» (Spez. MVP 1, Kap. 3.2): Chipreihe der eigenen Trupps (zuletzt meldend zuerst) und «+». Ein Chip setzt
 * den Trupp **als Text** an den Anfang des Meldungsfelds (der Text bleibt einzige Wahrheit). Gewählt = erkannter
 * Trupp (dunkler Rahmen). «+» öffnet ein Feld «Name des Trupps, z. B. H06»: Enter nimmt ihn auf und wählt ihn, Esc
 * bricht ab. Tablet: Reihe scrollt waagrecht. Zählt im Inventar als ein Element (`data-zaehl="trupps"`).
 */
import { useRef, useState } from "react";

export function TruppChips({ trupps, selected, onPick, onAdd }: {
  trupps: string[];
  /** erkannter Trupp im Text */
  selected?: string;
  onPick(name: string): void;
  /** neuer Trupp (aufnehmen und wählen) */
  onAdd(name: string): void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const inp = useRef<HTMLInputElement>(null);
  const done = (ok: boolean) => {
    const n = name.trim();
    setAdding(false);
    setName("");
    if (ok && n) onAdd(n);
  };
  return (
    <div className="eb-trupps" role="group" aria-label="Wer meldet?" data-zaehl="trupps">
      <div className="eb-trupps-row">
        {trupps.map((u) => (
          <button key={u} type="button" className="eb-chip" aria-pressed={selected?.toLowerCase() === u.toLowerCase()}
            onPointerDown={(e) => e.preventDefault()} onClick={() => onPick(u)}>{u}</button>
        ))}
        {adding ? (
          <input ref={inp} className="eb-chip-add" autoFocus value={name} placeholder="Name des Trupps, z. B. H06" aria-label="Name des neuen Trupps"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => done(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); done(true); }
              else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); }
            }} />
        ) : (
          <button type="button" className="eb-chip eb-chip-plus" aria-label="Trupp hinzufügen" onClick={() => setAdding(true)}>{trupps.length ? "+" : "+ Trupp"}</button>
        )}
      </div>
    </div>
  );
}
