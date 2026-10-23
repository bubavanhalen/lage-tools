/**
 * Mögliche Aktionen Rot (Feindmöglichkeiten): aus Hinweisen und Meldungen abgeleitet, offline.
 * Katalog typischer Möglichkeiten mit Indikatoren; je mehr Indikatoren zutreffen, desto wahrscheinlicher.
 * Es bleiben Hinweise, keine Fakten – jede Möglichkeit nennt ihre Indikatoren (erfüllt/offen/dagegen) und die Auslöser.
 *
 * Bewertung:
 * - jeder Indikator hat ein Gewicht (`COA_WEIGHTS`, 0–1 = Aussagekraft allein). `score` = (1 − Π(1 − Gewicht)) über die
 *   zählenden Indikatoren × Π(1 − Gewicht) über die Gegenindikatoren (`against`, Anzeige ✗);
 * - keine Doppelzählung: ein Rot-Indikator zählt nur, wenn er eine Rot-Meldung beiträgt, die nicht schon andere
 *   Indikatoren derselben Möglichkeit erfüllt (spezifischere zuerst, dann stärkere). Sonst gilt er als «schon gezählt»
 *   (z. B. D1 und «Drohne 1×» = eine Drohne);
 * - Alterung: Indikatoren aus einzelnen Meldungen verlieren mit der Halbwertszeit `HALF_LIFE_MIN` an Gewicht; Zustände
 *   (Stao aufgeklärt, Hindernis, Pendel, Lücke, Ruhe, Rot-Stellung) altern nicht, solange der Hinweis gilt. Bezugszeit ist
 *   die letzte Meldung im Journal bis zur Lagezeit – ohne neue Meldungen bleibt die Bewertung beim Abspielen stehen;
 * - Entscheide des Zfhr: verworfene Hinweise zählen nicht, bestätigte mit Gewicht × `CONFIRMED_FACTOR` (gedeckelt);
 * - eine Möglichkeit erscheint nur, wenn mindestens `MIN_MET` Rot-Indikatoren aus verschiedenen Meldungen zählen
 *   (Lage-Indikatoren wie «nicht verschoben» zählen nicht dazu) und einer davon ein Schlüssel-Indikator ihrer Art ist;
 * - Auswahl: wahrscheinlichste = höchster `score`, mit Hysterese: die bisherige wahrscheinlichste (Rangfolge vor der
 *   letzten Meldung) bleibt, solange die neue höchstens `HYSTERESIS` besser ist; gefährlichste = unter den übrigen
 *   (`score` ≥ `DANGER_MIN_SCORE`) die höchste Gefährlichkeit (`COA_DANGER`), nur wenn gefährlicher als die
 *   wahrscheinlichste; weitere = nächsthöchster `score`, möglichst andere Art.
 * Zeitraum (Überfall): ab der nächstgelegenen Annäherung (ohne Vorbereitungszeit) bzw. ab dem letzten starken Indikator
 * (mit Vorbereitung); er wird nie an die Lagezeit nachgezogen – vorbei ⇒ `windowState: "ueberfaellig"`.
 * IDs stabil: Art + Ziel (eigenes Element, NAI, erste Meldung der Sperren, Pendel-Hinweis).
 */
import { areaCenter } from "./journal";
import { angleDiff, bearing, centroid, distToRing } from "./hintgeo";
import { decisionFor, type Hint } from "./hints";
import type { LV95 } from "./lv95";
import type { Area, Exercise, HintDecision } from "./model";
import { MIN_MS, durShort, hmOf, isoOfMs, lageMs, nk, placeLabel, prepareRed, type PEv } from "./redprep";

/** Distanz in m (LV95) – schnell (ohne Math.hypot), wird sehr oft gerechnet */
const dist = (a: LV95, b: LV95): number => { const x = b.e - a.e, y = b.n - a.n; return Math.sqrt(x * x + y * y); };

export type CoaKind = "ueberfall" | "hinterhalt" | "sperren" | "versorgung" | "aufklaerung" | "infiltration" | "absetzen";

export interface CoaIndicator {
  /** z. B. «Drohne über H05 02:50 (D1)» */
  text: string;
  met: boolean;
  /** Gegenindikator: spricht gegen die Möglichkeit (Anzeige ✗), zählt negativ */
  against?: boolean;
  /** Hinweis, der den Indikator erfüllt */
  hintId?: string;
  /** Meldungen, die den Indikator erfüllen */
  events?: string[];
  /** Hinweis-Regel bzw. Kurzname des Indikators, z. B. «D1», «still» */
  rule?: string;
  /** wirksames Gewicht (Aussagekraft nach Alterung und Entscheid), 0–1 */
  weight?: number;
}

export interface RedCoa {
  /** stabil: Art + Ziel (Element/PQ/NAI) */
  id: string;
  kind: CoaKind;
  /** Einordnung: wahrscheinlichste, gefährlichste, weitere */
  label: "wahrscheinlichste" | "gefaehrlichste" | "weitere";
  /** z. B. «Überfall auf Stao H05 (AQ11)» */
  title: string;
  /** Ziel der Aktion */
  target?: { pos: LV95; unit?: string; cell?: string; nai?: string };
  /** erwartete Annäherung (Achse) in LV95, Ausgangspunkt zuerst */
  approach?: LV95[];
  /** Beschreibung der Annäherung, z. B. «aus AP10 über Seftigenstrasse» */
  approachText?: string;
  /** erwarteter Zeitraum (ISO) – wird nie an die Lagezeit nachgezogen */
  window?: { from: string; to: string };
  /**
   * Zustand des Zeitraums zur Lagezeit: «jetzt» (Rot ≤ 1 km in Richtung Ziel gemeldet), «erwartet» (ca. von–bis),
   * «ueberfaellig» (Zeitraum vorbei, nichts gemeldet), «offen» (kein Zeitraum bestimmbar)
   */
  windowState?: "jetzt" | "erwartet" | "ueberfaellig" | "offen";
  indicators: CoaIndicator[];
  /** 0–1: Gewicht der zählenden Indikatoren (siehe Kopf der Datei) */
  score: number;
  /** Gefährlichkeit 0–1 (für «gefährlichste») */
  danger: number;
  /** Was prüfen / tun (kurz, in eigenen Worten) */
  check: string[];
  /** alle auslösenden Meldungen */
  events: string[];
}

export interface CoaOptions {
  /** Lagezeit (ISO) */
  t: string;
  /** Hinweise zur Lagezeit (aus analyzeJournal) */
  hints: Hint[];
  /** Entscheide des Zfhr zu Hinweisen (Standard: `ex.hintDecisions`): verworfene zählen nicht, bestätigte stärker */
  decisions?: Record<string, HintDecision>;
}

/** Ergebnis von `analyzeRedCoas`: Auswahl (höchstens drei) und alle Möglichkeiten (gleiche Reihenfolge, übrige als «weitere») */
export interface CoaAnalysis {
  picked: RedCoa[];
  all: RedCoa[];
}

/** Gewichte der Indikatoren je Art (Aussagekraft allein, 0–1); Gegenindikatoren mit Kommentar «✗» */
export const COA_WEIGHTS = {
  ueberfall: { aufgeklaert: 0.35, nahe_rot_stao: 0.3, schwergewicht: 0.35, formation: 0.3, still: 0.1, annaeherung: 0.4, /** ✗ */ weg: 0.4 },
  hinterhalt: { hindernis_engnis: 0.45, hindernis: 0.3, aufklaerung: 0.3, rot_stellung: 0.25, luecke: 0.25, /** ✗ */ eigene_praesenz: 0.3 },
  sperren: { mehrere: 0.3, ied: 0.15, eigene_nahe: 0.15, rot_sichert: 0.15, feuer: 0.2 },
  versorgung: { pendel: 0.4, uebergabe: 0.3, rot_stao: 0.2, halt: 0.15 },
  aufklaerung: { c3: 0.35, d1: 0.35, drohne: 0.2, beobachter: 0.25 },
  infiltration: { luecke: 0.4, ruhe: 0.25, rot_nahe: 0.3, ausweichen: 0.2 },
  absetzen: { abnahme: 0.35, weg: 0.35, kolonne: 0.2, kolonne_weg: 0.4, ruhe: 0.2, /** ✗ */ naehert: 0.3 },
} as const;

/** Gefährlichkeit je Art (0–1): Überraschung und mögliche Verluste für die eigenen Elemente */
export const COA_DANGER: Record<CoaKind, number> = {
  hinterhalt: 1, ueberfall: 0.9, infiltration: 0.7, sperren: 0.5, aufklaerung: 0.4, versorgung: 0.3, absetzen: 0.2,
};

