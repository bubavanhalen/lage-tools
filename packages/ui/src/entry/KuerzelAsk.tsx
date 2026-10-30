/**
 * Kürzel-Abfrage im Meldungsfeld (Spez. MVP 3, Entscheid E5, Kap. 2.3): erscheint beim ersten Enter ohne Kürzel, die
 * Meldung bleibt im Feld. Enter im Kürzel-Feld speichert das Kürzel (2–6 Zeichen, A–Z/0–9, gross) **und** trägt ein;
 * leer + Enter trägt ohne Kürzel ein (Abfrage erst wieder nach Neuladen). Esc zurück ins Meldungsfeld.
 * Testhaken: Feld mit Label «Kürzel», Text «Wer erfasst?».
 * MVP 3.5 (S24): Rückfall, wenn die Kürzel-Zeile übergangen wurde; eine Regel (`kuerzelNorm`), kein `maxLength`, der
 * still abschneidet («Wm M» → «wird zu WMM»).
 */
import { useEffect, useId, type RefObject } from "react";
import { KUERZEL_HINWEIS, kuerzelNorm } from "../shell/contracts";

export function KuerzelAsk({ value, onChange, onSubmit, onCancel, error, inputRef }: {
  value: string;
  onChange(v: string): void;
  /** Enter: eintragen (mit Kürzel bzw. ohne, wenn leer) */
  onSubmit(): void;
  onCancel(): void;
  /** Kürzel ungültig */
  error: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, [inputRef]);
  return (
    <div className="eb-kuerzel" role="group" aria-label="Wer erfasst?">
      <p className="eb-kz-q" id={`${id}-q`}><b>Wer erfasst?</b> Dein Kürzel steht im Journal und bei der Übergabe.</p>
      <div className="eb-kz-row">
        <label className="eb-kz-l" htmlFor={`${id}-k`}>Kürzel</label>
        <input ref={inputRef} id={`${id}-k`} className="eb-kz-f mono" value={value} placeholder="z. B. MU"
          autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="send"
          aria-invalid={error || undefined} aria-describedby={`${id}-h`}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
          }} />
        <span className="eb-kz-h" id={`${id}-h`}>
          {error || (value.trim() && !kuerzelNorm(value)) ? <b className={error ? "eb-kz-err" : undefined}>{KUERZEL_HINWEIS}</b>
            : value.trim() && kuerzelNorm(value) !== value.trim() ? <>wird zu <b className="mono">{kuerzelNorm(value)}</b> · Enter trägt ein</>
            : <>Enter trägt ein · ohne Kürzel: Feld leer lassen</>}
        </span>
      </div>
    </div>
  );
}
