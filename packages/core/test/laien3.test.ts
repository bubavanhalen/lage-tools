import { describe, expect, it } from "vitest";
import { demoExercise, lastPosition, melderProblems, normalizeSpoken, parseMeldung, splitMelderCount, type Draft, type JournalContext, type WhereKind } from "../src";

// Regression «nie still falsch», dritte Runde: Sätze der Nachprüfung MVP 0 (29.10.2026) und neue Fälle – Uhrzeit mit
// Ziffern-Stunde, ungefähre/relative Zeit, unbekannter Melder, zwei Orte, «NAI drei». Nur fiktive Daten (Beispiel Bern,
// Raster BERN AA–AU × 1–15, NAI 1–3, Trupps H01–H05). Jede Zeile ist richtig erkannt oder trägt ein Problem, das das
// Eintragen sperrt. Uhr: 07:30.
const ex = demoExercise();
const ctx = (o: Partial<JournalContext> = {}): JournalContext => ({
  sheets: ex.sheets, areas: ex.areas, units: ex.units, places: [], days: ex.days, day: ex.days[1]!, now: new Date(2030, 4, 15, 7, 30),
  lastPos: (u, s) => lastPosition(ex.events!, s, u), ...o,
});

interface Exp {
  kind?: Draft["kind"];
  melder: string;
  sym?: string;
  /** null = ausdrücklich keine Anzahl */
  count?: number | null;
  wo?: WhereKind | null;
  label?: string;
  /** Ereigniszeit aus dem Text (sonst «jetzt» = 07:30) */
  time?: string;
  desc?: string;
  dir?: number;
  /** erwartetes Problem (Teil des Klartexts) – Eintragen gesperrt */
  problem?: string;
}

function check(text: string, x: Exp, c = ctx()) {
  const d = parseMeldung(text, c);
  if (x.kind) expect(d.kind, "Einordnung").toBe(x.kind);
  expect(d.melder, "Melder").toBe(x.melder);
  if (x.sym) expect(d.sym, "Zeichen").toBe(x.sym);
  if (x.count !== undefined) expect(d.count, "Anzahl").toBe(x.count ?? undefined);
  if (x.wo !== undefined) expect(d.where?.kind ?? null, "Ort").toBe(x.wo);
  if (x.label) expect(d.where?.label, "Ort").toBe(x.label);
  if (x.dir !== undefined) expect(d.dir, "Richtung").toBe(x.dir);
  if (x.time) { expect(d.t.slice(11, 16), "Zeit").toBe(x.time); expect(d.timeFromText, "Zeit aus Text").toBe(true); }
  else { expect(d.t.slice(11, 16), "Zeit = jetzt").toBe("07:30"); expect(d.timeFromText, "Zeit = jetzt").toBe(false); }
  if (x.desc) expect(d.desc ?? "", "Sinn").toContain(x.desc);
  if (x.problem) expect(d.problems?.map((p) => p.text).join(" | "), "Problem").toContain(x.problem);
  else expect(d.problems, "kein Problem").toBeUndefined();
  return d;
}

