/**
 * Inhalt der Übergabe (Spez. MVP 3, Kap. 2.7, 3.8, E11) – eine reine Ableitung für Bildschirm und PDF, damit beide
 * dasselbe zeigen. Abschnitte: Lage Blau · Lage Rot · Offene Punkte · Neu seit der letzten Übergabe · Zahlen für den
 * Rapport · Visum. Kurz gehalten (≤ 900 Wörter auch bei 800 Meldungen): Neu höchstens 12 Zeilen, Offen höchstens 12,
 * Lage Rot höchstens zwei Möglichkeiten.
 */
import {
  artOf, catalogEntry, coaHeadline, letzteRotAktivitaet, placeLabel, schichtEintraege, vonOben, kurzText, compareEvents, istStill, isLage, lageBlau, lvzIndex, nrLabel, rapportZahlen, vermerkeOf,
  type Exercise, type Hint, type LageEvent, type OffenItem, type RapportZahlen,
} from "@lage/core";
import type { LageRotState } from "../lageRot";
import { coaWhen } from "../red/redText";
import { klassifizierungOf } from "../shell/contracts";
import { hm, textMitTag, zeitKurz } from "../entry/labels";

export const NEU_MAX = 12;
export const OFFEN_MAX = 12;
/** «Von oben (gültig)»: so viele Orientierungen */
export const VON_OBEN_MAX = 3;

export interface UebergabeZeileBlau { trupp: string; ort: string; seit: string; letzte: string; vbk: string; offen: string; still: string | null }
export interface UebergabeZeileOffen { key: string; mark: string; t: string; nr: string; text: string; meta: string }
/** Zeile «Neu» bzw. «Von oben»: Zeit (mit Tag, wenn nicht heute) · Nr (gedämpft) · Text · Status */
export interface UebergabeZeileNeu { key: string; t: string; nr: string; bang: boolean; text: string; meta: string }
export interface UebergabeDaten {
  titel: string;
  klass: string;
  /** «T2 15.05.2030 07:30» */
  stand: string;
  /** «Schicht BSP seit T2 06:00 (1 h 30 min) · 18 Einträge in der Schicht» */
  schichtZeile: string;
  blau: UebergabeZeileBlau[];
  rot: { gesehen: string | null; zuletzt: string | null; aktivitaet: string | null; moeglich: string[] };
  /** «Von oben (gültig)»: die letzten Orientierungen (Bat, Kp …), unabhängig von der Schicht, jüngste zuerst */
  vonOben: UebergabeZeileNeu[];
  offen: UebergabeZeileOffen[];
  offenTotal: number;
  offenWeitere: number;
  neu: { titel: string; zeilen: UebergabeZeileNeu[]; weitere: number; total: number };
  zahlen: Array<[string, string, string]>;
  /** Kürzel, das übergibt (vorbelegt) */
  von: string | null;
}

