/**
 * Mögliche Aktionen Rot (Feindmöglichkeiten): aus Hinweisen und Meldungen abgeleitet, offline.
 * Katalog typischer Möglichkeiten mit Indikatoren; je mehr Indikatoren zutreffen, desto wahrscheinlicher.
 * Es bleiben Hinweise, keine Fakten – jede Möglichkeit nennt ihre Indikatoren (erfüllt/offen) und die Auslöser.
 *
 * Bewertung:
 * - jeder Indikator hat ein Gewicht (`COA_WEIGHTS`, 0–1 = Aussagekraft allein). `score` = 1 − Π(1 − Gewicht) über die
 *   erfüllten Indikatoren (unabhängige Hinweise verstärken sich, ohne 1 zu erreichen);
 * - eine Möglichkeit erscheint nur, wenn mindestens `MIN_MET` Indikatoren erfüllt sind und einer davon ein
 *   Schlüssel-Indikator ihrer Art ist (z. B. Überfall: Stao aufgeklärt oder Schwergewicht nahe) – kein Lärm;
 * - Auswahl: wahrscheinlichste = höchster `score`; gefährlichste = unter den übrigen (≥ `MIN_MET` erfüllt,
 *   `score` ≥ `DANGER_MIN_SCORE`) die höchste Gefährlichkeit (`COA_DANGER`), nur wenn gefährlicher als die
 *   wahrscheinlichste; weitere = nächsthöchster `score`, möglichst andere Art.
 * Hinweise zählen, solange sie offen sind oder höchstens `RECENT_MIN` vorbei (Übergaben `HANDOVER_MIN`).
 * IDs stabil: Art + Ziel (eigenes Element, NAI, erste Meldung der Sperren, Pendel-Hinweis).
 */
import { areaCenter } from "./journal";
import { angleDiff, bearing, centroid, dist, distToRing } from "./hintgeo";
import type { Hint } from "./hints";
import type { LV95 } from "./lv95";
import type { Area, Exercise } from "./model";
import { MIN_MS, durShort, hmOf, isoOfMs, lageMs, nk, placeLabel, prepareRed, type PEv } from "./redprep";

export type CoaKind = "ueberfall" | "hinterhalt" | "sperren" | "versorgung" | "aufklaerung" | "infiltration" | "absetzen";

export interface CoaIndicator {
  /** z. B. «Drohne über H05 02:50 (D1)» */
  text: string;
  met: boolean;
  /** Hinweis, der den Indikator erfüllt */
  hintId?: string;
  /** Meldungen, die den Indikator erfüllen */
  events?: string[];
  /** Hinweis-Regel bzw. Kurzname des Indikators, z. B. «D1», «still» */
  rule?: string;
  /** Gewicht (Aussagekraft) des Indikators, 0–1 */
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
  /** erwarteter Zeitraum (ISO) */
  window?: { from: string; to: string };
  indicators: CoaIndicator[];
  /** 0–1: Gewicht der erfüllten Indikatoren (siehe Kopf der Datei) */
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
}

/** Gewichte der Indikatoren je Art (Aussagekraft allein, 0–1) */
export const COA_WEIGHTS = {
  ueberfall: { aufgeklaert: 0.35, nahe_rot_stao: 0.3, schwergewicht: 0.35, formation: 0.3, still: 0.1, annaeherung: 0.4 },
  hinterhalt: { hindernis_engnis: 0.45, hindernis: 0.3, aufklaerung: 0.3, rot_stellung: 0.25, luecke: 0.25 },
  sperren: { mehrere: 0.3, ied: 0.15, eigene_nahe: 0.15, rot_sichert: 0.15, feuer: 0.2 },
  versorgung: { pendel: 0.4, uebergabe: 0.3, rot_stao: 0.2, halt: 0.15 },
  aufklaerung: { c3: 0.35, d1: 0.35, drohne: 0.2, beobachter: 0.25 },
  infiltration: { luecke: 0.4, ruhe: 0.25, rot_nahe: 0.3, ausweichen: 0.2 },
  absetzen: { abnahme: 0.35, weg: 0.35, kolonne: 0.2, ruhe: 0.2 },
} as const;

/** Gefährlichkeit je Art (0–1): Überraschung und mögliche Verluste für die eigenen Elemente */
export const COA_DANGER: Record<CoaKind, number> = {
  hinterhalt: 1, ueberfall: 0.9, infiltration: 0.7, sperren: 0.5, aufklaerung: 0.4, versorgung: 0.3, absetzen: 0.2,
};