/** Schwellen (Zeiten in Minuten, Abstände in m, Tempo in km/h, Winkel in Grad) */
export const COA_THRESHOLDS = {
  /** mindestens so viele Rot-Indikatoren aus verschiedenen Meldungen */
  MIN_MET: 2,
  DANGER_MIN_SCORE: 0.3,
  /** Wechsel der wahrscheinlichsten erst bei so viel höherem `score` */
  HYSTERESIS: 0.05,
  /** Halbwertszeit der Indikatoren aus einzelnen Meldungen */
  HALF_LIFE_MIN: 90,
  /** bestätigter Hinweis: Gewicht × Faktor, höchstens … */
  CONFIRMED_FACTOR: 1.25,
  CONFIRMED_MAX: 0.6,
  /** Hinweise zählen bis so lange nach ihrem Ende */
  RECENT_MIN: 60,
  /** Übergabe/Umladen (C1) zählt für Versorgung so lange */
  HANDOVER_MIN: 240,
  /** Aufklärung (C3) zählt für Hinterhalt/Aufklärung so lange nach ihrem Ende */
  RECON_MIN: 120,
  /** Überfall: Schwergewicht höchstens so weit vom Stao; Formation Linie/Y (mit Richtung zum Ziel bzw. nahe); Annäherung */
  SCHWERGEWICHT_M: 1500,
  FORMATION_M: 3500,
  FORMATION_NEAR_M: 1000,
  APPROACH_M: 3000,
  APPROACH_MIN: 60,
  APPROACH_DEG: 45,
  /** «jetzt»: annäherndes Rot höchstens so weit vom Ziel */
  JETZT_M: 1000,
  /** Rot entfernt sich: Abweichung der Richtung vom Weg-Vektor höchstens …; Bezug eigene Elemente bis …, NAI bis … */
  AWAY_DEG: 60,
  AWAY_M: 3000,
  AWAY_NAI_M: 1000,
  /** Rot entfernt sich (Verlauf eines Elements): Abstand zum nächsten eigenen Element wächst um mindestens … innert … */
  WITHDRAW_M: 500,
  WITHDRAW_MIN: 90,
  /** eigenes Element gilt als «nicht verschoben» nach … am gleichen Ort (± `MOVED_M`) */
  STILL_MIN: 120,
  MOVED_M: 200,
  /** Hinterhalt: Rot in Stellung/Halt höchstens so weit vom Engnis, innert …; eigene Präsenz im Engnis */
  STELLUNG_M: 1000,
  STELLUNG_MIN: 180,
  RECON_NEAR_M: 1000,
  PRESENCE_M: 200,
  /** Sperren: Hindernisse innert … zusammenfassen (Kette), so lange zurück */
  SPERREN_M: 1500,
  SPERREN_MIN: 180,
  EIGENE_NAHE_M: 1000,
  ROT_SICHERT_M: 1000,
  FEUER_M: 2000,
  /** Versorgung: Rot-Stao bzw. Halt so nahe an einem Pendel-Ende */
  PENDEL_END_M: 1500,
  /** Absetzen: Abnahme der Rot-Meldungen (Stunde davor mindestens …, jetzt höchstens ⅔ davon) */
  DROP_MIN_EVENTS: 4,
  DROP_RATIO: 2 / 3,
  /** Zeitraum: Vorbereitung nach dem letzten starken Indikator (von–bis), Tempo zu Fuss bzw. mit Fz (langsam–schnell) */
  PREP_MIN: 10,
  PREP_MAX: 50,
  STRONG_WEIGHT: 0.3,
  FOOT_KMH: [3, 5],
  FZ_KMH: [20, 40],
} as const;
const T = COA_THRESHOLDS;
const W = COA_WEIGHTS;

const OBSTACLE_IED = new Set(["ied", "vbied", "mine", "pz_mine", "pers_mine", "minensperre", "sprengfalle", "minenlegen", "sprengobjekt"]);
const FIRE_SYMS = new Set(["kpz", "spz", "spz_rad", "pz", "pz_gren", "mg", "smg", "pzaw", "pzj", "mw", "mw_geraet", "art", "pz_hb"]);
const STAO_SYMS = new Set(["stellung", "kdo_po", "hq", "lager", "mun_lager", "treibstoff", "log_pt", "sammelraum"]);
const STAO_RE = /(?<!\p{L})(?:stellung|stao|bezieht|beziehen|eingerichtet|verschanzt|lager|biwak)(?!\p{L})/iu;
const SPOT_RE = /(handy|telefon|fotograf|filmt|filmen|feldstecher|fernglas|beobacht|späht|spähen|kundschaft|ausspäh)/iu;
const BLOCK_RE = /(blockiert|hindernis|baumstämme|barrikade|sperre)/iu;
const PRESENCE_RE = /(?<!\p{L})(?:pat|patr|patrouille|patrouilliert|präsenz|kontrolle|kontrolliert|durchsuchung|durchsucht)(?!\p{L})/iu;
const EXCURSION_SYMS = new Set(["patrouille", "durchsuchung", "kontrollposten", "verkehrsposten"]);
const DUP_SUFFIX = " – schon gezählt";

interface Ind extends CoaIndicator {
  /** Grundgewicht */
  weight: number;
  key?: boolean;
  /** Zustand (altert nicht) */
  persistent?: boolean;
  /** Hinweis vom Zfhr bestätigt */
  confirmed?: boolean;
  /** Zeitpunkt des Auslösers (Alterung, Zeitraum) */
  ms?: number;
}
interface Cand {
  kind: CoaKind;
  key: string;
  title: string;
  target?: RedCoa["target"];
  approach?: LV95[];
  approachText?: string;
  window?: RedCoa["window"];
  windowState?: RedCoa["windowState"];
  ind: Ind[];
  check: string[];
}
/** bewertete Möglichkeit (intern) */
interface Scored {
  coa: Omit<RedCoa, "label">;
  /** Bewertung vor der letzten Meldung (für die Hysterese) */
  prevScore: number;
  prevQualifies: boolean;
}

interface Own { name: string; pos: LV95; cell: string; since?: number; last: PEv }

interface Ctx {
  ex: Exercise;
  tMs: number;
  /** Bezugszeit: letzte Meldung bis zur Lagezeit (Alterung, «zuletzt») */
  refMs: number;
  evs: PEv[];
  byId: Map<string, PEv>;
  hints: Hint[];
  /** vom Zfhr bestätigte Hinweise (IDs) */
  confirmed: Set<string>;
  own: Own[];
  nais: Area[];
  cell: (p: LV95 | undefined, fb?: string) => string;
  /** Zwischenspeicher: Meldungen seit … Min vor der letzten Meldung; Meldungen je Rot-Element */
  memo: Map<string, PEv[]>;
  byUnit: Map<string, PEv[]>;
}

const HMS = new WeakMap<Hint, number>();
/** Beginn eines Hinweises in ms (zwischengespeichert) */
const hms = (h: Hint) => { let v = HMS.get(h); if (v === undefined) { v = Date.parse(h.t); HMS.set(h, v); } return v; };
/** Hinweis gilt (offen oder höchstens `recentMin` vor der letzten Meldung vorbei) */
const active = (c: Ctx, h: Hint, recentMin: number = T.RECENT_MIN) =>
  hms(h) <= c.tMs && (!h.until || Date.parse(h.until) > c.refMs - recentMin * MIN_MS);
const evsOf = (c: Ctx, h: Hint) => h.events.map((id) => c.byId.get(id)).filter((v): v is PEv => !!v);
const uniq = <X>(xs: X[]) => [...new Set(xs)];
const floor5 = (ms: number) => Math.floor(ms / (5 * MIN_MS)) * 5 * MIN_MS;
const ceil5 = (ms: number) => Math.ceil(ms / (5 * MIN_MS)) * 5 * MIN_MS;
const since = (c: Ctx, min: number) => c.refMs - min * MIN_MS;
/** Meldungen ab `ms` (Meldungen sind nach Zeit sortiert: binäre Suche) */
const fromMs = (c: Ctx, ms: number, k: string): PEv[] => {
  const hit = c.memo.get(k);
  if (hit) return hit;
  let lo = 0, hi = c.evs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (c.evs[m]!.ms < ms) lo = m + 1; else hi = m; }
  const r = c.evs.slice(lo);
  c.memo.set(k, r);
  return r;
};
/** Meldungen seit `min` Min vor der letzten Meldung */
const recent = (c: Ctx, min: number) => fromMs(c, since(c, min), `r${min}`);
/** höchstens so viele Auslöser je Indikator (die neuesten) – mehr hilft weder der Anzeige noch der Bewertung */
const MAX_EVENTS = 20;
const ind = (text: string, met: boolean, weight: number, x: Partial<Ind> = {}): Ind => {
  const i: Ind = { text, met, weight };
  for (const k of Object.keys(x) as Array<keyof Ind>) if (x[k] !== undefined) (i as unknown as Record<string, unknown>)[k] = x[k];
  if (i.events && i.events.length > MAX_EVENTS) i.events = i.events.slice(-MAX_EVENTS);
  return i;
};
const fromHint = (h: Hint, c: Ctx) => ({
  hintId: h.id, events: [...h.events], rule: h.rule, ms: Math.max(...evsOf(c, h).map((v) => v.ms), hms(h)),
  confirmed: c.confirmed.has(h.id) || undefined,
});
const lastOf = <X>(xs: X[]) => xs[xs.length - 1];
/** v bewegt sich auf P zu (Richtung höchstens `deg` neben der Peilung zu P) */
const towards = (v: PEv, P: LV95, deg: number = T.APPROACH_DEG) => !!v.pos && v.e.dir !== undefined && angleDiff(v.e.dir, bearing(v.pos, P)) <= deg;
/** v entfernt sich von P */
const awayFrom = (v: PEv, P: LV95) => !!v.pos && v.e.dir !== undefined && angleDiff(v.e.dir, bearing(P, v.pos)) <= T.AWAY_DEG;
const NATURAL = new Intl.Collator("de", { numeric: true });
const SECTORS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
const sector = (deg: number) => SECTORS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;

