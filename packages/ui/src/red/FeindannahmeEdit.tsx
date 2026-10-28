/**
 * «Erwartete Kräfte Rot (aus dem Befehl)» – Feindannahme in Kurzschrift, z. B. «2 Det, 14 Pers, 5 Fz, 1 Drohne», mit
 * Vorschau der gelesenen Teile. Aus `LageRotPanel` herausgelöst (Spez. MVP 1, Kap. 2.9 Schritt 5); Paket A setzt die
 * Komponente in Vorbereiten, Schritt 5, ein (`prepare/FeindannahmeEdit.tsx` kann sie unverändert weitergeben).
 * Ändern wirkt sofort auf die Kräfte-Zeile in «Was Rot vorhaben könnte».
 */
import { useState } from "react";
import { parseStrength, type Exercise } from "@lage/core";
import { specChip } from "../lageRot";
import "./red.css";

export const FA_EMPTY = "Noch keine erwarteten Kräfte. Kurzschrift, z. B. 2 Det, 14 Pers, 5 Fz, 1 Drohne.";

export function FeindannahmeEdit({ ex, update, readOnly }: {
  ex: Exercise;
  update: (f: (x: Exercise) => Exercise) => void;
  /** nur anzeigen (z. B. Präsentation) */
  readOnly?: boolean;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const cur = ex.feindannahme?.trim() ?? "";
  const save = () => {
    const v = (edit ?? "").trim();
    update((x) => { if (v) x.feindannahme = v; else delete x.feindannahme; return x; });
    setEdit(null);
  };
  if (edit !== null) {
    const p = edit.trim() ? parseStrength(edit) : { rows: [], unknown: [] };
    return (
      <div className="fa-edit">
        <label className="fa-l" htmlFor="fa-in">Erwartete Kräfte Rot <span>(aus dem Befehl, Kurzschrift wie Meldungen)</span></label>
        <input id="fa-in" className="mono" value={edit} autoFocus placeholder="z. B. 2 Det, 14 Pers, 5 Fz, 1 Drohne" spellCheck={false}
          onChange={(e) => setEdit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { e.stopPropagation(); setEdit(null); } }} />
        {(p.rows.length > 0 || p.unknown.length > 0) && (
          <ul className="fa-prev" aria-label="Verstanden">
            {p.rows.map((r) => <li key={r.key} className={r.parent ? "sub" : ""} title={r.name}>{specChip(r)}</li>)}
            {p.unknown.map((u, k) => <li key={"u" + k} className="unk" title="nicht verstanden – wird nicht gezählt">? {u}</li>)}
          </ul>
        )}
        <div className="fa-btns">
          <button className="red-btn primary" onClick={save}>Speichern</button>
          <button className="red-btn" onClick={() => setEdit(null)}>Abbrechen (Esc)</button>
          {cur && <button className="red-btn fa-del" onClick={() => setEdit("")}>Leeren</button>}
        </div>
      </div>
    );
  }
  if (!cur) {
    return (
      <div className="fa none">
        <p className="fa-empty">{FA_EMPTY}</p>
        {!readOnly && <button className="red-btn" onClick={() => setEdit("")}>Erwartete Kräfte eintragen</button>}
      </div>
    );
  }
  return (
    <div className="fa">
      <p className="fa-cur"><span className="fa-k">Erwartete Kräfte Rot</span> <span className="mono">{cur}</span></p>
      {!readOnly && <button className="red-btn" onClick={() => setEdit(cur)}>Ändern</button>}
    </div>
  );
}
