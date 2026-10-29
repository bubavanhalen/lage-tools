/**
 * Filter der Journal-Liste aus der einen Suche (Spez. MVP 1, Kap. 3.4): Text (Trupp, PQ, NAI, Ort, Meldung) und
 * Stichwörter «feind», «eigene», «unklar», «nur 1 Trupp» (→ Chip «Art: …»). Reine Funktionen, ohne Browser testbar.
 *
 * MVP 3 (Kap. 1.1, 2.5): Stichwörter «gestrichen», «dringend», «offen», «Auftrag», «Orientierung», «Rückfrage», «Vbk»,
 * «Notiz»; eine Zahl allein («54», «Nr 54», «12a») sucht die laufende Nummer. Feind/Eigene/Unklar zeigen nur Meldungen.
 */
import { artOf, compareEvents, lvzIndex, nrLabel, vermerkeOf, type EventQuality, type Exercise, type Kind, type LageEvent } from "@lage/core";
import type { SearchArt } from "../shell/contracts";

/** Art einer Meldung für Filter: neutral (N) zählt zu «Unklar» */
export const kindOfEvent = (e: Pick<LageEvent, "side" | "aff">): Kind => (e.side === "blau" ? "eigen" : e.aff === "U" || e.aff === "N" ? "unklar" : "feind");

const KEYWORDS: Array<[RegExp, Exclude<SearchArt, null>]> = [
  [/(^|\s)nur\s*(1|ein(en)?)\s*trupp(\s|$)/i, "einzeln"],
  [/(^|\s)(feind|gegner|rot)(\s|$)/i, "feind"],
  [/(^|\s)(eigene?|blau)(\s|$)/i, "eigen"],
  [/(^|\s)unklar(\s|$)/i, "unklar"],
  // MVP 3
  [/(^|\s)(gestrichen|gestrichene|gelöscht|gelöschte)(\s|$)/i, "gestrichen"],
  [/(^|\s)dringend(e)?(\s|$)/i, "dringend"],
  [/(^|\s)offen(e)?(\s|$)/i, "offen"],
  [/(^|\s)(auftrag|aufträge|auftraege)(\s|$)/i, "auftrag"],
  [/(^|\s)(orientierung|orientierungen)(\s|$)/i, "orientierung"],
  [/(^|\s)(rückfrage|rückfragen|rueckfrage|rueckfragen)(\s|$)/i, "rueckfrage"],
  [/(^|\s)(vbk|verbindungskontrolle|verbindungskontrollen)(\s|$)/i, "vbk"],
  [/(^|\s)(notiz|notizen)(\s|$)/i, "notiz"],
];

