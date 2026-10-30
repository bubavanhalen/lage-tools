/**
 * LVZ-Vermerke, Bezüge, Aufheben und «Offen» (Spez. MVP 3, Kap. 3.3, 3.5, 3.7).
 *
 * - Vermerke (dringend, Status, Massnahme, weitergemeldet) sind Zeitstempel-Register pro Feld (`Stamp`): `setVermerk`
 *   ändert nur `lvz.<feld>` und `updatedAt`, **nicht** `rev`; Zusammenführen pro Feld (`mergeLvz`, model.ts).
 * - Abgeleitet statt gespeichert: Status von Aufträgen/Rückfragen aus Bezügen (`vermerkeOf`), «aufgehoben» aus
 *   Meldungen mit `hebtAuf` (`liftMap`).
 * - `offenePunkte`: was bei einer Übergabe nicht vergessen gehen darf.
 *
 * MVP 3.5 (Spez. MVP 3.5, Kap. 3.4 D2/D3): Bezug auflösen (`bezugAufloesen`: doppelte Nummer, Abschluss aus «erledigt»,
 * «Antwort an Bat»), Ausgang («weitergemeldet Bat 07:31 (Nr 58)»), Rückfragen von oben, Begehren (offen bis erledigt).
 * Zeitvergleiche nur über `zeitCmp`/`zeitBis` (S23). Kein Import aus journal.ts (journal.ts importiert `liftMap`).
 */
import { artOf, artText, isLage, lebenszeichen, readArt, type ArtLesung } from "./arten";
import { AUFHEBBAR, catalogEntry } from "./catalog";
import { compareEvents, zeitBis, zeitCmp, zeitMs, type ZeitArg } from "./clock";
import { QUITTUNG_ERLEDIGT, STILL_MIN } from "./entscheide";
import type { Draft } from "./journal";
import type { Exercise, LageEvent, LvzVermerke, Stamp } from "./model";
import { findAllByNr, nrLabel, nrText } from "./nummer";

export { mergeLvz } from "./model";

/**
 * Vermerk setzen (`v` = neuer Wert; `null` bei «weiter» = zurückgenommen). Ändert nur `lvz.<key>` und `updatedAt`,
 * nicht `rev` (zählt nie als Konflikt). `device` = dieses Gerät, `kuerzel` = Schicht.
 */
export function setVermerk<K extends keyof LvzVermerke>(e: LageEvent, key: K, v: NonNullable<LvzVermerke[K]>["v"], o: { device: string; kuerzel?: string; now?: Date }): LageEvent {
  const at = (o.now ?? new Date()).toISOString();
  const stamp = { v, at, device: o.device, ...(o.kuerzel ? { von: o.kuerzel } : {}) } as Stamp<typeof v>;
  return { ...e, lvz: { ...(e.lvz ?? {}), [key]: stamp }, updatedAt: at };
}

/** einmal je Ereignisliste: Bezüge und Aufhebungen nach Ziel-ID */
export interface LvzIndex {
  /** Ziel-ID → Einträge mit `bezug` darauf (nicht gestrichen), älteste zuerst */
  bezuege: Map<string, LageEvent[]>;
  lifts: Map<string, { t: string; by: string }>;
  /** (MVP 3.5) die Ereignisliste selbst – für Nummern in abgeleiteten Vermerken («weitergemeldet … (Nr 58)») */
  events?: LageEvent[];
}

/**
 * Aufhebungen: Ziel-ID → früheste nicht gestrichene Aufhebung (`t` Lagezeit, `by` ID der aufhebenden Meldung).
 * Rückblick vor `t` zeigt das Ziel noch.
 */
export function liftMap(events: LageEvent[]): Map<string, { t: string; by: string }> {
  const out = new Map<string, { t: string; by: string }>();
  for (const e of events) {
    if (e.deleted || !e.hebtAuf) continue;
    const cur = out.get(e.hebtAuf);
    if (!cur || zeitCmp(e, cur.t) < 0) out.set(e.hebtAuf, { t: e.t, by: e.id });
  }
  return out;
}

const INDEX = new WeakMap<LageEvent[], LvzIndex>();

export function lvzIndex(events: LageEvent[]): LvzIndex {
  let idx = INDEX.get(events);
  if (idx) return idx;
  const bezuege = new Map<string, LageEvent[]>();
  for (const e of [...events].sort(compareEvents)) {
    if (e.deleted || !e.bezug) continue;
    // (Fix N) weitere Bezüge mit derselben Art («Nr 55 und 56 an Bat weitergemeldet»)
    for (const id of [e.bezug, ...(e.bezugAuch ?? []).filter((x) => x !== e.bezug)]) {
      const l = bezuege.get(id);
      if (l) l.push(e); else bezuege.set(id, [e]);
    }
  }
  idx = { bezuege, lifts: liftMap(events), events };
  INDEX.set(events, idx);
  return idx;
}

export interface VermerkStand {
  dringend: boolean;
  status: "offen" | "erledigt" | null;
  /** ISO UTC */
  erledigtUm?: string;
  massnahme?: string;
  weiter?: { an: string; um: string };
  quittiert?: { t: string; id: string };
  beantwortet?: { t: string; id: string };
  aufgehoben?: { t: string; id: string };
  /** (MVP 3.5, D3) weitergemeldet über einen Ausgang (`bezugArt: "weiter"`): Eintrag und Nummer («weitergemeldet Bat 07:31 (Nr 58)») */
  weiterVon?: { id: string; nr: string };
}

