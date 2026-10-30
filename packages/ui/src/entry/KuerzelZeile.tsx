/**
 * Kürzel-Zeile beim Öffnen (Spez. MVP 3.5, Kap. 2.2, E4, S24): erscheint über dem Meldungsfeld, solange die Übung auf
 * diesem Gerät kein Kürzel hat (Erststart, neue Übung, Datei als neue Übung, «Übung wechseln», `?beispiel=leer`).
 * «Wer führt das Journal?» · Feld «Dein Kürzel» · «Übernehmen». Die Eingabe wird live normalisiert angezeigt
 * («Wm M» → «wird zu WMM», `kuerzelNorm`); ungültig → «2–6 Zeichen: Buchstaben A–Z und Ziffern» (Knopf bleibt aktiv,
 * Enter umrandet den Hinweis rot – nie still). Kein `maxLength`, der still abschneidet. Enter/«Übernehmen» ruft `onSet`
 * (die Hülle setzt das Kürzel als Schichtbeginn und den Fokus ins Meldungsfeld). Testhaken: Label «Dein Kürzel»,
 * Text «wird zu WMM».
 */
import { useEffect, useId, useRef, useState } from "react";
import { KUERZEL_HINWEIS, kuerzelNorm, type KuerzelZeileProps } from "../shell/contracts";

export function KuerzelZeile({ exId, onSet, autoFocus }: KuerzelZeileProps & { autoFocus?: boolean }) {
  const id = useId();
  const [v, setV] = useState("");
  const [fehler, setFehler] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => { setV(""); setFehler(false); }, [exId]);
  useEffect(() => { if (autoFocus) inp.current?.focus({ preventScroll: true }); }, [exId]); // eslint-disable-line react-hooks/exhaustive-deps
  const norm = v.trim() ? kuerzelNorm(v) : null;
  const take = () => {
    if (!norm) { setFehler(true); inp.current?.focus(); return; }
    onSet(norm);
  };
  return (
    <div className="eb-kzz" role="group" aria-labelledby={`${id}-h`}>
      <p className="eb-kzz-h" id={`${id}-h`}>Wer führt das Journal?</p>
      <div className="eb-kzz-row">
        <label className="eb-kzz-l" htmlFor={`${id}-k`}>Dein Kürzel</label>
        <input ref={inp} id={`${id}-k`} className="eb-kzz-f mono" value={v} placeholder="z. B. MU"
          autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="done"
          aria-invalid={fehler || undefined} aria-describedby={`${id}-t`}
          onChange={(e) => { setV(e.target.value); setFehler(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); take(); } }} />
        <button type="button" className="eb-btn" onClick={take}>Übernehmen</button>
      </div>
      <p className={"eb-kzz-t" + (fehler ? " is-err" : "")} id={`${id}-t`} aria-live="polite">
        {v.trim() && !norm ? KUERZEL_HINWEIS
          : norm && norm !== v.trim() ? <>wird zu <b className="mono">{norm}</b></>
          : "Steht bei jedem Eintrag und in der Übergabe. 2–6 Zeichen."}
      </p>
    </div>
  );
}
