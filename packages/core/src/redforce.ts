/**
 * Lage Rot: erkannte Kräfte (aus dem Journal geschätzt) gegenüber der Feindannahme (erwartet).
 * Offline, ohne Abhängigkeiten. Benannte Elemente zählen einmal; unbenannte Sichtungen werden über Zeit und Raum
 * abgeglichen: «min» = vorsichtig (Wiederholungen zusammengefasst), «max» = alle Sichtungen verschieden.
 *
 * Schätzung je Zeile (Personen, Fahrzeuge, Typ wie Kpz/Drohne/Mg):
 * - benannte Elemente (z. B. «Det 1»): je Element das Maximum seiner Meldungen (Stufe als Spanne, z. B. Trp 3–5 Pers);
 * - unbenannte Sichtungen, Untergrenze («mind.»): in jedem Zeitfenster (`WINDOW_MIN`) werden Sichtungen gleichen Typs,
 *   die durch plausible Bewegung erklärbar sind (zu Fuss `FOOT_KMH`, Fz/Luft `FZ_KMH`, Ortsunschärfe Planquadrat/NAI), zu
 *   einem Objekt zusammengefasst; eine Sichtung, die Teil eines benannten Elements sein kann (von dessen Meldungen davor
 *   und danach erreichbar), zählt nur mit dem Überschuss über dessen Stärke. Grösste Summe eines Fensters = Untergrenze.
 *   Angaben aus fremder Quelle («angeblich», «Zivilperson meldet») zählen nicht zur Untergrenze;
 * - unbenannte Sichtungen, Obergrenze («bis»): Summe aller Sichtungen ohne offensichtliche Doppelmeldungen – gleiches
 *   Merkmal; gleicher/benachbarter Ort (innert `DUP_PLACE_MIN`, grössere Zahl ersetzt die kleinere); oder erreichbar
 *   innert `DUP_MIN` (bei Typen wie Kpz/Drohne ohne Zeitgrenze) –, gedeckelt auf `MAX_FACTOR` × Untergrenze (bzw. grösste
 *   Einzelsichtung);
 * - Art «unklar» zählt nicht, wird aber als eigene Zeile «Unklar» (Anzahl Sichtungen) ausgewiesen;
 * - mit Zeitfenster (`from`) zusätzlich die Zählung nur der Meldungen im Fenster (`inWindow`).
 *
 * Feindannahme (`parseStrength`): Kurzschrift wie in Meldungen; Zusätze (Inf, mot, verst, (+)/(−), Kdo, Reserve,
 * Gattung «Pz Gren», Typbezeichnungen wie «Leopard») werden übersprungen, «mit»/Klammer = davon, Spannen («12 bis 15»,
 * «15-20») als Mitte mit `min`/`max`. Ohne Personenangabe werden Personen aus der Stufe geschätzt (`STUFE_PERS`), wenn
 * alle genannten Elemente eine Stufe haben (nicht bei Det).
 */
import { CATALOG } from "./catalog";
import { sameOrNeighbor } from "./hintgeo";
import type { Exercise } from "./model";
import { GENERIC_FZ, MIN_MS, isoOfMs, lageMs, prepareRed, reachable, type PEv } from "./redprep";

/** Schwellen der Schätzung (Zeiten in Minuten, Tempo in km/h) */
export const STRENGTH_THRESHOLDS = {
  /** Richtwerte Tempo für den Abgleich über Zeit/Raum */
  FOOT_KMH: 6,
  FZ_KMH: 60,
  /** Zeitfenster «gleichzeitig» für die Untergrenze */
  WINDOW_MIN: 60,
  /** Doppelmeldung: erreichbar und gleiche oder kleinere Anzahl innert … */
  DUP_MIN: 60,
  /** Doppelmeldung am gleichen/benachbarten Ort (stehende Gruppe, mehrfach gemeldet) innert … */
  DUP_PLACE_MIN: 360,
  /** Obergrenze höchstens so viel mal die Untergrenze («alle verschieden» ist sonst nicht aussagekräftig) */
  MAX_FACTOR: 2,
  /** benanntes Element «nicht mehr gesehen» nach … */
  NOT_SEEN_MIN: 60,
} as const;
const S = STRENGTH_THRESHOLDS;

/** Zeile der Stärke, z. B. Personen, Fahrzeuge, Kpz, Drohnen, Elemente (Det) */
export interface StrengthRow {
  /** Schlüssel: «pers», «fz», «elemente:det», oder Katalog-Schlüssel (z. B. «kpz», «drohne»); «unklar» */
  key: string;
  /** Anzeigename, z. B. «Personen», «Fahrzeuge», «davon Kpz», «Elemente» */
  name: string;
  /** Unterzeile von (z. B. «fz» bei Kpz) */
  parent?: string;
  /** Kürzel für Anzahlen, z. B. «Det» (→ «2 Det»), «Pers», «Fz», «Kpz», «Drohnen» */
  abbr?: string;
}

