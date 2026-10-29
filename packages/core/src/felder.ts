/**
 * Meldungen im Schema AEIOU («A: 1020 E: 3 Pers bewaffnet I: Rtg W O: AF8 C U: beobachten weiter») oder als
 * Meldezettel («Wann: 1020 Wer: H03 Was: 3 Pers Wo: AF8») feldweise lesen (Spez. MVP 3, Kap. 3.2).
 *
 * Schema nach docs/REGELWERK_ROT.md, «Meldeschemata»: **A** Wann · **E** Wer tut was · **I** Wie · **O** Wo · **U** Umwelt.
 * - Zeit nur aus A/Wann/Zeit, Ort nur aus O/Wo/Ort, Gesehenes aus E (+ I). **U/Umwelt/Bem wird nie ausgewertet.**
 * - Entscheid 2 des Kunden (`AEIOU_E_REGEL`): **E ist immer das Gesehene, nie der Melder.** Der Melder kommt aus dem
 *   Feld «Melder:»/«Von:», dem Text vor dem ersten Feld («H03 A: 1020 …») oder (UI) dem Trupp-Knopf; sonst fehlt er.
 * - Meldezettel: «Wer:» mit genau einem eigenen Trupp (und ohne «Melder:») ist der Melder – ein eigenes Feld für das
 *   Gesehene gibt es dort («Was:»). Das gilt nur für den Meldezettel, nicht für AEIOU-E.
 *
 * Reine Funktionen, ohne Abhängigkeiten. `parseMeldung` (Paket A) liest danach `felderZuText(f)` mit den bisherigen
 * Regeln; `Draft.text` bleibt der Originaltext.
 */
import type { MeldeFelder } from "./model";

/** AEIOU-Marke: Grossbuchstabe + Doppelpunkt, davor Anfang oder Leerzeichen */
const AEIOU_RE = /(?<=^|\s)([AEIOU]):/g;
/** Wortmarken des Meldezettels (gross/klein egal) */
const WORT_RE = /(?<=^|\s)(wann|zeit|wer|was|wie|wo|ort|melder|von|rtg|richtung|bem|bemerkung|umwelt):/giu;

const ELEMENT_RE = /^(?:H\d{1,3}|Det\.?\s?\d{1,2}|Zug\s?\d{1,2}|Gr\.?\s?\d{1,2}|Trp\.?\s?\d{1,2}|Pat\.?\s?\d{1,2})$/i;

type Key = keyof Omit<MeldeFelder, "schema">;

const AEIOU_KEY: Record<string, Key> = { A: "wann", E: "was", I: "wie", O: "wo", U: "umwelt" };
const WORT_KEY: Record<string, Key | "rtg"> = {
  wann: "wann", zeit: "wann", wer: "wer", was: "was", wie: "wie", wo: "wo", ort: "wo",
  melder: "melder", von: "melder", rtg: "rtg", richtung: "rtg", bem: "umwelt", bemerkung: "umwelt", umwelt: "umwelt",
};

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s,;:–-]+|[\s,;–-]+$/g, "").trim();

/** eigener Trupp («H03», «h3» bei H03 in der Übung)? */
function ownUnit(w: string, blau: string[]): string | null {
  const flat = (s: string) => s.toLowerCase().replace(/[\s.]/g, "").replace(/(\D)0+(\d)/g, "$1$2");
  const hit = blau.find((b) => flat(b) === flat(w));
  if (hit) return hit;
  return /^H\d{1,3}$/i.test(w) ? w.toUpperCase() : null;
}

/** Melder vor dem ersten Feld («H03 A: …», «H03 meldet: A: …») */
function lead(prefix: string, blau: string[]): string | undefined {
  const p = clean(prefix.replace(/\bmeldet\b/i, ""));
  if (!p) return undefined;
  return ownUnit(p, blau) ?? (ELEMENT_RE.test(p) ? p : undefined);
}

/**
 * Felder lesen: AEIOU ab **3** Marken `A: E: I: O: U:`, Meldezettel ab **2** Wortmarken; sonst `null` (Kurzmeldung).
 * Werte reichen bis zur nächsten Marke; «Rtg:»/«Richtung:» wird an `wie` angehängt («Rtg W»).
 */
export function readMeldeFelder(text: string, o: { blau: string[] }): MeldeFelder | null {
  const aeiou = [...text.matchAll(AEIOU_RE)];
  const wort = [...text.matchAll(WORT_RE)];
  const schema: MeldeFelder["schema"] | null = new Set(aeiou.map((m) => m[1])).size >= 3 ? "aeiou" : new Set(wort.map((m) => m[1]!.toLowerCase())).size >= 2 ? "formular" : null;
  if (!schema) return null;
  // beim AEIOU-Schema zählen zusätzlich die Wortmarken «Melder:»/«Von:»/«Bem:» (nicht «Wer:» usw., die stehen dann im Text)
  const marks = (schema === "aeiou"
    ? [...aeiou.map((m) => ({ i: m.index!, len: m[0].length, key: AEIOU_KEY[m[1]!]! as Key | "rtg" })),
      ...wort.filter((m) => /^(melder|von|bem|bemerkung)$/i.test(m[1]!)).map((m) => ({ i: m.index!, len: m[0].length, key: WORT_KEY[m[1]!.toLowerCase()]! }))]
    : wort.map((m) => ({ i: m.index!, len: m[0].length, key: WORT_KEY[m[1]!.toLowerCase()]! }))).sort((a, b) => a.i - b.i);
  const f: MeldeFelder = { schema };
  const put = (k: Key, v: string) => { if (!v) return; f[k] = f[k] ? `${f[k]} ${v}` : v; };
  let rtg = "";
  marks.forEach((m, n) => {
    const v = clean(text.slice(m.i + m.len, n + 1 < marks.length ? marks[n + 1]!.i : text.length));
    if (m.key === "rtg") rtg = v ? `Rtg ${v.replace(/^(rtg|richtung)\.?\s*/i, "")}` : "";
    else put(m.key, v);
  });
  if (rtg) f.wie = f.wie ? `${f.wie} ${rtg}` : rtg;
  const vor = lead(text.slice(0, marks[0]!.i), o.blau);
  if (!f.melder && vor) f.melder = vor;
  if (f.melder) f.melder = ownUnit(f.melder, o.blau) ?? f.melder;
  // Meldezettel: «Wer: H03» (genau ein eigener Trupp) ist der Melder; AEIOU-E nie (Entscheid 2)
  if (schema === "formular" && !f.melder && f.wer) {
    const u = ownUnit(f.wer, o.blau);
    if (u) { f.melder = u; delete f.wer; }
  }
  return f;
}

/**
 * Gelesener Text für die bisherige Erkennung: `${wann} ${melder}: ${wer} ${was} ${wie} ${wo}` – **ohne** Umwelt/Bem.
 * Ohne Melder steht nur `${wann} ${was} …` da. Achtung Paket A: `parseMeldung` nimmt sonst ein eigenes Element am
 * Anfang des Gesehenen («E: H03 …») als Melder – bei `felder.melder` leer muss der Melder aus dem Trupp-Knopf kommen
 * oder fehlen (Entscheid 2), nie aus E.
 */
export function felderZuText(f: MeldeFelder): string {
  const was = clean([f.wer, f.was, f.wie, f.wo].filter(Boolean).join(" "));
  if (f.melder) return clean(`${[f.wann, f.melder].filter(Boolean).join(" ")}: ${was}`);
  return clean([f.wann, was].filter(Boolean).join(" "));
}
