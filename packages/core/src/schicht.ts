/**
 * Schichten, Übergabe und Zahlen für den Rapport (Spez. MVP 3, Kap. 3.6, 3.8).
 *
 * - `ex.schichten`: Schichtbeginne (Kürzel gesetzt) und Übergaben, Vereinigung nach ID beim Zusammenführen (sync.ts).
 *   Welche Schicht auf *diesem* Gerät läuft, hält die UI zusätzlich in `localStorage` (`SCHICHT_KEY`, contracts.ts).
 * - `lageBlau`: je eigener Trupp Ort, seit wann, letzte Meldung, letzte Vbk, still, offene Aufträge/Rückfragen.
 * - `rapportZahlen`: Zahlen für Übergabe und Rapport (Schicht und ganze Übung).
 *
 * Phase 0: erste, getestete Umsetzung; Paket A baut aus (Kurztexte, Ort-Seit-Regel), Paket C zeigt an.
 */
import { ART_LABEL, artOf, isLage, lebenszeichen } from "./arten";
import { compareEvents } from "./clock";
import { STILL_MIN } from "./entscheide";
import type { Hint } from "./hints";
import { isErsatzOrt, placeLabel, situationAt, unitKey } from "./journal";
import { inhaltText, lvzIndex, offenePunkte, vermerkeOf } from "./lvz";
import type { Exercise, LageEvent, SchichtWechsel } from "./model";
import { nrLabel } from "./nummer";
import { schichtEintraege } from "./schichtwahl";
export { erfasstUm, schichtEintraege, schichtZuordnung } from "./schichtwahl";

/** laufende Schicht dieses Geräts: jüngster Wechsel (`at`) mit `device` – oder null */
export function aktuelleSchicht(ex: Pick<Exercise, "schichten">, device: string): SchichtWechsel | null {
  let best: SchichtWechsel | null = null;
  for (const s of ex.schichten ?? []) if (s.device === device && (!best || s.at > best.at)) best = s;
  return best;
}

/** Wechsel mit Lagezeit `t` in [from, to] (from null = von Anfang), älteste zuerst */
export function schichtenIm(ex: Pick<Exercise, "schichten">, from: string | null, to: string): SchichtWechsel[] {
  return (ex.schichten ?? []).filter((s) => (!from || s.t >= from) && s.t <= to).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.at < b.at ? -1 : 1));
}

/** Schichten zusammenführen: Vereinigung nach ID (bei gleicher ID gilt `a`), nach `at` sortiert */
export function mergeSchichten(a?: SchichtWechsel[], b?: SchichtWechsel[]): SchichtWechsel[] | undefined {
  if (!b?.length) return a;
  if (!a?.length) return b;
  const map = new Map(a.map((s) => [s.id, s]));
  for (const s of b) if (!map.has(s.id)) map.set(s.id, s);
  return [...map.values()].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.id < y.id ? -1 : 1));
}

export interface LageBlauZeile {
  trupp: string;
  /** letzter genauer Standort (`placeLabel`), null ohne Standort */
  ort: string | null;
  /** seit wann an diesem Standort (ISO lokal) */
  seit: string | null;
  letzteMeldung?: { t: string; text: string; nr: string };
  letzteVbk?: { t: string; ergebnis: NonNullable<LageEvent["vbk"]> };
  /** Minuten seit dem letzten Lebenszeichen (null ohne Lebenszeichen) */
  stillMin: number | null;
  offen: Array<{ nr: string; art: "auftrag" | "rueckfrage"; text: string; frist?: string; ueberfaellig: boolean }>;
}

const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));