const hhmm = (t: string) => t.slice(11, 16);
const datum = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)}`;
const tag = (t: string, days: string[]) => { const i = days.indexOf(t.slice(0, 10)); return i >= 0 ? `T${i + 1}` : ""; };
/** «T2 06:00» bzw. «16.05. 06:00» */
export const tagZeit = (t: string, days: string[]) => `${tag(t, days) || `${t.slice(8, 10)}.${t.slice(5, 7)}.`} ${hhmm(t)}`;
/** «T2 15.05.2030 07:30» */
export const standText = (t: string, days: string[]) => `${tag(t, days) ? tag(t, days) + " " : ""}${datum(t)} ${hhmm(t)}`;
/** «1 h 31 min», «45 min» */
export function dauerText(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
const kurz = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const minutes = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
/** Meldungstext ohne führenden Melder («H05: 4 Pers …» → «4 Pers …») */
const ohneMelder = (e: Pick<LageEvent, "melder" | "text">) => (e.melder ? e.text.replace(new RegExp(`^${e.melder}\\s*(?:meldet)?\\s*[:,]?\\s*`), "") : e.text).trim() || e.text;

const MARK: Record<OffenItem["art"], string> = { dringend: "!", auftrag: "✎", rueckfrage: "✎", verbindung: "⇄", still: "⇄", "ohne-ort": "◆", offen: "•", konflikt: "⚠" };

/** Beginn von «Neu»: eigene Schicht, sonst letzte Übergabe der Übung (ISO UTC) – null = noch keine */
export function neuSeit(ex: Pick<Exercise, "schichten">, seit: string | null): { at: string; t: string | null } | null {
  if (seit) return { at: seit, t: null };
  const last = [...(ex.schichten ?? [])].sort((a, b) => (a.at < b.at ? -1 : 1)).pop();
  return last ? { at: last.at, t: last.t } : null;
}
/**
 * Einträge seit `at` (ISO UTC, erfasst), Lagezeit ≤ t, nicht gestrichen – dieselbe Regel wie Druck und CSV
 * (`schichtEintraege`, MVP 3 Fix 3)
 */
export function neueEintraege(ex: Exercise, at: string | null, t: string): LageEvent[] {
  return schichtEintraege(ex, { at }, t);
}

export interface UebergabeInput {
  ex: Exercise; tLive: string; hints: Hint[]; lage: LageRotState; items: OffenItem[];
  kuerzel: string | null; seit: string | null; seitT: string | null;
}

export function uebergabeDaten(i: UebergabeInput): UebergabeDaten {
  const { ex, tLive: t, lage, items } = i;
  const days = ex.days;
  const neuAb = neuSeit(ex, i.seit);
  const neuList = neueEintraege(ex, neuAb?.at ?? null, t);

  // Kopf
  const schichtZeile = i.kuerzel
    ? `Schicht ${i.kuerzel}${i.seitT ? ` seit ${tagZeit(i.seitT, days)} (${dauerText(minutes(i.seitT, t))})` : ""} · ${neuList.length} ${neuList.length === 1 ? "Eintrag" : "Einträge"} in der Schicht`
    : "Kürzel fehlt – keine Schicht auf diesem Gerät";

  // 1 Lage Blau
  const blau = lageBlau(ex, t).map((z): UebergabeZeileBlau => ({
    trupp: z.trupp,
    ort: z.ort ?? "–",
    seit: z.seit ? tagZeit(z.seit, days) : "–",
    letzte: z.letzteMeldung ? `${zeitKurz(z.letzteMeldung.t, t, days)} ${kurz(ohneMelder({ melder: z.trupp, text: z.letzteMeldung.text }), 38)}` : "–",
    vbk: z.letzteVbk ? `${zeitKurz(z.letzteVbk.t, t, days)} ${z.letzteVbk.ergebnis}` : "–",
    offen: z.offen.map((o) => `${o.art === "auftrag" ? "Auftrag" : "Rückfrage"} ${o.nr}${o.ueberfaellig ? " ⚠" : ""}`).join(", "),
    still: istStill(z) ? `${z.stillMin} min still` : null,
  }));

  // 2 Lage Rot
  const row = (k: string) => lage.compare.find((c) => c.row.key === k);
  const seen = (k: string) => { const c = row(k)?.found; return c ? c.min || c.max : 0; };
  const exp = (["pers", "fz"] as const).map((k) => [k, row(k)?.expected] as const).filter(([, v]) => v !== undefined);
  const anyRed = (ex.events ?? []).some((e) => isLage(e) && e.side === "rot" && e.t.slice(0, 16) <= t);
  const gesehen = anyRed
    ? `Rot gesehen: mind. ${seen("pers")} Pers, ${seen("fz")} Fz${exp.length ? ` · erwartet ${exp.map(([k, v]) => `${v} ${k === "pers" ? "Pers" : "Fz"}`).join(", ")}` : ""}`
    : null;
  // zuletzt gesehene benannte Feindelemente
  const lastRed = new Map<string, LageEvent>();
  for (const e of [...(ex.events ?? [])].filter((x) => isLage(x) && x.side === "rot" && x.unit && x.t.slice(0, 16) <= t).sort(compareEvents)) lastRed.set(e.unit, e);
  const notSeen = new Map(lage.force.notSeen.map((n) => [n.unit, n.minutes]));
  const zuletzt = [...lastRed.values()].sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 4).map((e) => {
    const ns = notSeen.get(e.unit);
    const ort = e.where ?? e.cells?.[0] ?? e.nai ?? "";
    const wann = e.t.slice(0, 10) === t.slice(0, 10) ? hhmm(e.t) : tagZeit(e.t, days);
    return `${e.unit}${ort ? ` ${ort}` : ""} (${wann}${ns ? `, seit ${ns >= 60 ? `${Math.floor(ns / 60)} h` : `${ns} min`} nicht mehr` : ""})`;
  });
  // letzte Rot-Aktivität (auch ohne Element, z. B. Drohne), wenn sie nicht schon unter «Zuletzt gesehen» steht
  const akt = letzteRotAktivitaet(ex, t);
  const aktNeu = akt && !(akt.unit && lastRed.get(akt.unit)?.id === akt.id && zuletzt.length);
  const aktivitaet = akt && aktNeu ? (() => {
    const was = akt.desc || catalogEntry(akt.sym)?.name || kurz(kurzText(akt, ex.units?.blau ?? []), 40);
    const ort = placeLabel(akt);
    return `Zuletzt Rot-Aktivität: ${zeitKurz(akt.t, t, days)} ${was}${ort ? ` ${ort}` : ""}${akt.melder ? ` (von ${akt.melder})` : ""}`;
  })() : null;
  const moeglich = lage.coas.filter((c) => c.label !== "weitere").slice(0, 2).map((c) => {
    const w = coaWhen(c, ex, t);
    return `${c.label === "wahrscheinlichste" ? "Am wahrscheinlichsten" : "Am gefährlichsten"}: ${coaHeadline(c)}${w && w.state !== "offen" ? ` – ${w.text}` : ""}`;
  });

  // 3 Offene Punkte
  const offen = items.slice(0, OFFEN_MAX).map((it): UebergabeZeileOffen => ({
    key: it.key, mark: MARK[it.art], t: it.art === "still" ? "" : zeitKurz(it.t, t, days), nr: it.nr ?? "", text: textMitTag(it.text, it.t, t, days),
    meta: it.art === "auftrag" ? (it.ueberfaellig ? "⚠ Frist vorbei" : `seit ${dauerText(it.seitMin)}`) : it.art === "rueckfrage" ? `seit ${dauerText(it.seitMin)}` : "",
  }));

  // 4 Neu: dringend → Feind → Auftrag/Rückfrage → Rest, je jüngste zuerst
  const idx = lvzIndex(ex.events ?? []);
  const rang = (e: LageEvent) => {
    if (vermerkeOf(e, idx).dringend) return 0;
    if (isLage(e) && e.side === "rot" && e.aff !== "U") return 1;
    const a = artOf(e);
    if (a === "auftrag" || a === "rueckfrage") return 2;
    return 3;
  };
  const sorted = [...neuList].sort((a, b) => rang(a) - rang(b) || (a.t < b.t ? 1 : a.t > b.t ? -1 : 0));
  const blauNamen = ex.units?.blau ?? [];
  /** Status eines dringenden Eintrags in «Neu» (Prüfung M5): «erledigt 07:40 · Massnahme: …» bzw. «offen» */
  const status = (e: LageEvent): string => {
    const v = vermerkeOf(e, idx);
    if (!v.dringend) return "";
    const teile = [v.status === "erledigt" ? `erledigt${v.erledigtUm ? ` ${hm(v.erledigtUm)}` : ""}` : "offen"];
    if (v.massnahme) teile.push(`Massnahme: ${v.massnahme}`);
    return teile.join(" · ");
  };
  const zeile = (e: LageEvent, n = 90): UebergabeZeileNeu => ({
    key: e.id, t: zeitKurz(e.t, t, days), nr: nrLabel(e, ex), bang: vermerkeOf(e, idx).dringend, text: kurz(kurzText(e, blauNamen), n), meta: status(e),
  });
  const neuZeilen = sorted.slice(0, NEU_MAX).map((e) => zeile(e));
  const n = `${neuList.length} ${neuList.length === 1 ? "Eintrag" : "Einträge"}`;
  // eigene Schicht nur mit dem Kürzel begonnen (keine Übergabe): «Neu in dieser Schicht»
  const eigenerBeginn = i.seit ? (ex.schichten ?? []).find((w) => w.at === i.seit) : undefined;
  const neuTitel = !neuAb ? `Neu (noch keine Übergabe) – ${n}`
    : eigenerBeginn && eigenerBeginn.art === "beginn" ? `Neu in dieser Schicht (seit ${tagZeit(eigenerBeginn.t ?? i.seitT ?? t, days)}) – ${n}`
    : `Neu seit der letzten Übergabe (${tagZeit(neuAb.t ?? i.seitT ?? t, days)}) – ${n}`;

  // Von oben (gültig): die letzten Orientierungen, unabhängig von der Schicht
  const byId = new Map((ex.events ?? []).map((e) => [e.id, e]));
  const oben = vonOben(ex, t, VON_OBEN_MAX).map((z): UebergabeZeileNeu => {
    const e = byId.get(z.id);
    // Fix 3: Abgelaufenes nie als gültig – «Lagerapport 1000 im KP · vorbei (10:00)»
    const meta = [z.vorbei && z.termin ? `vorbei (${zeitKurz(z.termin, t, days)})` : "", e ? status(e) : ""].filter(Boolean).join(" · ");
    return { key: z.id, t: zeitKurz(z.t, t, days), nr: z.nr, bang: !!e && vermerkeOf(e, idx).dringend, text: kurz(`${z.quelle ? `${z.quelle}: ` : ""}${z.text}`, 140), meta };
  });

  // 5 Zahlen
  const zs = rapportZahlen(ex, neuAb?.at ?? null, t, i.hints);
  const za = rapportZahlen(ex, null, t, i.hints);
  const zahl = (z: RapportZahlen, k: "auftraege" | "rueckfragen" | "dringend") => `${z[k].total} (${z[k].offen})`;
  const zahlen: Array<[string, string, string]> = [
    ["Einträge", String(zs.eintraege), String(za.eintraege)],
    ["Feind / Unklar / Eigene gesehen", `${zs.gesehen.feind}/${zs.gesehen.unklar}/${zs.gesehen.eigen}`, `${za.gesehen.feind}/${za.gesehen.unklar}/${za.gesehen.eigen}`],
    ["Aufträge (offen)", zahl(zs, "auftraege"), zahl(za, "auftraege")],
    ["Rückfragen (offen)", zahl(zs, "rueckfragen"), zahl(za, "rueckfragen")],
    ["Dringend (offen)", zahl(zs, "dringend"), zahl(za, "dringend")],
    ["Korrigiert / gestrichen", `${zs.korrigiert} / ${zs.gestrichen}`, `${za.korrigiert} / ${za.gestrichen}`],
    ["Hinweise zu Rot offen / erledigt", "", za.hinweise ? `${za.hinweise.offen} / ${za.hinweise.erledigt}` : "–"],
  ];

  return {
    titel: ex.name, klass: klassifizierungOf(ex), stand: standText(t, days), schichtZeile, blau,
    rot: { gesehen, zuletzt: zuletzt.length ? `Zuletzt gesehen: ${zuletzt.join(" · ")}` : null, aktivitaet, moeglich },
    vonOben: oben,
    offen, offenTotal: items.length, offenWeitere: Math.max(0, items.length - OFFEN_MAX),
    neu: { titel: neuTitel, zeilen: neuZeilen, weitere: Math.max(0, neuList.length - NEU_MAX), total: neuList.length },
    zahlen, von: i.kuerzel,
  };
}
