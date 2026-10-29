/**
 * MVP 3 Fix 3 (Nachprüfung review4, Teil N): Schicht-Zählung in Übergabe, Druckdialog und CSV gleich (eine Regel,
 * `schichtEintraege`), Übergabe-PDF eine Seite (Visum nie allein), Tablet-Text passend zum Knopf. Nur fiktive Daten.
 */
process.env.TZ = "Europe/Zurich";
import { describe, expect, it } from "vitest";
import { demoExercise, entryState, eventFromDraft, journalToCsv, lastPosition, parseMeldung, schichtEintraege, type Exercise, type LageEvent } from "@lage/core";
import { uebergabeDaten, type UebergabeDaten } from "../src/lvzui/uebergabeDaten";
import { eintraegeIm, letzteSchicht } from "../src/print/umfang";
import { knopfText } from "../src/entry/labels";
import type { LageRotState } from "../src/lageRot";

const { uebergabePdfDoc } = await import("../src/lvzui/uebergabePdf");
const LEER_ROT: LageRotState = { coas: [], more: [], force: { rows: [], notSeen: [] }, spec: null, compare: [], from: null, hints: [] };

const at = (hhmm: string) => new Date(2030, 4, 15, +hhmm.slice(0, 2), +hhmm.slice(2));
function trage(ex: Exercise, text: string, now: Date): LageEvent {
  const events = ex.events ?? [];
  const d = parseMeldung(text, { sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now, lastPos: (u, s) => lastPosition(events, s, u), events, ex: { events } });
  void entryState;
  const e = eventFromDraft(d, "dev-t", now, { nr: (ex.events?.length ?? 0) + 100, kuerzel: "BSP" });
  ex.events = [...events, e];
  return e;
}

describe("Schicht-Zählung: Übergabe = Druck «Letzte Schicht» = CSV-Spalte «Schicht» (Fix 3)", () => {
  it("Einträge der nächsten Schicht zur gleichen Minute (10:10) zählen nicht zur übergebenen", () => {
    const ex: Exercise = { ...demoExercise(), schichten: [{ id: "s1", art: "beginn", at: "2030-05-15T04:00:00.000Z", t: "2030-05-15T06:00", an: "BSP", device: "d" }] };
    for (const [s, h] of [["H01 Vbk gut", "0905"], ["H02 2 Pers AK10 Rtg S", "0950"], ["0930 H03 1 Fz AN7", "1009"]] as const) trage(ex, s, at(h));
    const g = trage(ex, "H04 2 Pers AG12", at("1000"));
    ex.events = ex.events!.map((e) => (e.id === g.id ? { ...e, deleted: true, updatedAt: at("1005").toISOString() } : e));
    // Übergabe um 10:10 (Bildschirm), dann Abschluss
    const ueb = uebergabeDaten({ ex, tLive: "2030-05-15T10:10", hints: [], lage: LEER_ROT, items: [], kuerzel: "BSP", seit: "2030-05-15T04:00:00.000Z", seitT: "2030-05-15T06:00" });
    ex.schichten = [...ex.schichten!, { id: "s2", art: "uebergabe", at: new Date(Date.parse("2030-05-15T08:10:09.000Z")).toISOString(), t: "2030-05-15T10:10", an: "MU", von: "BSP", device: "d" }];
    // nach dem Abschluss: drei Einträge der neuen Schicht mit Lagezeit 10:10
    for (const s of ["H01 Vbk gut", "H02 2 Pers AK10 Rtg S", "Auftrag an H02: zurück auf Stao AL9 bis 1100"]) trage(ex, s, new Date(Date.parse("2030-05-15T08:10:20.000Z")));
    const l = letzteSchicht(ex, "2030-05-15T10:15")!;
    expect(l).toMatchObject({ kuerzel: "BSP", to: "2030-05-15T10:10", at: { von: "2030-05-15T04:00:00.000Z", bis: "2030-05-15T08:10:09.000Z" } });
    const druck = eintraegeIm(ex, { from: l.from, to: l.to, at: l.at }).filter((e) => !e.deleted).length;
    const rows = journalToCsv(ex.events!, ex.days, { schichten: ex.schichten }).replace(/^﻿/, "").split("\r\n").map((r) => r.split(";"));
    const ci = rows[0]!.indexOf("Schicht"), si = rows[0]!.indexOf("Status");
    const csv = rows.slice(1).filter((r) => r[ci] === "BSP" && !r[si]!.startsWith("gestrichen")).length;
    expect(ueb.neu.total).toBe(druck);
    expect(csv).toBe(druck);
    expect(schichtEintraege(ex, { at: l.at.von, bis: l.at.bis }, l.to).length).toBe(druck);
    expect(rows.slice(1).filter((r) => r[ci] === "MU")).toHaveLength(3);
    // gestrichen mit Zeit
    expect(rows.slice(1).find((r) => r[si]!.startsWith("gestrichen"))![si]).toBe("gestrichen 10:05");
    // Zahlen der Übergabe (Schicht) = dieselbe Menge
    expect(+ueb.zahlen[0]![1]).toBe(druck);
  });
});