/** Personen je Stufe für die Feindannahme ohne Personenangabe (Schätzung als Spanne, vorsichtig–höchstens) */
export const STUFE_PERS: Record<string, [number, number]> = { trp: [3, 4], gr: [6, 10], hz: [12, 18], zug: [25, 35] };

/** Feindannahme, aus Kurzschrift gelesen */
export interface StrengthSpec {
  /** `count` = Anzahl (bei Spanne die Mitte, aufgerundet); `min`/`max` nur bei Spanne bzw. aus der Stufe geschätzt */
  rows: Array<StrengthRow & { count: number; min?: number; max?: number; names?: string[] }>;
  /** nicht verstandene Teile der Eingabe */
  unknown: string[];
}

/** Erkannte Stärke einer Zeile */
export interface StrengthEstimate extends StrengthRow {
  min: number;
  max: number;
  /** benannte Elemente (z. B. «Det 1», «Det 2») */
  names?: string[];
  /** Meldungen, die zählen */
  events: string[];
  /** nur Meldungen im Zeitfenster (mit `estimateRedForce(…, { from })`) */
  inWindow?: { min: number; max: number };
}

export interface RedForce {
  rows: StrengthEstimate[];
  /** benannte Rot-Elemente, die seit längerer Zeit nicht mehr gemeldet wurden (längste zuerst) */
  notSeen: Array<{ unit: string; since: string; minutes: number; event: string }>;
}

/** Vergleich erkannt ↔ erwartet je Zeile */
export interface StrengthCompare {
  row: StrengthRow;
  found?: StrengthEstimate;
  expected?: number;
  /** «vollstaendig» (min = erwartet), «teilweise» (Anteil), «fehlt» (0), «unerwartet» (gefunden, nicht erwartet), «mehr» (min > erwartet), «offen» (keine Feindannahme bzw. Zeile «unklar») */
  state: "vollstaendig" | "teilweise" | "fehlt" | "unerwartet" | "mehr" | "offen";
  /** Anteil min/erwartet (0–1+) */
  ratio?: number;
}

// ---------------------------------------------------------------------------------------------
// Zeilen und Begriffe
// ---------------------------------------------------------------------------------------------
const ELEMENT_TYPES: Array<{ type: string; abbr: string; words: string[] }> = [
  { type: "det", abbr: "Det", words: ["det", "detachement", "detachemente", "detachment", "detachements"] },
  { type: "zug", abbr: "Zug", words: ["zug", "züge", "zuege"] },
  { type: "hz", abbr: "Hz", words: ["hz", "halbzug", "halbzüge"] },
  { type: "gr", abbr: "Gr", words: ["gr", "gruppe", "gruppen"] },
  { type: "trp", abbr: "Trp", words: ["trp", "trupp", "trupps"] },
  { type: "pat", abbr: "Pat", words: ["pat", "patr", "patrouille", "patrouillen"] },
  { type: "kp", abbr: "Kp", words: ["kp", "kompanie", "kompanien"] },
  { type: "element", abbr: "Elemente", words: ["element", "elemente", "einheit", "einheiten"] },
];
const PERS_WORDS = ["pers", "person", "personen", "mann", "sdt", "soldat", "soldaten", "bewaffnete", "angehörige", "ag"];
const FZ_WORDS = ["fz", "fzg", "fahrzeug", "fahrzeuge", "pw", "personenwagen", "auto", "autos", "wagen", "lieferwagen", "kastenwagen", "transporter", "van"];
/** Zusätze ohne eigene Zählung (Gattung, Ausrüstung, Verstärkung, Rolle) */
const SKIP_WORDS = new Set(["inf", "infanterie", "mot", "motorisiert", "motorisierte", "mech", "mechanisiert", "mechanisierte", "verst", "verstärkt", "verstärkte",
  "kdo", "kommando", "res", "reserve", "gren", "aufkl", "bewaffnet", "+", "-", "−", "(+)", "(-)", "(−)", "ca", "rund", "etwa", "feindliche", "feindlich", "gn", "rot"]);
const SNIPER_WORDS = ["sniper", "snipers", "scharfschütze", "scharfschützen", "heckenschütze", "heckenschützen"];
/** Kürzel für Typ-Zeilen */
const ABBR: Record<string, string> = {
  kpz: "Kpz", spz: "Spz", spz_rad: "Rad Spz", mtw: "MTW", aufkl_fz: "Aufkl Fz", gw: "Gw", lw: "Lastw", motorrad: "Motorrad", bus: "Bus",
  san_fz: "San Fz", bagger: "Bagger", dozer: "Dozer", brueckenleger: "Brü Pz", pz_hb: "Pz Hb",
  drohne: "Drohnen", heli: "Heli", flugzeug: "Flugzeug",
  mg: "Mg", smg: "sMg", pzaw: "Pzaw", panzerfaust: "Pzf", mw_geraet: "Mw", rak_werfer: "Rak Werfer", stgw: "Stgw", schaf_gewehr: "SSG", flab_kan: "Flab Kan", flab_lwf: "Flab Lwf",
};
const TYPE_NAME: Record<string, string> = { drohne: "Drohnen", heli: "Helikopter", flugzeug: "Flugzeuge" };
ABBR.scharfschuetze = "Scharfschützen";
const SKIP_TYPES = new Set(["fz", "ziv_fz", "kolonne"]);

