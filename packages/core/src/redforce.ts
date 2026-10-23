/**
 * Lage Rot: erkannte Kräfte (aus dem Journal geschätzt) gegenüber der Feindannahme (erwartet).
 * Offline, ohne Abhängigkeiten. Benannte Elemente zählen einmal; unbenannte Sichtungen werden über Zeit und Raum
 * abgeglichen: «min» = vorsichtig (Wiederholungen zusammengefasst), «max» = alle Sichtungen verschieden.
 *
 * Schätzung je Zeile (Personen, Fahrzeuge, Typ wie Kpz/Drohne/Mg):
 * - benannte Elemente (z. B. «Det 1»): je Element das Maximum seiner Meldungen (Stufe als Spanne, z. B. Trp 3–5 Pers);
 * - unbenannte Sichtungen, Untergrenze: in jedem Zeitfenster (`WINDOW_MIN`) werden Sichtungen gleichen Typs, die durch
 *   plausible Bewegung erklärbar sind (zu Fuss `FOOT_KMH`, Fz/Luft `FZ_KMH`, Ortsunschärfe Planquadrat/NAI), zu einem
 *   Objekt zusammengefasst; Sichtungen, die ein benanntes Element erklären kann (Meldung des Elements innert
 *   `ABSORB_MIN`, erreichbar), zählen nur mit dem Überschuss. Grösste Summe eines Fensters = Untergrenze.
 *   Angaben aus fremder Quelle («angeblich», «Zivilperson meldet») zählen nicht zur Untergrenze;
 * - unbenannte Sichtungen, Obergrenze: Summe aller Sichtungen ohne offensichtliche Doppelmeldungen (gleiches Merkmal bzw.
 *   gleicher/benachbarter Ort innert `DUP_MIN`), gedeckelt auf `MAX_FACTOR` × Untergrenze (bzw. grösste Einzelsichtung);
 * - Art «unklar» zählt nicht, wird aber als eigene Zeile «Unklar» (Anzahl Sichtungen) ausgewiesen.
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
  /** unbenannte Sichtung kann ein benanntes Element sein, wenn dieses innert so vieler Min gemeldet wurde */
  ABSORB_MIN: 90,
  /** Doppelmeldung (gleicher/benachbarter Ort, gleiche oder kleinere Anzahl) innert … */
  DUP_MIN: 60,
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

/** Feindannahme, aus Kurzschrift gelesen */
export interface StrengthSpec {
  rows: Array<StrengthRow & { count: number; names?: string[] }>;
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
const FZ_WORDS = ["fz", "fahrzeug", "fahrzeuge", "pw", "personenwagen", "auto", "autos", "wagen"];
/** Kürzel für Typ-Zeilen */
const ABBR: Record<string, string> = {
  kpz: "Kpz", spz: "Spz", spz_rad: "Rad Spz", mtw: "MTW", aufkl_fz: "Aufkl Fz", gw: "Gw", lw: "Lastw", motorrad: "Motorrad", bus: "Bus",
  san_fz: "San Fz", bagger: "Bagger", dozer: "Dozer", brueckenleger: "Brü Pz", pz_hb: "Pz Hb",
  drohne: "Drohnen", heli: "Heli", flugzeug: "Flugzeug",
  mg: "Mg", smg: "sMg", pzaw: "Pzaw", panzerfaust: "Pzf", mw_geraet: "Mw", rak_werfer: "Rak Werfer", stgw: "Stgw", schaf_gewehr: "SSG", flab_kan: "Flab Kan", flab_lwf: "Flab Lwf",
};
const TYPE_NAME: Record<string, string> = { drohne: "Drohnen", heli: "Helikopter", flugzeug: "Flugzeuge" };
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
  add("helikopter", { k: "type", key: "heli" });
  TERMS = m;
  return m;
}

