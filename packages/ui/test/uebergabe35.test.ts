/**
 * Übergabe MVP 3.5 (Spez. MVP 3.5, Kap. 2.7, D4/D5/D7) ohne Browser: «Von oben (gültig)» höchstens 8 gültige + «+n
 * weitere», höchstens 2 vorbei, «ab 09:07»; «Stand» = Geräteuhr; Übergabe-Eintrag nicht unter «Neu»; Zahlen mit Ausgang
 * und Begehren; Wörter (Schätzung) unter dem Budget. Nur fiktive Daten (Beispiel Bern, demoLang).
 */
import { describe, expect, it } from "vitest";
import { demoExercise, demoLang, eventFromDraft, lastPosition, nextNr, offenePunkte, parseMeldung, uebergabeEintrag, type Exercise } from "@lage/core";
import type { LageRotState } from "../src/lageRot";
import { uebergabeDaten, type UebergabeDaten } from "../src/lvzui/uebergabeDaten";

const LEER_ROT: LageRotState = { coas: [], more: [], force: { rows: [], notSeen: [] }, spec: null, compare: [], from: null, hints: [] };
const at = (hhmm: string) => new Date(`2030-05-15T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00+02:00`);
function trage(ex: Exercise, s: string, hhmm: string): void {
  const now = at(hhmm);
  const d = parseMeldung(s, { sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now, lastPos: (u, si) => lastPosition(ex.events!, si, u), events: ex.events, ex });
  ex.events = [...(ex.events ?? []), eventFromDraft(d, "dev-a", now, { nr: nextNr(ex, 0), kuerzel: "BSP" })];
}
const daten = (ex: Exercise, t: string, tUhr?: string) => uebergabeDaten({ ex, tLive: t, hints: [], lage: LEER_ROT, items: offenePunkte(ex, t), kuerzel: "BSP", seit: null, seitT: null, ...(tUhr ? { tUhr } : {}) });
/** Wörter der Seite (wie `woerterImBrowser`, grob): alle Texte und Überschriften */
function woerter(d: UebergabeDaten): number {
  const t = [d.titel, d.klass, `Stand ${d.stand}`, d.schichtZeile, ...d.blau.flatMap((z) => [z.trupp, z.ort, z.seit, z.letzte, z.vbk, z.offen, z.still ?? ""]),
    d.rot.gesehen, d.rot.zuletzt, d.rot.aktivitaet, ...d.rot.moeglich, ...d.vonOben.flatMap((z) => [z.t, `Nr ${z.nr}`, z.text, z.meta]),
    ...d.offen.flatMap((o) => [o.t, `Nr ${o.nr}`, o.text, o.meta]), d.neu.titel, ...d.neu.zeilen.flatMap((z) => [z.t, `Nr ${z.nr}`, z.text, z.meta]),
    ...d.zahlen.flat(), "1 Lage Blau Trupp Ort seit letzte Meldung letzte Vbk offen 2 Lage Rot 3 Von oben (gültig) 4 Offene Punkte 5 6 Zahlen für den Rapport Schicht ganze Übung 7 Visum übergeben von um übernommen von Letzte Übergabe als PDF Als PDF Übergabe abschliessen Schliessen"].join(" ");
  return t.split(/\s+/).filter(Boolean).length;
}

describe("Übergabe «Von oben (gültig)» (D4)", () => {
  it("12 von oben um 10:10: 8 gültige, «+n weitere», höchstens 2 vorbei, «ab 09:07»", () => {
    const ex = demoExercise();
    trage(ex, "Bat: ab 0907 Feind Det mit 2 Fz aus Rtg Belp erwartet", "0747");
    for (let i = 0; i < 4; i++) trage(ex, `Bat: Lagerapport 08${i}0 im KP Bat`, `075${i}`);
    for (let i = 0; i < 8; i++) trage(ex, `Kp: Nachbar ${i + 1} links`, `080${i}`);
    const d = daten(ex, "2030-05-15T10:10");
    const gueltig = d.vonOben.filter((z) => !z.meta.includes("vorbei"));
    expect(gueltig.length).toBe(8);
    expect(d.vonObenWeitere).toBe(1);
    expect(d.vonOben.filter((z) => /\(vorbei \d\d:\d\d\)/.test(z.meta)).length).toBe(2);
    expect(d.vonOben.some((z) => z.text === "Bat: ab 09:07 Feind Det mit 2 Fz aus Rtg Belp erwartet")).toBe(false); // jüngere zuerst – ab 09:07 ist die älteste gültige
    trage(ex, "Bat: ab 0907 Feind Det mit 2 Fz aus Rtg Belp erwartet", "0810");
    expect(daten(ex, "2030-05-15T10:10").vonOben[0]!.text).toBe("Bat: ab 09:07 Feind Det mit 2 Fz aus Rtg Belp erwartet");
  });
  it("Auftrag von oben steht dabei («Kdt: an H03: … bis 12:00»)", () => {
    const ex = demoExercise();
    trage(ex, "Kp Kdt: Auftrag an H03 NAI 2 überwachen bis 1200", "0750");
    expect(daten(ex, "2030-05-15T08:00").vonOben[0]!.text).toBe("Kdt: an H03: NAI 2 überwachen bis 12:00");
  });
});

describe("Stand, Neu, Zahlen (D4/D5)", () => {
  it("«Stand» = Geräteuhr; Übergabe-Eintrag nicht unter «Neu» und nicht in den Einträgen", () => {
    const ex = demoExercise();
    const t = "2030-05-15T07:30";
    const d0 = daten(ex, t, "2030-05-15T07:31+02:00");
    expect(d0.stand).toBe("T2 15.05.2030 07:31");
    ex.events = [...ex.events!, uebergabeEintrag({ id: "w1", art: "uebergabe", at: "2030-05-15T05:30:00.000Z", t, an: "MU", von: "BSP", device: "dev-a" }, { nr: nextNr(ex, 0), device: "dev-a" })];
    const d1 = daten(ex, t);
    expect(d1.neu.total).toBe(d0.neu.total);
    expect(d1.neu.zeilen.some((z) => /Übergabe BSP/.test(z.text))).toBe(false);
    expect(d1.zahlen[0]).toEqual(d0.zahlen[0]);
  });
  it("Zahlen: «Begehren (offen)», «Ausgang an Bat / Kp», «Hinweise zu Rot offen»", () => {
    const ex = demoExercise();
    trage(ex, "Meldung an Bat: 2 Kpz AK9", "0731");
    const z = Object.fromEntries(daten(ex, "2030-05-15T08:00").zahlen.map((r) => [r[0], r[2]]));
    expect(z["Ausgang an Bat / Kp"]).toBe("1 / 0");
    expect(z["Begehren (offen)"]).toMatch(/^\d+ \(\d+\)$/);
    expect(z).toHaveProperty("Hinweise zu Rot offen");
  });
  it("Wörter (Schätzung) bei der langen Übung unter 900", () => {
    const lang = demoLang();
    const n = woerter(daten(lang, "2030-05-18T07:30"));
    expect(n).toBeLessThanOrEqual(850);
  });
});