/** Lage Blau zur Lagezeit `t` (Übergabe-Seite, Abschnitt 1) – in der Reihenfolge von `ex.units.blau` */
export function lageBlau(ex: Exercise, t: string): LageBlauZeile[] {
  const events = (ex.events ?? []).filter((e) => !e.deleted && e.t <= t).sort(compareEvents);
  const sit = situationAt(events, t);
  const offen = offenePunkte(ex, t);
  const blau = ex.units?.blau ?? [];
  return blau.map((trupp) => {
    const st = sit.units.find((u) => u.key === unitKey("blau", trupp));
    // seit: erste Meldung der letzten ununterbrochenen Folge am aktuellen Standort; Ort: jüngste Meldung dieser Folge
    // mit einem genannten Ort (nie der frühere Ersatzort «letzter Standort» – Standort bleibt, Entscheid)
    let seit: string | null = null;
    let ort: string | null = null;
    if (st) {
      for (const e of events) {
        if (e.side !== "blau" || !e.pos || unitKey("blau", e.unit) !== st.key || !isLage(e)) continue;
        const same = e.pos.e === st.pos.e && e.pos.n === st.pos.n;
        if (!same) { seit = null; ort = null; continue; }
        seit ??= e.t;
        const l = placeLabel(e);
        if (l && !isErsatzOrt(l)) ort = l;
      }
    }
    const signs = events.filter((e) => lebenszeichen(e) === trupp);
    const last = signs[signs.length - 1];
    const vbk = events.filter((e) => artOf(e) === "vbk" && e.melder === trupp && e.vbk).pop();
    return {
      trupp,
      ort: st ? ort ?? (isErsatzOrt(placeLabel(st.event)) ? null : placeLabel(st.event) || null) : null,
      seit,
      ...(last ? { letzteMeldung: { t: last.t, text: artOf(last) === "meldung" ? inhaltText(last, blau) : `${last.bezugArt === "antwort" ? "Antwort" : ART_LABEL[artOf(last)]} ${inhaltText(last, blau)}`, nr: nrLabel(last, ex) } } : {}),
      ...(vbk ? { letzteVbk: { t: vbk.t, ergebnis: vbk.vbk! } } : {}),
      stillMin: last ? minutesBetween(last.t, t) : null,
      offen: offen
        .filter((o) => o.eventId && (o.art === "auftrag" || o.art === "rueckfrage"))
        .filter((o) => { const e = events.find((x) => x.id === o.eventId)!; return o.art === "auftrag" ? e.an === trupp : e.melder === trupp || e.an === trupp; })
        .map((o) => {
          const e = events.find((x) => x.id === o.eventId)!;
          return { nr: o.nr ?? "", art: o.art as "auftrag" | "rueckfrage", text: o.text, ...(e.frist ? { frist: e.frist } : {}), ueberfaellig: !!o.ueberfaellig };
        }),
    };
  });
}

export interface VonObenZeile {
  id: string;
  /** laufende Nummer («57», «12a») */
  nr: string;
  /** Lagezeit (ISO lokal) */
  t: string;
  /** Absender («Bat», «Kp», «Kdt» …), leer wenn keiner genannt */
  quelle: string;
  /** Inhalt ohne Art-Hinweis («Lagerapport 1800 im KP») */
  text: string;
  /** Termin bzw. Ende aus dem Text (ISO lokal): «Lagerapport 1000» → 10:00, «Funkstille bis 0800» → 08:00; «ab 2200» hat keines */
  termin?: string;
  /** Termin liegt vor `t` – abgelaufen, nicht mehr gültig (MVP 3 Fix 3) */
  vorbei?: boolean;
}