function lookup(s: string): Term | undefined {
  const m = terms();
  const w = normTxt(s);
  if (!w) return undefined;
  for (const c of [w, w.replace(/en$/, ""), w.replace(/n$/, ""), w.replace(/e$/, ""), w.replace(/s$/, "")]) {
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
  const cat = CATALOG.find((e) => e.key === key);
  const abbr = ABBR[key] ?? cat?.name ?? key;
  if (cat?.category === "Fahrzeuge") return { key, name: `davon ${abbr}`, parent: "fz", abbr };
  return { key, name: TYPE_NAME[key] ?? abbr, abbr };
}

function rowOrder(key: string): number {
  if (key.startsWith("elemente:")) return ELEMENT_TYPES.findIndex((x) => x.type === key.slice(9));
  if (key === "pers") return 10;
  if (key === "fz") return 20;
  if (key === "unklar") return 90;
  const cat = CATALOG.find((e) => e.key === key);
  if (cat?.category === "Fahrzeuge") return 21;
  if (cat?.category === "Luftfahrzeuge") return 30;
  if (cat?.category === "Waffen") return 40;
  return 50;
}
const byOrder = (a: { key: string }, b: { key: string }) => rowOrder(a.key) - rowOrder(b.key) || a.key.localeCompare(b.key);
const natural = (a: string, b: string) => a.localeCompare(b, "de", { numeric: true });

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
const QUAL_RE = /^(?:ca|circa|~|≈|mind|mindestens|min|max|maximal|höchstens|hoechstens|etwa|rund|bis zu|total|gesamt)\s*/;

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

/** Feindannahme in Kurzschrift lesen, z. B. «2 Det, 14 Pers, 5 Fz (2 Kpz), 1 Drohne», «2 Det à 7 Pers», «Det 1, Det 2» */
export function parseStrength(text: string): StrengthSpec {
  const counts = new Map<string, number>();
  const names = new Map<string, Set<string>>();
  let derivedPers = 0;
  const unknown: string[] = [];
  const add = (key: string, n: number) => counts.set(key, (counts.get(key) ?? 0) + n);
  const keyOf = (t: Term) => (t.k === "el" ? `elemente:${t.type}` : t.k === "type" ? t.key : t.k);

  const parsePart = (raw: string) => {
    let p = normTxt(raw).replace(/[–—]/g, "-").replace(/^[-•*]\s*/, "");
    // Klammer = davon bzw. Zusatz, z. B. «5 Fz (2 Kpz)», «2 Det (14 Pers)»
    const inner: string[] = [];
    p = p.replace(/\(([^)]*)\)/g, (_, x: string) => { inner.push(x); return " "; }).replace(/\s+/g, " ").trim();
    for (const x of inner) for (const q of splitParts(x)) parsePart(q);
    if (!p) return;
    p = p.replace(QUAL_RE, "");
    // «à 6 Pers», «je 6», «zu je 6 Pers»
    let per: number | undefined, perTerm: Term | undefined;
    p = p.replace(new RegExp(String.raw`\s+(?:à|a|je|zu je|zu)\s+${NUM}(?:\s+(.+))?$`), (_, n: string, w?: string) => {
      per = toNum(n);
      perTerm = w ? lookup(w) : { k: "pers" };
      return "";
    }).trim();
    let m = new RegExp(String.raw`^${NUM}(?:\s*-\s*${NUM})?\s*(?:x|×)?\s*(.+)$`).exec(p);
    if (m) {
      const n = Math.max(toNum(m[1]!), m[2] ? toNum(m[2]) : 0);
      const t = lookup(m[3]!);
      if (t && Number.isFinite(n)) {
        add(keyOf(t), n);
        if (per !== undefined && perTerm && Number.isFinite(per)) {
          if (perTerm.k === "pers") derivedPers += n * per;
          else add(keyOf(perTerm), n * per);
        }
        return;
      }
    }
    // benanntes Element: «Det 1», «Zug Nord»
    m = /^(\S+)\s+(\d+[a-z]?|[a-zäöü]+)$/.exec(p);
    if (m) {
      const t = lookup(m[1]!);
      if (t?.k === "el") {
        const et = ELEMENT_TYPES.find((x) => x.type === t.type)!;
        const key = keyOf(t);
        const nm = `${et.abbr} ${/^\d/.test(m[2]!) ? m[2]!.toUpperCase() : m[2]![0]!.toUpperCase() + m[2]!.slice(1)}`;
        const s = names.get(key) ?? new Set<string>();
        s.add(nm);
        names.set(key, s);
        if (per !== undefined && Number.isFinite(per) && perTerm?.k === "pers") derivedPers += per;
        return;
      }
    }
    // Begriff allein: «Drohne», «Kpz» = 1
    const t = lookup(p);
    if (t) { add(keyOf(t), 1); return; }
    unknown.push(raw.trim());
  };
  for (const part of splitParts(text ?? "")) parsePart(part);

  for (const [key, s] of names) counts.set(key, Math.max(counts.get(key) ?? 0, s.size));
  if (!counts.has("pers") && derivedPers > 0) counts.set("pers", derivedPers);
  // nur Typen genannt («2 Kpz, 3 Lastw»): Fahrzeuge = Summe
  if (!counts.has("fz")) {
    const kids = [...counts.entries()].filter(([k]) => strengthRow(k).parent === "fz");
    if (kids.length) counts.set("fz", kids.reduce((s, [, n]) => s + n, 0));
  }
  const rows = [...counts.entries()].map(([key, count]) => {
    const r: StrengthSpec["rows"][number] = { ...strengthRow(key), count };
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
  lo: (v: PEv) => number;
  hi: (v: PEv) => number;
  kmh: (a: PEv, b: PEv) => number;
  /** gleichen Typs (dürfen dasselbe Objekt sein) */
  compat: (a: PEv, b: PEv) => boolean;
}

const typeQty = (key: string) => (v: PEv) => v.types.find(([k]) => k === key)?.[1] ?? 0;
const fzCompat = (a: PEv, b: PEv) => a.e.sym === b.e.sym || GENERIC_FZ.has(a.e.sym) || GENERIC_FZ.has(b.e.sym);

/** Untergrenze der unbenannten Sichtungen (siehe Kopf der Datei) */
function windowMin(sights: PEv[], named: Array<{ lo: number; reps: PEv[] }>, q: Qty): number {
  const list = sights.filter((v) => !v.hearsay && q.lo(v) > 0).sort((a, b) => a.ms - b.ms);
  if (!list.length) return 0;
  // je Sichtung: benannte Elemente, die sie erklären können (unabhängig vom Fenster)
  const cand = new Map<PEv, number[]>();
  for (const x of list) {
    const js: number[] = [];
    named.forEach((u, j) => {
      if (u.reps.some((r) => Math.abs(r.ms - x.ms) <= S.ABSORB_MIN * MIN_MS && q.compat(r, x) && reachable(r, x, q.kmh(r, x)))) js.push(j);
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

/** Obergrenze: Summe ohne offensichtliche Doppelmeldungen */
function dedupSum(sights: PEv[], q: Qty): number {
  const kept: PEv[] = [];
  const sigs = new Map<string, number>();
  let sum = 0;
  for (const x of [...sights].sort((a, b) => a.ms - b.ms)) {
    const hi = q.hi(x);
    if (hi <= 0) continue;
    if (x.sig && (sigs.get(x.sig) ?? -1) >= hi) continue;
    let dup = false;
    for (let j = kept.length - 1; j >= 0; j--) {
      const d = kept[j]!;
      if (x.ms - d.ms > S.DUP_MIN * MIN_MS) break;
      if (!q.compat(d, x) || hi > q.hi(d)) continue;
      if (sameOrNeighbor(d, x) || d.nais.some((n) => x.nais.includes(n))) { dup = true; break; }
    }
    if (x.sig) sigs.set(x.sig, Math.max(sigs.get(x.sig) ?? 0, hi));
    if (dup) continue;
    kept.push(x);
    sum += hi;
  }
  return sum;
}

function estimateRow(key: string, feind: PEv[], q: Qty, unitName: Map<string, string>): StrengthEstimate | null {
  const rel = feind.filter((v) => q.hi(v) > 0);
  if (!rel.length) return null;
  const byUnit = new Map<string, PEv[]>();
  const unnamed: PEv[] = [];
  for (const v of rel) {
    if (v.unitKey) { const l = byUnit.get(v.unitKey); if (l) l.push(v); else byUnit.set(v.unitKey, [v]); }
    else unnamed.push(v);
  }
  const named = [...byUnit.values()].map((reps) => ({ lo: Math.max(...reps.map(q.lo)), hi: Math.max(...reps.map(q.hi)), reps }));
  const nLo = named.reduce((s, u) => s + u.lo, 0), nHi = named.reduce((s, u) => s + u.hi, 0);
  const min = nLo + windowMin(unnamed, named, q);
  const raw = nHi + dedupSum(unnamed, q);
  // Deckel: höchstens `MAX_FACTOR` × (Untergrenze bzw. grösste einzelne Sichtung)
  const base = Math.max(min, ...rel.map(q.hi));
  const max = Math.max(min, Math.min(raw, Math.ceil(S.MAX_FACTOR * base)));
  const est: StrengthEstimate = { ...strengthRow(key), min, max, events: rel.map((v) => v.id) };
  if (byUnit.size && key !== "pers" && key !== "fz") est.names = [...byUnit.keys()].map((k) => unitName.get(k) ?? k).sort(natural);
  return est;
}

/** Erkannte Kräfte Rot bis zur Lagezeit `t` */
export function estimateRedForce(ex: Exercise, t: string): RedForce {
  const tMs = lageMs(ex, t);
  const evs = prepareRed(ex, tMs);
  const feind = evs.filter((v) => v.feind);
  const unitName = new Map<string, string>();
  const lastOf = new Map<string, PEv>();
  for (const v of evs) {
    if (v.side !== "rot" || !v.unitKey) continue;
    unitName.set(v.unitKey, v.e.unit);
    lastOf.set(v.unitKey, v);
  }
  const rows: StrengthEstimate[] = [];
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
  const pers = estimateRow("pers", feind, { lo: (v) => v.persLo, hi: (v) => v.persHi, kmh: () => S.FOOT_KMH, compat: () => true }, unitName);
  if (pers) rows.push(pers);
  const fz = estimateRow("fz", feind, { lo: (v) => v.fz, hi: (v) => v.fz, kmh: () => S.FZ_KMH, compat: fzCompat }, unitName);
  if (fz) rows.push(fz);
  const typeKeys = new Set<string>();
  for (const v of feind) for (const [k] of v.types) typeKeys.add(k);
  for (const key of typeKeys) {
    const f = typeQty(key);
    const r = estimateRow(key, feind, { lo: f, hi: f, kmh: () => S.FZ_KMH, compat: () => true }, unitName);
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
  rows.sort(byOrder);

  const notSeen: RedForce["notSeen"] = [];
  for (const [k, v] of lastOf) {
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