type Term = { k: "el"; type: string } | { k: "pers" } | { k: "fz" } | { k: "type"; key: string };
const normTxt = (s: string) => s.toLowerCase().replace(/ß/g, "ss").replace(/[.]/g, " ").replace(/\s+/g, " ").trim();

let TERMS: Map<string, Term> | undefined;
function terms(): Map<string, Term> {
  if (TERMS) return TERMS;
  const m = new Map<string, Term>();
  const add = (w: string, t: Term) => { const k = normTxt(w); if (k && !m.has(k)) m.set(k, t); };
  for (const et of ELEMENT_TYPES) for (const w of et.words) add(w, { k: "el", type: et.type });
  for (const w of PERS_WORDS) add(w, { k: "pers" });
  for (const w of FZ_WORDS) add(w, { k: "fz" });
  for (const e of CATALOG) {
    if (SKIP_TYPES.has(e.key) || e.hidden) continue;
    if (e.category !== "Fahrzeuge" && e.category !== "Luftfahrzeuge" && e.category !== "Waffen") continue;
    const key = e.key;
    const t: Term = { k: "type", key };
    for (const w of [ABBR[key] ?? "", ...e.aliases, e.name, e.noun ?? "", e.pl ?? ""]) if (w) add(w, t);
  }
  add("drohnen", { k: "type", key: "drohne" });
  for (const w of SNIPER_WORDS) add(w, { k: "type", key: "scharfschuetze" });
  add("helikopter", { k: "type", key: "heli" });
  TERMS = m;
  return m;
}

function lookup(s: string): Term | undefined {
  const m = terms();
  const w = normTxt(s);
  if (!w) return undefined;
  for (const c of [w, w.replace(/en$/, ""), w.replace(/n$/, ""), w.replace(/e$/, ""), w.replace(/s$/, ""), w.replace(/se$/, "")]) {
    const t = m.get(c);
    if (t) return t;
  }
  return undefined;
}

/** Zeile zu einem Schlüssel */
export function strengthRow(key: string): StrengthRow {
  if (key.startsWith("elemente:")) {
    const et = ELEMENT_TYPES.find((x) => x.type === key.slice(9));
    return { key, name: "Elemente", abbr: et?.abbr ?? "Elemente" };
  }
  if (key === "pers") return { key, name: "Personen", abbr: "Pers" };
  if (key === "fz") return { key, name: "Fahrzeuge", abbr: "Fz" };
  if (key === "unklar") return { key, name: "Unklar (nicht gezählt)", abbr: "Sichtungen" };
  if (key === "scharfschuetze") return { key, name: "davon Scharfschützen", parent: "pers", abbr: "Scharfschützen" };
  const cat = CATALOG.find((e) => e.key === key);
  const abbr = ABBR[key] ?? cat?.name ?? key;
  if (cat?.category === "Fahrzeuge") return { key, name: `davon ${abbr}`, parent: "fz", abbr };
  return { key, name: TYPE_NAME[key] ?? abbr, abbr };
}

function rowOrder(key: string): number {
  if (key.startsWith("elemente:")) return ELEMENT_TYPES.findIndex((x) => x.type === key.slice(9));
  if (key === "pers") return 10;
  if (key === "scharfschuetze") return 11;
  if (key === "fz") return 20;
  if (key === "unklar") return 90;
  const cat = CATALOG.find((e) => e.key === key);
  if (cat?.category === "Fahrzeuge") return 21;
  if (cat?.category === "Luftfahrzeuge") return 30;
  if (cat?.category === "Waffen") return 40;
  return 50;
}
const byOrder = (a: { key: string }, b: { key: string }) => rowOrder(a.key) - rowOrder(b.key) || a.key.localeCompare(b.key);
const COLLATOR = new Intl.Collator("de", { numeric: true });
const natural = (a: string, b: string) => COLLATOR.compare(a, b);

/** Element-Typ aus dem Namen, z. B. «Det 2» → det, «Zug Nord» → zug, sonst «element» */
export function elementType(unit: string): string {
  const w = normTxt(unit).split(/[\s\d]/)[0] ?? "";
  for (const et of ELEMENT_TYPES) if (et.words.includes(w)) return et.type;
  return "element";
}

// ---------------------------------------------------------------------------------------------
// Feindannahme lesen
// ---------------------------------------------------------------------------------------------
const NUM_WORDS: Record<string, number> = {
  ein: 1, eine: 1, einen: 1, einer: 1, eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12,
};
const NUM = String.raw`(\d+|einen|einer|eine|eins|ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf)(?![a-zäöü])`;
const toNum = (s: string) => (/^\d+$/.test(s) ? +s : NUM_WORDS[s] ?? NaN);
const QUAL_RE = /^(?:ca|circa|~|≈|mind|mindestens|min|max|maximal|höchstens|hoechstens|etwa|rund|bis zu|total|gesamt|davon)\s*/;