/**
 * Stand der Vermerke einer Meldung: gesetzte Vermerke plus abgeleiteter Status. Auftrag/Rückfrage sind «offen», bis
 * `status` erledigt ist oder ein Bezug sie erledigt (Antwort, «ausgeführt»; Quittung nur «quittiert», Entscheid 5).
 * Meldungen haben keinen Status, ausser dringend (→ offen bis erledigt) oder ausdrücklich gesetzt. Vbk «keine» ist offen
 * (bis zum nächsten Lebenszeichen – das prüft `offenePunkte`).
 * MVP 3.5 (D3): «weitergemeldet» auch aus einem Ausgang mit `bezugArt: "weiter"` (jüngster; ein gesetzter Vermerk geht
 * vor), `weiterVon` = dieser Ausgang; eine Rückfrage von oben beantwortet ein Ausgang/eine Notiz mit `bezugArt: "antwort"`;
 * eine Meldung mit Begehren ist «offen», bis sie erledigt ist.
 */
export function vermerkeOf(e: LageEvent, idx: LvzIndex): VermerkStand {
  const l = e.lvz ?? {};
  const out: VermerkStand = { dringend: !!l.dringend?.v, status: null };
  if (l.massnahme?.v) out.massnahme = l.massnahme.v;
  if (l.weiter?.v) out.weiter = l.weiter.v;
  const lift = idx.lifts.get(e.id);
  if (lift) out.aufgehoben = { t: lift.t, id: lift.by };
  const art = artOf(e);
  let erledigtDurch: LageEvent | undefined;
  for (const b of idx.bezuege.get(e.id) ?? []) {
    if (b.bezugArt === "quittung") { out.quittiert ??= { t: b.t, id: b.id }; if (QUITTUNG_ERLEDIGT) erledigtDurch ??= b; }
    // (Fix M3) Auftrag von oben ohne Trupp («Bat verlangt Lagemeldung»): eine Antwort nach oben erledigt ihn
    else if (b.bezugArt === "antwort" || (art === "rueckfrage" && b.bezugArt !== "ausgefuehrt")) { out.beantwortet ??= { t: b.t, id: b.id }; if (art === "rueckfrage" || (art === "auftrag" && !!e.quelle && !e.an)) erledigtDurch ??= b; }
    else if (b.bezugArt === "ausgefuehrt" && art === "auftrag") erledigtDurch ??= b;
    else if (b.bezugArt === "weiter" && artOf(b) === "ausgang") {
      // jüngster Ausgang gilt (Liste älteste zuerst); ein gesetzter Vermerk «weitergemeldet» geht vor
      if (!l.weiter?.v) out.weiter = { an: b.an ?? "", um: b.t };
      out.weiterVon = { id: b.id, nr: idx.events ? nrLabel(b, { events: idx.events }) : "" };
    }
  }
  if (l.status) {
    out.status = l.status.v;
    if (l.status.v === "erledigt") out.erledigtUm = l.status.at;
  } else if (art === "auftrag" || art === "rueckfrage") {
    out.status = erledigtDurch ? "erledigt" : "offen";
    if (erledigtDurch) out.erledigtUm = erledigtDurch.createdAt ?? erledigtDurch.updatedAt;
  } else if (art === "vbk" && e.vbk === "keine") out.status = "offen";
  else if (art === "meldung" && e.begehren) out.status = "offen";
  else if (out.dringend) out.status = "offen";
  return out;
}

/** Aufhebbar: Hindernis, Anlage (Checkpoint …), Fläche/Linie aus dem Katalog (`AUFHEBBAR`) bzw. gezeichnet */
export function istAufhebbar(e: Pick<LageEvent, "sym" | "shape">): boolean {
  return !!e.shape || AUFHEBBAR.has(e.sym);
}

/** Oberbegriffe: «Sperre aufgehoben» passt auf alle Hindernisse */
const OBERBEGRIFF = new Set(["sperre"]);
const baseCell = (c: string) => c.replace(/\s?[ABCD]$/, "").toUpperCase();

/**
 * Aktive Ziele für «… aufgehoben» am Ort, jüngste zuerst: Art Meldung, nicht gestrichen, nicht schon aufgehoben,
 * `t ≤ d.t`, aufhebbar, gleiches Zeichen (oder Oberbegriff Sperre → alle Hindernisse) und gleicher Ort (gleiches
 * Planquadrat ohne Unterquadrant, gleiches NAI oder ≤ 300 m).
 */
export function aufhebZiele(events: LageEvent[], d: Pick<Draft, "sym" | "cells" | "nai" | "pos" | "t">, idx: LvzIndex): LageEvent[] {
  const dc = catalogEntry(d.sym);
  const sameKind = (e: LageEvent) => e.sym === d.sym || (OBERBEGRIFF.has(d.sym) && catalogEntry(e.sym)?.category === dc?.category);
  const cells = new Set((d.cells ?? []).map(baseCell));
  const samePlace = (e: LageEvent) =>
    (e.cells ?? []).some((c) => cells.has(baseCell(c))) || (!!d.nai && e.nai === d.nai)
    || (!!d.pos && !!e.pos && Math.hypot(d.pos.e - e.pos.e, d.pos.n - e.pos.n) <= 300);
  return events
    .filter((e) => isLage(e) && zeitBis(e, d.t) && istAufhebbar(e) && !idx.lifts.has(e.id) && sameKind(e) && samePlace(e))
    .sort((a, b) => compareEvents(b, a));
}

