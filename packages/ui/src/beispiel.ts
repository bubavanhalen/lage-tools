/**
 * Testzugang über die Adresse (Spez. MVP 1, Kap. 6.1/7; MVP 3, Kap. 2.10/6.1/8.5):
 *   `?beispiel`       → Beispiel Bern (fiktiv) mit allen Meldungen (`demoExercise()`), wie «Beispiel ansehen»
 *   `?beispiel=leer`  → dieselbe Vorbereitung (Raster BERN, NAI 1–3, AO, Trupps H01–H05, Feindannahme) ohne Meldungen
 *   `?beispiel=lang`  → lange Übung (fiktiv, Raum Bern): 800 Einträge über 4 Tage, alle Eintragsarten, 12 Übergaben
 *                       (`demoLang()`, deterministisch; Uhr für Tests 2030-05-18 07:30 = T4)
 *
 * Alle haben eine eigene, feste ID und ersetzen beim Laden nur sich selbst (wie das Beispiel aus dem Menü) –
 * Übungen des Benutzers bleiben unberührt. Danach wird der Parameter aus der Adresse entfernt: Neuladen zeigt den
 * gespeicherten Stand weiter (nichts geht verloren), erneutes Öffnen mit `?beispiel…` beginnt frisch.
 *
 * MVP 3: `?beispiel` und `?beispiel=lang` setzen auf diesem Gerät das fiktive Kürzel «BSP» als laufende Schicht
 * (`beispielSchicht`, `localStorage[SCHICHT_KEY]`), `?beispiel=leer` nicht (dort erscheint die Kürzel-Abfrage).
 */
import { demoExercise, demoLang, DEMO_LANG_ID, type Exercise, type SchichtWechsel } from "@lage/core";
import { SCHICHT_KEY, type SchichtLokal } from "./shell/contracts";

export type BeispielArt = "voll" | "leer" | "lang";

export const BEISPIEL_LEER_ID = "ex-beispiel-bern-leer";
export const BEISPIEL_LANG_ID = DEMO_LANG_ID;
/** fiktives Kürzel der Beispiel-Schicht */
export const BEISPIEL_KUERZEL = "BSP";
/** Schichtbeginn im Beispiel Bern: T2 06:00 (Sommerzeit) */
const BEISPIEL_SCHICHT: SchichtWechsel = { id: "schicht-beispiel-t2", art: "beginn", at: "2030-05-15T04:00:00.000Z", t: "2030-05-15T06:00", an: BEISPIEL_KUERZEL, device: "dev-beispiel" };

/** Art aus der Adresse: `?beispiel` / `?beispiel=1` → voll, `?beispiel=leer` → leer, `?beispiel=lang` → lang, sonst null. */
export function beispielAusUrl(search: string = typeof location === "undefined" ? "" : location.search): BeispielArt | null {
  const q = new URLSearchParams(search);
  if (!q.has("beispiel")) return null;
  const v = (q.get("beispiel") ?? "").trim().toLowerCase();
  return v === "leer" ? "leer" : v === "lang" ? "lang" : "voll";
}

/** Beispielübung (fiktiv, Raum Bern); `leer` ohne Meldungen, Anhänge und Entscheide, `lang` 800 Einträge – je eigene ID. */
export function beispielUebung(art: BeispielArt): Exercise {
  if (art === "lang") return demoLang();
  const ex = demoExercise();
  if (art === "voll") return { ...ex, schichten: [{ ...BEISPIEL_SCHICHT }] };
  ex.id = BEISPIEL_LEER_ID;
  ex.name = "Beispiel Bern (fiktiv, ohne Meldungen)";
  ex.events = [];
  ex.attachments = [];
  ex.hintDecisions = {};
  return ex;
}

/** Schicht dieses Geräts für das Beispiel: «BSP» seit dem letzten Wechsel der Übung; `leer` → null (Abfrage zeigen) */
export function beispielSchicht(art: BeispielArt, ex: Pick<Exercise, "schichten">): SchichtLokal | null {
  if (art === "leer") return null;
  const last = [...(ex.schichten ?? [])].filter((s) => s.an === BEISPIEL_KUERZEL).sort((a, b) => (a.at < b.at ? -1 : 1)).pop();
  return { kuerzel: BEISPIEL_KUERZEL, seit: last?.at ?? null, wechselId: last?.id ?? null };
}

/** Schicht des Beispiels auf diesem Gerät setzen bzw. (leer) entfernen – still, ohne Fehler bei gesperrtem Speicher */
export function beispielSchichtSetzen(art: BeispielArt, ex: Pick<Exercise, "id" | "schichten">): void {
  try {
    const s = beispielSchicht(art, ex);
    if (s) localStorage.setItem(SCHICHT_KEY(ex.id), JSON.stringify(s));
    else localStorage.removeItem(SCHICHT_KEY(ex.id));
  } catch { /* privates Fenster, gesperrter Speicher: egal */ }
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