/** Eingabe in Teile zerlegen (Komma, Semikolon, Zeilenumbruch, «+», «und», «sowie») – nicht innerhalb von Klammern */
function splitParts(text: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,;\n+]/.test(ch)) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.flatMap((p) => (/\(/.test(p) ? [p] : p.split(/\s+(?:und|sowie|&)\s+/i))).map((p) => p.trim()).filter(Boolean);
}

/**
 * Begriff aus Wörtern, Zusätze übersprungen: «zug verst» → Zug, «pz gren zug» → Zug, «kpz leopard» → Kpz.
 * Ergebnis: Begriff und übrige (nicht verstandene) Wörter.
 */
function termOf(words: string): { t?: Term; rest: string[] } {
  let toks = words.split(" ").filter(Boolean);
  // Gattung «Pz Gren» bzw. «Pz» vor einem Element («1 Pz Gren Zug», «Pz Zug»)
  const hasEl = toks.some((w) => lookup(w)?.k === "el");
  if (hasEl) toks = toks.filter((w, i) => !(w === "pz" || (w === "gren" && toks[i - 1] === "pz")));
  toks = toks.filter((w) => !SKIP_WORDS.has(w));
  if (!toks.length) return { rest: [] };
  const whole = lookup(toks.join(" "));
  if (whole) return { t: whole, rest: [] };
  // ein Begriff, übrige Wörter sind Bezeichnungen desselben Begriffs (z. B. «Kpz Leopard»)
  for (let i = 0; i < toks.length; i++) {
    const t = lookup(toks[i]!);
    if (!t) continue;
    const rest = toks.filter((_, j) => j !== i);
    const same = (w: string) => { const u = lookup(w); return !!u && JSON.stringify(u) === JSON.stringify(t); };
    if (rest.every(same)) return { t, rest: [] };
    return { t, rest: rest.filter((w) => !same(w)) };
  }
  return { rest: toks };
}