/** MVP 3.5 (D3): + «rueckfrage-oben» (Rückfrage von Bat/Kdt, prio 28) und «begehren» (Nachschub, Sanität, prio 45) */
export type OffenArt = "dringend" | "konflikt" | "auftrag" | "rueckfrage" | "rueckfrage-oben" | "begehren" | "verbindung" | "still" | "ohne-ort" | "offen";

export interface OffenItem {
  /** stabil (Art + ID bzw. Trupp) */
  key: string;
  art: OffenArt;
  prio: number;
  eventId?: string;
  unit?: string;
  /** Zeit des Eintrags bzw. des letzten Lebenszeichens (ISO lokal) */
  t: string;
  /** Klartext ohne Nummer, z. B. «an H03: Beo NAI 2 – bis 08:00» */
  text: string;
  nr?: string;
  /** Frist vorbei */
  ueberfaellig?: boolean;
  /** Minuten seit `t` */
  seitMin: number;
  /** (Fix M3) Auftrag von oben ohne Trupp («Bat verlangt Lagemeldung bis 0800») – Art «rueckfrage-oben», «Antwort eintragen» */
  auftragOben?: true;
  /** (Fix M3) Frist (ISO lokal) eines Auftrags von oben */
  frist?: string;
}

/** Rangfolge in «Offen» (Kap. 3.7) */
export const OFFEN_PRIO: Record<OffenArt | "auftrag-frist", number> = {
  dringend: 10, konflikt: 20, "auftrag-frist": 25, "rueckfrage-oben": 28, auftrag: 30, rueckfrage: 40, begehren: 45, verbindung: 50, still: 50, "ohne-ort": 60, offen: 70,
};

// ---------- MVP 3.5: Bezug auflösen (D2, Spez. MVP 3.5, Kap. 3.4, 5.3) ----------

/** Ergebnis von `bezugAufloesen` – parseMeldung übernimmt es in den Entwurf (Phase 0 verdrahtet) */
export interface BezugErgebnis {
  bezug?: string;
  bezugArt?: LageEvent["bezugArt"];
  /** mehrere mögliche Bezüge (IDs): «64» bei 64a/64b, mehrere offene Aufträge bei «erledigt» → `Draft.bezugKandidaten` */
  kandidaten?: string[];
  /** Grund für die Vorschau (gelb): `bezug-wahl`, `auftrag-wahl`; `bezug` = unbekannte Nummer */
  grund?: "bezug-wahl" | "auftrag-wahl" | "bezug";
  /**
   * (additiv) D1.7: genau ein offener Auftrag wird abgeschlossen → `Draft.abschluss` («schliesst Auftrag Nr 66 ab»; `nr` =
   * Nummer wie angezeigt «66», `text` «an H03: Beo NAI 2»); `null` = ausdrücklich keiner («nicht abschliessen», «keiner»,
   * mehrere zur Wahl)
   */
  abschluss?: { id: string; nr: string; text: string } | null;
  /** (additiv) Wahl-Knöpfe zu `kandidaten` (Text und Beschriftungen, Kap. 4) → `Draft.wahl` → `EntryReason.choices` */
  wahl?: BezugWahl;
  /** (Fix H1) fester Bezug aus Offen (`ctx.bezugNr`): Anzeige «Antwort auf Nr 57 (Standort H02?)» → `Draft.bezugFest` */
  fest?: { id: string; nr: string; text: string };
  /** (Fix N) weitere Bezüge eines Ausgangs («Nr 55 und 56 weitergemeldet») → `Draft.bezugAuch` */
  auch?: string[];
}

/** Wahl-Knöpfe in der Vorschau (`Draft.wahl`, `EntryReason.choices`): «64a 07:37 H02 3 Fz AK9» bzw. «Nr 66 Beo NAI 2» */
export interface BezugWahl {
  grund: "bezug-wahl" | "auftrag-wahl";
  /** Klartext der Zustandszeile (Kap. 4): «Nr 64 gibt es zweimal – welche?», «Welcher Auftrag ist erledigt?» */
  text: string;
  /** je Kandidat ein Knopf (ID → `JournalContext.bezugWahl`); bei `auftrag-wahl` zuletzt «keiner» (ID «keiner») */
  choices: Array<{ id: string; label: string }>;
}

/** ID der Wahl «keiner» (kein Auftrag ist erledigt) – `JournalContext.bezugWahl` */
export const BEZUG_KEINER = "keiner";

const ZAHLWORT = ["", "einmal", "zweimal", "dreimal", "viermal", "fünfmal"];

