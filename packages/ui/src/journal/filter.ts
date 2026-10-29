/**
 * Filter der Journal-Liste aus der einen Suche (Spez. MVP 1, Kap. 3.4): Text (Trupp, PQ, NAI, Ort, Meldung) und
 * Stichwörter «feind», «eigene», «unklar», «nur 1 Trupp» (→ Chip «Art: …»). Reine Funktionen, ohne Browser testbar.
 */
import { compareEvents, type EventQuality, type Kind, type LageEvent } from "@lage/core";
import type { SearchArt } from "../shell/contracts";

/** Art einer Meldung für Filter: neutral (N) zählt zu «Unklar» */
export const kindOfEvent = (e: Pick<LageEvent, "side" | "aff">): Kind => (e.side === "blau" ? "eigen" : e.aff === "U" || e.aff === "N" ? "unklar" : "feind");

const KEYWORDS: Array<[RegExp, Exclude<SearchArt, null>]> = [
  [/(^|\s)nur\s*(1|ein(en)?)\s*trupp(\s|$)/i, "einzeln"],
  [/(^|\s)(feind|gegner|rot)(\s|$)/i, "feind"],
  [/(^|\s)(eigene?|blau)(\s|$)/i, "eigen"],
  [/(^|\s)unklar(\s|$)/i, "unklar"],
];

/** Chip-Text zur Art */
export const ART_LABEL: Record<Exclude<SearchArt, null>, string> = { feind: "Feind", eigen: "Eigene", unklar: "Unklar", einzeln: "nur 1 Trupp" };

/**
 * Stichwort im Suchtext erkennen und herauslösen: «feind AK7» → { q: "AK7", art: "feind" }. Nur ganze Wörter;
 * `complete` = false lässt ein Stichwort am Ende ohne Leerzeichen stehen (der Benutzer tippt vielleicht weiter, z. B. «feindl…»).
 */
export function takeKeyword(text: string, complete = true): { q: string; art: SearchArt } {
  for (const [re, art] of KEYWORDS) {
    const m = re.exec(text);
    if (!m) continue;
    if (!complete && m.index + m[0].length === text.length && !/\s$/.test(m[0])) continue;
    const q = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
    return { q, art };
  }
  return { q: text, art: null };
}

const PQ_LIKE = /^[a-z]{1,2}\d{1,3}$/i;
const norm = (s: string) => s.toLowerCase().replace(/[«»"':,()]/g, " ");

/** Passt die Meldung zum Suchtext? Jedes Wort muss als Wortanfang vorkommen; Planquadrate («AK7») genau. */
export function matchesQuery(e: LageEvent, q: string): boolean {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return true;
  const hay = norm(`${e.unit} ${e.melder ?? ""} ${e.text} ${e.where ?? ""} ${(e.cells ?? []).join(" ")} ${e.nai ?? ""} ${e.desc ?? ""}`);
  const words = hay.split(/\s+/).filter(Boolean);
  // «NAI 2», «Det 1»: Wortfolgen zusammen prüfen
  const joined = ` ${words.join(" ")} `;
  return toks.every((t, i) => {
    if (PQ_LIKE.test(t)) return words.includes(t);
    if (/^\d+$/.test(t) && i > 0) return joined.includes(` ${toks[i - 1]} ${t} `) || words.includes(t);
    return words.some((w) => w.startsWith(t));
  });
}

/**
 * Journal-Liste: nicht gelöscht, Lagezeit (≤ `to`), «Zeige letzte» (≥ `from`), Suche und Art; neueste zuerst.
 * `einzeln` = Sichtungen aus nur einer Quelle (Qualität «unbestätigt»).
 */
export function filterJournal(events: LageEvent[], o: { q?: string; art?: SearchArt; from?: string | null; to?: string | null; quality?: Map<string, EventQuality> }): LageEvent[] {
  const q = (o.q ?? "").trim();
  // einmal sortieren je Ereignisliste (neueste zuerst), Filterwechsel filtern nur noch (800 Meldungen: kein Sortieren pro Klick)
  return sortedDesc(events)
    .filter((e) => !e.deleted
      && (!o.to || e.t <= o.to)
      && (!o.from || e.t >= o.from)
      && (!o.art || (o.art === "einzeln" ? o.quality?.get(e.id)?.status === "unbestaetigt" : kindOfEvent(e) === o.art))
      && (!q || matchesQuery(e, q)));
}

const SORTED = new WeakMap<LageEvent[], LageEvent[]>();
/** neueste zuerst; zwischengespeichert pro Array (die Übung ersetzt `events` bei jeder Änderung) */
function sortedDesc(events: LageEvent[]): LageEvent[] {
  let s = SORTED.get(events);
  if (!s) { s = [...events].sort((a, b) => compareEvents(b, a)); SORTED.set(events, s); }
  return s;
}
