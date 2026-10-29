/**
 * Klartext-Hilfen für Meldungsfeld, Liste und Foto-/Sprach-Übersicht (Spez. MVP 1, Kap. 4.1; Nachbesserung M1):
 * Kürzel erklären («T2» = Übungstag 2 mit Datum), «Fehlt noch: was gesehen» statt «Wer», kein «Einheit (allg.)»,
 * Vorschläge der Erkennung in den Text übernehmen. Reine Funktionen, ohne Browser testbar.
 */

/** «T2 = Übungstag 2 · Mi., 15.05.2030» (Tooltip/Titel zu «T2»); ausserhalb der Übungstage nur das Datum */
export function dayTitle(t: string, days: string[]): string {
  const day = t.slice(0, 10);
  const d = new Date(`${day}T12:00:00`);
  const date = Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  const i = days.indexOf(day);
  return i >= 0 ? `T${i + 1} = Übungstag ${i + 1} · ${date}` : date;
}

/** fehlende Angaben in Worten: «Wer» (aus der Qualitätsprüfung) heisst hier «was gesehen» */
export const missLabel = (m: string): string => (m === "Wer" ? "was gesehen" : m);

/**
 * Text für das Zeichen, wenn nur das allgemeine Zeichen «Einheit» erkannt wurde (Spez. 4.1: «Einheit (allg.)» gibt es
 * nicht mehr): eigene Meldung → «Trupp H04», sonst «Gesehen: ?». `null` = es gibt einen besseren Text.
 */
export function genericWhat(sym: string, side: string, who?: string): string | null {
  if (sym !== "einheit") return null;
  if (side === "blau") return who ? `Trupp ${who}` : "Eigener Trupp";
  return "Gesehen: ?";
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Vorschlag übernehmen: Textstelle `token` durch `by` ersetzen (erste Fundstelle, ganzes Wort). Zeiten passen auch
 * mit Doppelpunkt/Punkt («15:35» ↔ «1535»). Unverändert, wenn die Stelle nicht vorkommt.
 */
export function replaceToken(text: string, token: string, by: string): string {
  const t = token.trim();
  if (!t) return text;
  const time = /^(\d{1,2}):?(\d{2})$/.exec(t);
  const re = time
    ? new RegExp(`(^|[^\\d])${time[1]!.padStart(2, "0").replace(/^0/, "0?")}[:.]?${time[2]}(?!\\d)`)
    : new RegExp(`(^|[\\s(«"'])${esc(t)}(?=$|[\\s,.;:!?)»"'])`, "i");
  if (!re.test(text)) return text;
  return text.replace(re, (_m, pre: string) => `${pre}${by}`);
}