/** Rasterindex (Zellen à `size` m) für die Suche «Meldungen höchstens r ≤ size von p» */
function gridOf(vs: PEv[], size: number): (p: LV95, r: number) => PEv[] {
  const g = new Map<string, PEv[]>();
  const k = (e: number, n: number) => `${e},${n}`;
  for (const v of vs) {
    const kk = k(Math.floor(v.pos!.e / size), Math.floor(v.pos!.n / size));
    const l = g.get(kk);
    if (l) l.push(v); else g.set(kk, [v]);
  }
  return (p, r) => {
    const ce = Math.floor(p.e / size), cn = Math.floor(p.n / size);
    const out: PEv[] = [];
    for (let de = -1; de <= 1; de++) for (let dn = -1; dn <= 1; dn++) for (const v of g.get(k(ce + de, cn + dn)) ?? []) if (dist(v.pos!, p) <= r) out.push(v);
    return out;
  };
}

/** Stärke der Auslöser kurz, z. B. «6 Pers + 2 Fz» */
function forceText(vs: PEv[]): string {
  const best = new Map<string, { p: number; f: number }>();
  for (const v of vs) {
    const k = v.melder || v.id;
    const b = best.get(k) ?? { p: 0, f: 0 };
    b.p = Math.max(b.p, v.persLo);
    b.f = Math.max(b.f, v.fz);
    best.set(k, b);
  }
  const p = [...best.values()].reduce((s, b) => s + b.p, 0), f = [...best.values()].reduce((s, b) => s + b.f, 0);
  return [p ? `${p} Pers` : "", f ? `${f} Fz` : ""].filter(Boolean).join(" + ") || "Rot";
}
const sameUnit = (vs: PEv[]) => vs.length > 0 && !!vs[0]!.unitKey && vs.every((v) => v.unitKey === vs[0]!.unitKey);
const whoText = (v: PEv) => (v.e.unit ? `${v.e.unit}${forceText([v]) !== "Rot" ? ` ${forceText([v])}` : ""}` : forceText([v]));

/** Was hat den Stao aufgeklärt (aus den Auslösern von D1) */
function spotterText(vs: PEv[]): string {
  const r = vs.find((v) => v.side === "rot");
  if (!r) return "Aufklärung";
  if (r.isDrone) return "Drohne";
  if (r.isFz) return "Fz-Halt";
  return "Beobachter";
}

// ---------------------------------------------------------------------------------------------
// Eigene Elemente: Stao und «nicht verschoben seit»
// ---------------------------------------------------------------------------------------------
function ownUnits(c: Ctx): Own[] {
  const reps = new Map<string, PEv[]>();
  for (const v of c.evs) {
    if (v.side !== "blau" || !v.e.unit || !v.pos || !v.precise) continue;
    const cat = v.cat;
    const activityOnly = cat?.activity && (cat.lean !== "eigen" || (cat.geometry && cat.geometry !== "punkt"));
    if (activityOnly && !EXCURSION_SYMS.has(v.e.sym)) continue;
    const k = nk(v.e.unit);
    const l = reps.get(k);
    if (l) l.push(v); else reps.set(k, [v]);
  }
  const out: Own[] = [];
  const isExc = (v: PEv) => EXCURSION_SYMS.has(v.e.sym) || PRESENCE_RE.test(v.e.text);
  for (const [, list] of reps) {
    let i = list.length - 1;
    while (i >= 0 && isExc(list[i]!)) i--;
    if (i < 0) continue;
    const last = list[i]!;
    let since: number | undefined = last.ms;
    if (i < list.length - 1) since = undefined; // gerade unterwegs (Patrouille)
    else {
      for (let j = i - 1; j >= 0; j--) {
        const v = list[j]!;
        if (isExc(v) || dist(v.pos!, last.pos!) > T.MOVED_M) break;
        since = v.ms;
      }
    }
    out.push({ name: last.e.unit, pos: last.pos!, cell: c.cell(last.pos), since, last });
  }
  return out;
}

/** Rot am Boden (Art feind, Ort genau, keine Drohne/Luftfahrzeug) – Annäherung, Ausgangsraum, Absetzen */
const ground = (v: PEv) => v.feind && !!v.pos && v.precise && !v.isDrone && v.cat?.category !== "Luftfahrzeuge";
/** Rot am Boden mit Richtung, seit `min` vor der letzten Meldung */
const movingRed = (c: Ctx, min: number) => {
  const k = `m${min}`;
  let r = c.memo.get(k);
  if (!r) { r = recent(c, min).filter((v) => ground(v) && v.e.dir !== undefined); c.memo.set(k, r); }
  return r;
};

/**
 * Rot entfernt sich gegenüber allen eigenen Elementen und NAI: vom nächsten eigenen Element (≤ `AWAY_M`) weg, auf kein
 * eigenes Element (≤ `AWAY_M`) bzw. kein NAI (≤ `AWAY_NAI_M`) zu; oder ein Rot-Element hat den Abstand zum nächsten eigenen
 * Element innert `WITHDRAW_MIN` um mindestens `WITHDRAW_M` vergrössert (und hält auf kein eigenes Element zu).
 */