/** Feindannahme in Kurzschrift lesen, z. B. «2 Det, 14 Pers, 5 Fz (2 Kpz), 1 Drohne», «2 Det à 7 Pers», «Det 1, Det 2» */
export function parseStrength(text: string): StrengthSpec {
  /** Anzahl je Zeile als Spanne [vorsichtig, höchstens] */
  const counts = new Map<string, [number, number]>();
  const names = new Map<string, Set<string>>();
  let derivedPers = 0;
  /** Personen aus der Stufe (nur wenn alle genannten Elemente eine Stufe haben) */
  const stufe: [number, number] = [0, 0];
  let stufeOk = true;
  const unknown: string[] = [];
  const add = (key: string, lo: number, hi = lo) => {
    const c = counts.get(key) ?? [0, 0];
    counts.set(key, [c[0] + lo, c[1] + hi]);
    // Fahrzeuge: eigene Teile zählen zusammen («1 Lastw, 2 Lieferwagen» = 3 Fz), «davon»/Klammer/«mit» nicht
    if (key === "fz" || strengthRow(key).parent === "fz") { const f = sub ? fzSub : fzTop; f[0] += lo; f[1] += hi; }
  };
  let sub = false;
  const fzTop: [number, number] = [0, 0], fzSub: [number, number] = [0, 0];
  const keyOf = (t: Term) => (t.k === "el" ? `elemente:${t.type}` : t.k === "type" ? t.key : t.k);
  const element = (t: Term, n: [number, number]) => {
    if (t.k !== "el") return;
    const r = STUFE_PERS[t.type];
    if (!r) { stufeOk = false; return; }
    stufe[0] += n[0] * r[0];
    stufe[1] += n[1] * r[1];
  };

  const parsePart = (raw: string, davon = false) => {
    const outer = sub;
    sub = davon || outer || /^\s*davon\b/i.test(raw);
    try { parseOne(raw); } finally { sub = outer; }
  };
  const parseOne = (raw: string) => {
    let p = normTxt(raw).replace(/[–—]/g, "-").replace(/^[-•*]\s*/, "").replace(/(\p{L})-(\p{L})/gu, "$1 $2");
    // Klammer = davon bzw. Zusatz, z. B. «5 Fz (2 Kpz)», «2 Det (14 Pers)», «1 Kp (-)»
    const inner: string[] = [];
    p = p.replace(/\(([^)]*)\)/g, (_, x: string) => { inner.push(x); return " "; }).replace(/\s+/g, " ").trim();
    for (const x of inner) for (const q of splitParts(x)) if (!/^[+\-−]$/.test(q.trim()) && !SKIP_WORDS.has(normTxt(q))) parsePart(q, true);
    // «mit» = davon: «1 Hz Inf mit 2 Spz»
    const mit = p.split(/\s+mit\s+/);
    if (mit.length > 1) { p = mit[0]!; for (const q of mit.slice(1)) parsePart(q, true); }
    p = p.replace(QUAL_RE, "").replace(/^(\d+)\s*[x×]\s*/, "$1 ").trim();
    if (!p) return;
    // «à 6 Pers», «je 6», «zu je 6 Pers»
    let per: number | undefined, perTerm: Term | undefined;
    p = p.replace(new RegExp(String.raw`\s+(?:à|a|je|zu je|zu)\s+${NUM}(?:\s+(.+))?$`), (_, n: string, w?: string) => {
      per = toNum(n);
      perTerm = w ? termOf(w).t : { k: "pers" };
      return "";
    }).trim();
    // Anzahl (auch Spanne «12 bis 15», «15-20») + Begriff
    let m = new RegExp(String.raw`^${NUM}(?:\s*(?:-|bis)\s*${NUM})?\s+(.+)$`).exec(p);
    // Begriff + Anzahl: «Drohnen 2»
    if (!m) {
      const r = /^(.+?)\s+(\d+)$/.exec(p);
      const t = r ? termOf(r[1]!) : undefined;
      if (r && t?.t && t.t.k !== "el" && !t.rest.length) m = ["", r[2]!, undefined, r[1]!] as unknown as RegExpExecArray;
    }
    if (m) {
      const a = toNum(m[1]!), b = m[2] ? toNum(m[2]) : a;
      const { t, rest } = termOf(m[3]!);
      if (t && !rest.length && Number.isFinite(a) && Number.isFinite(b)) {
        const n: [number, number] = [Math.min(a, b), Math.max(a, b)];
        add(keyOf(t), n[0], n[1]);
        element(t, n);
        if (per !== undefined && perTerm && Number.isFinite(per)) {
          if (perTerm.k === "pers") derivedPers += n[1] * per;
          else add(keyOf(perTerm), n[0] * per, n[1] * per);
        }
        return;
      }
    }
    // benanntes Element: «Det 1», «Zug Nord» (nicht «Zug verst»)
    const toks = p.split(" ").filter((w) => !SKIP_WORDS.has(w));
    if (toks.length === 2 && /^(\d+[a-z]?|[a-zäöü]+)$/.test(toks[1]!) && !lookup(toks[1]!)) {
      const t = lookup(toks[0]!);
      if (t?.k === "el") {
        const et = ELEMENT_TYPES.find((x) => x.type === t.type)!;
        const key = keyOf(t);
        const nm = `${et.abbr} ${/^\d/.test(toks[1]!) ? toks[1]!.toUpperCase() : toks[1]![0]!.toUpperCase() + toks[1]!.slice(1)}`;
        const s = names.get(key) ?? new Set<string>();
        s.add(nm);
        names.set(key, s);
        element(t, [1, 1]);
        if (per !== undefined && Number.isFinite(per) && perTerm?.k === "pers") derivedPers += per;
        return;
      }
    }
    // Begriff allein: «Drohne», «Kpz», «Zug verst» = 1
    const { t, rest } = termOf(p);
    if (t && !rest.length) {
      add(keyOf(t), 1);
      element(t, [1, 1]);
      if (per !== undefined && Number.isFinite(per) && perTerm?.k === "pers") derivedPers += per;
      return;
    }
    unknown.push(raw.trim());
  };
  for (const part of splitParts(text ?? "")) parsePart(part);

  for (const [key, s] of names) {
    const c = counts.get(key) ?? [0, 0];
    counts.set(key, [Math.max(c[0], s.size), Math.max(c[1], s.size)]);
  }
  if (!counts.has("pers")) {
    if (derivedPers > 0) counts.set("pers", [derivedPers, derivedPers]);
    else if (stufeOk && stufe[1] > 0) counts.set("pers", [stufe[0], stufe[1]]);
  }
  // Fahrzeuge: Summe der eigenen Teile (allgemein + Typen), sonst der «davon»-Angaben
  if (fzTop[1] > 0 || fzSub[1] > 0) counts.set("fz", fzTop[1] >= fzSub[1] ? fzTop : fzSub);
  const rows = [...counts.entries()].map(([key, [lo, hi]]) => {
    const r: StrengthSpec["rows"][number] = { ...strengthRow(key), count: Math.round((lo + hi) / 2) };
    if (lo !== hi) { r.min = lo; r.max = hi; }
    const nm = names.get(key);
    if (nm) r.names = [...nm].sort(natural);
    return r;
  }).sort(byOrder);
  return { rows, unknown };
}

// ---------------------------------------------------------------------------------------------
// Erkannte Kräfte schätzen
// ---------------------------------------------------------------------------------------------
interface Qty {
  /** Typ-Zeile (Kpz, Drohne …): seltene Objekte – erreichbar = dieselben, ohne Zeitgrenze */
  typed?: boolean;
  lo: (v: PEv) => number;
  hi: (v: PEv) => number;
  kmh: (a: PEv, b: PEv) => number;
  /** gleichen Typs (dürfen dasselbe Objekt sein) */
  compat: (a: PEv, b: PEv) => boolean;
  /** gleicher bestimmter Typ (z. B. beide Kpz): erreichbar = dieselben, ohne Zeitgrenze */
  sameType?: (a: PEv, b: PEv) => boolean;
}

const typeQty = (key: string) => (v: PEv) => v.types.find(([k]) => k === key)?.[1] ?? 0;
const fzCompat = (a: PEv, b: PEv) => a.e.sym === b.e.sym || GENERIC_FZ.has(a.e.sym) || GENERIC_FZ.has(b.e.sym);

