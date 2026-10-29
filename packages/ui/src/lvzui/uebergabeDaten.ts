/**
 * Inhalt der Übergabe (Spez. MVP 3, Kap. 2.7, 3.8, E11) – eine reine Ableitung für Bildschirm und PDF, damit beide
 * dasselbe zeigen. Abschnitte: Lage Blau · Lage Rot · Offene Punkte · Neu seit der letzten Übergabe · Zahlen für den
 * Rapport · Visum. Kurz gehalten (≤ 900 Wörter auch bei 800 Meldungen): Neu höchstens 12 Zeilen, Offen höchstens 12,
 * Lage Rot höchstens zwei Möglichkeiten.
 */
import {
  artOf, artText, coaHeadline, compareEvents, istStill, isLage, lageBlau, lvzIndex, nrLabel, rapportZahlen, vermerkeOf,
  type Exercise, type Hint, type LageEvent, type OffenItem, type RapportZahlen,
} from "@lage/core";
import type { LageRotState } from "../lageRot";
import { coaWhen } from "../red/redText";
import { klassifizierungOf } from "../shell/contracts";

export const NEU_MAX = 12;
export const OFFEN_MAX = 12;

export interface UebergabeZeileBlau { trupp: string; ort: string; seit: string; letzte: string; vbk: string; offen: string; still: string | null }
export interface UebergabeZeileOffen { key: string; mark: string; t: string; nr: string; text: string; meta: string }
export interface UebergabeDaten {
  titel: string;
  klass: string;
  /** «T2 15.05.2030 07:30» */
  stand: string;
  /** «Schicht BSP seit T2 06:00 (1 h 30 min) · 18 Einträge in der Schicht» */
  schichtZeile: string;
  blau: UebergabeZeileBlau[];
  rot: { gesehen: string | null; zuletzt: string | null; moeglich: string[] };
  offen: UebergabeZeileOffen[];
  offenTotal: number;
  offenWeitere: number;
  neu: { titel: string; zeilen: string[]; weitere: number; total: number };
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
const erfasst = (e: LageEvent) => e.createdAt ?? e.updatedAt;

/** Einträge seit `at` (ISO UTC, erfasst), Lagezeit ≤ t, nicht gestrichen */
export function neueEintraege(ex: Exercise, at: string | null, t: string): LageEvent[] {
  return (ex.events ?? []).filter((e) => !e.deleted && e.t.slice(0, 16) <= t && (!at || erfasst(e) >= at));
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
    letzte: z.letzteMeldung ? `${hhmm(z.letzteMeldung.t)} ${kurz(ohneMelder({ melder: z.trupp, text: z.letzteMeldung.text }), 38)}` : "–",
    vbk: z.letzteVbk ? `${hhmm(z.letzteVbk.t)} ${z.letzteVbk.ergebnis}` : "–",
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
  const moeglich = lage.coas.filter((c) => c.label !== "weitere").slice(0, 2).map((c) => {
    const w = coaWhen(c, ex, t);
    return `${c.label === "wahrscheinlichste" ? "Am wahrscheinlichsten" : "Am gefährlichsten"}: ${coaHeadline(c)}${w && w.state !== "offen" ? ` – ${w.text}` : ""}`;
  });

  // 3 Offene Punkte
  const offen = items.slice(0, OFFEN_MAX).map((it): UebergabeZeileOffen => ({
    key: it.key, mark: MARK[it.art], t: it.art === "still" ? "" : hhmm(it.t), nr: it.nr ?? "", text: it.text,
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
  const neuZeilen = sorted.slice(0, NEU_MAX).map((e) => `${hhmm(e.t)} ${nrLabel(e, ex)} ${vermerkeOf(e, idx).dringend ? "! " : ""}${artText(e)}: ${kurz(ohneMelder(e), 60)}${e.melder && artOf(e) === "meldung" ? ` (${e.melder})` : ""}`);
  const neuTitel = neuAb
    ? `Neu seit der letzten Übergabe (${tagZeit(neuAb.t ?? i.seitT ?? t, days)}) – ${neuList.length} ${neuList.length === 1 ? "Eintrag" : "Einträge"}`
    : `Neu (noch keine Übergabe) – ${neuList.length} ${neuList.length === 1 ? "Eintrag" : "Einträge"}`;

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
    rot: { gesehen, zuletzt: zuletzt.length ? `Zuletzt gesehen: ${zuletzt.join(" · ")}` : null, moeglich },
    offen, offenTotal: items.length, offenWeitere: Math.max(0, items.length - OFFEN_MAX),
    neu: { titel: neuTitel, zeilen: neuZeilen, weitere: Math.max(0, neuList.length - NEU_MAX), total: neuList.length },
    zahlen, von: i.kuerzel,
  };
}