function withdrawing(c: Ctx, min: number): PEv[] {
  if (!c.own.length) return [];
  const nearestOwn = (p: LV95) => Math.min(...c.own.map((o) => dist(o.pos, p)));
  const headOn = (v: PEv) => c.own.some((o) => dist(o.pos, v.pos!) <= T.AWAY_M && towards(v, o.pos)) ||
    c.nais.some((a) => distToRing(v.pos!, a.ring) <= T.AWAY_NAI_M && towards(v, areaCenter(a)));
  const out: PEv[] = [];
  for (const v of recent(c, min)) {
    if (!ground(v)) continue;
    if (v.e.dir !== undefined && headOn(v)) continue;
    if (v.e.dir !== undefined) {
      const o = c.own.reduce((m, x) => (dist(x.pos, v.pos!) < dist(m.pos, v.pos!) ? x : m));
      if (dist(o.pos, v.pos!) <= T.AWAY_M && awayFrom(v, o.pos)) { out.push(v); continue; }
    }
    if (!v.unitKey) continue;
    const prev = (c.byUnit.get(v.unitKey) ?? []).find((x) => x.pos && x.precise && x.ms < v.ms && x.ms >= v.ms - T.WITHDRAW_MIN * MIN_MS);
    if (prev && nearestOwn(v.pos!) - nearestOwn(prev.pos!) >= T.WITHDRAW_M && nearestOwn(prev.pos!) <= T.AWAY_M) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Katalog der Möglichkeiten
// ---------------------------------------------------------------------------------------------
function ueberfall(c: Ctx): Cand[] {
  const out: Cand[] = [];
  const w = W.ueberfall;
  for (const o of c.own) {
    const P = o.pos;
    // Stellungswechsel nach der Aufklärung: Hinweis zum alten Stao zählt nicht mehr
    const atStao = (h: Hint) => !h.pos || dist(h.pos, P) <= T.MOVED_M;
    const changed = c.hints.some((h) => (h.rule === "D1" || h.rule === "D2") && h.unit === o.name && hms(h) <= c.tMs && !atStao(h));
    const ind1 = (() => {
      const d1 = c.hints.find((h) => h.rule === "D1" && h.unit === o.name && active(c, h) && atStao(h));
      if (d1) {
        const r = evsOf(c, d1).filter((v) => v.side === "rot");
        return ind(`${spotterText(r)} über ${o.name} ${hmOf(r[0]?.ms ?? hms(d1))} (D1)`, true, w.aufgeklaert, { ...fromHint(d1, c), key: true, persistent: true });
      }
      const d2 = c.hints.find((h) => h.rule === "D2" && h.unit === o.name && active(c, h) && atStao(h));
      if (d2) {
        const r = evsOf(c, d2).find((v) => v.side === "rot" && v.e.unit);
        return ind(`Rot-Stao ${r ? `${r.e.unit} ` : ""}neben ${o.name} (D2)`, true, w.nahe_rot_stao, { ...fromHint(d2, c), key: true, persistent: true });
      }
      return ind(`Stao ${o.name} aufgeklärt – nicht gemeldet`, false, w.aufgeklaert, { key: true, rule: "D1" });
    })();
    // Schwergewicht nahe, das sich nicht entfernt
    const c4 = c.hints.filter((h) => h.rule === "C4" && active(c, h) && h.pos && dist(h.pos, P) <= T.SCHWERGEWICHT_M && !evsOf(c, h).every((v) => awayFrom(v, P)))
      .sort((a, b) => dist(a.pos!, P) - dist(b.pos!, P))[0];
    const c4evs = c4 ? evsOf(c, c4).filter((v) => v.side === "rot" && !awayFrom(v, P)) : [];
    const ind2 = c4
      ? ind(`Schwergewicht ${forceText(c4evs)} ${c4.cells?.[0] ?? c.cell(c4.pos)} ${hmOf(hms(c4))} (C4)`, true, w.schwergewicht, { ...fromHint(c4, c), key: true })
      : ind(`Schwergewicht Rot nahe ${o.name} – nicht gemeldet`, false, w.schwergewicht, { key: true, rule: "C4" });
    // Formation Linie/Y nur mit Richtung zum Ziel oder nahe am Ziel
    const c6 = c.hints.filter((h) => h.rule === "C6" && active(c, h) && /Formation (Linie|Y)\b/.test(h.title) && evsOf(c, h).some((v) => v.pos &&
      (dist(v.pos, P) <= T.FORMATION_NEAR_M || (dist(v.pos, P) <= T.FORMATION_M && towards(v, P)))))
      .sort((a, b) => hms(b) - hms(a))[0];
    const ind3 = c6
      ? ind(`Formation ${/Formation (\S+)/.exec(c6.title)![1]} ${c6.cells?.[0] ?? c.cell(evsOf(c, c6)[0]?.pos ?? c6.pos)} ${hmOf(hms(c6))} (C6)`, true, w.formation, fromHint(c6, c))
      : ind("Formation Linie/Y (Kontakt erwartet) – nicht gemeldet", false, w.formation, { rule: "C6" });
    const stillMin = o.since !== undefined ? (c.tMs - o.since) / MIN_MS : 0;
    const ind4 = o.since !== undefined && stillMin >= T.STILL_MIN
      ? ind(`${o.name} nicht verschoben seit ${hmOf(o.since)}`, true, w.still, { events: [o.last.id], rule: "still", persistent: true })
      : ind(`${o.name} ${o.since !== undefined ? `erst seit ${hmOf(o.since)} am Ort` : "unterwegs"}`, false, w.still, { rule: "still" });
    // Annäherung: Rot bewegt sich auf den Stao zu
    const appr = movingRed(c, T.APPROACH_MIN).filter((v) => dist(v.pos!, P) <= T.APPROACH_M && dist(v.pos!, P) > 250 && towards(v, P));
    // Gegenindikator: Rot entfernt sich vom Stao
    const away = movingRed(c, 60).filter((v) => dist(v.pos!, P) <= T.APPROACH_M && awayFrom(v, P));
    // Ausgangsraum: Schwergewicht, sonst letzte Rot-Häufung in der Nähe, die sich nähert oder steht
    const nearRed = recent(c, 120).filter((v) => ground(v) && v.pos && v.ms >= since(c, 120) && dist(v.pos, P) <= T.APPROACH_M && dist(v.pos, P) > 250 &&
      (v.e.dir === undefined || angleDiff(v.e.dir, bearing(v.pos, P)) < 90));
    const startEvs = c4evs.length ? c4evs : nearRed.length ? [lastOf(nearRed)!] : [];
    const start = c4evs.length ? (c4!.pos ?? centroid(c4evs.filter((v) => v.pos).map((v) => v.pos!))) : centroid(startEvs.filter((v) => v.pos).map((v) => v.pos!));
    const startCell = start ? c.cell(start) : "";
    const lastAppr = lastOf(appr);
    const ind5 = lastAppr
      ? ind(`Annäherung ${forceText(appr)} ${c.cell(lastAppr.pos)} → ${o.cell} ${hmOf(lastAppr.ms)}`, true, w.annaeherung, { events: appr.map((v) => v.id), rule: "annaeherung", ms: lastAppr.ms })
      : ind(`Annäherung auf ${startCell ? `Achse ${startCell} → ` : ""}${o.cell} noch nicht gemeldet`, false, w.annaeherung, { rule: "annaeherung" });
    const inds = [ind1, ind2, ind3, ind4, ind5];
    const lastAway = lastOf(away);
    if (lastAway) {
      inds.push(ind(`Rot entfernt sich von ${o.name}: ${whoText(lastAway)} ${c.cell(lastAway.pos)} Rtg ${sector(lastAway.e.dir!)} ${hmOf(lastAway.ms)}`, true, w.weg,
        { against: true, events: away.map((v) => v.id), rule: "weg", ms: lastAway.ms }));
    }
    const check = [
      ...(changed ? [] : [`Stellungswechsel ${o.name}`]),
      startCell ? `Achse ${startCell}–${o.cell} beobachten` : `Annäherung auf ${o.cell} beobachten`,
      "Reserve bereit",
    ];
    const cand: Cand = {
      kind: "ueberfall", key: o.name, title: `Überfall auf Stao ${o.name} (${o.cell})`,
      target: { pos: P, unit: o.name, cell: o.cell }, ind: inds, check,
    };
    if (start && dist(start, P) > 100) {
      cand.approach = [start, P];
      const road = [...startEvs, ...appr].map((v) => v.road).find(Boolean)
        ?? recent(c, 180).filter((v) => v.feind && v.road && v.pos && v.ms >= since(c, 180) && dist(v.pos, start) <= 600).map((v) => v.road).pop();
      cand.approachText = `aus ${startCell}${road ? ` über ${road}` : ""}`;
      // Zeitraum: ab der nächstgelegenen Annäherung (ohne Vorbereitung), sonst ab dem letzten starken Indikator
      const nearest = appr.reduce<PEv | undefined>((m, v) => (!m || dist(v.pos!, P) < dist(m.pos!, P) ? v : m), undefined);
      const footOf = (vs: PEv[]) => vs.some((v) => v.persLo > 0) || !vs.some((v) => v.fz > 0);
      if (nearest) {
        cand.window = windowFor(nearest.ms, dist(nearest.pos!, P), footOf([nearest]) ? T.FOOT_KMH : T.FZ_KMH, false);
        cand.windowState = dist(nearest.pos!, P) <= T.JETZT_M && c.tMs <= Date.parse(cand.window.to) ? "jetzt" : undefined;
      } else {
        const strong = inds.filter((i) => i.met && !i.against && i.ms !== undefined && i.weight >= T.STRONG_WEIGHT && i.rule !== "still").map((i) => i.ms!);
        const base = strong.length ? Math.max(...strong) : c.refMs;
        cand.window = windowFor(base, dist(start, P), footOf(startEvs) ? T.FOOT_KMH : T.FZ_KMH, true);
      }
      cand.windowState ??= c.tMs > Date.parse(cand.window.to) ? "ueberfaellig" : "erwartet";
    } else cand.windowState = "offen";
    out.push(cand);
  }
  return out;
}

/** Zeitraum ab `base`: (Vorbereitung +) Weg schnell–langsam, auf 5 Min gerundet, mindestens 30 Min breit – nie nachgezogen */
function windowFor(base: number, d: number, kmh: readonly [number, number], prep: boolean): NonNullable<RedCoa["window"]> {
  const fast = (d / 1000 / kmh[1]) * 60, slow = (d / 1000 / kmh[0]) * 60;
  const from = floor5(base + ((prep ? T.PREP_MIN : 0) + fast) * MIN_MS);
  const to = Math.max(from + 30 * MIN_MS, ceil5(base + ((prep ? T.PREP_MAX : 0) + slow) * MIN_MS));
  return { from: isoOfMs(from), to: isoOfMs(to) };
}

function hinterhalt(c: Ctx): Cand[] {
  const out: Cand[] = [];
  const w = W.hinterhalt;
  const c5s = c.hints.filter((h) => h.rule === "C5" && active(c, h));
  const lvl = (h: Hint) => (h.level === "hoch" ? 2 : h.level === "mittel" ? 1 : 0);
  // stärkste, dann neueste zuerst
  c5s.sort((a, b) => lvl(b) - lvl(a) || hms(b) - hms(a) || a.id.localeCompare(b.id));
  type Tgt = { key: string; label: string; pos: LV95; ring?: LV95[]; area?: Area; c5: Hint[]; engnis: boolean };
  const targets: Tgt[] = [];
  const used = new Set<Hint>();
  for (const a of c.nais.filter((x) => x.typ === "engnis")) {
    const hs = c5s.filter((x) => x.nai === a.name || (x.pos && distToRing(x.pos, a.ring) <= 300));
    hs.forEach((h) => used.add(h));
    targets.push({ key: a.name, label: a.name, pos: areaCenter(a), ring: a.ring, area: a, c5: hs, engnis: true });
  }
  for (const h of c5s) {
    if (!h.pos || used.has(h)) continue;
    const cell = h.cells?.[0] ?? c.cell(h.pos);
    const t = targets.find((x) => !x.engnis && x.key === cell);
    if (t) t.c5.push(h); else targets.push({ key: cell, label: cell, pos: h.pos, c5: [h], engnis: false });
  }
  for (const tg of targets) {
    const near = (p: LV95 | undefined, m: number) => !!p && (tg.ring ? distToRing(p, tg.ring) <= m : dist(p, tg.pos) <= m);
    const best = tg.c5[0];
    const c5e = tg.c5.flatMap((h) => evsOf(c, h));
    // Auslöser: neuestes Hindernis bzw. neueste Meldung der stärksten C5
    const bevs = best ? evsOf(c, best).filter((v) => v.side === "rot") : [];
    const b0 = lastOf(bevs.filter((v) => v.cat?.category === "Hindernisse" || OBSTACLE_IED.has(v.e.sym) || BLOCK_RE.test(v.e.text))) ?? lastOf(bevs);
    const what = b0 ? (b0.cat?.category === "Hindernisse" || BLOCK_RE.test(b0.e.text) ? b0.cat?.category === "Hindernisse" ? b0.cat.noun ?? b0.cat.name : "Hindernis" : b0.cat?.noun ?? b0.cat?.name ?? "Hindernis") : "Hindernis";
    const i1 = best
      ? ind(`${what} ${tg.label} ${hmOf(b0?.ms ?? hms(best))} (C5${tg.c5.length > 1 ? `, ${tg.c5.length}×` : ""})`, true, tg.engnis ? w.hindernis_engnis : w.hindernis,
        { ...fromHint(best, c), events: uniq(c5e.map((v) => v.id)), ms: Math.max(...c5e.map((v) => v.ms), hms(best)), key: true, persistent: true })
      : ind(`Hindernis/Halt im Engnis ${tg.label} – nicht gemeldet`, false, w.hindernis_engnis, { key: true, rule: "C5" });
    const c3 = c.hints.filter((h) => h.rule === "C3" && active(c, h, T.RECON_MIN) &&
      (evsOf(c, h).some((v) => (tg.area && v.nais.includes(tg.area.name)) || near(v.pos, T.RECON_NEAR_M)))).sort((a, b) => hms(b) - hms(a))[0];
    const i2 = c3
      ? ind(`Aufklärung ${tg.label} ${c3.events.length}× (C3)`, true, w.aufklaerung, fromHint(c3, c))
      : ind(`Aufklärung ${tg.label} – nicht gemeldet`, false, w.aufklaerung, { rule: "C3" });
    const st = recent(c, T.STELLUNG_MIN).filter((v) => v.feind && v.pos && v.precise && v.ms >= since(c, T.STELLUNG_MIN) && near(v.pos, T.STELLUNG_M) &&
      (STAO_SYMS.has(v.e.sym) || STAO_RE.test(v.e.text) || (v.halt && (v.persLo > 0 || v.fz > 0))) && !c5e.includes(v));
    const s0 = lastOf(st);
    const i3 = s0
      ? ind(`${s0.e.unit || forceText([s0])} in Stellung ${c.cell(s0.pos)} ${hmOf(s0.ms)}`, true, w.rot_stellung, { events: st.map((v) => v.id), rule: "stellung", ms: s0.ms, persistent: true })
      : ind(`Rot in Stellung nahe ${tg.label} – nicht gemeldet`, false, w.rot_stellung, { rule: "stellung" });
    const d3 = tg.area ? c.hints.find((h) => h.rule === "D3" && h.nai === tg.area!.name && active(c, h, 0)) : undefined;
    const i4 = d3
      ? ind(`Lücke in der Überwachung ${tg.label} (D3)`, true, w.luecke, { ...fromHint(d3, c), persistent: true })
      : ind(`Lücke in der Überwachung ${tg.label}${tg.area?.trupp ? ` (${tg.area.trupp})` : ""} – keine`, false, w.luecke, { rule: "D3" });
    const inds = [i1, i2, i3, i4];
    // Gegenindikator: eigene Präsenz im Engnis (eigener Stao dort oder eigene Meldung aus dem Engnis in der letzten Stunde)
    const ownThere = c.own.find((o) => near(o.pos, T.PRESENCE_M));
    const ownEv = ownThere ? undefined : lastOf(recent(c, 60).filter((v) => v.side === "blau" && v.pos && v.precise && v.ms >= since(c, 60) && near(v.pos, T.PRESENCE_M)));
    if (ownThere || ownEv) {
      const who = ownThere?.name ?? ownEv!.e.unit ?? ownEv!.melder;
      inds.push(ind(`eigene Präsenz im ${tg.engnis ? "Engnis" : "Raum"} ${tg.label}: ${who}${ownEv ? ` ${hmOf(ownEv.ms)}` : ""}`, true, w.eigene_praesenz,
        { against: true, events: [(ownThere?.last ?? ownEv!).id], rule: "praesenz", ms: ownEv?.ms, persistent: !!ownThere }));
    }
    const trupp = tg.area?.trupp;
    out.push({
      kind: "hinterhalt", key: tg.key,
      title: tg.engnis ? `Hinterhalt an Engnis ${tg.label} auf eigene Verschiebung` : `Hinterhalt an Strasse ${tg.label} auf eigene Verschiebung`,
      target: { pos: best?.pos && !tg.engnis ? best.pos : tg.pos, cell: c.cell(tg.pos), nai: tg.area?.name },
      ind: inds,
      check: [`Verschiebungen nicht über ${tg.label}`, `${tg.label} überwachen${trupp ? ` (${trupp})` : ""}`, "Umgehung erkunden"],
    });
  }
  return out;
}

function sperren(c: Ctx): Cand[] {
  const w = W.sperren;
  const obst = recent(c, T.SPERREN_MIN).filter((v) => v.feind && v.pos && v.ms >= since(c, T.SPERREN_MIN) && (v.cat?.category === "Hindernisse" || OBSTACLE_IED.has(v.e.sym)));
  // Kette: Hindernisse höchstens `SPERREN_M` voneinander
  const groups: PEv[][] = [];
  for (const v of obst) {
    const hit = groups.filter((g) => g.some((x) => dist(x.pos!, v.pos!) <= T.SPERREN_M));
    if (!hit.length) { groups.push([v]); continue; }
    const merged = hit.flat().concat(v);
    for (const g of hit) groups.splice(groups.indexOf(g), 1);
    groups.push(merged.sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id)));
  }
  const out: Cand[] = [];
  for (const g of groups) {
    const pos = centroid(g.map((v) => v.pos!))!;
    const cells = uniq(g.map((v) => v.nais[0] ?? c.cell(v.pos)));
    const label = cells.length > 2 ? `${cells[0]}–${cells[cells.length - 1]}` : cells.join("–");
    const i1 = g.length >= 2
      ? ind(`${g.length} Sperren/Hindernisse ${cells.join(", ")} seit ${hmOf(g[0]!.ms)}`, true, w.mehrere, { events: g.map((v) => v.id), key: true, rule: "sperren", ms: lastOf(g)!.ms, persistent: true })
      : ind(`weitere Sperre im Raum ${label} – nicht gemeldet`, false, w.mehrere, { key: true, rule: "sperren" });
    const ied = g.filter((v) => OBSTACLE_IED.has(v.e.sym));
    const i2 = ied.length
      ? ind(`${ied[0]!.cat?.noun ?? "IED"} ${c.cell(ied[0]!.pos)} ${hmOf(ied[0]!.ms)}`, true, w.ied, { events: ied.map((v) => v.id), rule: "ied", ms: ied[0]!.ms, persistent: true })
      : ind("IED/Minen – nicht gemeldet", false, w.ied, { rule: "ied" });
    const own = c.own.map((o) => ({ o, d: Math.min(...g.map((v) => dist(v.pos!, o.pos))) })).filter((x) => x.d <= T.EIGENE_NAHE_M).sort((a, b) => a.d - b.d)[0];
    const i3 = own
      ? ind(`Sperre ca. ${Math.round(own.d / 100) * 100} m von ${own.o.name}`, true, w.eigene_nahe, { events: [own.o.last.id], rule: "eigene", persistent: true })
      : ind("Sperre nahe eigenem Element – keine", false, w.eigene_nahe, { rule: "eigene" });
    const guard = recent(c, T.SPERREN_MIN + 60).filter((v) => v.feind && v.pos && (v.persLo > 0 || v.fz > 0) && !g.includes(v) &&
      g.some((x) => Math.abs(x.ms - v.ms) <= 60 * MIN_MS && dist(x.pos!, v.pos!) <= T.ROT_SICHERT_M));
    const g0 = lastOf(guard);
    const i4 = g0
      ? ind(`Rot bei Sperre: ${forceText(guard)} ${c.cell(g0.pos)} ${hmOf(g0.ms)}`, true, w.rot_sichert, { events: guard.map((v) => v.id), rule: "sichert", ms: g0.ms })
      : ind("Rot sichert Sperre – nicht gemeldet", false, w.rot_sichert, { rule: "sichert" });
    const fire = recent(c, T.SPERREN_MIN).filter((v) => v.feind && v.pos && FIRE_SYMS.has(v.e.sym) && v.ms >= since(c, T.SPERREN_MIN) && g.some((x) => dist(x.pos!, v.pos!) <= T.FEUER_M));
    const f0 = lastOf(fire);
    const i5 = f0
      ? ind(`Feuerunterstützung ${f0.cat?.noun ?? f0.cat?.name ?? ""} ${c.cell(f0.pos)}`.replace(/\s+/g, " "), true, w.feuer, { events: fire.map((v) => v.id), rule: "feuer", ms: f0.ms })
      : ind("Feuerunterstützung (Kpz, Mg, Pzaw) bei Sperre – nicht gemeldet", false, w.feuer, { rule: "feuer" });
    out.push({
      kind: "sperren", key: g[0]!.id, title: `Sperren/Kanalisieren im Raum ${label}`,
      target: { pos, cell: c.cell(pos), nai: g.find((v) => v.nais.length)?.nais[0] }, ind: [i1, i2, i3, i4, i5],
      check: ["Umgehung erkunden", "Hindernis nur gesichert räumen", own ? `Verbindung ${own.o.name} prüfen` : "Achsen offenhalten"],
    });
  }
  return out;
}

