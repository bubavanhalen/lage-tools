/**
 * Auswertung der Sätze (Spez. MVP 3.5, Kap. 8.3): je Satz `parseMeldung` → `entryState` → bei Gelb zweites Enter (Entwurf
 * wie im Feld) → `eventFromDraft` → Zeichen und Standorte aus `situationAt`. Bildet den Eintrage-Weg des Meldungsfelds
 * nach (ui/src/commit.ts `journalCtx`/`addEvents`, ui/src/entry/stateOptions.ts `entryOptions`) – ohne Browser.
 * Änderungen am Eintrage-Weg der UI (Paket E, z. B. «zweites Enter bei trupp-neu ohne Melder») hier nachziehen.
 */
import {
  LIVE_TOLERANZ_MIN, addMinuten, artOf, cellAtAny, clockDay, demoExercise, entryState, eventFromDraft, jetztLagezeit, lastPosition, nextNr,
  nrLabel, onlineAllowed, parseMeldung, situationAt, zeitMax, type Draft, type EntryStateOptions, type Exercise, type JournalContext, type LageEvent,
} from "../../src";
import type { SatzFall, SatzSoll } from "./saetze35";

export const ZONE = "Europe/Zurich";

/** Inhalt einer Lesung (Vorschau-Entwurf bzw. eingetragener Eintrag), nur gesetzte Werte */
export interface SatzInhalt {
  art: string;
  seite?: "feind" | "eigen" | "unklar";
  /** «Zeichenschlüssel Beschreibung» */
  gesehen: string;
  anzahl?: number;
  ort: string | null;
  orte?: string[];
  melder: string | null;
  dringend?: true;
  begehren?: true;
  an?: string;
  quelle?: string;
  frist?: string;
  bezugArt?: string;
  bezugNr?: string;
  dir?: number;
  from?: number;
  teile?: true;
  abschluss?: true;
  vbk?: string;
  zeit: string;
  tOffset?: string;
}

export interface SatzErgebnis {
  stufe: string;
  gruende: string[];
  vorschlag: string | null;
  vorschau: SatzInhalt;
  /** null = nicht eingetragen («geht nicht») */
  eingetragen: SatzInhalt | null;
  zeichenNeu: number;
  /** Trupps, die sich bewegt haben: Trupp → Planquadrat */
  truppNach: Record<string, string>;
  /** neu in `units.blau` */
  blauNeu: string[];
}

const ohneLeere = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== false && !(Array.isArray(v) && !v.length))) as T;

/** Trupp-Knopf vor dem Tippen: Feld war leer → «H04 » + Text (ui/src/entry/trupp.ts `withTrupp`) */
const mitTrupp = (satz: string, trupp?: string) => (trupp ? `${trupp} ${satz}` : satz);

/** Kontext wie das Meldungsfeld beim Enter (commit.ts `journalCtx`, useEntryDraft `commitNew`) */
function ctxOf(ex: Exercise, now: Date): JournalContext {
  const events = ex.events ?? [];
  const clk = clockDay(ex.days, now);
  return {
    sheets: ex.sheets, areas: ex.areas, units: ex.units, places: ex.places ?? [], days: ex.days, day: clk.day, now, dayFromClock: clk.follow,
    lastPos: (u, s) => lastPosition(events, s, u), events, ex, zone: ZONE,
  };
}

/** Optionen wie stateOptions.ts `entryOptions` (Online-Ortssuche nur, wenn die Übung sie erlaubt – K2) */
function optsOf(ex: Exercise, now: Date): EntryStateOptions {
  let last: string | null = null;
  for (const e of ex.events ?? []) if (!e.deleted) last = last ? zeitMax(last, e.t) : e.t;
  const online = onlineAllowed(ex, "ortssuche");
  return {
    hasRaster: ex.sheets.length > 0, online, placePending: false, manualPos: false, hasPos: false, now, sheets: ex.sheets, areas: ex.areas,
    knownUnits: ex.units.blau, unitsPrepared: ex.units.blau.length > 0, days: ex.days, follow: clockDay(ex.days, now).follow, lastReport: last,
    ortsnamen: online ? "an" : "aus", zone: ZONE,
  };
}

