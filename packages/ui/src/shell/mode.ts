/**
 * Arbeitsweise (Spez. MVP 1, Kap. 1.1): Modus «Lage führen» | «Vorbereiten» und Schalter «Experte».
 * Pro Gerät in `localStorage["lage-tools.arbeitsweise"]` gemerkt, frei umschaltbar (Menü), ohne PIN.
 * Erststart: `{ modus: "lage", experte: false }`. Umschalten ändert nur die Ansicht – Entwurf, Auswahl und Lagezeit
 * bleiben, weil sie ausserhalb dieses Zustands liegen.
 * Mehrere Fenster: eine Änderung in einem Fenster gilt beim nächsten Öffnen; offene Fenster folgen über `storage`.
 */
import { useCallback, useEffect, useState } from "react";
import { ARBEITSWEISE_KEY, ARBEITSWEISE_START, type Arbeitsweise, type Modus } from "./contracts";

/** gespeicherte Arbeitsweise lesen (fehlerhaft/fehlend → Erststart) */
export function readArbeitsweise(raw: string | null | undefined = undefined): Arbeitsweise {
  let s = raw;
  if (s === undefined) { try { s = localStorage.getItem(ARBEITSWEISE_KEY); } catch { s = null; } }
  if (!s) return { ...ARBEITSWEISE_START };
  try {
    const v = JSON.parse(s) as Partial<Arbeitsweise>;
    const modus: Modus = v.modus === "vorbereiten" ? "vorbereiten" : "lage";
    return { modus, experte: v.experte === true };
  } catch {
    return { ...ARBEITSWEISE_START };
  }
}

export function writeArbeitsweise(a: Arbeitsweise): void {
  try { localStorage.setItem(ARBEITSWEISE_KEY, JSON.stringify(a)); } catch { /* privates Fenster: nur für diese Sitzung */ }
}

export interface ArbeitsweiseApi {
  aw: Arbeitsweise;
  setModus(m: Modus): void;
  setExperte(on: boolean): void;
}

export function useArbeitsweise(): ArbeitsweiseApi {
  const [aw, setAw] = useState<Arbeitsweise>(() => readArbeitsweise());
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === ARBEITSWEISE_KEY) setAw(readArbeitsweise(e.newValue)); };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  const set = useCallback((f: (a: Arbeitsweise) => Arbeitsweise) => setAw((a) => {
    const n = f(a);
    if (n.modus === a.modus && n.experte === a.experte) return a;
    writeArbeitsweise(n);
    return n;
  }), []);
  const setModus = useCallback((modus: Modus) => set((a) => ({ ...a, modus })), [set]);
  const setExperte = useCallback((experte: boolean) => set((a) => ({ ...a, experte })), [set]);
  return { aw, setModus, setExperte };
}
