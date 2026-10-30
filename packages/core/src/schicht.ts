/**
 * Schichten, Übergabe und Zahlen für den Rapport (Spez. MVP 3, Kap. 3.6, 3.8).
 *
 * - `ex.schichten`: Schichtbeginne (Kürzel gesetzt) und Übergaben, Vereinigung nach ID beim Zusammenführen (sync.ts).
 *   Welche Schicht auf *diesem* Gerät läuft, hält die UI zusätzlich in `localStorage` (`SCHICHT_KEY`, contracts.ts).
 * - `lageBlau`: je eigener Trupp Ort, seit wann, letzte Meldung, letzte Vbk, still, offene Aufträge/Rückfragen.
 * - `rapportZahlen`: Zahlen für Übergabe und Rapport (Schicht und ganze Übung).
 *
 * MVP 3.5 (Spez. MVP 3.5, Kap. 3.4 D3/D4): «Von oben (gültig)» mit allen Orientierungen und Aufträgen von oben
 * (`vonOben`, «bis» = Ende, «ab/um/erwartet» = Beginn), Übergabe-Eintrag im Journal (`uebergabeEintrag`, S20), Zahlen
 * mit Ausgängen und Begehren, offene Hinweise über `offeneHinweise` (eine Zahl, S25). Zeitvergleiche über `zeitCmp`.
 */
import { ART_LABEL, artOf, isLage, lebenszeichen } from "./arten";
import { compareEvents, zeitBis, zeitCmp, zeitMs, zeitTeile } from "./clock";
import { STILL_MIN } from "./entscheide";
import type { Hint } from "./hints";
import { newEventId } from "./model";
import { offeneHinweise } from "./zaehlen";
import { isErsatzOrt, placeLabel, situationAt, unitKey } from "./journal";
import { eingangMs, inhaltText, lvzIndex, offenePunkte, vermerkeOf } from "./lvz";
import type { Exercise, LageEvent, SchichtWechsel } from "./model";
import { nrLabel } from "./nummer";
import { schichtEintraege } from "./schichtwahl";
export { erfasstUm, schichtEintraege, schichtZuordnung } from "./schichtwahl";

/** laufende Schicht dieses Geräts: jüngster Wechsel (`at`) mit `device` – oder null */
export function aktuelleSchicht(ex: Pick<Exercise, "schichten">, device: string): SchichtWechsel | null {
  let best: SchichtWechsel | null = null;
  for (const s of ex.schichten ?? []) if (s.device === device && (!best || s.at > best.at)) best = s; // zeit-ok: ISO UTC (at), kein Lagezeit-Vergleich
  return best;
}