function versorgung(c: Ctx): Cand[] {
  const w = W.versorgung;
  const out: Cand[] = [];
  const handovers = c.hints.filter((h) => h.rule === "C1" && active(c, h, T.HANDOVER_MIN));
  const staos = c.evs.filter((v) => v.feind && v.pos && v.precise && (STAO_SYMS.has(v.e.sym) || STAO_RE.test(v.e.text)));
  const staoNear = gridOf(staos, T.PENDEL_END_M);
  const halts0 = recent(c, 120).filter((v) => v.side === "rot" && v.pos && v.halt && v.isFz);
  for (const p of c.hints.filter((h) => h.rule === "C2" && active(c, h, 0))) {
    const pe = evsOf(c, p).filter((v) => v.pos);
    if (pe.length < 2) continue;
    // Pendel-Enden: Orte der Durchfahrten (erste Meldung = Ende A, am weitesten entfernte = Ende B)
    const a = pe[0]!;
    const b = pe.reduce((m, v) => (dist(v.pos!, a.pos!) > dist(m.pos!, a.pos!) ? v : m), pe[0]!);
    const lab = (v: PEv) => v.nais[0] ?? c.cell(v.pos);
    const ends = [{ v: a, l: lab(a) }, { v: b, l: lab(b) }].sort((x, y) => NATURAL.compare(x.l, y.l));
    const nearEnd = (q: LV95 | undefined, m: number) => !!q && ends.some((e) => dist(e.v.pos!, q) <= m);
    const nx = p.next ? Date.parse(p.next) : undefined;
    // Prognose nur, solange die nächste Durchfahrt nicht überfällig ist
    const next = nx !== undefined && nx >= c.tMs ? nx : undefined;
    const late = nx !== undefined && nx < c.tMs ? `, seit ${hmOf(nx)} überfällig` : "";
    const i1 = ind(`Pendel ${p.title.replace(/^Pendelverkehr\s+/, "").replace(/ zwischen .*$/, "")} ${ends[0]!.l} ↔ ${ends[1]!.l}, ${pe.length} Meldungen${next ? `, nächste ca. ${hmOf(next)}` : late} (C2)`,
      true, w.pendel, { ...fromHint(p, c), key: true, persistent: true });
    const ho = handovers.filter((h) => nearEnd(h.pos, T.PENDEL_END_M)).sort((x, y) => hms(y) - hms(x))[0];
    const i2 = ho
      ? ind(`${/Übergabe/.test(ho.title) ? "Übergabe" : "Umsteigen/Halt"} ${ho.cells?.[0] ?? c.cell(ho.pos)} ${hmOf(hms(ho))} (C1)`, true, w.uebergabe, { ...fromHint(ho, c), key: true })
      : ind("Übergabe/Umladen – nicht gemeldet", false, w.uebergabe, { key: true, rule: "C1" });
    // Rot-Stao an den Enden: nur die neuesten
    const st = uniq(ends.flatMap((e) => staoNear(e.v.pos!, T.PENDEL_END_M))).sort((x, y) => x.ms - y.ms || (x.id < y.id ? -1 : 1)).slice(-MAX_EVENTS);
    const s0 = lastOf(st);
    const i3 = s0
      ? ind(`Rot-Stao ${s0.e.unit ? `${s0.e.unit} ` : ""}${c.cell(s0.pos)} am Pendel-Ende`, true, w.rot_stao, { events: st.map((v) => v.id), rule: "stao", ms: s0.ms, persistent: true })
      : ind("Rot-Stao/Lager am Pendel-Ende – nicht gemeldet", false, w.rot_stao, { rule: "stao" });
    const halts = halts0.filter((v) => nearEnd(v.pos, 500));
    const h0 = lastOf(halts);
    const i4 = h0
      ? ind(`Fz-Halt am Pendel-Ende ${c.cell(h0.pos)} ${hmOf(h0.ms)}`, true, w.halt, { events: halts.map((v) => v.id), rule: "halt", ms: h0.ms })
      : ind("Kurzhalt am Pendel-Ende – nicht gemeldet", false, w.halt, { rule: "halt" });
    const tEnd = s0 ? ends.reduce((m, e) => (dist(e.v.pos!, s0.pos!) < dist(m.v.pos!, s0.pos!) ? e : m)) : ends[1]!;
    out.push({
      kind: "versorgung", key: p.id,
      title: `Versorgung/Übergabe Pendel ${ends[0]!.l} ↔ ${ends[1]!.l}${next ? ` (nächste ca. ${hmOf(next)})` : ""}`,
      target: { pos: tEnd.v.pos!, cell: tEnd.l.startsWith("NAI") ? c.cell(tEnd.v.pos) : tEnd.l, nai: tEnd.v.nais[0] },
      approach: [ends[0]!.v.pos!, ends[1]!.v.pos!], approachText: `Pendel ${ends[0]!.l} ↔ ${ends[1]!.l}`,
      ind: [i1, i2, i3, i4],
      check: [next ? `Durchfahrt ca. ${hmOf(next)} beobachten` : "nächste Durchfahrt beobachten", `Übergabeort ${tEnd.l} überwachen`, "Merkmale/Kennzeichen melden"],
    });
  }
  return out;
}

