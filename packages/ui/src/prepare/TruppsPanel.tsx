/**
 * Vorbereiten, Schritt 4 «Trupps» (Spez. MVP 1, Kap. 2.9): eigene Trupps als Liste (`ex.units.blau`), hinzufügen,
 * entfernen (mit Rückgängig), Zuteilung NAI ↔ Trupp anzeigen. Trupps entstehen auch beim ersten Melden – der
 * Schritt ist empfohlen, nicht nötig. Die Chipreihe «Wer meldet?» liest dieselbe Liste.
 */
import { useState } from "react";
import type { Exercise } from "@lage/core";
import "./prepare.css";

export function TruppsPanel({ ex, update, offerUndo }: {
  ex: Exercise;
  update(f: (x: Exercise) => Exercise): void;
  offerUndo(label: string, restore: () => void): void;
}) {
  const [name, setName] = useState("");
  const list = ex.units.blau;
  const nais = ex.areas.filter((a) => a.kind === "nai");
  const naiOf = (t: string) => nais.filter((a) => a.trupp?.trim().toLowerCase() === t.toLowerCase()).map((a) => a.name);
  const free = nais.filter((a) => !a.trupp?.trim()).map((a) => a.name);
  const clean = name.trim().replace(/\s+/g, " ");
  const dup = !!clean && list.some((u) => u.toLowerCase() === clean.toLowerCase());
  const add = () => {
    if (!clean || dup) return;
    update((x) => { x.units.blau = [...x.units.blau, clean]; return x; });
    setName("");
  };
  const remove = (u: string) => {
    const i = list.indexOf(u);
    update((x) => { x.units.blau = x.units.blau.filter((y) => y !== u); return x; });
    offerUndo(`Trupp «${u}» entfernt`, () => update((x) => { if (!x.units.blau.includes(u)) x.units.blau.splice(Math.min(i, x.units.blau.length), 0, u); return x; }));
  };
  return (
    <div className="pp">
      {list.length === 0 ? <p className="pp-empty">Noch keine Trupps. Sie entstehen auch beim ersten Melden.</p> : (
        <ul className="pp-list">
          {list.map((u) => {
            const n = naiOf(u);
            return (
              <li key={u} className="pp-trupp">
                <b className="mono">{u}</b>
                <span className="pp-meta">{n.length ? `überwacht ${n.join(", ")}` : "kein NAI zugeteilt"}</span>
                <button type="button" className="pp-btn" onClick={() => remove(u)} aria-label={`Trupp ${u} entfernen`}>Entfernen</button>
              </li>
            );
          })}
        </ul>
      )}
      {free.length > 0 && <p className="pp-note">Ohne Trupp: {free.join(", ")} – Zuteilung in Schritt 3 «NAI und Räume».</p>}
      <form className="pp-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <label className="pp-l" htmlFor="pp-trupp">Trupp hinzufügen</label>
        <div className="pp-addrow">
          <input id="pp-trupp" className="mono" value={name} placeholder="Name des Trupps, z. B. H06" onChange={(e) => setName(e.target.value)} spellCheck={false} />
          <button type="submit" className="pp-btn" disabled={!clean || dup}>Hinzufügen</button>
        </div>
        {dup && <p className="pp-note">«{clean}» gibt es schon.</p>}
      </form>
    </div>
  );
}