/** Wechsel mit Lagezeit `t` in [from, to] (from null = von Anfang), älteste zuerst */
export function schichtenIm(ex: Pick<Exercise, "schichten">, from: string | null, to: string): SchichtWechsel[] {
  return (ex.schichten ?? []).filter((s) => (!from || zeitBis(from, s.t)) && zeitBis(s.t, to)).sort((a, b) => zeitCmp(a.t, b.t) || (a.at < b.at ? -1 : 1));
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


/** Lage Blau zur Lagezeit `t` (Übergabe-Seite, Abschnitt 1) – in der Reihenfolge von `ex.units.blau` */
export function lageBlau(ex: Exercise, t: string): LageBlauZeile[] {
  const events = (ex.events ?? []).filter((e) => !e.deleted && zeitBis(e, t)).sort(compareEvents);
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
    // letztes Lebenszeichen nach Eingang (Fix N: nachgemeldet «0255» um 03:10 = Lebenszeichen 03:10); nur echte Meldungen
    // eines Trupps (nie Ausgang, Rückfrage/Auftrag von oben – `lebenszeichen`)
    const signs = events.filter((e) => lebenszeichen(e) === trupp);
    const last = signs.reduce<LageEvent | undefined>((a, e) => (!a || eingangMs(e) >= eingangMs(a) ? e : a), undefined);
    // Vbk des Trupps: betroffen ist `an` («H03 keine Verbindung zu H04» → H04), sonst der Melder
    const vbk = events.filter((e) => artOf(e) === "vbk" && (e.an ?? e.melder) === trupp && e.vbk).pop();
    return {
      trupp,
      ort: st ? ort ?? (isErsatzOrt(placeLabel(st.event)) ? null : placeLabel(st.event) || null) : null,
      seit,
      ...(last ? { letzteMeldung: { t: last.t, text: artOf(last) === "meldung" ? inhaltText(last, blau) : `${last.bezugArt === "antwort" ? "Antwort" : ART_LABEL[artOf(last)]} ${inhaltText(last, blau)}`, nr: nrLabel(last, ex) } } : {}),
      ...(vbk ? { letzteVbk: { t: vbk.t, ergebnis: vbk.vbk! } } : {}),
      stillMin: last ? Math.max(0, Math.round((zeitMs(t) - eingangMs(last)) / 60000)) : null,
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
  /** (MVP 3.5, D4) «bis HHMM» = Ende (danach vorbei), «ab|um|erwartet|ca. HHMM» = Beginn (bleibt gültig, «ab 09:07») */
  terminArt?: "bis" | "ab";
  /** (MVP 3.5, D4) Orientierung oder Auftrag von oben (mit `quelle`) */
  art: "orientierung" | "auftrag";
}

/** Zeiten im Inhalt: «bis 0800» (Ende), «1000», «neu 0800» (Termin); «ab/seit/von/um/ca. 2200» (Beginn) */
const TERMIN_RE = /(?<![\p{L}\d:.])(?:(ab|seit|von|bis|um|neu|auf|ca\.?|circa|gegen)\s+)?([01]?\d|2[0-3])[:.h]?([0-5]\d)(?:\s*uhr)?(?![\d'’:.]?\d)/giu;
/** «erwartet» im Text: jede Zeit ohne «bis» ist ein Beginn («Bat: ab 0907 Feind Det … erwartet», «Feind erwartet 0900») */
const ERWARTET_RE = /(?<![\p{L}])erwartet(?![\p{L}])/iu;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Zeit «hhmm» aus dem Inhalt als Lagezeit am Tag des Eintrags (mehr als 6 h davor → nächster Tag) */
function terminZeit(e: Pick<LageEvent, "t">, min: number): number {
  const base = Date.parse(e.t.slice(0, 16));
  let ms = Date.parse(`${e.t.slice(0, 10)}T${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`);
  if (ms < base - 6 * 3600000) ms += 86400000;
  return ms;
}
const isoLokal = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/**
 * (MVP 3.5, D4) Termin einer Orientierung und seine Art: «bis 0800» = **Ende** (`bis`, danach vorbei); «ab|um|erwartet|
 * ca. 0907» = **Beginn** (`ab`, bleibt gültig, Anzeige «ab 09:07»); eine Zeit ohne Wort («Lagerapport 1000») = Termin,
 * danach vorbei (`bis`, Fix 3). Mehrere: das späteste «bis», sonst der früheste Beginn, sonst die späteste Zeit.
 * Tag = Tag des Eintrags; liegt die Zeit mehr als 6 h davor, ist der nächste Tag gemeint. null = keine Zeit im Text.
 */
export function terminInfo(e: Pick<LageEvent, "t">, text: string): { termin: string; art: "bis" | "ab" } | null {
  const erwartet = ERWARTET_RE.test(text);
  const bis: number[] = [], ab: number[] = [], plain: number[] = [];
  for (const m of text.matchAll(TERMIN_RE)) {
    const w = (m[1] ?? "").toLowerCase().replace(/\.$/, "");
    const ms = terminZeit(e, +m[2]! * 60 + +m[3]!);
    if (w === "bis") bis.push(ms);
    else if (w === "ab" || w === "seit" || w === "von" || w === "um" || w === "ca" || w === "circa" || w === "gegen" || erwartet) ab.push(ms);
    else plain.push(ms);
  }
  if (bis.length) return { termin: isoLokal(Math.max(...bis)), art: "bis" };
  if (ab.length) return { termin: isoLokal(Math.min(...ab)), art: "ab" };
  if (plain.length) return { termin: isoLokal(Math.max(...plain)), art: "bis" };
  return null;
}

/**
 * Termin bzw. Ende einer Orientierung (ISO lokal) oder null – nur Ende/Termin (`terminInfo` mit Art «bis»); ein Beginn
 * («ab 2200», «um 1200», «… erwartet») hat keines (MVP 3 Fix 3, Spez. MVP 3.5 D4).
 */
export function terminOf(e: Pick<LageEvent, "t">, text: string): string | null {
  const i = terminInfo(e, text);
  return i?.art === "bis" ? i.termin : null;
}

/**
 * «Von oben (gültig)» für die Übergabe (MVP 3.5, D4): **alle** Orientierungen und Aufträge von oben (mit `quelle`) mit
 * Lagezeit ≤ `t`, nicht gestrichen, jüngste zuerst – unabhängig von der Schicht; gültige vor den vorbei (Termin «bis»
 * bzw. Frist vorbei). Ein Beginn («ab 09:07») bleibt gültig (`terminArt: "ab"`). Die Übergabe zeigt höchstens
 * `VON_OBEN_MAX` gültige und `VON_OBEN_VORBEI` vorbei (entscheide.ts); `n` kürzt die Liste (Standard: alle).
 */
export function vonOben(ex: Pick<Exercise, "events" | "units">, t: string, n = Infinity): VonObenZeile[] {
  const blau = ex.units?.blau ?? [];
  const alle = (ex.events ?? [])
    .filter((e) => !e.deleted && (artOf(e) === "orientierung" || (artOf(e) === "auftrag" && !!e.quelle)) && zeitBis(e, t))
    .sort((a, b) => compareEvents(b, a))
    .map((e): VonObenZeile => {
      const auftrag = artOf(e) === "auftrag";
      // (Fix M3) Auftrag von oben ohne Trupp («Bat verlangt Lagemeldung bis 0800»): ohne «an ?:»
      const frist = e.frist ? ` bis ${e.frist.slice(11, 16).replace(":", "")}` : "";
      const text = auftrag ? (e.an ? `an ${e.an}: ${inhaltText(e, blau)}${frist}` : `${inhaltText(e, blau)}${frist}`) : inhaltText(e, blau);
      const info = auftrag ? (e.frist ? { termin: e.frist, art: "bis" as const } : null) : terminInfo(e, text);
      return {
        id: e.id, nr: nrLabel(e, ex), t: e.t, quelle: e.quelle ?? "", text, art: auftrag ? "auftrag" : "orientierung",
        ...(info ? { termin: info.termin, terminArt: info.art, vorbei: info.art === "bis" && zeitBis(info.termin, t) } : {}),
      };
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
    if (!isLage(e) || e.side !== "rot" || !zeitBis(e, t)) continue;
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
  /** (MVP 3.5, D3) Ausgänge nach Empfänger: Bat (auch Btl), Kp, andere */
  ausgang: { bat: number; kp: number; andere: number };
  /** (MVP 3.5, D3) Meldungen mit Begehren; offen = nicht erledigt (Phase 0: Status über `vermerkeOf`, Standard offen) */
  begehren: { total: number; offen: number };
}

/**
 * Zahlen für den Rapport: Einträge mit Lagezeit `t ≤ to` und – wenn `from` gesetzt – erfasst ab `from`
 * (**ISO UTC**, Schichtbeginn, verglichen mit `createdAt ?? updatedAt`). `from = null` = ganze Übung.
 * Gestrichene zählen nur bei «gestrichen». Hinweise: `offeneHinweise` (ohne Info, entschiedene und beendete erledigt).
 * Übergabe-Einträge (`system`) zählen nicht.
 */
export function rapportZahlen(ex: Exercise, from: string | null, to: string, hints?: Hint[]): RapportZahlen {
  const all = ex.events ?? [];
  const idx = lvzIndex(all);
  const inRange = schichtEintraege(ex, { at: from }, to, { gestrichene: true });
  const z: RapportZahlen = {
    eintraege: 0, gesehen: { feind: 0, unklar: 0, eigen: 0 }, auftraege: { total: 0, offen: 0 }, rueckfragen: { total: 0, offen: 0 },
    dringend: { total: 0, offen: 0 }, korrigiert: 0, gestrichen: 0,
    ausgang: { bat: 0, kp: 0, andere: 0 }, begehren: { total: 0, offen: 0 },
  };
  for (const e of inRange) {
    // Übergabe-Eintrag (S20) ist kein Eintrag der Schicht (D3)
    if (e.system) continue;
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
    // MVP 3.5 (D3): Ausgänge nach Empfänger, Begehren (offen bis erledigt)
    if (art === "ausgang") { const an = (e.an ?? "").toLowerCase(); if (/^(bat|btl)/.test(an)) z.ausgang.bat++; else if (/^kp/.test(an)) z.ausgang.kp++; else z.ausgang.andere++; }
    if (e.begehren) { z.begehren.total++; if (v.status !== "erledigt") z.begehren.offen++; }
  }
  // eine Zahl überall (S25, D5): dieselbe Zählung wie Reiter «Was Rot ⚠n» und Offen
  if (hints) { const h = offeneHinweise(hints, ex.hintDecisions, to); z.hinweise = { offen: h.offen, erledigt: h.erledigt }; }
  return z;
}

/** Meldungen (Art Meldung, nicht gestrichen, keine Aufhebung) – für «Zeige letzte 6 h ab 200» */
export function zaehleMeldungen(ex: Pick<Exercise, "events">): number {
  let n = 0;
  for (const e of ex.events ?? []) if (isLage(e)) n++;
  return n;
}

/** «Übergabe BSP → MU · 4 offen · 18 neu» (Text des Übergabe-Eintrags, S20) */
export function uebergabeText(w: Pick<SchichtWechsel, "von" | "an" | "stand">): string {
  const s = w.stand;
  return [`Übergabe ${w.von || "–"} → ${w.an}`, ...(s ? [`${s.offen} offen`, `${s.neu} neu`] : [])].join(" · ");
}

/**
 * (MVP 3.5, S20/D4) Journaleintrag zu einer abgeschlossenen Übergabe: Art Notiz, `system: "uebergabe"`, `schichtId`,
 * laufende Nummer `nr`, erfasst von = übergebendes Kürzel, Lagezeit `w.t` (16 Zeichen) mit Offset `tOffset` (aus der
 * Geräteuhr). Kein Zeichen, nie offen, zählt nicht in den Einträgen der Schicht (`rapportZahlen`). Suchbar («Übergabe»),
 * im PDF und in der CSV. Die virtuelle Zeile «Schichtwechsel …» der Liste entfällt, wenn es diesen Eintrag gibt.
 */
export function uebergabeEintrag(w: SchichtWechsel, o: { nr: number; device: string; now?: Date; tOffset?: string }): LageEvent {
  const now = o.now ?? new Date();
  const at = now.toISOString();
  const off = o.tOffset ? zeitTeile(`${w.t.slice(0, 16)}${o.tOffset}`).off : undefined;
  return {
    id: newEventId(now.getTime()), rev: 1, device: o.device, updatedAt: at, createdAt: at, t: w.t.slice(0, 16), ...(off ? { tOffset: off } : {}),
    tReported: w.t.slice(0, 16), side: "blau", unit: "", text: uebergabeText(w), sym: "einheit", aff: "F", source: { kind: "text" }, confirmed: true,
    art: "notiz", notiz: true, system: "uebergabe", schichtId: w.id, nr: o.nr, von: o.device, ...(w.von ? { erfasstVon: w.von } : {}),
  };
}

/** Übergabe-Eintrag zu einem Wechsel (nicht gestrichen) – für die Liste (virtuelle Zeile nur ohne Eintrag) */
export function uebergabeEintragZu(ex: Pick<Exercise, "events">, schichtId: string): LageEvent | undefined {
  return (ex.events ?? []).find((e) => e.system === "uebergabe" && e.schichtId === schichtId && !e.deleted);
}