function aufklaerung(c: Ctx): Cand[] {
  const w = W.aufklaerung;
  const out: Cand[] = [];
  type Tgt = { key: string; label: string; pos: LV95; unit?: string; nai?: string; c3?: Hint; d1?: Hint };
  const tg: Tgt[] = [];
  const moved = (h: Hint) => { const o = c.own.find((x) => x.name === h.unit); return !!o && dist(o.pos, h.pos!) > T.MOVED_M; };
  for (const h of c.hints.filter((x) => x.rule === "D1" && active(c, x) && x.unit && x.pos && !moved(x))) tg.push({ key: h.unit!, label: `Stao ${h.unit}`, pos: h.pos!, unit: h.unit, d1: h });
  for (const h of c.hints.filter((x) => x.rule === "C3" && active(c, x, T.RECON_MIN) && x.pos)) {
    const ev = evsOf(c, h);
    const nai = ev.find((v) => v.nais.length)?.nais[0];
    const exist = tg.find((t) => dist(t.pos, h.pos!) <= T.RECON_NEAR_M);
    if (exist) { exist.c3 ??= h; continue; }
    const label = nai ?? h.cells?.[0] ?? c.cell(h.pos);
    tg.push({ key: label, label, pos: h.pos!, nai, c3: h });
  }
  for (const t of tg) {
    const c3 = t.c3 ?? c.hints.find((h) => h.rule === "C3" && active(c, h, T.RECON_MIN) && h.pos && dist(h.pos, t.pos) <= T.RECON_NEAR_M);
    const d1 = t.d1;
    const i1 = c3 ? ind(`Aufklärung ${t.nai ?? c3.cells?.join("/") ?? t.label} ${c3.events.length}× (C3)`, true, w.c3, { ...fromHint(c3, c), key: true })
      : ind(`wiederholte Aufklärung ${t.label} – nicht gemeldet`, false, w.c3, { key: true, rule: "C3" });
    const i2 = d1 ? ind(`${spotterText(evsOf(c, d1).filter((v) => v.side === "rot"))} beim Stao ${t.unit} (D1)`, true, w.d1, { ...fromHint(d1, c), key: true, persistent: true })
      : ind("eigener Stao aufgeklärt – nicht gemeldet", false, w.d1, { key: true, rule: "D1" });
    const dr = recent(c, 120).filter((v) => v.side === "rot" && v.isDrone && v.ms >= since(c, 120) && v.pos && dist(v.pos, t.pos) <= T.RECON_NEAR_M);
    const i3 = dr.length ? ind(`Drohne ${dr.length}× in den letzten 2 h`, true, w.drohne, { events: dr.map((v) => v.id), rule: "drohne", ms: lastOf(dr)!.ms })
      : ind("Drohne in den letzten 2 h – keine", false, w.drohne, { rule: "drohne" });
    const ob = recent(c, 120).filter((v) => v.side === "rot" && SPOT_RE.test(v.e.text) && v.ms >= since(c, 120) && v.pos && dist(v.pos, t.pos) <= T.RECON_NEAR_M);
    const o0 = lastOf(ob);
    const i4 = o0 ? ind(`Beobachter ${c.cell(o0.pos)} ${hmOf(o0.ms)}`, true, w.beobachter, { events: ob.map((v) => v.id), rule: "beobachter", ms: o0.ms })
      : ind("Beobachter/Handy – nicht gemeldet", false, w.beobachter, { rule: "beobachter" });
    out.push({
      kind: "aufklaerung", key: t.key, title: `Aufklärung ${t.unit ? `Stao ${t.unit}` : t.label} zur Vorbereitung einer Aktion`,
      target: { pos: t.pos, unit: t.unit, cell: c.cell(t.pos), nai: t.nai }, ind: [i1, i2, i3, i4],
      check: [t.unit ? `Tarnung und Stellung ${t.unit} prüfen` : `${t.label} überwachen`, "Gegenaufklärung (Drohne, Beobachter melden)", "Aktion im Raum erwarten"],
    });
  }
  return out;
}