/** «64a 07:37 H02 3 Fz AK9» (Nummer, Zeit, Melder, Inhalt; höchstens ~40 Zeichen) */
export function bezugKnopfText(e: LageEvent, ex: Pick<Exercise, "events">, blau: string[] = []): string {
  const was = [e.melder, inhalt(e, blau)].filter(Boolean).join(" ");
  const s = `${nrLabel(e, ex)} ${hhmm(e.t)} ${was}`.replace(/\s+/g, " ").trim();
  return s.length > 42 ? `${s.slice(0, 41).trimEnd()}…` : s;
}

/** «Beo NAI 2» – Inhalt eines Auftrags ohne Empfänger und Frist */
const auftragInhalt = (e: LageEvent, blau: string[]) => inhalt(e, blau);

/** offene Aufträge an `trupp` mit Lagezeit ≤ `t`, jüngste zuerst */
export function offeneAuftraegeAn(events: LageEvent[], trupp: string, t: string): LageEvent[] {
  if (!trupp) return [];
  const idx = lvzIndex(events);
  return events
    .filter((e) => !e.deleted && artOf(e) === "auftrag" && !!e.an && sameName(e.an, trupp) && zeitBis(e, t) && vermerkeOf(e, idx).status === "offen")
    .sort((a, b) => compareEvents(b, a));
}

const sameName = (a: string, b: string) => a.replace(/[\s.]/g, "").replace(/(\D)0+(\d)/g, "$1$2").toLowerCase() === b.replace(/[\s.]/g, "").replace(/(\D)0+(\d)/g, "$1$2").toLowerCase();