/** eintragen wie `addEvents` (commit.ts): Tag ergänzen, Melder und Element merken */
function eintragen(ex: Exercise, ev: LageEvent): void {
  ex.events = [...(ex.events ?? []), ev];
  const day = ev.t.slice(0, 10);
  if (!ex.days.includes(day)) ex.days = [...ex.days, day].sort();
  const merke = (side: "rot" | "blau" | "ul", u?: string) => { if (u && !ex.units[side].some((v) => v.toLowerCase() === u.toLowerCase())) ex.units[side] = [...ex.units[side], u]; };
  merke("blau", ev.melder);
  merke(ev.side, ev.unit);
}

/** Lage zur Zeit LIVE (Geräteuhr + Toleranz, S22): Anzahl Zeichen, Planquadrat je eigener Trupp */
function lage(ex: Exercise, now: Date): { zeichen: number; blau: Map<string, string> } {
  // Lagezeit mit Offset (S23): in der doppelten Stunde eindeutig, sobald situationAt über zeitBis vergleicht (Paket C)
  const t = addMinuten(jetztLagezeit(now), LIVE_TOLERANZ_MIN, ZONE);
  const s = situationAt([...(ex.events ?? [])], t);
  const blau = new Map<string, string>();
  for (const u of s.units) if (u.side === "blau") blau.set(u.unit, cellAtAny(ex.sheets, u.pos)?.label ?? "?");
  return { zeichen: s.units.length + s.loose.length, blau };
}

const seiteOf = (e: Pick<LageEvent, "side" | "aff">): "feind" | "eigen" | "unklar" => (e.side === "blau" ? "eigen" : e.aff === "U" || e.aff === "N" ? "unklar" : "feind");

function ausEntwurf(d: Draft, ex: Exercise): SatzInhalt {
  const bezug = d.bezug ? (ex.events ?? []).find((e) => e.id === d.bezug) : undefined;
  return ohneLeere({
    art: d.art, seite: d.art === "meldung" ? d.kind : undefined, gesehen: `${d.sym} ${d.desc ?? ""}`.trim(), anzahl: d.count,
    ort: d.where?.label ?? d.cells?.[0] ?? d.nai ?? null, orte: d.orte, melder: d.melder || null,
    dringend: d.dringend || undefined, begehren: d.begehren ? true : undefined, an: d.an, quelle: d.quelle, frist: d.frist?.slice(11, 16),
    bezugArt: d.bezugArt, bezugNr: bezug ? nrLabel(bezug, ex) : d.bezugNr, dir: d.dir, from: d.from, teile: d.teile ? true : undefined,
    abschluss: d.abschluss ? true : undefined, vbk: d.vbk, zeit: d.t.slice(11, 16), tOffset: d.tOffset,
  }) as SatzInhalt;
}

function ausEintrag(e: LageEvent, ex: Exercise): SatzInhalt {
  const bezug = e.bezug ? (ex.events ?? []).find((x) => x.id === e.bezug) : undefined;
  const art = artOf(e);
  return ohneLeere({
    art, seite: art === "meldung" && !e.hebtAuf ? seiteOf(e) : undefined, gesehen: `${e.sym} ${e.desc ?? ""}`.trim(), anzahl: e.count,
    ort: e.where ?? e.cells?.[0] ?? e.nai ?? null, orte: e.orte, melder: e.melder || null,
    dringend: e.lvz?.dringend?.v ? true : undefined, begehren: e.begehren ? true : undefined, an: e.an, quelle: e.quelle, frist: e.frist?.slice(11, 16),
    bezugArt: e.bezugArt, bezugNr: bezug ? nrLabel(bezug, ex) : undefined, dir: e.dir, from: e.from, vbk: e.vbk, zeit: e.t.slice(11, 16), tOffset: e.tOffset,
  }) as SatzInhalt;
}