/** Untergrenze der unbenannten Sichtungen (siehe Kopf der Datei) */
function windowMin(sights: PEv[], named: Array<{ lo: number; reps: PEv[]; track: PEv[] }>, q: Qty): number {
  const list = sights.filter((v) => !v.hearsay && q.lo(v) > 0).sort((a, b) => a.ms - b.ms);
  if (!list.length) return 0;
  // je Sichtung: benannte Elemente gleichen Typs, die sie erklären können – von allen Meldungen des Elements davor
  // und danach (auch ohne Zahl, z. B. «bezieht Stellung») erreichbar
  const cand = new Map<PEv, number[]>();
  for (const x of list) {
    const js: number[] = [];
    named.forEach((u, j) => {
      if (!u.reps.some((r) => q.compat(r, x))) return;
      let before: PEv | undefined, after: PEv | undefined;
      for (const r of u.track) {
        if (r.ms <= x.ms) before = r;
        else if (!after) after = r;
      }
      const ok = (r: PEv | undefined) => !r || reachable(r, x, q.kmh(r, x));
      if ((before || after) && ok(before) && ok(after)) js.push(j);
    });
    cand.set(x, js);
  }
  let best = 0, lo = 0;
  const W = S.WINDOW_MIN * MIN_MS;
  for (let i = 0; i < list.length; i++) {
    while (list[lo]!.ms <= list[i]!.ms - W) lo++;
    const win = list.slice(lo, i + 1).sort((a, b) => q.lo(b) - q.lo(a) || a.ms - b.ms);
    const ng = new Map<number, { members: PEv[]; max: number }>();
    const groups: Array<{ members: PEv[]; max: number }> = [];
    const fits = (g: { members: PEv[] }, x: PEv) => g.members.every((m) => q.compat(m, x) && reachable(m, x, q.kmh(m, x)));
    for (const x of win) {
      let done = false;
      for (const j of cand.get(x)!) {
        const g = ng.get(j) ?? { members: [], max: 0 };
        if (!fits(g, x)) continue;
        g.members.push(x);
        g.max = Math.max(g.max, q.lo(x));
        ng.set(j, g);
        done = true;
        break;
      }
      if (done) continue;
      const g = groups.find((gr) => fits(gr, x));
      if (g) { g.members.push(x); g.max = Math.max(g.max, q.lo(x)); }
      else groups.push({ members: [x], max: q.lo(x) });
    }
    let sum = groups.reduce((s, g) => s + g.max, 0);
    for (const [j, g] of ng) sum += Math.max(0, g.max - named[j]!.lo);
    if (sum > best) best = sum;
  }
  return best;
}

/**
 * Obergrenze: Summe ohne offensichtliche Doppelmeldungen (siehe Kopf der Datei). Am gleichen/benachbarten Ort ersetzt
 * eine grössere Zahl die kleinere (stehende Gruppe, Zahl schwankt); sonst zählt eine erreichbare Sichtung mit gleicher
 * oder kleinerer Zahl innert `DUP_MIN` (Typ-Zeilen ohne Zeitgrenze) nicht nochmals.
 */
function dedupSum(sights: PEv[], q: Qty, named: Array<{ hi: number; track: PEv[] }> = []): number {
  // benannte Elemente zählen schon (mit ihrer Stärke): eine unbenannte Sichtung am letzten Ort des Elements bzw. von dort
  // erreichbar ist dasselbe Element (nur eine grössere Zahl zählt mit dem Überschuss)
  type K = { v: PEv; hi: number; dead?: boolean };
  const kept: K[] = [];
  const namedK = new Map<number, K>();
  const sigs = new Map<string, number>();
  let sum = 0;
  const placeMs = S.DUP_PLACE_MIN * MIN_MS, dupMs = S.DUP_MIN * MIN_MS;
  const all = [...sights.map((v) => ({ v, u: -1 })), ...named.flatMap((u, j) => u.track.map((v) => ({ v, u: j })))]
    .sort((a, b) => a.v.ms - b.v.ms || (a.v.id < b.v.id ? -1 : a.v.id > b.v.id ? 1 : 0));
  /** Doppelmeldung von d? «place» = gleicher/benachbarter Ort */
  const match = (d: K, x: PEv, hi: number): "place" | "reach" | null => {
    const dt = x.ms - d.v.ms;
    if (!q.compat(d.v, x)) return null;
    if (dt <= placeMs && (sameOrNeighbor(d.v, x) || d.v.nais.some((m) => x.nais.includes(m)))) return "place";
    if (hi <= d.hi && (dt <= dupMs || q.typed || !!q.sameType?.(d.v, x)) && reachable(d.v, x, q.kmh(d.v, x))) return "reach";
    return null;
  };
  for (const { v: x, u } of all) {
    if (u >= 0) {
      // benanntes Element: letzten Ort nachführen
      const k = namedK.get(u);
      if (k) k.v = x; else namedK.set(u, { v: x, hi: named[u]!.hi });
      continue;
    }
    const hi = q.hi(x);
    if (hi <= 0) continue;
    if (x.sig && (sigs.get(x.sig) ?? -1) >= hi) continue;
    if (x.sig) sigs.set(x.sig, Math.max(sigs.get(x.sig) ?? 0, hi));
    let hit: K | undefined, how: "place" | "reach" | null = null;
    for (const d of namedK.values()) if ((how = match(d, x, hi))) { hit = d; break; }
    if (!hit) {
      for (let j = kept.length - 1; j >= 0; j--) {
        const d = kept[j]!;
        if (d.dead) continue;
        if (x.ms - d.v.ms > placeMs && !q.typed && !q.sameType) break;
        if ((how = match(d, x, hi))) { hit = d; break; }
      }
    }
    if (!hit) { kept.push({ v: x, hi }); sum += hi; continue; }
    // grössere Zahl ersetzt die kleinere (Überschuss zählt); am gleichen Ort Spur nachführen (wandernde Gruppe)
    if (hi > hit.hi) { sum += hi - hit.hi; hit.hi = hi; }
    if (how === "place" && ![...namedK.values()].includes(hit)) {
      hit.dead = true;
      kept.push({ v: x, hi: hit.hi });
    }
  }
  return sum;
}