function infiltration(c: Ctx): Cand[] {
  const w = W.infiltration;
  const out: Cand[] = [];
  for (const a of c.nais) {
    const d3 = c.hints.find((h) => h.rule === "D3" && h.nai === a.name && active(c, h, 0));
    const i1 = d3 ? ind(`${a.name} nicht überwacht (D3)`, true, w.luecke, { ...fromHint(d3, c), key: true, persistent: true })
      : ind(`Lücke in der Überwachung ${a.name} – keine`, false, w.luecke, { key: true, rule: "D3" });
    const a3 = c.hints.find((h) => h.rule === "A3" && h.nai === a.name && active(c, h, 0)) ??
      c.hints.find((h) => h.rule === "A3" && active(c, h, 0) && h.title.includes(a.name));
    const i2 = a3 ? ind(`Auffällige Ruhe ${a.name} (A3)`, true, w.ruhe, { ...fromHint(a3, c), persistent: true }) : ind(`Ruhe in ${a.name} – keine`, false, w.ruhe, { rule: "A3" });
    // Rot nahe: nicht, wenn es sich vom NAI entfernt; ist die Lücke (D3) erfüllt, nur Rot im NAI bzw. auf den NAI zu,
    // das nicht schon die Lücke auslöst (D3 heisst bereits «Rot in der Nähe»)
    const ctr = areaCenter(a);
    const d3evs = new Set(d3?.events ?? []);
    const near = recent(c, 60).filter((v) => v.side === "rot" && v.pos && v.precise && v.ms >= since(c, 60) && distToRing(v.pos, a.ring) <= 1000 && !awayFrom(v, ctr) &&
      (!d3 || (!d3evs.has(v.id) && (v.nais.includes(a.name) || towards(v, ctr)))));
    const n0 = lastOf(near);
    const i3 = n0 ? ind(`Rot nahe ${a.name}: ${forceText(near)} ${hmOf(n0.ms)}`, true, w.rot_nahe, { events: near.map((v) => v.id), rule: "nahe", ms: n0.ms })
      : ind(`Rot nahe ${a.name} – nicht gemeldet`, false, w.rot_nahe, { rule: "nahe" });
    const b3 = c.hints.find((h) => (h.rule === "B3" || h.rule === "B2") && active(c, h) && h.pos && distToRing(h.pos, a.ring) <= 1500);
    const i4 = b3 ? ind(`${b3.title} (${b3.rule})`, true, w.ausweichen, fromHint(b3, c)) : ind("Ausweichen vor Checkpoint – nicht gemeldet", false, w.ausweichen, { rule: "B3" });
    out.push({
      kind: "infiltration", key: a.name, title: `Infiltration durch ${a.name}`,
      target: { pos: areaCenter(a), cell: c.cell(areaCenter(a)), nai: a.name }, ind: [i1, i2, i3, i4],
      check: [`${a.name} besetzen`, a.trupp ? `Verbindung ${a.trupp} prüfen` : "Trupp zuteilen", "Reserve bereit"],
    });
  }
  return out;
}

function absetzen(c: Ctx): Cand[] {
  const w = W.absetzen;
  const rot = fromMs(c, c.tMs - 120 * MIN_MS, "abs").filter((v) => v.side === "rot");
  // Abnahme bezieht sich auf die Lagezeit (ausbleibende Meldungen sind die Information)
  const nowEvs = rot.filter((v) => v.ms > c.tMs - 60 * MIN_MS);
  const beforeEvs = rot.filter((v) => v.ms > c.tMs - 120 * MIN_MS && v.ms <= c.tMs - 60 * MIN_MS);
  const now = nowEvs.length, before = beforeEvs.length;
  const i1 = before >= T.DROP_MIN_EVENTS && now <= before * T.DROP_RATIO
    ? ind(`Abnahme Rot-Meldungen: ${now} statt ${before} je Stunde`, true, w.abnahme, { key: true, rule: "abnahme", events: beforeEvs.map((v) => v.id), persistent: true })
    : ind("Abnahme der Rot-Meldungen – keine", false, w.abnahme, { key: true, rule: "abnahme" });
  const away = withdrawing(c, 60);
  const awaySet = new Set(away);
  const lastDir = [...away].reverse().find((v) => v.e.dir !== undefined);
  const dirTxt = lastDir ? sector(lastDir.e.dir!) : "";
  // Kolonne: weg von den eigenen Elementen = starker Indikator; auf eigene Elemente zu zählt nicht
  const kols = c.hints.filter((h) => h.rule === "C6" && active(c, h) && /Kolonne/.test(h.title)).sort((a, b) => hms(b) - hms(a));
  const kolAway = kols.find((h) => evsOf(c, h).some((v) => awaySet.has(v)));
  const kol = kolAway ?? kols.find((h) => !evsOf(c, h).some((v) => c.own.some((o) => dist(o.pos, v.pos ?? o.pos) <= T.AWAY_M && towards(v, o.pos))));
  const i3 = kol
    ? ind(`${kol.title}${kolAway ? " weg von eigenen Elementen" : ""} (C6)`, true, kolAway ? w.kolonne_weg : w.kolonne, { ...fromHint(kol, c), key: !!kolAway })
    : ind("Kolonne (Verschiebung) – nicht gemeldet", false, w.kolonne, { rule: "C6" });
  const a0 = lastOf(away);
  const i2 = away.length
    ? ind(`Rot entfernt sich: ${away.length > 1 && !sameUnit(away) ? forceText(away) : whoText(a0!)}${dirTxt ? ` Rtg ${dirTxt}` : ""} ${hmOf(a0!.ms)}`, true, w.weg, { events: away.map((v) => v.id), key: true, rule: "weg", ms: a0!.ms })
    : ind("Rot entfernt sich von eigenen Elementen – nicht gemeldet", false, w.weg, { key: true, rule: "weg" });
  const a3 = c.hints.find((h) => h.rule === "A3" && active(c, h, 0));
  const i4 = a3 ? ind(`${a3.title} (A3)`, true, w.ruhe, { ...fromHint(a3, c), persistent: true }) : ind("Auffällige Ruhe – keine", false, w.ruhe, { rule: "A3" });
  const inds = [i1, i2, i3, i4];
  // Gegenindikator: Rot nähert sich eigenen Elementen
  const appr = movingRed(c, 60).filter((v) => !awaySet.has(v) && c.own.some((o) => dist(o.pos, v.pos!) <= T.APPROACH_M && dist(o.pos, v.pos!) > 250 && towards(v, o.pos)));
  const p0 = lastOf(appr);
  if (p0) {
    const o = c.own.filter((x) => towards(p0, x.pos)).sort((x, y) => dist(x.pos, p0.pos!) - dist(y.pos, p0.pos!))[0]!;
    inds.push(ind(`Rot nähert sich ${o.name}: ${whoText(p0)} ${c.cell(p0.pos)} ${hmOf(p0.ms)}`, true, w.naehert, { against: true, events: appr.map((v) => v.id), rule: "naehert", ms: p0.ms }));
  }
  const pos = centroid(away.map((v) => v.pos!)) ?? centroid(c.evs.filter((v) => v.side === "rot" && v.pos).slice(-5).map((v) => v.pos!));
  if (!pos) return [];
  return [{
    kind: "absetzen", key: "rot", title: `Absetzen/Ausweichen von Rot${dirTxt ? ` Rtg ${dirTxt}` : ""}`,
    target: { pos, cell: c.cell(pos) }, ind: inds,
    check: ["Kontakt halten (Beobachtung nachführen)", `Ausweichachse${dirTxt ? ` Rtg ${dirTxt}` : ""} überwachen`, "Lage an Vorgesetzte melden"],
  }];
}

// ---------------------------------------------------------------------------------------------
// Bewertung: Alterung, Entscheide, Zuordnung Indikator ↔ Meldung (keine Doppelzählung)
// ---------------------------------------------------------------------------------------------
function effWeight(c: Ctx, i: Ind, atMs: number): number {
  let w = i.weight;
  if (i.confirmed) w = Math.max(w, Math.min(w * T.CONFIRMED_FACTOR, T.CONFIRMED_MAX));
  if (!i.persistent && i.ms !== undefined) w *= 0.5 ** (Math.max(0, atMs - i.ms) / MIN_MS / T.HALF_LIFE_MIN);
  return w;
}

/**
 * Keine Doppelzählung: ein Rot-Indikator zählt nur, wenn er mindestens eine Rot-Meldung beiträgt, die nicht schon die
 * bisher gezählten Indikatoren derselben Möglichkeit erfüllt (spezifischere mit weniger Meldungen zuerst, dann stärkere).
 * Beispiel: «Drohne beim Stao (D1)» und «Aufklärung 2× (C3)» zählen (zwei Drohnen), «Drohne 2×» mit denselben nicht mehr.
 */