/** Beispiel Bern für einen Fall (eigene Übungstage bei Sommerzeit-Fällen) */
export function beispielFuer(f: Pick<SatzFall, "tage">): Exercise {
  const ex = demoExercise();
  if (f.tage) ex.days = [...f.tage];
  return ex;
}

/** einen Satz in `ex` eintragen (verändert `ex`) und auswerten */
export function auswerten(f: SatzFall, ex: Exercise): SatzErgebnis {
  const now = new Date(f.uhr);
  // Einträge davor: je 1 min vor der Uhr, ohne Prüfung eingetragen (wie getippt und mit Enter bestätigt)
  (f.vorher ?? []).forEach((v, i) => {
    const t0 = new Date(now.getTime() - ((f.vorher!.length - i) * 60000));
    const d0 = parseMeldung(v, ctxOf(ex, t0));
    eintragen(ex, eventFromDraft(d0, "dev-vorher", t0, { nr: f.vorherNr?.[i] ?? nextNr(ex, 0), kuerzel: "BSP" }));
  });
  const vor = lage(ex, now);
  const blau0 = [...ex.units.blau];
  const d = parseMeldung(mitTrupp(f.satz, f.truppKnopf), ctxOf(ex, now));
  const st = entryState(d, optsOf(ex, now));
  let ev: LageEvent | null = null;
  // «geht nicht» trägt nie ein; gelb: zweites Enter trägt den Entwurf ein, wie er ist
  if (st.level !== "geht-nicht") {
    ev = eventFromDraft(d, "dev-satz", now, { nr: nextNr(ex, 0), kuerzel: "BSP" });
    // wie useEntryDraft `commitNew` (MVP 3.5, S16): unbekannter Trupp – das zweite Enter trägt ohne ihn ein (nie still angelegt)
    const neu = d.truppNeu ?? st.reasons.find((r) => r.code === "trupp-neu")?.token;
    if (neu) {
      const gleich = (u?: string) => !!u && u.toLowerCase() === neu.toLowerCase() && !ex.units.blau.some((b) => b.toLowerCase() === u.toLowerCase());
      if (gleich(ev.melder)) delete ev.melder;
      if (gleich(ev.unit)) ev.unit = "";
    }
    eintragen(ex, ev);
  }
  const nach = lage(ex, now);
  const truppNach: Record<string, string> = {};
  for (const [u, c] of nach.blau) if (vor.blau.get(u) !== c) truppNach[u] = c;
  const vorschlag = st.reasons.find((r) => r.suggest)?.suggest ?? d.ersatz?.wort ?? null;
  return {
    stufe: st.level, gruende: st.reasons.map((r) => r.code), vorschlag, vorschau: ausEntwurf(d, ex), eingetragen: ev ? ausEintrag(ev, ex) : null,
    zeichenNeu: nach.zeichen - vor.zeichen, truppNach, blauNeu: ex.units.blau.filter((u) => !blau0.includes(u)),
  };
}

/** alle Fälle auswerten: Folgen (Einsatz s02/s12/s16) gemeinsam in einem Beispiel, sonst je ein frisches */
export function alleAuswerten(faelle: SatzFall[]): Map<string, SatzErgebnis | { fehler: string }> {
  const out = new Map<string, SatzErgebnis | { fehler: string }>();
  const folgen = new Map<string, Exercise>();
  for (const f of faelle) {
    const folge = f.quelle.startsWith("einsatz-");
    let ex = folge ? folgen.get(f.quelle) : undefined;
    if (!ex) { ex = beispielFuer(f); if (folge) folgen.set(f.quelle, ex); }
    try { out.set(f.id, auswerten(f, ex)); } catch (e) { out.set(f.id, { fehler: String((e as Error)?.stack ?? e).slice(0, 400) }); }
  }
  return out;
}

