/**
 * Testzugang über die Adresse (Spez. MVP 1, Kap. 6.1/7):
 *   `?beispiel`       → Beispiel Bern (fiktiv) mit allen Meldungen (`demoExercise()`), wie «Beispiel ansehen»
 *   `?beispiel=leer`  → dieselbe Vorbereitung (Raster BERN, NAI 1–3, AO, Trupps H01–H05, Feindannahme) ohne Meldungen
 *
 * Beide haben eine eigene, feste ID und ersetzen beim Laden nur sich selbst (wie das Beispiel aus dem Menü) –
 * Übungen des Benutzers bleiben unberührt. Danach wird der Parameter aus der Adresse entfernt: Neuladen zeigt den
 * gespeicherten Stand weiter (nichts geht verloren), erneutes Öffnen mit `?beispiel…` beginnt frisch.
 */
import { demoExercise, type Exercise } from "@lage/core";

export type BeispielArt = "voll" | "leer";

export const BEISPIEL_LEER_ID = "ex-beispiel-bern-leer";

/** Art aus der Adresse: `?beispiel` / `?beispiel=1` → voll, `?beispiel=leer` → leer, sonst null. */
export function beispielAusUrl(search: string = typeof location === "undefined" ? "" : location.search): BeispielArt | null {
  const q = new URLSearchParams(search);
  if (!q.has("beispiel")) return null;
  return (q.get("beispiel") ?? "").trim().toLowerCase() === "leer" ? "leer" : "voll";
}

/** Beispielübung (fiktiv, Raum Bern); `leer` ohne Meldungen, Anhänge und Entscheide, mit eigener ID. */
export function beispielUebung(art: BeispielArt): Exercise {
  const ex = demoExercise();
  if (art === "voll") return ex;
  ex.id = BEISPIEL_LEER_ID;
  ex.name = "Beispiel Bern (fiktiv, ohne Meldungen)";
  ex.events = [];
  ex.attachments = [];
  ex.hintDecisions = {};
  return ex;
}

/** `beispiel` aus der Adresse entfernen (ohne Neuladen, ohne neuen Verlaufseintrag). */
export function beispielAusUrlEntfernen(): void {
  try {
    const u = new URL(location.href);
    if (!u.searchParams.has("beispiel")) return;
    u.searchParams.delete("beispiel");
    history.replaceState(history.state, "", u.pathname + (u.search ? u.search : "") + u.hash);
  } catch { /* egal */ }
}