/** eigene Sätze des Prüfers (getippt) */
const PRUEFER: Array<[string, Exp]> = [
  ["Hotel null vier meldet zwo Fahrzeuge in Alpha Kilo sieben", { kind: "feind", melder: "H04", sym: "fz", count: 2, wo: "raster", label: "AK7" }],
  ["H02 um viertel vor zehn drei Pers AG5", { kind: "feind", melder: "H02", count: 3, wo: "raster", label: "AG5", time: "09:45" }],
  ["H03 AL9 4 Fz Rtg Ost 0945", { kind: "feind", melder: "H03", count: 4, wo: "raster", label: "AL9", time: "09:45", dir: 90 }],
  ["H01 2 Fz AK7 kurz nach acht", { melder: "H01", count: 2, wo: "raster", label: "AK7", problem: "«kurz nach acht»: ungefähre Zeit" }],
  ["H05 zwölf Pers AZ3", { melder: "H05", count: 12, wo: null, problem: "«AZ3» gibt es nicht" }],
  ["H04 2 Fz AK 0", { melder: "H04", count: 2, wo: null, problem: "«AK0» gibt es nicht" }],
  ["H02 meldet zwei Panzer und vier Lastwagen AJ6, Zeit 13 Uhr 20", { kind: "feind", melder: "H02", count: null, wo: "raster", label: "AJ6", time: "13:20", desc: "2 Panzer, 4 Lastwagen" }],
  ["H01 um 14.30 Uhr 3 Pers bei NAI drei", { kind: "feind", melder: "H01", count: 3, wo: "nai", label: "NAI 3", time: "14:30" }],
  ["Hotel fünf, Feind drei Mann, Alpha Charlie elf, Richtung Nord", { kind: "feind", melder: "H05", count: 3, wo: "raster", label: "AC11", dir: 0 }],
  ["H03 1 Fz AA1 vor zehn Minuten", { kind: "feind", melder: "H03", count: 1, wo: "raster", label: "AA1", time: "07:20" }],
  ["H04 zwanzig Pers AK7", { kind: "feind", melder: "H04", count: 20, wo: "raster", label: "AK7" }],
  ["H02 fünfundzwanzig Soldaten AG3", { kind: "feind", melder: "H02", count: 25, wo: "raster", label: "AG3" }],
  ["H01 sieht 3 Pers AK7 um Viertel nach 7", { kind: "feind", melder: "H01", count: 3, wo: "raster", label: "AK7", time: "07:15" }],
  ["H04 2 Fz AK71", { melder: "H04", count: 2, wo: null, problem: "«AK71» gibt es nicht" }],
  ["H05 um 7 Uhr 3 Fz AB4", { kind: "feind", melder: "H05", count: 3, wo: "raster", label: "AB4", time: "07:00" }],
  ["H03 meldet 0830 drei Fz AH3, 0835 weiter Rtg Süd", { melder: "H03", count: 3, wo: "raster", label: "AH3", time: "08:30", problem: "«0835»: zweite Zeitangabe" }],
  ["H02 2 Fz AG3 gegen neun", { kind: "feind", melder: "H02", count: 2, wo: "raster", label: "AG3", time: "09:00" }],
  ["H01 dreiundzwanzig Uhr zehn 2 Pers AE2", { kind: "feind", melder: "H01", count: 2, wo: "raster", label: "AE2", time: "23:10" }],
];

/** eigene Sätze des Prüfers (diktiert: zuerst `normalizeSpoken`, wie die Spracheingabe) */
const DIKTAT: Array<[string, Exp]> = [
  ["Hotel null drei zwo Fahrzeuge Alpha Lima neun Zeit null acht drei null", { kind: "feind", melder: "H03", count: 2, wo: "raster", label: "AL9", time: "08:30" }],
  // H13 gibt es nicht, H01 schon: «H01 3 Pers» (nicht H13 ohne Anzahl)
  ["Hotel eins drei Personen Alpha Kilo sieben um halb neun", { kind: "feind", melder: "H01", count: 3, wo: "raster", label: "AK7", time: "08:30" }],
  ["Hotel zwo ein Panzer November Alpha India zwo", { kind: "feind", melder: "H02", count: 1, wo: "nai", label: "NAI 2" }],
  ["Hotel vier vier Fahrzeuge Alpha Kilo sieben", { kind: "feind", melder: "H04", sym: "fz", count: 4, wo: "raster", label: "AK7" }],
  ["Hotel null fünf fünf Mann Alpha Delta neun Richtung Westen um zehn nach elf", { kind: "feind", melder: "H05", count: 5, wo: "raster", label: "AD9", time: "11:10", dir: 270 }],
];

