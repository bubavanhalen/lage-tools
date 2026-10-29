/**
 * LVZ-Vermerke, Bezüge, Aufheben und «Offen» (Spez. MVP 3, Kap. 3.3, 3.5, 3.7).
 *
 * - Vermerke (dringend, Status, Massnahme, weitergemeldet) sind Zeitstempel-Register pro Feld (`Stamp`): `setVermerk`
 *   ändert nur `lvz.<feld>` und `updatedAt`, **nicht** `rev`; Zusammenführen pro Feld (`mergeLvz`, model.ts).
 * - Abgeleitet statt gespeichert: Status von Aufträgen/Rückfragen aus Bezügen (`vermerkeOf`), «aufgehoben» aus
 *   Meldungen mit `hebtAuf` (`liftMap`).
 * - `offenePunkte`: was bei einer Übergabe nicht vergessen gehen darf.
 *
 * Phase 0: Verträge mit erster, getesteter Umsetzung; Paket A baut aus (Texte, Aufheben-Erkennung, Vorrang).
 * Kein Import aus journal.ts (journal.ts wird `liftMap` importieren).
 */
import { artOf, artText, isLage, lebenszeichen, readArt } from "./arten";
import { AUFHEBBAR, catalogEntry } from "./catalog";
import { compareEvents } from "./clock";
import { QUITTUNG_ERLEDIGT, STILL_MIN } from "./entscheide";
import type { Draft } from "./journal";
import type { Exercise, LageEvent, LvzVermerke, Stamp } from "./model";
import { nrLabel } from "./nummer";

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
    if (!cur || e.t < cur.t) out.set(e.hebtAuf, { t: e.t, by: e.id });
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
    const l = bezuege.get(e.bezug);
    if (l) l.push(e); else bezuege.set(e.bezug, [e]);
  }
  idx = { bezuege, lifts: liftMap(events) };
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
}

/**
 * Stand der Vermerke einer Meldung: gesetzte Vermerke plus abgeleiteter Status. Auftrag/Rückfrage sind «offen», bis
 * `status` erledigt ist oder ein Bezug sie erledigt (Antwort, «ausgeführt»; Quittung nur «quittiert», Entscheid 5).
 * Meldungen haben keinen Status, ausser dringend (→ offen bis erledigt) oder ausdrücklich gesetzt. Vbk «keine» ist offen
 * (bis zum nächsten Lebenszeichen – das prüft `offenePunkte`).
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
    else if (b.bezugArt === "antwort" || (art === "rueckfrage" && b.bezugArt !== "ausgefuehrt")) { out.beantwortet ??= { t: b.t, id: b.id }; if (art === "rueckfrage") erledigtDurch ??= b; }
    else if (b.bezugArt === "ausgefuehrt" && art === "auftrag") erledigtDurch ??= b;
  }
  if (l.status) {
    out.status = l.status.v;
    if (l.status.v === "erledigt") out.erledigtUm = l.status.at;
  } else if (art === "auftrag" || art === "rueckfrage") {
    out.status = erledigtDurch ? "erledigt" : "offen";
    if (erledigtDurch) out.erledigtUm = erledigtDurch.createdAt ?? erledigtDurch.updatedAt;
  } else if (art === "vbk" && e.vbk === "keine") out.status = "offen";
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
    .filter((e) => isLage(e) && e.t <= d.t && istAufhebbar(e) && !idx.lifts.has(e.id) && sameKind(e) && samePlace(e))
    .sort((a, b) => compareEvents(b, a));
}

export type OffenArt = "dringend" | "konflikt" | "auftrag" | "rueckfrage" | "verbindung" | "still" | "ohne-ort" | "offen";

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
}

/** Rangfolge in «Offen» (Kap. 3.7) */
export const OFFEN_PRIO: Record<OffenArt | "auftrag-frist", number> = {
  dringend: 10, konflikt: 20, "auftrag-frist": 25, auftrag: 30, rueckfrage: 40, verbindung: 50, still: 50, "ohne-ort": 60, offen: 70,
};

const hhmm = (t: string) => t.slice(11, 16);
const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
const ortText = (e: Pick<LageEvent, "where" | "cells" | "nai">) => e.where ?? e.cells?.[0] ?? e.nai ?? "";
/** Inhalt ohne Art-Hinweis und ohne Frist («Auftrag an H01: Beo NAI 1 bis 1200» → «Beo NAI 1») */
function inhalt(e: LageEvent, blau: string[]): string {
  let t = readArt(e.text, { blau }).rest.replace(/(?<![\p{L}\d])bis\s+\d{1,2}[:.]?\d{2}(?![\p{L}\d])/u, "").replace(/\s+/g, " ").trim();
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
  const extra = [e.melder && !base.includes(e.melder) ? e.melder : "", ort && !base.includes(ort) ? ort : ""].filter(Boolean);
  return `${artText(e)} ${base}${extra.length ? ` (${extra.join(", ")})` : ""}`.replace(/\s+/g, " ").trim();
}