const ohneKlammer = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "");

/** Abweichungen vom Soll (leer = erfüllt), Regeln siehe Kopf von saetze35.ts */
export function abweichungen(e: SatzErgebnis, s: SatzSoll): string[] {
  const out: string[] = [];
  if (e.stufe !== s.stufe) out.push(`Stufe ${e.stufe} statt ${s.stufe}`);
  if (s.grund && !e.gruende.includes(s.grund)) out.push(`Grund ${s.grund} fehlt (${e.gruende.join(", ") || "keine"})`);
  if (s.vorschlag !== undefined && e.vorschlag !== s.vorschlag) out.push(`Vorschlag «${e.vorschlag}» statt «${s.vorschlag}»`);
  const zweit = new Set(Object.keys(s.nachZweitemEnter ?? {}));
  const feld = <K extends keyof SatzSoll>(k: K, ist: (i: SatzInhalt) => unknown, gleich: (a: unknown, b: NonNullable<SatzSoll[K]> | null) => boolean = (a, b) => a === b) => {
    const soll = (zweit.has(k) ? s.nachZweitemEnter![k] : s[k]) as SatzSoll[K];
    if (soll === undefined) return;
    const quelle = zweit.has(k) ? e.eingetragen : e.vorschau;
    if (!quelle) { out.push(`${k}: nicht eingetragen`); return; }
    const v = ist(quelle);
    if (!gleich(v, soll as NonNullable<SatzSoll[K]> | null)) out.push(`${k}${zweit.has(k) ? " (2. Enter)" : ""}: ${JSON.stringify(v)} statt ${soll instanceof RegExp ? String(soll) : JSON.stringify(soll)}`);
  };
  feld("art", (i) => i.art);
  feld("seite", (i) => i.seite);
  feld("gesehen", (i) => i.gesehen, (a, b) => (b as RegExp).test(String(a)));
  feld("anzahl", (i) => i.anzahl);
  feld("ort", (i) => i.ort, (a, b) => (b === null ? a === null : a === b || a === ohneKlammer(String(b))));
  feld("orte", (i) => i.orte ?? [], (a, b) => (b as string[]).every((o) => (a as string[]).includes(o)));
  feld("melder", (i) => i.melder, (a, b) => (b === null ? a === null : a === b));
  feld("dringend", (i) => !!i.dringend);
  feld("begehren", (i) => !!i.begehren);
  feld("an", (i) => i.an);
  feld("quelle", (i) => i.quelle);
  feld("frist", (i) => i.frist);
  feld("bezugArt", (i) => i.bezugArt);
  feld("dir", (i) => i.dir);
  feld("from", (i) => i.from);
  feld("teile", (i) => !!i.teile);
  feld("abschluss", (i) => !!i.abschluss);
  feld("vbk", (i) => i.vbk);
  feld("zeit", (i) => i.zeit);
  feld("tOffset", (i) => i.tOffset);
  if (e.zeichenNeu !== s.zeichenNeu) out.push(`zeichenNeu ${e.zeichenNeu} statt ${s.zeichenNeu}`);
  const soll = s.truppNach ?? {};
  for (const [u, c] of Object.entries(e.truppNach)) if (!(u in soll)) out.push(`${u} bewegt nach ${c} (soll bleiben)`);
  for (const [u, c] of Object.entries(soll)) if (!(e.truppNach[u] ?? "").startsWith(c)) out.push(`${u} nach ${e.truppNach[u] ?? "– (bleibt)"} statt ${c}`);
  if (s.blauNeu && JSON.stringify(e.blauNeu) !== JSON.stringify(s.blauNeu)) out.push(`neue Trupps ${JSON.stringify(e.blauNeu)} statt ${JSON.stringify(s.blauNeu)}`);
  return out;
}