/** neue Fälle: Uhrzeit mit Ziffern-Stunde, ungefähre und relative Zeit */
const ZEIT: Array<[string, Exp]> = [
  ["H05 um 07 Uhr 3 Fz AB4", { melder: "H05", count: 3, label: "AB4", time: "07:00" }],
  ["H05 3 Fz AB4 um 19 Uhr", { melder: "H05", count: 3, label: "AB4", time: "19:00" }],
  ["H05 3 Fz AB4 7 Uhr", { melder: "H05", count: 3, label: "AB4", time: "07:00" }],
  ["H05 um 19 Uhr 3 Fz AB4", { melder: "H05", count: 3, label: "AB4", time: "19:00" }],
  ["H05 um 19 Uhr 30 3 Fz AB4", { melder: "H05", count: 3, label: "AB4", time: "19:30" }],
  ["H05 um 9 Uhr 4 Pers AB4", { melder: "H05", count: 4, label: "AB4", time: "09:00" }],
  ["H05 um 715 3 Fz AB4", { melder: "H05", count: 3, label: "AB4", time: "07:15" }],
  ["H05 3 Fz AB4 um 715", { melder: "H05", count: 3, label: "AB4", time: "07:15" }],
  ["H05 um 7:15 3 Fz AB4", { melder: "H05", count: 3, label: "AB4", time: "07:15" }],
  ["H05 um 7.15 Uhr 3 Fz AB4", { melder: "H05", count: 3, label: "AB4", time: "07:15" }],
  ["H05 19.30 Uhr 3 Fz AB4", { melder: "H05", count: 3, label: "AB4", time: "19:30" }],
  ["H05 um 7 3 Fz AB4", { melder: "H05", count: 3, label: "AB4", time: "07:00" }],
  ["H05 3 Fz AB4 24 Uhr", { melder: "H05", count: 3, label: "AB4", time: "00:00" }],
  ["H04 2 Fz AK7 kurz vor zehn", { melder: "H04", count: 2, label: "AK7", problem: "«kurz vor zehn»: ungefähre Zeit" }],
  ["H04 2 Fz AK7 kurz nach 8", { melder: "H04", count: 2, label: "AK7", problem: "«kurz nach 8»: ungefähre Zeit" }],
  ["H04 2 Fz AK7 vor 10 min", { melder: "H04", count: 2, label: "AK7", time: "07:20" }],
  ["H04 2 Fz AK7 vor 10min", { melder: "H04", count: 2, label: "AK7", time: "07:20" }],
  ["H04 2 Fz AK7 vor einer halben Stunde", { melder: "H04", count: 2, label: "AK7", time: "07:00" }],
  ["H04 2 Fz AK7 vor einer Viertelstunde", { melder: "H04", count: 2, label: "AK7", time: "07:15" }],
  ["H04 vor 2 Std 2 Fz AK7", { melder: "H04", count: 2, label: "AK7", time: "05:30" }],
  ["H04 2 Fz AK7 gegen 9", { melder: "H04", count: 2, label: "AK7", time: "09:00" }],
  ["H04 2 Fz AK7 ca. 9 Uhr", { melder: "H04", count: 2, label: "AK7", time: "09:00" }],
  // keine Meldezeit, kein Problem
  ["ca. 10 Personen in NAI 1, H02", { melder: "H02", count: 10, wo: "nai", label: "NAI 1" }],
  ["H04 2 Fz AK7 bis 1100", { melder: "H04", count: 2, label: "AK7" }],
  ["H04 gegen 3 Pers AK7 im Kampf", { melder: "H04", count: 3, label: "AK7" }],
];

/** neue Fälle: Melder, den es nicht gibt; zwei Orte; NAI in Worten */
const MELDER: Array<[string, Exp]> = [
  ["H13 2 Fz AK7", { melder: "H13", count: 2, label: "AK7", problem: "«H13» gibt es in der Übung nicht (bekannt: H01, H02, H03, H04, H05)" }],
  ["Hotel eins drei Stellung bezogen AK7", { melder: "H13", label: "AK7", problem: "«H13» gibt es in der Übung nicht" }],
  ["Hotel eins drei Personen Alpha Kilo sieben", { kind: "feind", melder: "H01", count: 3, label: "AK7" }],
  ["H05 sieht H12 bei AQ2", { melder: "H05", label: "AQ2", problem: "«H12» gibt es in der Übung nicht" }],
  // neuer Trupp ohne Verdacht auf zusammengezogene Ziffern: keine Sperre, aber nie still angelegt (MVP 3.5, S16/C12 –
  // Melder leer, `truppNeu`, gelb «H06 als Trupp aufnehmen»)
  ["H06 Stellung bezogen AK7", { kind: "eigen", melder: "", label: "AK7" }],
  ["H05 sieht H09 bei AQ2", { melder: "H05", label: "AQ2" }],
  ["Zug 1 Stellung bezogen AK7", { kind: "eigen", melder: "", label: "AK7" }],
  ["2 Fz AK7 und 3 Pers AL8 (H04)", { melder: "H04", count: null, label: "AK7", desc: "2 Fahrzeuge in AK7, 3 Personen in AL8", problem: "zwei Orte (AK7, AL8) – bitte als zwei Meldungen eintragen" }],
  ["H04 2 Fz AK7 und 2 Fz AL8", { melder: "H04", label: "AK7", problem: "zwei Orte (AK7, AL8)" }],
  ["H04 2 Fz AK7 und 3 Pers AK7", { melder: "H04", count: null, label: "AK7" }],
  ["H04 2 Fz AK7 Rtg AL8", { melder: "H04", count: 2, label: "AK7" }],
  ["H01 3 Pers NAI zwo", { melder: "H01", count: 3, wo: "nai", label: "NAI 2" }],
  ["H01 3 Pers bei NAI-eins", { melder: "H01", count: 3, wo: "nai", label: "NAI 1" }],
  ["H01 3 Pers NAI neun", { melder: "H01", count: 3, wo: null, problem: "«NAI 9» gibt es nicht" }],
];