function estimateRow(key: string, feind: PEv[], q: Qty, unitName: Map<string, string>, tracks: Map<string, PEv[]>): StrengthEstimate | null {
  const rel = feind.filter((v) => q.hi(v) > 0);
  if (!rel.length) return null;
  const byUnit = new Map<string, PEv[]>();
  const unnamed: PEv[] = [];
  for (const v of rel) {
    if (v.unitKey) { const l = byUnit.get(v.unitKey); if (l) l.push(v); else byUnit.set(v.unitKey, [v]); }
    else unnamed.push(v);
  }
  const named = [...byUnit.entries()].map(([k, reps]) => ({ lo: Math.max(...reps.map(q.lo)), hi: Math.max(...reps.map(q.hi)), reps, track: tracks.get(k) ?? reps }));
  const nLo = named.reduce((s, u) => s + u.lo, 0), nHi = named.reduce((s, u) => s + u.hi, 0);
  const min = nLo + windowMin(unnamed, named, q);
  const raw = nHi + dedupSum(unnamed, q, named);
  // Deckel: höchstens `MAX_FACTOR` × (Untergrenze bzw. grösste einzelne Sichtung)
  const base = Math.max(min, ...rel.map(q.hi));
  const max = Math.max(min, Math.min(raw, Math.ceil(S.MAX_FACTOR * base)));
  const est: StrengthEstimate = { ...strengthRow(key), min, max, events: rel.map((v) => v.id) };
  if (byUnit.size && key !== "pers" && key !== "fz") est.names = [...byUnit.keys()].map((k) => unitName.get(k) ?? k).sort(natural);
  return est;
}

/** Meldungen als «aufgerieben/zerstört/gefangen» – Element gilt nicht als «nicht mehr gesehen» */
const DESTROYED_RE = /(?<!\p{L})(?:aufgerieben|vernichtet|zerstört|zerschlagen|ausgeschaltet|neutralisiert|kampfunfähig|gefangen|gefangengenommen|festgenommen|ergeben|ergibt sich)(?!\p{L})/iu;

/** Zeilen (Elemente, Personen, Fahrzeuge, Typen, unklar) aus den Meldungen */
function rowsOf(evs: PEv[], unitName: Map<string, string>): StrengthEstimate[] {
  const feind = evs.filter((v) => v.feind);
  const rows: StrengthEstimate[] = [];
  // Spur je benanntem Element (alle Meldungen Art feind mit Ort)
  const tracks = new Map<string, PEv[]>();
  for (const v of feind) if (v.unitKey && v.pos) { const l = tracks.get(v.unitKey); if (l) l.push(v); else tracks.set(v.unitKey, [v]); }
  // Elemente: benannte Rot-Elemente (Art feind), je Typ
  const elByType = new Map<string, { names: Set<string>; events: string[] }>();
  for (const v of feind) {
    if (!v.unitKey) continue;
    const key = `elemente:${elementType(v.e.unit)}`;
    const g = elByType.get(key) ?? { names: new Set<string>(), events: [] };
    g.names.add(unitName.get(v.unitKey) ?? v.e.unit);
    g.events.push(v.id);
    elByType.set(key, g);
  }
  for (const [key, g] of elByType) rows.push({ ...strengthRow(key), min: g.names.size, max: g.names.size, names: [...g.names].sort(natural), events: g.events });

  const foot = (a: PEv, b: PEv) => (a.foot && b.foot ? S.FOOT_KMH : S.FZ_KMH);
  const pers = estimateRow("pers", feind, { lo: (v) => v.persLo, hi: (v) => v.persHi, kmh: () => S.FOOT_KMH, compat: () => true }, unitName, tracks);
  if (pers) rows.push(pers);
  const fz = estimateRow("fz", feind, { lo: (v) => v.fz, hi: (v) => v.fz, kmh: () => S.FZ_KMH, compat: fzCompat, sameType: (a, b) => a.e.sym === b.e.sym && !GENERIC_FZ.has(a.e.sym) && a.e.sym !== "ziv_fz" }, unitName, tracks);
  if (fz) rows.push(fz);
  const typeKeys = new Set<string>();
  for (const v of feind) for (const [k] of v.types) typeKeys.add(k);
  for (const key of typeKeys) {
    const f = typeQty(key);
    const kmh = key === "scharfschuetze" ? S.FOOT_KMH : S.FZ_KMH;
    const r = estimateRow(key, feind, { typed: true, lo: f, hi: f, kmh: () => kmh, compat: () => true }, unitName, tracks);
    if (r) rows.push(r);
  }
  // Unklar: Anzahl Sichtungen (Personen, Fz, Luft), nicht gezählt
  const unklar = evs.filter((v) => v.unklar && (v.persHi > 0 || v.fz > 0 || v.types.length));
  if (unklar.length) {
    const one = () => 1;
    const q: Qty = { lo: one, hi: one, kmh: foot, compat: (a, b) => a.isPers === b.isPers };
    const min = Math.max(1, windowMin(unklar, [], q));
    rows.push({ ...strengthRow("unklar"), min, max: Math.max(min, dedupSum(unklar, q)), events: unklar.map((v) => v.id) });
  }
  return rows.sort(byOrder);
}