/**
 * Offene Punkte zur Lagezeit `tLive` (Stand jetzt): dringend & nicht erledigt · Konflikte beim Zusammenführen
 * (`conflictIds` und `history` mit `conflict`, solange nicht «erledigt») · offene Aufträge (Frist vorbei zuerst) ·
 * Rückfragen ohne Antwort · Verbindung «keine» bis zum nächsten Lebenszeichen · Trupp > `stillMin` ohne Lebenszeichen ·
 * Meldungen ohne Ort · ausdrücklich «offen». Sortiert nach `prio`, innerhalb neueste zuerst. Hinweise zu Rot zählen nicht.
 */
export function offenePunkte(ex: Exercise, tLive: string, o: { conflictIds?: string[]; stillMin?: number } = {}): OffenItem[] {
  const all = ex.events ?? [];
  const idx = lvzIndex(all);
  const stillMin = o.stillMin ?? STILL_MIN;
  const conflicts = new Set(o.conflictIds ?? []);
  const blau = ex.units?.blau ?? [];
  const out: OffenItem[] = [];
  const live = all.filter((e) => !e.deleted && e.t <= tLive);
  const item = (art: OffenArt, e: LageEvent, text: string, extra: Partial<OffenItem> = {}): OffenItem => ({
    key: `${art}:${e.id}`, art, prio: OFFEN_PRIO[art], eventId: e.id, t: e.t, text, nr: nrLabel(e, ex), seitMin: minutesBetween(e.t, tLive), ...extra,
  });
  // letzte Lebenszeichen je Trupp
  const lastSign = new Map<string, LageEvent>();
  for (const e of [...live].sort(compareEvents)) { const u = lebenszeichen(e); if (u) lastSign.set(u, e); }
  const keineVbk = new Set<string>();
  for (const e of live) {
    const art = artOf(e);
    const v = vermerkeOf(e, idx);
    const erledigt = v.status === "erledigt";
    const conflict = conflicts.has(e.id) || (e.history ?? []).some((h) => h.conflict);
    if (conflict && !erledigt) out.push(item("konflikt", e, "zwei Fassungen – ansehen"));
    if (v.dringend && !erledigt) { out.push(item("dringend", e, `${kurzText(e, blau)}${v.weiter ? ` – weitergemeldet ${v.weiter.an} ${hhmm(v.weiter.um)}` : ""}`)); continue; }
    if (art === "auftrag" && v.status === "offen") {
      const frist = e.frist;
      const ueberfaellig = !!frist && frist < tLive;
      out.push({ ...item("auftrag", e, `an ${e.an ?? "?"}: ${inhalt(e, ex.units?.blau ?? [])}${frist ? ` – bis ${hhmm(frist)}` : ""}`), prio: ueberfaellig ? OFFEN_PRIO["auftrag-frist"] : OFFEN_PRIO.auftrag, ...(ueberfaellig ? { ueberfaellig } : {}) });
      continue;
    }
    if (art === "rueckfrage" && v.status === "offen") { out.push(item("rueckfrage", e, `${e.an ? `an ${e.an}` : `von ${e.melder ?? "?"}`}: ${inhalt(e, ex.units?.blau ?? [])}`)); continue; }
    if (art === "vbk" && e.vbk === "keine" && e.melder && v.status !== "erledigt") {
      const later = lastSign.get(e.melder);
      if (!later || compareEvents(later, e) < 0) {
        keineVbk.add(e.melder);
        out.push({ ...item("verbindung", e, `${e.melder}: keine Verbindung seit ${hhmm(e.t)}`), unit: e.melder });
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
    const min = minutesBetween(last.t, tLive);
    if (min <= stillMin) continue;
    const ort = ortText(last);
    out.push({ key: `still:${u}`, art: "still", prio: OFFEN_PRIO.still, unit: u, t: last.t, seitMin: min, text: `${u} seit ${min} min ohne Meldung (letzte ${hhmm(last.t)}${ort ? ` ${ort}` : ""})` });
  }
  return out.sort((a, b) => a.prio - b.prio || (a.t < b.t ? 1 : a.t > b.t ? -1 : 0));
}