describe("Laien-Sätze Runde 3: Sätze des Prüfers (getippt)", () => {
  it.each(PRUEFER)("%s", (s, x) => { check(s, x); });
});
describe("Laien-Sätze Runde 3: Sätze des Prüfers (diktiert)", () => {
  it.each(DIKTAT)("%s", (s, x) => { check(normalizeSpoken(s).text, x); });
});
describe("Uhrzeit mit Ziffern-Stunde, ungefähre und relative Zeit", () => {
  it.each(ZEIT)("%s", (s, x) => { check(s, x); });
  it("«vor 10 min» kurz nach Mitternacht gehört zum Vortag", () => {
    const d = parseMeldung("H04 2 Fz AK7 vor 10 min", ctx({ now: new Date(2030, 4, 16, 0, 5), day: ex.days[1]! }));
    expect(d.t).toBe(`${ex.days[0]}T23:55`);
  });
  it("«gegen neun» am Abend = 21:00", () => {
    expect(parseMeldung("H04 2 Fz AK7 gegen neun", ctx({ now: new Date(2030, 4, 15, 20, 0) })).t.slice(11)).toBe("21:00");
  });
  it("Ziffern gelten als 24-Stunden-Uhr («7 Uhr» am Abend bleibt 07:00)", () => {
    expect(parseMeldung("H05 um 7 Uhr 3 Fz AB4", ctx({ now: new Date(2030, 4, 15, 20, 0) })).t.slice(11)).toBe("07:00");
  });
  it("relative Zeit bleibt im Meldungstext", () => {
    expect(parseMeldung("H04 2 Fz AK7 vor 10 min", ctx()).text).toBe("H04 2 Fz AK7 vor 10 min");
  });
});
describe("Melder, den es nicht gibt; zwei Orte; NAI in Worten", () => {
  it.each(MELDER)("%s", (s, x) => { check(s, x); });
  it("ohne bekannte Trupps (neue Übung): kein Problem, neuer Trupp nur über den Knopf (MVP 3.5, S16)", () => {
    const d = parseMeldung("H13 2 Fz AK7", ctx({ units: { blau: [], rot: [], ul: [] } }));
    expect(d.melder).toBe("");
    expect(d.truppNeu).toBe("H13");
    expect(d.problems).toBeUndefined();
  });
  it("H13 bekannt: bleibt H13 (kein Aufteilen)", () => {
    const units = { ...ex.units, blau: [...ex.units.blau, "H13"] };
    const d = parseMeldung("H13 Pers AK7", ctx({ units }));
    expect(d.melder).toBe("H13");
    expect(d.problems).toBeUndefined();
  });
  it("Aufteilen ist sichtbar («gelesen als»)", () => {
    expect(parseMeldung("H13 Pers AK7", ctx()).normalized).toBe("H01 3 Pers AK7");
  });
  it("splitMelderCount / melderProblems", () => {
    expect(splitMelderCount("H21 Panzer NAI 2", ex.units.blau)).toBe("H02 1 Panzer NAI 2");
    expect(splitMelderCount("H13 Stellung", ex.units.blau)).toBe("H13 Stellung");
    expect(splitMelderCount("H10 Pers", ex.units.blau)).toBe("H10 Pers");
    expect(melderProblems(["H13", "Zug 1", "H04", "H06", "H61"], ex.units.blau).map((p) => p.token)).toEqual(["H13"]);
    expect(melderProblems(["H13"], ["H01", "H02", "H03", "H04", "H05", "H06", "H07"])[0]!.text).toBe("«H13» gibt es in der Übung nicht (bekannt: H01–H07) – gemeint «H01 3 …»?");
    // neue Übung: nach H01 darf H02 kommen
    expect(melderProblems(["H02"], ["H01"])).toEqual([]);
  });
});