/**
 * Erkannte Kräfte Rot bis zur Lagezeit `t` (ganzes Journal). Mit `from` (ISO) zusätzlich je Zeile die Zählung nur der
 * Meldungen ab `from` (`inWindow`; «nicht mehr gesehen» bleibt unabhängig vom Fenster).
 */
export function estimateRedForce(ex: Exercise, t: string, opts: { from?: string } = {}): RedForce {
  const tMs = lageMs(ex, t);
  const evs = prepareRed(ex, tMs);
  const unitName = new Map<string, string>();
  const lastOf = new Map<string, PEv>();
  const feindUnits = new Set<string>();
  for (const v of evs) {
    if (v.side !== "rot" || !v.unitKey) continue;
    unitName.set(v.unitKey, v.e.unit);
    lastOf.set(v.unitKey, v);
    if (v.feind) feindUnits.add(v.unitKey);
  }
  const rows = rowsOf(evs, unitName);
  const fromMs = opts.from ? Date.parse(opts.from) : NaN;
  if (Number.isFinite(fromMs)) {
    const win = new Map(rowsOf(evs.filter((v) => v.ms >= fromMs), unitName).map((r) => [r.key, r]));
    for (const r of rows) {
      const w = win.get(r.key);
      r.inWindow = { min: w?.min ?? 0, max: w?.max ?? 0 };
    }
  }

  const notSeen: RedForce["notSeen"] = [];
  for (const [k, v] of lastOf) {
    // nur als «unklar» gemeldet bzw. zuletzt als aufgerieben/gefangen gemeldet: nicht «nicht mehr gesehen»
    if (!feindUnits.has(k) || DESTROYED_RE.test(v.e.text ?? "")) continue;
    const minutes = Math.round((tMs - v.ms) / MIN_MS);
    if (minutes > S.NOT_SEEN_MIN) notSeen.push({ unit: unitName.get(k) ?? k, since: isoOfMs(v.ms), minutes, event: v.id });
  }
  notSeen.sort((a, b) => b.minutes - a.minutes || natural(a.unit, b.unit));
  return { rows, notSeen };
}

/** Erkannt ↔ erwartet zusammenführen (Zeilen aus beiden Seiten) */
export function compareStrength(found: RedForce, spec: StrengthSpec | null): StrengthCompare[] {
  const keys = new Set<string>([...found.rows.map((r) => r.key), ...(spec?.rows ?? []).map((r) => r.key)]);
  const out: StrengthCompare[] = [];
  for (const key of [...keys].sort((a, b) => byOrder({ key: a }, { key: b }))) {
    const f = found.rows.find((r) => r.key === key);
    const s = spec?.rows.find((r) => r.key === key);
    const row: StrengthRow = f ? { key: f.key, name: f.name, parent: f.parent, abbr: f.abbr } : strengthRow(key);
    if (row.parent === undefined) delete row.parent;
    if (row.abbr === undefined) delete row.abbr;
    const c: StrengthCompare = { row, state: "offen" };
    if (f) c.found = f;
    if (!spec || key === "unklar") { out.push(c); continue; }
    if (!s) {
      c.state = f && f.max > 0 ? "unerwartet" : "offen";
      out.push(c);
      continue;
    }
    c.expected = s.count;
    const min = f?.min ?? 0;
    if (s.count <= 0) { c.state = min > 0 ? "mehr" : "vollstaendig"; out.push(c); continue; }
    c.ratio = min / s.count;
    c.state = !f || f.max <= 0 ? "fehlt" : min > s.count ? "mehr" : min === s.count ? "vollstaendig" : "teilweise";
    out.push(c);
  }
  return out;
}
