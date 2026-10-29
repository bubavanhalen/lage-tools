import type { SearchHit } from "@lage/core";

/**
 * Vorschlag in Worten, ohne Hover lesbar: «H03 – zuletzt 07:20 gemeldet · Standort AP4 D (T1 18:45)», «AK7 – Planquadrat».
 * `lastReport` = Zeit der letzten Meldung des Trupps (ISO lokal, «T2 07:20» → Label «T2»).
 */
export function hitText(h: Pick<SearchHit, "kind" | "label" | "detail" | "badge" | "side">, today?: string, lastReport?: { t: string; day: string }): string {
  const strip = (x: string) => (today ? x.replace(new RegExp(`(^|\\s)${today}\\s(\\d\\d:\\d\\d)`), "$1$2") : x);
  let det = strip(h.detail ?? h.badge);
  if (h.kind === "element" && h.side === "blau" && lastReport) {
    const rep = strip(`${lastReport.day} ${lastReport.t.slice(11, 16)}`);
    const m = /^zuletzt (.+?)(?: · (.+))?$/.exec(det);
    const where = m?.[2] ? ` · Standort ${m[2]}${m[1] !== rep ? ` (${m[1]})` : ""}` : "";
    return `${h.label} – zuletzt ${rep} gemeldet${where}`;
  }
  if (h.kind === "pq") det = det ? `Planquadrat · ${det}` : "Planquadrat";
  return `${h.label} – ${det}`;
}