/** Zeiten im Inhalt: «bis 0800» (Ende), «1000», «um 1200», «neu 0800» (Termin); «ab/seit/von 2200» (Beginn, kein Ende) */
const TERMIN_RE = /(?<![\p{L}\d:.])(?:(ab|seit|von|bis|um|neu|auf)\s+)?([01]?\d|2[0-3])[:.h]?([0-5]\d)(?:\s*uhr)?(?![\d'’:.]?\d)/giu;
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Termin bzw. Ende einer Orientierung (ISO lokal) oder null: das späteste «bis …», sonst die späteste Zeit ohne «ab/seit/
 * von». Tag = Tag der Orientierung; liegt die Zeit mehr als 6 h vor der Orientierung, ist der nächste Tag gemeint
 * («2200 Bat: Lagerapport 0700» → 07:00 am Folgetag).
 */
export function terminOf(e: Pick<LageEvent, "t">, text: string): string | null {
  const base = Date.parse(e.t.slice(0, 16));
  const abs = (min: number) => {
    let ms = Date.parse(`${e.t.slice(0, 10)}T${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`);
    if (ms < base - 6 * 3600000) ms += 86400000;
    return ms;
  };
  const bis: number[] = [], plain: number[] = [];
  for (const m of text.matchAll(TERMIN_RE)) {
    const w = (m[1] ?? "").toLowerCase();
    const ms = abs(+m[2]! * 60 + +m[3]!);
    if (w === "bis") bis.push(ms);
    else if (w !== "ab" && w !== "seit" && w !== "von") plain.push(ms);
  }
  const list = bis.length ? bis : plain;
  if (!list.length) return null;
  const d = new Date(Math.max(...list));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * «Von oben (gültig)» für die Übergabe (Entscheid MVP 3 Nachbesserung): die letzten `n` Orientierungen mit Lagezeit ≤ `t`,
 * nicht gestrichen, jüngste zuerst – **unabhängig von der Schicht** (Befehle von oben gehen nie im Abschnitt «Neu» unter).
 * MVP 3 Fix 3: eine Orientierung mit vergangenem Termin («Lagerapport 1000» um 10:10) ist `vorbei` und steht nach den
 * gültigen – sie füllt nur freie Plätze und nie vor einer gültigen.
 */
export function vonOben(ex: Pick<Exercise, "events" | "units">, t: string, n = 3): VonObenZeile[] {
  const blau = ex.units?.blau ?? [];
  const alle = (ex.events ?? [])
    .filter((e) => !e.deleted && artOf(e) === "orientierung" && e.t.slice(0, 16) <= t.slice(0, 16))
    .sort((a, b) => compareEvents(b, a))
    .map((e): VonObenZeile => {
      const text = inhaltText(e, blau);
      const termin = terminOf(e, text);
      return { id: e.id, nr: nrLabel(e, ex), t: e.t, quelle: e.quelle ?? "", text, ...(termin ? { termin, vorbei: termin <= t.slice(0, 16) } : {}) };
    });
  return [...alle.filter((z) => !z.vorbei), ...alle.filter((z) => z.vorbei)].slice(0, n);
}

/**
 * Letzte Rot-Aktivität für «Lage Rot» der Übergabe (Prüfung Übergabe, Frage 2): jüngste Lage-Meldung der Seite Rot (Feind
 * oder Unklar, mit oder ohne bekanntes Element, z. B. «Drohne über NAI 3») mit Lagezeit ≤ `t` – keine Aufhebung, nicht
 * gestrichen. null, wenn Rot noch nie gesehen wurde.
 */
export function letzteRotAktivitaet(ex: Pick<Exercise, "events">, t: string): LageEvent | null {
  let best: LageEvent | null = null;
  for (const e of ex.events ?? []) {
    if (!isLage(e) || e.side !== "rot" || e.t.slice(0, 16) > t.slice(0, 16)) continue;
    if (!best || compareEvents(e, best) > 0) best = e;
  }
  return best;
}

/** «still» nach Entscheid 3 (Minuten), für Anzeige «62 min still» */
export const istStill = (z: Pick<LageBlauZeile, "stillMin">, stillMin = STILL_MIN) => z.stillMin !== null && z.stillMin > stillMin;

export interface RapportZahlen {
  eintraege: number;
  gesehen: { feind: number; unklar: number; eigen: number };
  auftraege: { total: number; offen: number };
  rueckfragen: { total: number; offen: number };
  dringend: { total: number; offen: number };
  korrigiert: number;
  gestrichen: number;
  hinweise?: { offen: number; erledigt: number };
}

/**
 * Zahlen für den Rapport: Einträge mit Lagezeit `t ≤ to` und – wenn `from` gesetzt – erfasst ab `from`
 * (**ISO UTC**, Schichtbeginn, verglichen mit `createdAt ?? updatedAt`). `from = null` = ganze Übung.
 * Gestrichene zählen nur bei «gestrichen». Hinweise: offen = ohne `until` und nicht verworfen, sonst erledigt.
 */
export function rapportZahlen(ex: Exercise, from: string | null, to: string, hints?: Hint[]): RapportZahlen {
  const all = ex.events ?? [];
  const idx = lvzIndex(all);
  const inRange = schichtEintraege(ex, { at: from }, to, { gestrichene: true });
  const z: RapportZahlen = {
    eintraege: 0, gesehen: { feind: 0, unklar: 0, eigen: 0 }, auftraege: { total: 0, offen: 0 }, rueckfragen: { total: 0, offen: 0 },
    dringend: { total: 0, offen: 0 }, korrigiert: 0, gestrichen: 0,
  };
  for (const e of inRange) {
    if (e.deleted) { z.gestrichen++; continue; }
    z.eintraege++;
    if ((e.history ?? []).some((h) => !h.conflict)) z.korrigiert++;
    const v = vermerkeOf(e, idx);
    const art = artOf(e);
    if (isLage(e)) {
      if (e.side === "blau") z.gesehen.eigen++;
      else if (e.aff === "U" || e.aff === "N") z.gesehen.unklar++;
      else z.gesehen.feind++;
    }
    if (art === "auftrag") { z.auftraege.total++; if (v.status === "offen") z.auftraege.offen++; }
    if (art === "rueckfrage") { z.rueckfragen.total++; if (v.status === "offen") z.rueckfragen.offen++; }
    if (v.dringend) { z.dringend.total++; if (v.status !== "erledigt") z.dringend.offen++; }
  }
  if (hints) {
    let offen = 0, erledigt = 0;
    for (const h of hints) {
      const d = ex.hintDecisions?.[h.id];
      if (!h.until && d?.state !== "verworfen") offen++; else erledigt++;
    }
    z.hinweise = { offen, erledigt };
  }
  return z;
}

/** Meldungen (Art Meldung, nicht gestrichen, keine Aufhebung) – für «Zeige letzte 6 h ab 200» */
export function zaehleMeldungen(ex: Pick<Exercise, "events">): number {
  let n = 0;
  for (const e of ex.events ?? []) if (isLage(e)) n++;
  return n;
}