/** Schwellen (Zeiten in Minuten, Abstände in m, Tempo in km/h) */
export const COA_THRESHOLDS = {
  MIN_MET: 2,
  DANGER_MIN_SCORE: 0.3,
  /** Hinweise zählen bis so lange nach ihrem Ende */
  RECENT_MIN: 60,
  /** Übergabe/Umladen (C1) zählt für Versorgung so lange */
  HANDOVER_MIN: 240,
  /** Aufklärung (C3) zählt für Hinterhalt/Aufklärung so lange nach ihrem Ende */
  RECON_MIN: 120,
  /** Überfall: Schwergewicht höchstens so weit vom Stao; Formation Linie/Y; Annäherung */
  SCHWERGEWICHT_M: 1500,
  FORMATION_M: 3500,
  APPROACH_M: 3000,
  APPROACH_MIN: 60,
  APPROACH_DEG: 45,
  /** eigenes Element gilt als «nicht verschoben» nach … am gleichen Ort (± `MOVED_M`) */
  STILL_MIN: 120,
  MOVED_M: 200,
  /** Hinterhalt: Rot in Stellung/Halt höchstens so weit vom Engnis, innert … */
  STELLUNG_M: 1000,
  STELLUNG_MIN: 180,
  RECON_NEAR_M: 1000,
  /** Sperren: Hindernisse innert … zusammenfassen (Kette), so lange zurück */
  SPERREN_M: 1500,
  SPERREN_MIN: 180,
  EIGENE_NAHE_M: 1000,
  ROT_SICHERT_M: 1000,
  FEUER_M: 2000,
  /** Versorgung: Rot-Stao bzw. Halt so nahe an einem Pendel-Ende */
  PENDEL_END_M: 1500,
  /** Absetzen: Abnahme der Rot-Meldungen (Stunde davor mindestens …, jetzt höchstens die Hälfte) */
  DROP_MIN_EVENTS: 4,
  /** Zeitraum: Vorbereitung nach dem letzten Indikator (von–bis), Tempo zu Fuss bzw. mit Fz (langsam–schnell) */
  PREP_MIN: 10,
  PREP_MAX: 50,
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
const PRESENCE_RE = /(?<!\p{L})(?:pat|patr|patrouille|patrouilliert|präsenz|kontrolle|kontrolliert|durchsuchung|durchsucht)(?!\p{L})/iu;
const EXCURSION_SYMS = new Set(["patrouille", "durchsuchung", "kontrollposten", "verkehrsposten"]);

interface Ind extends CoaIndicator {
  weight: number;
  key?: boolean;
  /** Zeitpunkt des Auslösers (für den Zeitraum) */
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
  ind: Ind[];
  check: string[];
}

interface Own { name: string; pos: LV95; cell: string; since?: number; last: PEv }

interface Ctx {
  ex: Exercise;
  tMs: number;
  evs: PEv[];
  byId: Map<string, PEv>;
  hints: Hint[];
  own: Own[];
  nais: Area[];
  cell: (p: LV95 | undefined, fb?: string) => string;
}

const hms = (h: Hint, f: "t" | "last" = "t") => Date.parse((f === "last" ? h.last : undefined) ?? h.t);
/** Hinweis gilt zur Lagezeit (offen oder höchstens `recentMin` vorbei) */
const active = (c: Ctx, h: Hint, recentMin: number = T.RECENT_MIN) =>
  hms(h) <= c.tMs && (!h.until || Date.parse(h.until) > c.tMs - recentMin * MIN_MS);
const evsOf = (c: Ctx, h: Hint) => h.events.map((id) => c.byId.get(id)).filter((v): v is PEv => !!v);
const uniq = <X>(xs: X[]) => [...new Set(xs)];
const floor5 = (ms: number) => Math.floor(ms / (5 * MIN_MS)) * 5 * MIN_MS;
const ceil5 = (ms: number) => Math.ceil(ms / (5 * MIN_MS)) * 5 * MIN_MS;
const ind = (text: string, met: boolean, weight: number, x: Partial<Ind> = {}): Ind => {
  const i: Ind = { text, met, weight, ...x };
  for (const k of Object.keys(i) as Array<keyof Ind>) if (i[k] === undefined) delete i[k];
  return i;
};
const fromHint = (h: Hint, c: Ctx) => ({ hintId: h.id, events: [...h.events], rule: h.rule, ms: Math.max(...evsOf(c, h).map((v) => v.ms), hms(h)) });

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

// ---------------------------------------------------------------------------------------------
// Katalog der Möglichkeiten
// ---------------------------------------------------------------------------------------------
function ueberfall(c: Ctx): Cand[] {
  const out: Cand[] = [];
  const w = W.ueberfall;
  for (const o of c.own) {
    const P = o.pos;
    const ind1 = (() => {
      const d1 = c.hints.find((h) => h.rule === "D1" && h.unit === o.name && active(c, h));
      if (d1) {
        const r = evsOf(c, d1).filter((v) => v.side === "rot");
        return ind(`${spotterText(r)} über ${o.name} ${hmOf(r[0]?.ms ?? hms(d1))} (D1)`, true, w.aufgeklaert, { ...fromHint(d1, c), key: true });
      }
      const d2 = c.hints.find((h) => h.rule === "D2" && h.unit === o.name && active(c, h));
      if (d2) {
        const r = evsOf(c, d2).find((v) => v.side === "rot" && v.e.unit);
        return ind(`Rot-Stao ${r ? `${r.e.unit} ` : ""}neben ${o.name} (D2)`, true, w.nahe_rot_stao, { ...fromHint(d2, c), key: true });
      }
      return ind(`Stao ${o.name} aufgeklärt – nicht gemeldet`, false, w.aufgeklaert, { key: true, rule: "D1" });
    })();
    const c4 = c.hints.filter((h) => h.rule === "C4" && active(c, h) && h.pos && dist(h.pos, P) <= T.SCHWERGEWICHT_M)
      .sort((a, b) => dist(a.pos!, P) - dist(b.pos!, P))[0];
    const c4evs = c4 ? evsOf(c, c4) : [];
    const ind2 = c4
      ? ind(`Schwergewicht ${forceText(c4evs)} ${c4.cells?.[0] ?? c.cell(c4.pos)} ${hmOf(hms(c4))} (C4)`, true, w.schwergewicht, { ...fromHint(c4, c), key: true })
      : ind(`Schwergewicht Rot nahe ${o.name} – nicht gemeldet`, false, w.schwergewicht, { key: true, rule: "C4" });
    const c6 = c.hints.filter((h) => h.rule === "C6" && active(c, h) && h.pos && /Formation (Linie|Y)\b/.test(h.title) && dist(h.pos, P) <= T.FORMATION_M)
      .sort((a, b) => hms(b) - hms(a))[0];
    const ind3 = c6
      ? ind(`Formation ${/Formation (\S+)/.exec(c6.title)![1]} ${c6.cells?.[0] ?? c.cell(c6.pos)} ${hmOf(hms(c6))} (C6)`, true, w.formation, fromHint(c6, c))
      : ind("Formation Linie/Y (Kontakt erwartet) – nicht gemeldet", false, w.formation, { rule: "C6" });
    const stillMin = o.since !== undefined ? (c.tMs - o.since) / MIN_MS : 0;
    const ind4 = o.since !== undefined && stillMin >= T.STILL_MIN
      ? ind(`${o.name} nicht verschoben seit ${hmOf(o.since)}`, true, w.still, { events: [o.last.id], rule: "still" })
      : ind(`${o.name} ${o.since !== undefined ? `erst seit ${hmOf(o.since)} am Ort` : "unterwegs"}`, false, w.still, { rule: "still" });
    // Ausgangsraum: Schwergewicht, sonst letzte Rot-Häufung in der Nähe
    const recent = c.evs.filter((v) => v.feind && v.pos && v.precise && v.ms >= c.tMs - 120 * MIN_MS && dist(v.pos, P) <= T.APPROACH_M && dist(v.pos, P) > 250);
    const startEvs = c4evs.length ? c4evs : recent.length ? [recent[recent.length - 1]!] : [];
    const start = c4?.pos ?? centroid(startEvs.filter((v) => v.pos).map((v) => v.pos!));
    // Annäherung: Rot bewegt sich auf den Stao zu
    const appr = c.evs.filter((v) => v.feind && v.pos && v.precise && v.e.dir !== undefined && v.ms >= c.tMs - T.APPROACH_MIN * MIN_MS &&
      dist(v.pos, P) <= T.APPROACH_M && dist(v.pos, P) > 250 && angleDiff(v.e.dir, bearing(v.pos, P)) <= T.APPROACH_DEG);
    const startCell = start ? c.cell(start) : "";
    const ind5 = appr.length
      ? ind(`Annäherung ${forceText(appr)} ${c.cell(appr[appr.length - 1]!.pos)} → ${o.cell} ${hmOf(appr[appr.length - 1]!.ms)}`, true, w.annaeherung, { events: appr.map((v) => v.id), rule: "annaeherung", ms: appr[appr.length - 1]!.ms })
      : ind(`Annäherung auf Achse ${startCell ? `${startCell} → ` : ""}${o.cell} noch nicht gemeldet`, false, w.annaeherung, { rule: "annaeherung" });
    const inds = [ind1, ind2, ind3, ind4, ind5];
    const cand: Cand = {
      kind: "ueberfall", key: o.name, title: `Überfall auf Stao ${o.name} (${o.cell})`,
      target: { pos: P, unit: o.name, cell: o.cell }, ind: inds,
      check: [`Stellungswechsel ${o.name}`, `Achse ${startCell ? `${startCell}–` : ""}${o.cell} beobachten`, "Reserve bereit"],
    };
    if (start && dist(start, P) > 100) {
      cand.approach = [start, P];
      const road = [...startEvs, ...appr].map((v) => v.road).find(Boolean)
        ?? c.evs.filter((v) => v.feind && v.road && v.pos && v.ms >= c.tMs - 180 * MIN_MS && dist(v.pos, start) <= 600).map((v) => v.road).pop();
      cand.approachText = `aus ${startCell}${road ? ` über ${road}` : ""}`;
      const foot = (c4evs.length ? c4evs : startEvs).some((v) => v.persLo > 0) || !(c4evs.length ? c4evs : startEvs).some((v) => v.fz > 0);
      cand.window = windowFor(c, inds, dist(start, P), foot ? T.FOOT_KMH : T.FZ_KMH);
    }
    out.push(cand);
  }
  return out;
}

/** Zeitraum ab letztem erfüllten Rot-Indikator: Vorbereitung + Weg (schnell–langsam), auf 5 Min gerundet */
function windowFor(c: Ctx, inds: Ind[], d: number, kmh: readonly [number, number]): RedCoa["window"] {
  const ms = inds.filter((i) => i.met && i.ms !== undefined).map((i) => i.ms!);
  const base = ms.length ? Math.max(...ms) : c.tMs;
  const fast = (d / 1000 / kmh[1]) * 60, slow = (d / 1000 / kmh[0]) * 60;
  const from = Math.max(floor5(c.tMs), floor5(base + (T.PREP_MIN + fast) * MIN_MS));
  const to = Math.max(from + 30 * MIN_MS, ceil5(base + (T.PREP_MAX + slow) * MIN_MS));
  return { from: isoOfMs(from), to: isoOfMs(to) };
}

function hinterhalt(c: Ctx): Cand[] {
  const out: Cand[] = [];
  const w = W.hinterhalt;
  const c5s = c.hints.filter((h) => h.rule === "C5" && active(c, h));
  type Tgt = { key: string; label: string; pos: LV95; ring?: LV95[]; area?: Area; c5?: Hint; engnis: boolean };
  const targets: Tgt[] = [];
  for (const a of c.nais.filter((x) => x.typ === "engnis")) {
    const h = c5s.find((x) => x.nai === a.name || (x.pos && distToRing(x.pos, a.ring) <= 300));
    targets.push({ key: a.name, label: a.name, pos: areaCenter(a), ring: a.ring, area: a, c5: h, engnis: true });
  }
  for (const h of c5s) {
    if (!h.pos || targets.some((t) => t.c5 === h)) continue;
    const cell = h.cells?.[0] ?? c.cell(h.pos);
    targets.push({ key: cell, label: cell, pos: h.pos, c5: h, engnis: false });
  }
  for (const tg of targets) {
    const near = (p: LV95 | undefined, m: number) => !!p && (tg.ring ? distToRing(p, tg.ring) <= m : dist(p, tg.pos) <= m);
    const c5e = tg.c5 ? evsOf(c, tg.c5) : [];
    const what = c5e[0]?.cat?.noun ?? c5e[0]?.cat?.name ?? "Hindernis";
    const i1 = tg.c5
      ? ind(`${what} ${tg.label} ${hmOf(hms(tg.c5))} (C5)`, true, tg.engnis ? w.hindernis_engnis : w.hindernis, { ...fromHint(tg.c5, c), key: true })
      : ind(`Hindernis/Halt im Engnis ${tg.label} – nicht gemeldet`, false, w.hindernis_engnis, { key: true, rule: "C5" });
    const c3 = c.hints.filter((h) => h.rule === "C3" && active(c, h, T.RECON_MIN) &&
      (evsOf(c, h).some((v) => (tg.area && v.nais.includes(tg.area.name)) || near(v.pos, T.RECON_NEAR_M)))).sort((a, b) => hms(b) - hms(a))[0];
    const i2 = c3
      ? ind(`Aufklärung ${tg.label} ${c3.events.length}× (C3)`, true, w.aufklaerung, fromHint(c3, c))
      : ind(`Aufklärung ${tg.label} – nicht gemeldet`, false, w.aufklaerung, { rule: "C3" });
    const st = c.evs.filter((v) => v.feind && v.pos && v.precise && v.ms >= c.tMs - T.STELLUNG_MIN * MIN_MS && near(v.pos, T.STELLUNG_M) &&
      (STAO_SYMS.has(v.e.sym) || STAO_RE.test(v.e.text) || (v.halt && (v.persLo > 0 || v.fz > 0))) && !c5e.includes(v));
    const s0 = st[st.length - 1];
    const i3 = s0
      ? ind(`${s0.e.unit || forceText([s0])} in Stellung ${c.cell(s0.pos)} ${hmOf(s0.ms)}`, true, w.rot_stellung, { events: st.map((v) => v.id), rule: "stellung", ms: s0.ms })
      : ind(`Rot in Stellung nahe ${tg.label} – nicht gemeldet`, false, w.rot_stellung, { rule: "stellung" });
    const d3 = tg.area ? c.hints.find((h) => h.rule === "D3" && h.nai === tg.area!.name && active(c, h, 0)) : undefined;
    const i4 = d3
      ? ind(`Lücke in der Überwachung ${tg.label} (D3)`, true, w.luecke, fromHint(d3, c))
      : ind(`Lücke in der Überwachung ${tg.label}${tg.area?.trupp ? ` (${tg.area.trupp})` : ""} – keine`, false, w.luecke, { rule: "D3" });
    const trupp = tg.area?.trupp;
    out.push({
      kind: "hinterhalt", key: tg.key,
      title: tg.engnis ? `Hinterhalt an Engnis ${tg.label} auf eigene Verschiebung` : `Hinterhalt an Strasse ${tg.label} auf eigene Verschiebung`,
      target: { pos: tg.c5?.pos && !tg.engnis ? tg.c5.pos : tg.pos, cell: c.cell(tg.pos), nai: tg.area?.name },
      ind: [i1, i2, i3, i4],
      check: [`Verschiebungen nicht über ${tg.label}`, `${tg.label} überwachen${trupp ? ` (${trupp})` : ""}`, "Umgehung erkunden"],
    });
  }
  return out;
}

function sperren(c: Ctx): Cand[] {
  const w = W.sperren;
  const obst = c.evs.filter((v) => v.feind && v.pos && v.ms >= c.tMs - T.SPERREN_MIN * MIN_MS && (v.cat?.category === "Hindernisse" || OBSTACLE_IED.has(v.e.sym)));
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
      ? ind(`${g.length} Sperren/Hindernisse ${cells.join(", ")} seit ${hmOf(g[0]!.ms)}`, true, w.mehrere, { events: g.map((v) => v.id), key: true, rule: "sperren", ms: g[g.length - 1]!.ms })
      : ind(`weitere Sperre im Raum ${label} – nicht gemeldet`, false, w.mehrere, { key: true, rule: "sperren" });
    const ied = g.filter((v) => OBSTACLE_IED.has(v.e.sym));
    const i2 = ied.length
      ? ind(`${ied[0]!.cat?.noun ?? "IED"} ${c.cell(ied[0]!.pos)} ${hmOf(ied[0]!.ms)}`, true, w.ied, { events: ied.map((v) => v.id), rule: "ied", ms: ied[0]!.ms })
      : ind("IED/Minen – nicht gemeldet", false, w.ied, { rule: "ied" });
    const own = c.own.map((o) => ({ o, d: Math.min(...g.map((v) => dist(v.pos!, o.pos))) })).filter((x) => x.d <= T.EIGENE_NAHE_M).sort((a, b) => a.d - b.d)[0];
    const i3 = own
      ? ind(`Sperre ca. ${Math.round(own.d / 100) * 100} m von ${own.o.name}`, true, w.eigene_nahe, { events: [own.o.last.id], rule: "eigene" })
      : ind("Sperre nahe eigenem Element – keine", false, w.eigene_nahe, { rule: "eigene" });
    const guard = c.evs.filter((v) => v.feind && v.pos && (v.persLo > 0 || v.fz > 0) && !g.includes(v) &&
      g.some((x) => Math.abs(x.ms - v.ms) <= 60 * MIN_MS && dist(x.pos!, v.pos!) <= T.ROT_SICHERT_M));
    const i4 = guard.length
      ? ind(`Rot bei Sperre: ${forceText(guard)} ${c.cell(guard[guard.length - 1]!.pos)} ${hmOf(guard[guard.length - 1]!.ms)}`, true, w.rot_sichert, { events: guard.map((v) => v.id), rule: "sichert", ms: guard[guard.length - 1]!.ms })
      : ind("Rot sichert Sperre – nicht gemeldet", false, w.rot_sichert, { rule: "sichert" });
    const fire = c.evs.filter((v) => v.feind && v.pos && FIRE_SYMS.has(v.e.sym) && v.ms >= c.tMs - T.SPERREN_MIN * MIN_MS && g.some((x) => dist(x.pos!, v.pos!) <= T.FEUER_M));
    const i5 = fire.length
      ? ind(`Feuerunterstützung ${fire[fire.length - 1]!.cat?.noun ?? fire[fire.length - 1]!.cat?.name ?? ""} ${c.cell(fire[fire.length - 1]!.pos)}`.replace(/\s+/g, " "), true, w.feuer, { events: fire.map((v) => v.id), rule: "feuer", ms: fire[fire.length - 1]!.ms })
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
  for (const p of c.hints.filter((h) => h.rule === "C2" && active(c, h, 0))) {
    const pe = evsOf(c, p).filter((v) => v.pos);
    if (pe.length < 2) continue;
    // Pendel-Enden: Orte der Durchfahrten (erste Meldung = Ende A, am weitesten entfernte = Ende B)
    const a = pe[0]!;
    const b = pe.reduce((m, v) => (dist(v.pos!, a.pos!) > dist(m.pos!, a.pos!) ? v : m), pe[0]!);
    const lab = (v: PEv) => v.nais[0] ?? c.cell(v.pos);
    const ends = [{ v: a, l: lab(a) }, { v: b, l: lab(b) }].sort((x, y) => x.l.localeCompare(y.l, "de", { numeric: true }));
    const nearEnd = (q: LV95 | undefined, m: number) => !!q && ends.some((e) => dist(e.v.pos!, q) <= m);
    const nx = p.next ? Date.parse(p.next) : undefined;
    // Prognose nur, solange die nächste Durchfahrt nicht überfällig ist
    const next = nx !== undefined && nx >= c.tMs ? nx : undefined;
    const late = nx !== undefined && nx < c.tMs ? `, seit ${hmOf(nx)} überfällig` : "";
    const i1 = ind(`Pendel ${p.title.replace(/^Pendelverkehr\s+/, "").replace(/ zwischen .*$/, "")} ${ends[0]!.l} ↔ ${ends[1]!.l}, ${pe.length} Meldungen${next ? `, nächste ca. ${hmOf(next)}` : late} (C2)`,
      true, w.pendel, { ...fromHint(p, c), key: true });
    const ho = handovers.filter((h) => nearEnd(h.pos, T.PENDEL_END_M)).sort((x, y) => hms(y) - hms(x))[0];
    const i2 = ho
      ? ind(`${/Übergabe/.test(ho.title) ? "Übergabe" : "Umsteigen/Halt"} ${ho.cells?.[0] ?? c.cell(ho.pos)} ${hmOf(hms(ho))} (C1)`, true, w.uebergabe, { ...fromHint(ho, c), key: true })
      : ind("Übergabe/Umladen – nicht gemeldet", false, w.uebergabe, { key: true, rule: "C1" });
    const st = staos.filter((v) => nearEnd(v.pos, T.PENDEL_END_M));
    const s0 = st[st.length - 1];
    const i3 = s0
      ? ind(`Rot-Stao ${s0.e.unit ? `${s0.e.unit} ` : ""}${c.cell(s0.pos)} am Pendel-Ende`, true, w.rot_stao, { events: st.map((v) => v.id), rule: "stao", ms: s0.ms })
      : ind("Rot-Stao/Lager am Pendel-Ende – nicht gemeldet", false, w.rot_stao, { rule: "stao" });
    const halts = c.evs.filter((v) => v.side === "rot" && v.pos && v.halt && v.isFz && v.ms >= c.tMs - 120 * MIN_MS && nearEnd(v.pos, 500));
    const i4 = halts.length
      ? ind(`Fz-Halt am Pendel-Ende ${c.cell(halts[halts.length - 1]!.pos)} ${hmOf(halts[halts.length - 1]!.ms)}`, true, w.halt, { events: halts.map((v) => v.id), rule: "halt", ms: halts[halts.length - 1]!.ms })
      : ind("Kurzhalt am Pendel-Ende – nicht gemeldet", false, w.halt, { rule: "halt" });
    const tEnd = s0 ? ends.reduce((m, e) => (dist(e.v.pos!, s0.pos!) < dist(m.v.pos!, s0.pos!) ? e : m)) : ends[1]!;
    const cand: Cand = {
      kind: "versorgung", key: p.id,
      title: `Versorgung/Übergabe Pendel ${ends[0]!.l} ↔ ${ends[1]!.l}${next ? ` (nächste ca. ${hmOf(next)})` : ""}`,
      target: { pos: tEnd.v.pos!, cell: tEnd.l.startsWith("NAI") ? c.cell(tEnd.v.pos) : tEnd.l, nai: tEnd.v.nais[0] },
      approach: [ends[0]!.v.pos!, ends[1]!.v.pos!], approachText: `Pendel ${ends[0]!.l} ↔ ${ends[1]!.l}`,
      ind: [i1, i2, i3, i4],
      check: [next ? `Durchfahrt ca. ${hmOf(next)} beobachten` : "nächste Durchfahrt beobachten", `Übergabeort ${tEnd.l} überwachen`, "Merkmale/Kennzeichen melden"],
    };
    out.push(cand);
  }
  return out;
}

function aufklaerung(c: Ctx): Cand[] {
  const w = W.aufklaerung;
  const out: Cand[] = [];
  type Tgt = { key: string; label: string; pos: LV95; unit?: string; nai?: string; c3?: Hint; d1?: Hint };
  const tg: Tgt[] = [];
  for (const h of c.hints.filter((x) => x.rule === "D1" && active(c, x) && x.unit && x.pos)) tg.push({ key: h.unit!, label: `Stao ${h.unit}`, pos: h.pos!, unit: h.unit, d1: h });
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
    const i2 = d1 ? ind(`${spotterText(evsOf(c, d1).filter((v) => v.side === "rot"))} beim Stao ${t.unit} (D1)`, true, w.d1, { ...fromHint(d1, c), key: true })
      : ind("eigener Stao aufgeklärt – nicht gemeldet", false, w.d1, { key: true, rule: "D1" });
    const dr = c.evs.filter((v) => v.side === "rot" && v.isDrone && v.ms >= c.tMs - 120 * MIN_MS && v.pos && dist(v.pos, t.pos) <= T.RECON_NEAR_M);
    const i3 = dr.length ? ind(`Drohne ${dr.length}× in den letzten 2 h`, true, w.drohne, { events: dr.map((v) => v.id), rule: "drohne", ms: dr[dr.length - 1]!.ms })
      : ind("Drohne in den letzten 2 h – keine", false, w.drohne, { rule: "drohne" });
    const ob = c.evs.filter((v) => v.side === "rot" && SPOT_RE.test(v.e.text) && v.ms >= c.tMs - 120 * MIN_MS && v.pos && dist(v.pos, t.pos) <= T.RECON_NEAR_M);
    const i4 = ob.length ? ind(`Beobachter ${c.cell(ob[ob.length - 1]!.pos)} ${hmOf(ob[ob.length - 1]!.ms)}`, true, w.beobachter, { events: ob.map((v) => v.id), rule: "beobachter", ms: ob[ob.length - 1]!.ms })
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
    const i1 = d3 ? ind(`${a.name} nicht überwacht (D3)`, true, w.luecke, { ...fromHint(d3, c), key: true })
      : ind(`Lücke in der Überwachung ${a.name} – keine`, false, w.luecke, { key: true, rule: "D3" });
    const a3 = c.hints.find((h) => h.rule === "A3" && h.nai === a.name && active(c, h, 0)) ??
      c.hints.find((h) => h.rule === "A3" && active(c, h, 0) && h.title.includes(a.name));
    const i2 = a3 ? ind(`Auffällige Ruhe ${a.name} (A3)`, true, w.ruhe, fromHint(a3, c)) : ind(`Ruhe in ${a.name} – keine`, false, w.ruhe, { rule: "A3" });
    const near = c.evs.filter((v) => v.side === "rot" && v.pos && v.precise && v.ms >= c.tMs - 60 * MIN_MS && distToRing(v.pos, a.ring) <= 1000);
    const i3 = near.length ? ind(`Rot nahe ${a.name}: ${forceText(near)} ${hmOf(near[near.length - 1]!.ms)}`, true, w.rot_nahe, { events: near.map((v) => v.id), rule: "nahe", ms: near[near.length - 1]!.ms })
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
  const rot = c.evs.filter((v) => v.side === "rot");
  const now = rot.filter((v) => v.ms > c.tMs - 60 * MIN_MS).length;
  const before = rot.filter((v) => v.ms > c.tMs - 120 * MIN_MS && v.ms <= c.tMs - 60 * MIN_MS).length;
  const i1 = before >= T.DROP_MIN_EVENTS && now <= before / 2
    ? ind(`Abnahme Rot-Meldungen: ${now} statt ${before} je Stunde`, true, w.abnahme, { key: true, rule: "abnahme" })
    : ind("Abnahme der Rot-Meldungen – keine", false, w.abnahme, { key: true, rule: "abnahme" });
  const away = rot.filter((v) => v.feind && v.pos && v.precise && v.e.dir !== undefined && v.ms > c.tMs - 60 * MIN_MS).filter((v) => {
    const o = c.own.reduce<Own | undefined>((m, x) => (!m || dist(x.pos, v.pos!) < dist(m.pos, v.pos!) ? x : m), undefined);
    return o && dist(o.pos, v.pos!) <= 3000 && angleDiff(v.e.dir!, bearing(o.pos, v.pos!)) <= 45;
  });
  const sectors = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
  const dirTxt = away.length ? sectors[Math.round((((away[away.length - 1]!.e.dir! % 360) + 360) % 360) / 45) % 8] : "";
  const i2 = away.length >= 2
    ? ind(`Rot entfernt sich: ${forceText(away)} Rtg ${dirTxt}`, true, w.weg, { events: away.map((v) => v.id), key: true, rule: "weg", ms: away[away.length - 1]!.ms })
    : ind("Rot entfernt sich von eigenen Elementen – nicht gemeldet", false, w.weg, { key: true, rule: "weg" });
  const kol = c.hints.find((h) => h.rule === "C6" && active(c, h) && /Kolonne/.test(h.title));
  const i3 = kol ? ind(`${kol.title} (C6)`, true, w.kolonne, fromHint(kol, c)) : ind("Kolonne (Verschiebung) – nicht gemeldet", false, w.kolonne, { rule: "C6" });
  const a3 = c.hints.find((h) => h.rule === "A3" && active(c, h, 0));
  const i4 = a3 ? ind(`${a3.title} (A3)`, true, w.ruhe, fromHint(a3, c)) : ind("Auffällige Ruhe – keine", false, w.ruhe, { rule: "A3" });
  const pos = centroid(away.map((v) => v.pos!)) ?? centroid(rot.filter((v) => v.pos).slice(-5).map((v) => v.pos!));
  if (!pos) return [];
  return [{
    kind: "absetzen", key: "rot", title: `Absetzen/Ausweichen von Rot${dirTxt ? ` Rtg ${dirTxt}` : ""}`,
    target: { pos, cell: c.cell(pos) }, ind: [i1, i2, i3, i4],
    check: ["Kontakt halten (Beobachtung nachführen)", `Ausweichachse${dirTxt ? ` Rtg ${dirTxt}` : ""} überwachen`, "Lage an Vorgesetzte melden"],
  }];
}

// ---------------------------------------------------------------------------------------------
// Auswahl
// ---------------------------------------------------------------------------------------------
function finish(c: Cand): Omit<RedCoa, "label"> {
  const met = c.ind.filter((i) => i.met);
  const score = 1 - met.reduce((p, i) => p * (1 - i.weight), 1);
  const events = uniq(met.flatMap((i) => i.events ?? []));
  const r: Omit<RedCoa, "label"> = {
    id: `${c.kind}:${c.key}`, kind: c.kind, title: c.title, target: c.target,
    indicators: c.ind.map(({ key: _k, ms: _m, ...i }) => i),
    score: Math.round(score * 1000) / 1000, danger: COA_DANGER[c.kind], check: c.check, events,
  };
  if (r.target) for (const k of Object.keys(r.target) as Array<keyof NonNullable<RedCoa["target"]>>) if (r.target[k] === undefined) delete r.target[k];
  if (c.approach) r.approach = c.approach;
  if (c.approachText) r.approachText = c.approachText;
  if (c.window) r.window = c.window;
  return r;
}

const qualifies = (c: Cand) => {
  const met = c.ind.filter((i) => i.met);
  return met.length >= T.MIN_MET && met.some((i) => i.key);
};

/** Alle Möglichkeiten mit genügend Indikatoren (ohne Auswahl), höchster `score` zuerst – für Tests und Auswertung */
export function allRedCoas(ex: Exercise, o: CoaOptions): Array<Omit<RedCoa, "label">> {
  const tMs = lageMs(ex, o.t);
  const evs = prepareRed(ex, tMs);
  if (!evs.length) return [];
  const sheets = ex.sheets ?? [];
  const c: Ctx = {
    ex, tMs, evs, byId: new Map(evs.map((v) => [v.id, v])), hints: o.hints.filter((h) => Date.parse(h.t) <= tMs), own: [],
    nais: (ex.areas ?? []).filter((a) => a.kind === "nai"), cell: (p, fb = "") => placeLabel(sheets, p, fb),
  };
  c.own = ownUnits(c);
  const cands: Cand[] = [];
  for (const fn of [ueberfall, hinterhalt, sperren, versorgung, aufklaerung, infiltration, absetzen]) {
    try {
      cands.push(...fn(c).filter(qualifies));
    } catch {
      // eine fehlerhafte Möglichkeit darf die Lage nie stören
    }
  }
  return cands.map(finish).sort((a, b) => b.score - a.score || b.danger - a.danger || a.id.localeCompare(b.id));
}

/** Höchstens drei Möglichkeiten: wahrscheinlichste, gefährlichste (falls verschieden), eine weitere */
export function computeRedCoas(ex: Exercise, o: CoaOptions): RedCoa[] {
  const all = allRedCoas(ex, o);
  if (!all.length) return [];
  const out: RedCoa[] = [{ ...all[0]!, label: "wahrscheinlichste" }];
  const rest = all.slice(1);
  const danger = rest.filter((x) => x.score >= T.DANGER_MIN_SCORE && x.danger > all[0]!.danger)
    .sort((a, b) => b.danger - a.danger || b.score - a.score)[0];
  if (danger) out.push({ ...danger, label: "gefaehrlichste" });
  const used = new Set(out.map((x) => x.id));
  const kinds = new Set(out.map((x) => x.kind));
  const left = rest.filter((x) => !used.has(x.id));
  const other = left.find((x) => !kinds.has(x.kind)) ?? left[0];
  if (other) out.push({ ...other, label: "weitere" });
  return out;
}

/** Kurztext Dauer (für Anzeigen «nicht mehr gesehen»), z. B. «4 h 15′» */
export const formatSince = durShort;