/** Chip-Text zur Art */
export const ART_LABEL: Record<Exclude<SearchArt, null>, string> = {
  feind: "Feind", eigen: "Eigene", unklar: "Unklar", einzeln: "nur 1 Trupp",
  // MVP 3 (Phase 0: nur Chip-Texte; Stichwörter und Filter baut Paket B)
  gestrichen: "gestrichen", dringend: "dringend", offen: "offen",
  auftrag: "Auftrag", orientierung: "Orientierung", rueckfrage: "Rückfrage", vbk: "Verbindung", notiz: "Notiz",
};

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
/** Satzzeichen trennen Wörter («Standort Det 2?» findet «Det 2»; Punkt nur am Wortende, «2.5» bleibt) */
const norm = (s: string) => s.toLowerCase().replace(/[«»"':,()?!;]/g, " ").replace(/\.(?=\s|$)/g, " ");

/** Passt die Meldung zum Suchtext? Jedes Wort muss als Wortanfang vorkommen; Planquadrate («AK7») genau. */
export function matchesQuery(e: LageEvent, q: string): boolean {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return true;
  const hay = norm(`${e.unit} ${e.melder ?? ""} ${e.text} ${e.where ?? ""} ${(e.cells ?? []).join(" ")} ${e.nai ?? ""} ${e.desc ?? ""} ${e.an ?? ""} ${e.quelle ?? ""} ${(e.orte ?? []).join(" ")} ${e.erfasstVon ?? ""}`);
  const words = hay.split(/\s+/).filter(Boolean);
  // «NAI 2», «Det 1»: Wortfolgen zusammen prüfen
  const joined = ` ${words.join(" ")} `;
  return toks.every((t, i) => {
    if (PQ_LIKE.test(t)) return words.includes(t);
    if (/^\d+$/.test(t) && i > 0) return joined.includes(` ${toks[i - 1]} ${t} `) || words.includes(t);
    return words.some((w) => w.startsWith(t));
  });
}

/** Suchtext ist eine laufende Nummer («54», «Nr 54», «nr. 12a») → Nummer klein geschrieben, sonst null */
export function nrQuery(q: string): string | null {
  const m = /^\s*(?:nr\.?\s*)?(\d{1,5}[a-z]?)\s*$/i.exec(q);
  return m ? m[1]!.toLowerCase() : null;
}

/** Passt die Meldung zur Art im Filter? (Feind/Eigene/Unklar nur Meldungen; «gestrichen» prüft der Aufrufer) */
function artMatches(e: LageEvent, art: Exclude<SearchArt, null>, o: { quality?: Map<string, EventQuality>; ex?: Pick<Exercise, "events"> }): boolean {
  switch (art) {
    case "einzeln": return o.quality?.get(e.id)?.status === "unbestaetigt";
    case "feind": case "eigen": case "unklar": return artOf(e) === "meldung" && !e.hebtAuf && kindOfEvent(e) === art;
    case "gestrichen": return !!e.deleted;
    case "dringend": case "offen": {
      const v = vermerkeOf(e, lvzIndex(o.ex?.events ?? []));
      return art === "dringend" ? v.dringend : v.status === "offen";
    }
    default: return artOf(e) === art;
  }
}

/**
 * Journal-Liste: nicht gelöscht, Lagezeit (≤ `to`), «Zeige letzte» (≥ `from`), Suche und Art; neueste zuerst.
 * `einzeln` = Sichtungen aus nur einer Quelle (Qualität «unbestätigt»).
 * MVP 3: `gestrichene` = gestrichene Einträge an ihrer Zeit mitzeigen; Art «gestrichen» = nur diese. Eine Zahl allein
 * sucht die laufende Nummer (`ex` nötig).
 */
export function filterJournal(events: LageEvent[], o: { q?: string; art?: SearchArt; from?: string | null; to?: string | null; quality?: Map<string, EventQuality>; gestrichene?: boolean; ex?: Pick<Exercise, "events"> }): LageEvent[] {
  const q = (o.q ?? "").trim();
  const nr = nrQuery(q);
  const ex = o.ex ?? { events };
  const showDel = !!o.gestrichene || o.art === "gestrichen";
  // einmal sortieren je Ereignisliste (neueste zuerst), Filterwechsel filtern nur noch (800 Meldungen: kein Sortieren pro Klick)
  return sortedDesc(events)
    .filter((e) => (showDel || !e.deleted)
      && (!o.to || e.t <= o.to)
      && (!o.from || e.t >= o.from)
      && (!o.art || artMatches(e, o.art, { quality: o.quality, ex }))
      && (!q || (nr ? nrMatches(e, nr, ex) : matchesQuery(e, q))));
}

/** Nummer «12» passt auf «12», «12a», «12b»; «12a» nur genau */
function nrMatches(e: LageEvent, nr: string, ex: Pick<Exercise, "events">): boolean {
  const l = nrLabel(e, ex).toLowerCase();
  return l === nr || (/^\d+$/.test(nr) && l.replace(/[a-z]+$/, "") === nr);
}

/** Anzahl gestrichener Einträge (für «Gestrichene zeigen (n)»), im selben Zeitfenster wie die Liste */
export function countGestrichene(events: LageEvent[], o: { from?: string | null; to?: string | null } = {}): number {
  let n = 0;
  for (const e of events) if (e.deleted && (!o.to || e.t <= o.to) && (!o.from || e.t >= o.from)) n++;
  return n;
}

const SORTED = new WeakMap<LageEvent[], LageEvent[]>();
/** neueste zuerst; zwischengespeichert pro Array (die Übung ersetzt `events` bei jeder Änderung) */
function sortedDesc(events: LageEvent[]): LageEvent[] {
  let s = SORTED.get(events);
  if (!s) { s = [...events].sort((a, b) => compareEvents(b, a)); SORTED.set(events, s); }
  return s;
}

const WECHSEL_WORTE = ["schichtwechsel", "wechsel", "übergabe", "uebergabe", "schicht"];
/**
 * Suche nach den Zeilen «Schichtwechsel 07:30 BSP → MU» (MVP 3 Fix 3): beginnt mit «Schichtwechsel», «Wechsel»,
 * «Übergabe», «Schicht» oder ist deren Anfang («Schichtw», ab 4 Zeichen), bzw. genau ein Kürzel eines Wechsels.
 */
export function wechselSuche(q: string, ws: Array<{ an: string; von?: string }> = []): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return false;
  if (WECHSEL_WORTE.some((w) => s.startsWith(w) || (s.length >= 4 && w.startsWith(s)))) return true;
  return ws.some((w) => s === w.an.toLowerCase() || s === (w.von ?? "").toLowerCase());
}