describe("Übergabe-PDF: eine Seite, Visum nie allein (Fix 3)", () => {
  const lang = (n: number): UebergabeDaten => ({
    titel: "Beispiel Bern (fiktiv)", klass: "INTERN", stand: "T2 15.05.2030 10:10", schichtZeile: "Schicht BSP seit T2 06:00 (4 h 10 min) · 87 Einträge in der Schicht",
    blau: Array.from({ length: 6 }, (_, i) => ({ trupp: `H0${i + 1}`, ort: "AF12 A", seit: "T1 18:50", letzte: "08:41 Sperre AG13 geräumt · 89 min still", vbk: "07:53 schlecht", offen: "Auftrag 107, Rückfrage 125, Rückfrage 93", still: "89 min still" })),
    rot: { gesehen: "Rot gesehen: mind. 18 Pers, 4 Fz · erwartet 14 Pers, 5 Fz", zuletzt: "Zuletzt gesehen: Det 1 AO7 (06:05, seit 4 h nicht mehr) · Det 2 AM9 (05:30, seit 4 h nicht mehr)", aktivitaet: "Zuletzt Rot-Aktivität: 08:53 2 gegnerische Fahrzeuge AK8", moeglich: ["Am wahrscheinlichsten: Rot könnte den Raum NAI 3–AL10 sperren und uns umleiten", "Am gefährlichsten: Rot könnte bei NAI 3 einen Hinterhalt legen – eigene Verschiebung dort meiden"] },
    vonOben: Array.from({ length: 3 }, (_, i) => ({ key: `o${i}`, t: "08:51", nr: `12${i}`, bang: false, text: "Bat: Feind 40 Pers und 10 Kpz im Raum AK9 erwartet, Lagerapport 1000 im KP Bat", meta: i === 2 ? "vorbei (10:00)" : "" })),
    offen: Array.from({ length: 12 }, (_, i) => ({ key: `f${i}`, mark: "✎", t: "08:51", nr: `${100 + i}`, text: "an H02: 20 Pers bei AK9 beobachten und sofort melden, wenn sie sich Richtung Belp bewegen", meta: "seit 1 h 19 min" })),
    offenTotal: 12 + n, offenWeitere: n,
    neu: { titel: "Neu in dieser Schicht (seit T2 06:00) – 87 Einträge", zeilen: Array.from({ length: 12 }, (_, i) => ({ key: `n${i}`, t: "08:42", nr: `${115 + i}`, bang: i < 3, text: "Feind hier h zwo, zwei fahrzeuge, äh, eins davon schützenpanzer, bei AL elf, fahren rtg nord", meta: i < 3 ? "erledigt 08:51 · Massnahme: San Trp aufgeboten" : "" })), weitere: 75, total: 87 },
    zahlen: [["Einträge", "87", "125"], ["Feind / Unklar / Eigene gesehen", "38/5/5", "60/11/15"], ["Aufträge (offen)", "7 (6)", "7 (6)"], ["Rückfragen (offen)", "6 (3)", "6 (3)"], ["Dringend (offen)", "3 (2)", "3 (2)"], ["Korrigiert / gestrichen", "2 / 1", "2 / 1"], ["Hinweise zu Rot offen / erledigt", "", "3 / 19"]],
    von: "BSP",
  });
  it("volle Übergabe (12 Offen, 12 Neu, 6 Trupps): eine Seite mit Zahlen und Visum, Schrift ≥ 8 pt", () => {
    const r = uebergabePdfDoc(lang(6), { von: "BSP", an: "", um: "10:10" });
    expect(r.doc.getNumberOfPages()).toBe(1);
    expect(r.fs).toBeGreaterThanOrEqual(8);
    expect(r.zeilen).toContain("7 VISUM");
    expect(r.zeilen).toContain("6 ZAHLEN FÜR DEN RAPPORT");
    // gekürzt: was fehlt, steht als «+n weitere» da
    if (r.gekuerzt) expect(r.zeilen.some((z) => /^\+\d+ weitere im Journal$/.test(z))).toBe(true);
  });
  it("kleine Übergabe: grösste Schrift, nichts gekürzt", () => {
    const d = lang(0);
    const r = uebergabePdfDoc({ ...d, blau: d.blau.slice(0, 3), offen: d.offen.slice(0, 3), offenTotal: 3, neu: { ...d.neu, zeilen: d.neu.zeilen.slice(0, 3) } }, { von: "BSP", an: "MU", um: "10:10" });
    expect(r.doc.getNumberOfPages()).toBe(1);
    expect(r.gekuerzt).toBe(false);
    expect(r.fs).toBeGreaterThanOrEqual(9);
  });
});

describe("Tablet: Text wie der Knopf (Fix 3)", () => {
  it("«Nochmals Enter» → «Trotzdem eintragen» bzw. «Korrektur speichern», Laptop unverändert", () => {
    expect(knopfText("Als Notiz ohne Zeichen eintragen? Nochmals Enter.", { coarse: true })).toBe("Als Notiz ohne Zeichen eintragen? Nochmals «Trotzdem eintragen» tippen.");
    expect(knopfText("Nochmals Enter trägt als Notiz ein.", { coarse: true })).toBe("«Trotzdem eintragen» trägt als Notiz ein.");
    expect(knopfText("Ohne Ort eintragen? Nochmals Enter.", { coarse: true, korr: true })).toBe("Ohne Ort eintragen? Nochmals «Korrektur speichern» tippen.");
    expect(knopfText("Ohne Ort eintragen? Nochmals Enter.", { coarse: false })).toBe("Ohne Ort eintragen? Nochmals Enter.");
  });
});
