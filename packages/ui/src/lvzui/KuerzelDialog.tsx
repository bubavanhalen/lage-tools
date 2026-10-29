/**
 * Menü «Kürzel ändern …» (Spez. MVP 3, Kap. 3.6): neues Kürzel und die Frage «Neue Schicht beginnen (Neu ab jetzt)
 * oder nur Schreibweise korrigieren?». Ohne bisheriges Kürzel ist es immer ein Schichtbeginn.
 */
import { useState } from "react";
import { Dialog } from "../shell/Dialog";
import { kuerzelNorm } from "../shell/contracts";
import "./lvzui.css";

export function KuerzelDialog({ kuerzel, seit, onSet, onClose }: {
  kuerzel: string | null; seit: string | null;
  onSet: (k: string, neu: boolean) => void; onClose: () => void;
}) {
  const [v, setV] = useState(kuerzel ?? "");
  const ok = kuerzelNorm(v);
  const go = (neu: boolean) => { if (!ok) return; onSet(ok, neu); onClose(); };
  return (
    <Dialog title="Kürzel ändern" onClose={onClose}>
      <p className="dlg-p">{kuerzel ? <>Jetzt: Schicht <b>{kuerzel}</b>{seit ? <> seit {seit}</> : null}. </> : null}Dein Kürzel steht im Journal und bei der Übergabe (2–6 Zeichen, A–Z und Ziffern).</p>
      <label className="kz-field">Kürzel
        <input className="ueb-in mono" value={v} maxLength={6} autoFocus autoComplete="off" spellCheck={false} placeholder="z. B. MU"
          onChange={(e) => setV(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(true); } }} />
      </label>
      {!ok && v.trim() !== "" && <p className="dlg-note">2–6 Zeichen, nur A–Z und Ziffern.</p>}
      <div className="kz-acts">
        <button type="button" className="jl-btn ueb-primary kz-neu" disabled={!ok} onClick={() => go(true)}>Neue Schicht beginnen (Neu ab jetzt)</button>
        {kuerzel && <button type="button" className="jl-btn" disabled={!ok} onClick={() => go(false)}>Nur Schreibweise korrigieren</button>}
      </div>
    </Dialog>
  );
}