function assign(items: Array<{ w: number; rot: string[] }>): Set<number> {
  const used = new Set<string>();
  const order = items.map((_, k) => k).sort((a, b) => items[a]!.rot.length - items[b]!.rot.length || items[b]!.w - items[a]!.w || a - b);
  const ok = new Set<number>();
  for (const k of order) {
    const r = items[k]!.rot;
    if (!r.some((e) => !used.has(e))) continue;
    ok.add(k);
    for (const e of r) used.add(e);
  }
  return ok;
}

function score(c: Ctx, cand: Cand, rotOfInd: Map<Ind, string[]>): Scored | null {
  const rotOf = (i: Ind) => rotOfInd.get(i) ?? [];
  const met = cand.ind.filter((i) => i.met).map((i, k) => ({ i, k, w: effWeight(c, i, c.refMs), rot: rotOf(i) }));
  const pos = met.filter((x) => !x.i.against);
  const rotPos = pos.filter((x) => x.rot.length);
  const ok = assign(rotPos);
  const counted = new Set<Ind>([...rotPos.filter((_, k) => ok.has(k)).map((x) => x.i), ...pos.filter((x) => !x.rot.length).map((x) => x.i)]);
  const effOf = new Map(met.map((x) => [x.i, x.w]));
  const calc = (prev: boolean) => {
    const keep = (i: Ind) => !prev || i.ms === undefined || i.ms < c.refMs;
    const cs = [...counted].filter(keep);
    const ag = met.filter((x) => x.i.against && keep(x.i));
    const s = (1 - cs.reduce((p, i) => p * (1 - effOf.get(i)!), 1)) * ag.reduce((p, x) => p * (1 - x.w), 1);
    const rotN = cs.filter((i) => rotOf(i).length).length;
    return { s, q: rotN >= T.MIN_MET && cs.some((i) => i.key && rotOf(i).length) };
  };
  const now = calc(false);
  if (!now.q) return null;
  const prev = calc(true);
  const indicators: CoaIndicator[] = cand.ind.map((i) => {
    const { key: _k, ms: _m, persistent: _p, confirmed: _c, weight: _w, ...rest } = i;
    const o: CoaIndicator = { ...rest, weight: Math.round((effOf.get(i) ?? effWeight(c, i, c.refMs)) * 1000) / 1000 };
    if (i.met && !i.against && !counted.has(i)) { o.met = false; o.text = `${i.text}${DUP_SUFFIX}`; }
    return o;
  });
  const events = uniq(cand.ind.filter((i) => i.met && (counted.has(i) || i.against)).flatMap((i) => i.events ?? []));
  const r: Omit<RedCoa, "label"> = {
    id: `${cand.kind}:${cand.key}`, kind: cand.kind, title: cand.title, target: cand.target, indicators,
    score: Math.round(now.s * 1000) / 1000, danger: COA_DANGER[cand.kind], check: cand.check, events,
  };
  if (r.target) for (const k of Object.keys(r.target) as Array<keyof NonNullable<RedCoa["target"]>>) if (r.target[k] === undefined) delete r.target[k];
  if (cand.approach) r.approach = cand.approach;
  if (cand.approachText) r.approachText = cand.approachText;
  if (cand.window) r.window = cand.window;
  if (cand.windowState) r.windowState = cand.windowState;
  return { coa: r, prevScore: prev.s, prevQualifies: prev.q };
}

const byScore = (a: { score: number; danger: number; id: string }, b: { score: number; danger: number; id: string }) =>
  b.score - a.score || b.danger - a.danger || a.id.localeCompare(b.id);

function evaluate(ex: Exercise, o: CoaOptions): Scored[] {
  const tMs = lageMs(ex, o.t);
  const evs = prepareRed(ex, tMs);
  if (!evs.length) return [];
  const sheets = ex.sheets ?? [];
  const decisions = o.decisions ?? ex.hintDecisions;
  const hints0 = o.hints.filter((h) => Date.parse(h.t) <= tMs);
  const ids = hints0.map((h) => h.id);
  const hints: Hint[] = [];
  const confirmed = new Set<string>();
  for (const h of hints0) {
    const d = decisions ? decisionFor(h, decisions, ids) : undefined;
    if (d?.state === "verworfen") continue;
    if (d?.state === "bestaetigt") confirmed.add(h.id);
    hints.push(h);
  }
  const c: Ctx = {
    ex, tMs, refMs: evs[evs.length - 1]!.ms, evs, byId: new Map(evs.map((v) => [v.id, v])), hints, confirmed, own: [],
    nais: (ex.areas ?? []).filter((a) => a.kind === "nai"), cell: (p, fb = "") => placeLabel(sheets, p, fb), memo: new Map(), byUnit: new Map(),
  };
  for (const v of evs) if (v.side === "rot" && v.unitKey) { const l = c.byUnit.get(v.unitKey); if (l) l.push(v); else c.byUnit.set(v.unitKey, [v]); }
  c.own = ownUnits(c);
  const out: Scored[] = [];
  for (const fn of [ueberfall, hinterhalt, sperren, versorgung, aufklaerung, infiltration, absetzen]) {
    try {
      for (const cand of fn(c)) {
        // Vorprüfung: zu wenige erfüllte Rot-Indikatoren oder kein Schlüssel – nicht bewerten
        const rotOfInd = new Map<Ind, string[]>();
        let n = 0, key = false;
        for (const i of cand.ind) {
          if (!i.met) continue;
          const r = (i.events ?? []).filter((id) => c.byId.get(id)?.side === "rot");
          rotOfInd.set(i, r);
          if (!i.against && r.length) { n++; if (i.key) key = true; }
        }
        if (n < T.MIN_MET || !key) continue;
        const s = score(c, cand, rotOfInd);
        if (s) out.push(s);
      }
    } catch {
      // eine fehlerhafte Möglichkeit darf die Lage nie stören
    }
  }
  return out;
}

/**
 * Mögliche Aktionen Rot zur Lagezeit, einmal gerechnet: Auswahl (wahrscheinlichste, gefährlichste falls verschieden,
 * eine weitere) und alle Möglichkeiten mit genügend Indikatoren (Auswahl zuerst, übrige nach `score`, als «weitere»).
 */
export function analyzeRedCoas(ex: Exercise, o: CoaOptions): CoaAnalysis {
  const sc = evaluate(ex, o);
  if (!sc.length) return { picked: [], all: [] };
  const list = sc.map((s) => s.coa).sort(byScore);
  // Hysterese: bisherige wahrscheinlichste (vor der letzten Meldung) bleibt, solange die neue höchstens `HYSTERESIS` besser ist
  const prevTop = sc.filter((s) => s.prevQualifies).map((s) => ({ ...s.coa, score: s.prevScore })).sort(byScore)[0];
  let lead = list[0]!;
  const prevNow = prevTop && list.find((x) => x.id === prevTop.id);
  if (prevNow && prevNow.id !== lead.id && lead.score - prevNow.score < T.HYSTERESIS) lead = prevNow;
  else if (!prevNow) {
    // beide neu: bei kaum unterschiedlichem `score` die gefährlichere
    const close = list.filter((x) => lead.score - x.score < T.HYSTERESIS).sort((a, b) => b.danger - a.danger || byScore(a, b))[0];
    if (close) lead = close;
  }
  const picked: RedCoa[] = [{ ...lead, label: "wahrscheinlichste" }];
  const rest = list.filter((x) => x.id !== lead.id);
  const danger = rest.filter((x) => x.score >= T.DANGER_MIN_SCORE && x.danger > lead.danger)
    .sort((a, b) => b.danger - a.danger || b.score - a.score)[0];
  if (danger) picked.push({ ...danger, label: "gefaehrlichste" });
  const used = new Set(picked.map((x) => x.id));
  const kinds = new Set(picked.map((x) => x.kind));
  const left = rest.filter((x) => !used.has(x.id));
  const other = left.find((x) => !kinds.has(x.kind)) ?? left[0];
  if (other) picked.push({ ...other, label: "weitere" });
  const pickedIds = new Set(picked.map((x) => x.id));
  const all: RedCoa[] = [...picked, ...list.filter((x) => !pickedIds.has(x.id)).map((x): RedCoa => ({ ...x, label: "weitere" }))];
  return { picked, all };
}

/** Alle Möglichkeiten mit genügend Indikatoren (ohne Einordnung), Reihenfolge wie `analyzeRedCoas` – Hülle */
export function allRedCoas(ex: Exercise, o: CoaOptions): Array<Omit<RedCoa, "label">> {
  return analyzeRedCoas(ex, o).all.map(({ label: _l, ...x }) => x);
}

/** Höchstens drei Möglichkeiten: wahrscheinlichste, gefährlichste (falls verschieden), eine weitere – Hülle */
export function computeRedCoas(ex: Exercise, o: CoaOptions): RedCoa[] {
  return analyzeRedCoas(ex, o).picked;
}

/** Kurztext Dauer (für Anzeigen «nicht mehr gesehen»), z. B. «4 h 15′» */
export const formatSince = durShort;