/** (Fix M1) Vollzug eines Auftrags: der Trupp meldet Ziel/Ort erreicht bzw. die Sache erledigt */
const VOLLZUG_RE = /(?<![\p{L}])(?:erfolgt|eingetroffen|errichtet|erstellt|eingerichtet|bezogen|ausgeführt|ausgefuehrt|erreicht|angekommen|in\s+stellung|vollzogen|erfüllt|erledigt)(?![\p{L}])/iu;
/** Wörter, die beim Vergleich Ausgang ↔ Meldeauftrag nichts besagen */
const FUELL = new Set(["melden", "meldung", "bis", "bitte", "sofort", "verlangt", "will", "wissen", "möchte", "wünscht", "fordert", "erstattet", "gemeldet", "nach", "oben", "und", "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "wie", "viele", "wo", "ist", "sind", "an", "von", "zu", "in", "bei", "auf", "mit"]);
const woerter = (s: string) => new Set((s.toLowerCase().match(/[\p{L}][\p{L}\d]{2,}|h\d{1,3}|[a-z]{1,2}\d{1,2}/gu) ?? []).filter((w) => !FUELL.has(w) && !/^\d+$/.test(w)).map((w) => w.replace(/^(\D+?)0+(\d)/, "$1$2")));
const baseOrt = (c: string) => c.replace(/\s?[ABCD]$/, "").replace(/\s+/g, "").toUpperCase();

/** Kontext von `bezugAufloesen` (parseMeldung) */
export interface BezugKontext {
  events: LageEvent[];
  ex?: Pick<Exercise, "events">;
  melder?: string;
  t: string;
  abschlussAus?: boolean;
  bezugWahl?: string;
  blau?: string[];
  /** (Fix H1) fester Bezug aus «Antwort eintragen»/«Erledigt» in Offen: Nummer wie angezeigt («57a») oder ID – gewinnt immer */
  bezugNr?: string;
  /** (Fix M1) Orte der Meldung (Planquadrate ohne Unterquadrant, NAI) und Text – für den Vollzug eines Auftrags */
  orte?: string[];
  text?: string;
}

/** Auftrag von oben ohne Empfänger-Trupp («Bat verlangt Lagemeldung bis 0800», «Auftrag Bat: Sperre AG13 halten») */
export const istAuftragOben = (e: Pick<LageEvent, "art" | "notiz" | "quelle" | "an">): boolean => artOf(e) === "auftrag" && !!e.quelle && !e.an;
/** Rückfrage von oben («Bat fragt: …») */
export const istRueckfrageOben = (e: Pick<LageEvent, "art" | "notiz" | "quelle" | "an">): boolean => artOf(e) === "rueckfrage" && !!e.quelle && !e.an;

/** Eintrag zu einer Nummer («57», «57a») oder ID; null bei mehrdeutiger Nummer bzw. ohne Treffer */
function festerEintrag(nrOderId: string, events: LageEvent[], ex: Pick<Exercise, "events">): LageEvent | null {
  const byId = events.find((e) => e.id === nrOderId && !e.deleted);
  if (byId) return byId;
  const alle = findAllByNr(ex, nrOderId).filter((e) => !e.deleted);
  return alle.length === 1 ? alle[0]! : null;
}

/**
 * (MVP 3.5, D2; Fix H1/M1/M3) Bezug einer Lesung auflösen (von `parseMeldung` aufgerufen). **Nie still der jüngste:**
 * - `ctx.bezugNr` (fester Bezug aus Offen) gewinnt immer: Rückfrage → Antwort, Auftrag → «ausgefuehrt» + `abschluss`
 *   («nicht abschliessen» → nur Verweis), sonst Verweis/Weitermeldung. `fest` = Anzeige «Antwort auf Nr 57 (Standort H02?)».
 * - Nummer mit mehreren Einträgen («64» bei 64a/64b) → `kandidaten` + `wahl` (`bezug-wahl`), bis `ctx.bezugWahl` wählt.
 *   Ein Ausgang auf eine Rückfrage ist ihre Antwort, auf einen Auftrag von oben dessen Vollzug, sonst «weiter».
 * - `abschluss` («H03 erledigt», «H03 Auftrag ausgeführt») und Vollzug («H02 in AH10 eingetroffen», «H05 Sperre AQ12
 *   errichtet» – Ort eines offenen Auftrags an den Melder): genau einer → `bezug` + «ausgefuehrt» + `abschluss`; mehrere
 *   → `wahl` (`auftrag-wahl`, Knopf «keiner»); keiner → nichts.
 * - Ausgang «Antwort an Bat: …» ohne Nummer: offene Rückfragen und Aufträge von Bat – genau einer → dieser; mehrere →
 *   `wahl` (`bezug-wahl`, «ohne Bezug»). «Lagemeldung an Bat …» ohne Nummer: Meldeauftrag von Bat mit gleichem Inhalt
 *   (Wort) → Abschluss vorschlagen.
 * - Antwort an/von einem Trupp ohne Nummer mit mehreren offenen Rückfragen → `wahl` (eine: löst parseMeldung).
 * Leeres Ergebnis = nichts zu tun (das bisherige Verhalten von parseMeldung gilt).
 */
export function bezugAufloesen(l: ArtLesung, ctx: BezugKontext): BezugErgebnis {
  const events = ctx.events;
  const ex = ctx.ex ?? { events };
  const blau = ctx.blau ?? [];
  const idx = lvzIndex(events);
  const offen = (e: LageEvent) => !e.deleted && zeitBis(e, ctx.t) && vermerkeOf(e, idx).status === "offen";
  const abschlussVon = (z: LageEvent) => ({ id: z.id, nr: nrLabel(z, ex), text: istAuftragOben(z) ? obenText(z, blau) : `an ${z.an ?? "?"}: ${auftragInhalt(z, blau)}${z.frist ? ` – bis ${hhmm(z.frist)}` : ""}` });
  const festVon = (z: LageEvent) => ({ id: z.id, nr: nrLabel(z, ex), text: artOf(z) === "auftrag" ? abschlussVon(z).text : inhalt(z, blau) });
  /** Ziel `z` gewählt: Art des Bezugs je Ziel */
  const ziel = (z: LageEvent, o: { fest?: boolean } = {}): BezugErgebnis => {
    const extra = o.fest ? { fest: festVon(z) } : {};
    if (artOf(z) === "rueckfrage" && (l.art !== "meldung" || l.bezugArt === "antwort" || o.fest || l.bezugAnfang)) return { bezug: z.id, bezugArt: "antwort", ...extra };
    if (artOf(z) === "auftrag" && (l.art === "ausgang" || l.abschluss || l.bezugArt === "ausgefuehrt" || o.fest)) {
      if (ctx.abschlussAus || ctx.bezugWahl === BEZUG_KEINER) return o.fest ? { bezug: z.id, bezugArt: "verweis", abschluss: null, ...extra } : { abschluss: null };
      return { bezug: z.id, bezugArt: "ausgefuehrt", abschluss: abschlussVon(z), ...extra };
    }
    return { bezug: z.id, bezugArt: l.art === "ausgang" ? "weiter" : l.bezugArt ?? "verweis", ...extra };
  };
  /** Wahl zwischen `alle` (≥ 2): gewählt → Ziel; «keiner» → kein Bezug; sonst Knöpfe */
  const wahl = (alle: LageEvent[], grund: "bezug-wahl" | "auftrag-wahl", text: string, keiner: string | null, label: (e: LageEvent) => string): BezugErgebnis => {
    if (ctx.bezugWahl === BEZUG_KEINER && keiner) return grund === "auftrag-wahl" ? { abschluss: null } : {};
    const gew = ctx.bezugWahl ? alle.find((e) => e.id === ctx.bezugWahl) : undefined;
    if (gew) return ziel(gew);
    return {
      kandidaten: alle.map((e) => e.id), grund, ...(grund === "auftrag-wahl" ? { abschluss: null } : {}),
      wahl: { grund, text, choices: [...alle.map((e) => ({ id: e.id, label: label(e) })), ...(keiner ? [{ id: BEZUG_KEINER, label: keiner }] : [])] },
    };
  };
  const nrKnopf = (e: LageEvent) => `${nrText(e, ex)} ${artOf(e) === "auftrag" && !istAuftragOben(e) ? auftragInhalt(e, blau) : inhalt(e, blau)}`.replace(/\s+/g, " ").trim().slice(0, 42);

  // (Fix H1) fester Bezug aus Offen
  if (ctx.bezugNr) {
    const z = festerEintrag(ctx.bezugNr, events, ex);
    if (z) return { ...ziel(z, { fest: true }), ...auchVon(l, ex) };
  }

  // Nummer genannt
  if (l.bezugNr) {
    const alle = findAllByNr(ex, l.bezugNr).filter((e) => !e.deleted);
    if (alle.length > 1) {
      const nr = l.bezugNr.replace(/[a-z]$/i, "");
      return wahl(alle, "bezug-wahl", `Nr ${nr} gibt es ${ZAHLWORT[alle.length] ?? `${alle.length}-mal`} – welche?`, null, (e) => bezugKnopfText(e, ex, blau));
    }
    const z = alle[0];
    if (!z) return { grund: "bezug" };
    if (l.art === "ausgang") return { ...ziel(z), ...auchVon(l, ex) };
    if (l.abschluss && artOf(z) === "auftrag") return ziel(z);
    return {};
  }

  const melder = ctx.melder ?? "";
  // «H03 erledigt», «H03 Auftrag ausgeführt» ohne Nummer: offener Auftrag an den Melder (mehrere → Wahl)
  if (l.abschluss || (l.art === "meldung" && l.bezugArt === "ausgefuehrt")) {
    if (ctx.abschlussAus || ctx.bezugWahl === BEZUG_KEINER) return { abschluss: null };
    const auf = offeneAuftraegeAn(events, melder, ctx.t);
    if (!auf.length) return {};
    if (auf.length === 1) return ziel(auf[0]!);
    return wahl(auf, "auftrag-wahl", "Welcher Auftrag ist erledigt?", "keiner", nrKnopf);
  }

  // (Fix M1) Vollzug: Trupp meldet Ort eines offenen Auftrags an ihn («H02 in AH10 eingetroffen», «Sperre AQ12 errichtet»)
  if (l.art === "meldung" && melder && ctx.orte?.length && ctx.text && VOLLZUG_RE.test(ctx.text)) {
    const orte = new Set(ctx.orte.map(baseOrt));
    const auf = offeneAuftraegeAn(events, melder, ctx.t).filter((e) => (e.orte ?? []).some((o) => orte.has(baseOrt(o))));
    if (!auf.length) return {};
    if (ctx.abschlussAus || ctx.bezugWahl === BEZUG_KEINER) return { abschluss: null };
    if (auf.length === 1) return { bezug: auf[0]!.id, bezugArt: "ausgefuehrt", abschluss: abschlussVon(auf[0]!) };
    return wahl(auf, "auftrag-wahl", "Welcher Auftrag ist erledigt?", "keiner", nrKnopf);
  }

  // Ausgang nach oben ohne Nummer
  if (l.art === "ausgang" && l.an) {
    const von = (e: LageEvent) => !!e.quelle && sameName(e.quelle, l.an!);
    if (l.bezugArt === "antwort") {
      // «Antwort an Bat: …» → offene Rückfragen und Aufträge von Bat (älteste zuerst in der Wahl)
      const alle = events.filter((e) => (istRueckfrageOben(e) || istAuftragOben(e)) && von(e) && offen(e)).sort(compareEvents);
      if (!alle.length) return {};
      if (alle.length === 1) return ziel(alle[0]!);
      return wahl(alle, "bezug-wahl", "Welche Rückfrage wird beantwortet?", "ohne Bezug", nrKnopf);
    }
    // «Lagemeldung an Bat 0745 erstattet» → Meldeauftrag von Bat mit gleichem Inhalt (Wort) abschliessen?
    const w = woerter(`${l.token ?? ""} ${l.rest}`);
    const auf = events.filter((e) => istAuftragOben(e) && von(e) && offen(e) && [...woerter(inhalt(e, blau))].some((x) => w.has(x))).sort(compareEvents);
    if (!auf.length) return {};
    if (ctx.abschlussAus || ctx.bezugWahl === BEZUG_KEINER) return { abschluss: null };
    if (auf.length === 1) return { bezug: auf[0]!.id, bezugArt: "ausgefuehrt", abschluss: abschlussVon(auf[0]!) };
    return wahl(auf, "auftrag-wahl", "Welcher Auftrag ist erledigt?", "keiner", nrKnopf);
  }

  // Antwort an/von einem Trupp ohne Nummer («H04 Antwort: …», «Antwort an H02: …»): mehrere offene Rückfragen → Wahl
  if (l.art === "notiz" && l.bezugArt === "antwort") {
    const trupp = l.an ?? melder;
    if (!trupp) return {};
    const alle = events.filter((e) => artOf(e) === "rueckfrage" && !istRueckfrageOben(e) && offen(e)
      && ((!!e.an && sameName(e.an, trupp)) || (!!e.melder && sameName(e.melder, trupp)))).sort(compareEvents);
    if (alle.length < 2) return {};
    return wahl(alle, "bezug-wahl", "Welche Rückfrage wird beantwortet?", "ohne Bezug", nrKnopf);
  }
  return {};
}

/** weitere Nummern eines Ausgangs («Nr 55 und 56») → IDs (nur eindeutige) */
function auchVon(l: ArtLesung, ex: Pick<Exercise, "events">): Pick<BezugErgebnis, "auch"> {
  const ids = (l.bezugNrAuch ?? []).map((n) => findAllByNr(ex, n).filter((e) => !e.deleted)).filter((a) => a.length === 1).map((a) => a[0]!.id);
  return ids.length ? { auch: ids } : {};
}

/** «Bat verlangt Lagemeldung – bis 08:00», «Bat: Standort H02 melden – bis 08:00» (Auftrag von oben ohne Trupp) */
export function obenText(e: LageEvent, blau: string[] = []): string {
  const was = inhalt(e, blau);
  const verb = /^(?:verlangt|fordert|will|möchte|wünscht|braucht|erwartet)(?![\p{L}])/iu.test(was);
  return `${e.quelle ?? "?"}${verb ? " " : ": "}${was}${e.frist ? ` – bis ${hhmm(e.frist)}` : ""}`;
}

/**
 * (Fix N) Zeitpunkt eines Lebenszeichens in ms: Eingang (`createdAt`), wenn er nach der Lagezeit liegt – ein nachgemeldetes
 * «0255» um 03:10 zeigt, dass der Trupp um 03:10 Verbindung hatte. Ohne `createdAt` die Lagezeit.
 */
export function eingangMs(e: Pick<LageEvent, "t" | "tOffset" | "createdAt" | "tReported">): number {
  const t = zeitMs(e);
  // Eingang nur bei erfassten Einträgen (`tReported` gesetzt): genau aus `createdAt`, sonst aus `tReported`
  if (!e.tReported) return t;
  const c = e.createdAt ? Date.parse(e.createdAt) : zeitMs({ t: e.tReported.slice(0, 16) });
  return Number.isFinite(c) && c > t ? c : t;
}

const hhmm = (t: string) => t.slice(11, 16);
const minutesBetween = (a: ZeitArg, b: ZeitArg) => Math.max(0, Math.round((zeitMs(b) - zeitMs(a)) / 60000));
/** Ort in Worten; früherer Ersatzort «letzter Standort» (vor der Nachbesserung gespeichert) zählt nicht als Ort */
const ortText = (e: Pick<LageEvent, "where" | "cells" | "nai">) => (e.where && !/^letzter Standort$/i.test(e.where) ? e.where : undefined) ?? e.cells?.[0] ?? e.nai ?? "";
/**
 * Inhalt ohne Art-Hinweis, Melder und Frist («Auftrag an H01: Beo NAI 1 bis 1200» → «Beo NAI 1», «H05: 2 Kpz AJ9» → «2 Kpz AJ9»).
 * Die Frist fällt nur bei Aufträgen weg (steht dort als «– bis 12:00»); «Kdt: Funkstille bis 1100» bleibt ganz (Fix 3).
 */
export function inhaltText(e: LageEvent, blau: string[] = []): string {
  return inhalt(e, blau);
}

function inhalt(e: LageEvent, blau: string[]): string {
  let t = readArt(e.text, { blau }).rest;
  if (artOf(e) === "auftrag" && e.frist) t = t.replace(/(?<![\p{L}\d])bis\s+\d{1,2}[:.]?\d{2}(?![\p{L}\d])/u, "");
  t = t.replace(/\s+/g, " ").trim();
  if (e.melder) t = t.replace(new RegExp(`^${e.melder}\\s*[:,]?\\s*`), "");
  return t || e.text;
}

/**
 * Kurztext eines Eintrags für «Offen» und die Übergabe: «Feind 2 Kpz AJ9 Rtg W (H05)», «Feind 1 Fz Rtg N (H02, AK9)» –
 * Art in Worten, Inhalt ohne Melder, dahinter Melder und Ort (wenn nicht schon im Text).
 */
export function kurzText(e: LageEvent, blau: string[] = []): string {
  const base = inhalt(e, blau);
  const ort = ortText(e) || (e.orte ?? [])[0] || "";
  const art = artText(e);
  // Melder nicht doppelt («Antwort von H05 Mun genug», nicht «… (H05)»)
  const extra = [e.melder && !base.includes(e.melder) && !art.includes(e.melder) ? e.melder : "", ort && !base.includes(ort) ? ort : ""].filter(Boolean);
  return `${art} ${base}${extra.length ? ` (${extra.join(", ")})` : ""}`.replace(/\s+/g, " ").trim();
}

/**
 * Offene Punkte zur Lagezeit `tLive` (Stand jetzt): dringend & nicht erledigt · Konflikte beim Zusammenführen
 * (`conflictIds` und `history` mit `conflict`, solange nicht «erledigt») · offene Aufträge (Frist vorbei zuerst) ·
 * Rückfragen ohne Antwort · Verbindung «keine» bis zum nächsten Lebenszeichen · Trupp > `stillMin` ohne Lebenszeichen ·
 * Meldungen ohne Ort · ausdrücklich «offen». Sortiert nach `prio`, innerhalb neueste zuerst. Hinweise zu Rot zählen nicht.
 * MVP 3.5 (D3): Rückfragen von oben (`quelle`, «Bat fragt: Standort H02?», prio 28) bis Antwort/erledigt · Begehren
 * («H02: Mun- und Verpflegungsnachschub», prio 45) bis erledigt · Ausgänge und Übergabe-Einträge nie.
 */
export function offenePunkte(ex: Exercise, tLive: string, o: { conflictIds?: string[]; stillMin?: number } = {}): OffenItem[] {
  const all = ex.events ?? [];
  const idx = lvzIndex(all);
  const stillMin = o.stillMin ?? STILL_MIN;
  const conflicts = new Set(o.conflictIds ?? []);
  const blau = ex.units?.blau ?? [];
  const out: OffenItem[] = [];
  const live = all.filter((e) => !e.deleted && zeitBis(e, tLive));
  const item = (art: OffenArt, e: LageEvent, text: string, extra: Partial<OffenItem> = {}): OffenItem => ({
    key: `${art}:${e.id}`, art, prio: OFFEN_PRIO[art], eventId: e.id, t: e.t, text, nr: nrLabel(e, ex), seitMin: minutesBetween(e, tLive), ...extra,
  });
  // letzte Lebenszeichen je Trupp – nach Eingang (Fix N: ein nachgemeldetes «0255» um 03:10 ist ein Lebenszeichen um 03:10)
  const lastSign = new Map<string, LageEvent>();
  for (const e of [...live].sort(compareEvents)) {
    const u = lebenszeichen(e);
    if (!u) continue;
    const cur = lastSign.get(u);
    if (!cur || eingangMs(e) >= eingangMs(cur)) lastSign.set(u, e);
  }
  const keineVbk = new Set<string>();
  for (const e of live) {
    const art = artOf(e);
    const v = vermerkeOf(e, idx);
    const erledigt = v.status === "erledigt";
    if (e.system) continue; // Übergabe-Eintrag (S20): nie offen
    const conflict = conflicts.has(e.id) || (e.history ?? []).some((h) => h.conflict);
    if (conflict && !erledigt) out.push(item("konflikt", e, "zwei Fassungen – ansehen"));
    if (v.dringend && !erledigt) { out.push(item("dringend", e, `${kurzText(e, blau)}${v.weiter ? ` – weitergemeldet ${v.weiter.an} ${hhmm(v.weiter.um)}` : ""}`)); continue; }
    // (Fix M3) Auftrag von oben ohne Trupp («Bat verlangt Lagemeldung bis 0800»): bei den Rückfragen von oben, Frist wie Aufträge
    if (art === "auftrag" && v.status === "offen" && istAuftragOben(e)) {
      const frist = e.frist;
      const ueberfaellig = !!frist && zeitCmp(frist, tLive) < 0;
      out.push({ ...item("rueckfrage-oben", e, obenText(e, blau)), prio: ueberfaellig ? OFFEN_PRIO["auftrag-frist"] : OFFEN_PRIO["rueckfrage-oben"], auftragOben: true, ...(frist ? { frist } : {}), ...(ueberfaellig ? { ueberfaellig } : {}) });
      continue;
    }
    if (art === "auftrag" && v.status === "offen") {
      const frist = e.frist;
      const ueberfaellig = !!frist && zeitCmp(frist, tLive) < 0;
      out.push({ ...item("auftrag", e, `an ${e.an ?? "?"}: ${inhalt(e, ex.units?.blau ?? [])}${frist ? ` – bis ${hhmm(frist)}` : ""}`), prio: ueberfaellig ? OFFEN_PRIO["auftrag-frist"] : OFFEN_PRIO.auftrag, ...(ueberfaellig ? { ueberfaellig } : {}) });
      continue;
    }
    // Rückfrage von oben («Bat fragt: …»): eigene Gruppe vor den Aufträgen; Antwort mit «Antwort an Bat: …» (Ausgang)
    if (art === "rueckfrage" && v.status === "offen" && e.quelle && !e.an) { out.push(item("rueckfrage-oben", e, `${e.quelle} fragt: ${inhalt(e, blau)}`)); continue; }
    if (art === "rueckfrage" && v.status === "offen") { out.push(item("rueckfrage", e, `${e.an ? `an ${e.an}` : `von ${e.melder ?? "?"}`}: ${inhalt(e, ex.units?.blau ?? [])}`)); continue; }
    if (art === "meldung" && e.begehren && v.status === "offen") { out.push({ ...item("begehren", e, `${e.melder ?? "?"}: ${e.begehren.was || inhalt(e, blau)}`), ...(e.melder ? { unit: e.melder } : {}) }); continue; }
    // Vbk «keine»: betroffen ist `an` («H03 keine Verbindung zu H04» → H04), sonst der Melder
    const betroffen = art === "vbk" ? e.an ?? e.melder : undefined;
    if (art === "vbk" && e.vbk === "keine" && betroffen && v.status !== "erledigt") {
      const later = lastSign.get(betroffen);
      if (!later || eingangMs(later) < eingangMs(e)) {
        keineVbk.add(betroffen);
        out.push({ ...item("verbindung", e, `${betroffen}: keine Verbindung seit ${hhmm(e.t)}`), unit: betroffen });
      }
      continue;
    }
    if (isLage(e) && !e.pos && !erledigt) { out.push(item("ohne-ort", e, `${kurzText(e, blau)} – Ort fehlt`)); continue; }
    if (e.lvz?.status?.v === "offen") out.push(item("offen", e, kurzText(e, blau)));
  }
  // stumme Trupps (nur solche, die schon gemeldet haben)
  for (const u of ex.units?.blau ?? []) {
    const last = lastSign.get(u);
    if (!last || keineVbk.has(u)) continue;
    const min = Math.max(0, Math.round((zeitMs(tLive) - eingangMs(last)) / 60000));
    if (min <= stillMin) continue;
    const ort = ortText(last);
    out.push({ key: `still:${u}`, art: "still", prio: OFFEN_PRIO.still, unit: u, t: last.t, seitMin: min, text: `${u} seit ${min} min ohne Meldung (letzte ${hhmm(last.t)}${ort ? ` ${ort}` : ""})` });
  }
  return out.sort((a, b) => a.prio - b.prio || zeitCmp(b.t, a.t));
}
