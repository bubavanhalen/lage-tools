import { describe, expect, it } from "vitest";
import {
  clockField,
  compareEvents,
  countWords,
  demoExercise,
  eventFromDraft,
  lastPosition,
  normalizeSpoken,
  normalizeTyped,
  offsetFor,
  parseMeldung,
  reviseEvent,
  situationAt,
  type Draft,
  type JournalContext,
  type LageEvent,
  type WhereKind,
} from "../src";

// Regression «nie still falsch», zweite Runde: 40 neue freie Eingaben (unabhängige Prüfung MVP 0, 28.10.2026), nur
// fiktive Daten (Beispiel Bern, Raster BERN AA–AU × 1–15, NAI 1–3, Trupps H01–H05). Jede Zeile ist richtig erkannt
// oder trägt ein Problem (`problems`), das das Eintragen sperrt. Uhr: 07:30.
const ex = demoExercise();
const ctx = (o: Partial<JournalContext> = {}): JournalContext => ({
  sheets: ex.sheets, areas: ex.areas, units: ex.units, places: [], days: ex.days, day: ex.days[1]!, now: new Date(2030, 4, 15, 7, 30),
  lastPos: (u, s) => lastPosition(ex.events!, s, u), ...o,
});

interface Exp {
  kind: Draft["kind"];
  melder: string;
  /** Element auf der Karte (Standard: Melder bei «eigen», sonst leer) */
  unit?: string;
  sym?: string;
  /** null = ausdrücklich keine Anzahl */
  count?: number | null;
  wo: WhereKind | null;
  label?: string;
  /** Ereigniszeit aus dem Text (sonst «jetzt» = 07:30) */
  time?: string;
  /** Teil des Sinns */
  desc?: string;
  /** erwartetes Problem (Teil des Klartexts) – Eintragen gesperrt */
  problem?: string;
}

const ROWS: Array<[string, Exp]> = [
  ["H01 meldet drei Fahrzeuge bei AL5 Richtung Süden", { kind: "feind", melder: "H01", sym: "fz", count: 3, wo: "raster", label: "AL5" }],
  ["ca. 10 Personen in NAI 1, H02", { kind: "feind", melder: "H02", count: 10, wo: "nai", label: "NAI 1" }],
  ["H03: Lastwagen steht bei AM 8", { kind: "feind", melder: "H03", sym: "lw", wo: "raster", label: "AM8" }],
  ["Zwei Motorräder fahren durch AH4 nach Westen (H05)", { kind: "feind", melder: "H05", sym: "motorrad", count: 2, wo: "raster", label: "AH4" }],
  ["H02 hat seinen Posten in AJ11 bezogen", { kind: "eigen", melder: "H02", wo: "raster", label: "AJ11" }],
  ["H04 wechselt Stellung nach AK12", { kind: "eigen", melder: "H04", sym: "stellung", wo: "raster", label: "AK12" }],
  ["H01 steht jetzt bei AC3", { kind: "eigen", melder: "H01", wo: "raster", label: "AC3" }],
  // «fünf Leute»: Anzahl 5; Leute mit Rucksäcken ohne Hinweis auf Gegner = unklar
  ["Bei AD9 sind fünf Leute mit Rucksäcken, meldet H03", { kind: "unklar", melder: "H03", sym: "inf_trp", count: 5, wo: "raster", label: "AD9" }],
  // Zeit am Satzende in Worten
  ["H05 beobachtet Lieferwagen AE14 halb zehn", { kind: "unklar", melder: "H05", wo: "raster", label: "AE14", time: "09:30" }],
  // Zahlwort verschmilzt nicht mit der Ziffer: 08:20, 2 Fz (nicht 82 Fz)
  ["Um zwanzig nach acht 2 Fz AF3 H02", { kind: "feind", melder: "H02", sym: "fz", count: 2, wo: "raster", label: "AF3", time: "08:20" }],
  ["H01 0815 nichts Besonderes", { kind: "eigen", melder: "H01", wo: "zuletzt", time: "08:15" }],
  ["H04 sieht Rauch in AG6", { kind: "unklar", melder: "H04", sym: "brand", wo: "raster", label: "AG6" }],
  ["Helikopter kreist über NAI 2 – H01", { kind: "feind", melder: "H01", sym: "heli", wo: "nai", label: "NAI 2" }],
  ["H03 Funkverbindung zu H02 unterbrochen", { kind: "eigen", melder: "H03", wo: "zuletzt" }],
  ["H02 2 Fz AV3", { kind: "feind", melder: "H02", count: 2, wo: null, problem: "«AV3» gibt es nicht" }],
  ["H02 2 Fz AK16", { kind: "feind", melder: "H02", count: 2, wo: null, problem: "«AK16» gibt es nicht" }],
  ["H01 3 Pers in NAI 4", { kind: "feind", melder: "H01", count: 3, wo: null, problem: "«NAI 4» gibt es nicht" }],
  ["H04 3 Pers 25:10", { kind: "feind", melder: "H04", count: 3, wo: "melder", problem: "«25:10» ist keine gültige Uhrzeit" }],
  ["H05 sechs Soldaten AL9", { kind: "feind", melder: "H05", sym: "inf_trp", count: 6, wo: "raster", label: "AL9" }],
  // «ein Panzer» = 1 (Einzahl im Sinn)
  ["H02 ein Panzer AN10", { kind: "feind", melder: "H02", count: 1, wo: "raster", label: "AN10", desc: "1 gegnerischer" }],
  ["Hotel 2 sieht drei Personen in Alpha Lima 9", { kind: "feind", melder: "H02", sym: "inf_trp", count: 3, wo: "raster", label: "AL9" }],
  ["H3 Fahrzeugkolonne mit 4 Lastwagen AH8 Rtg Nord", { kind: "feind", melder: "H03", sym: "kolonne", wo: "raster", label: "AH8", desc: "4 Lastwagen" }],
  ["H01 bezieht Beobachtungsposten AB2", { kind: "eigen", melder: "H01", sym: "beob_aufkl", wo: "raster", label: "AB2" }],
  ["H05 ist am Ziel angekommen in AP7", { kind: "eigen", melder: "H05", wo: "raster", label: "AP7" }],
  ["Fremde Drohne über AJ5 gesehen von H04", { kind: "feind", melder: "H04", sym: "drohne", wo: "raster", label: "AJ5" }],
  ["H03 Ortschaft Wabern ruhig", { kind: "eigen", melder: "H03", wo: "zuletzt" }],
  ["H02 meldet Strassensperre bei AG12", { kind: "feind", melder: "H02", sym: "strassensperre", wo: "raster", label: "AG12" }],
  ["H04 hat 2 Gefangene gemacht in AK3", { kind: "unklar", melder: "H04", sym: "gefangene", count: 2, wo: "raster", label: "AK3" }],
  ["Verdächtiges Paket an der Bushaltestelle AE5, H01", { kind: "unklar", melder: "H01", wo: "raster", label: "AE5" }],
  ["H05 sieht H03 bei AQ2 vorbeifahren", { kind: "eigen", melder: "H05", unit: "H03", wo: "raster", label: "AQ2" }],
  // zwei Orte: Ort je Teil im Sinn, keine falsche Einzelanzahl – und gesperrt (Karte zeigt nur einen Ort, laien3.test.ts)
  ["2 Fz AK7 und 3 Pers AL8 (H04)", { kind: "feind", melder: "H04", count: null, wo: "raster", label: "AK7", desc: "2 Fahrzeuge in AK7, 3 Personen in AL8", problem: "zwei Orte (AK7, AL8) – bitte als zwei Meldungen eintragen" }],
  ["H02 halb elf 1 Fz AG4", { kind: "feind", melder: "H02", sym: "fz", count: 1, wo: "raster", label: "AG4", time: "10:30" }],
  // «punkt neun Uhr 4 Pers»: 09:00 und 4 Pers (nicht 09:04)
  ["H03 punkt neun Uhr 4 Pers AH9", { kind: "feind", melder: "H03", sym: "inf_trp", count: 4, wo: "raster", label: "AH9", time: "09:00" }],
  ["H01 meldet zwei Fz, einen Pw und einen Lieferwagen, in AC8", { kind: "feind", melder: "H01", count: null, wo: "raster", label: "AC8", desc: "2 Fahrzeuge, 1 Personenwagen, 1 Lieferwagen" }],
  ["Feind greift H05 an aus AR10", { kind: "feind", melder: "H05", wo: "raster", label: "AR10" }],
  ["H02 Stao AJ7 C", { kind: "eigen", melder: "H02", wo: "raster", label: "AJ7 C" }],
  ["H04 2 Fz Planquadrat AK 7 Unterquadrant D", { kind: "feind", melder: "H04", count: 2, wo: "raster", label: "AK7 D" }],
  ["H5 meldet einen Lastwagen bei Alpha Papa 4", { kind: "feind", melder: "H05", sym: "lw", count: 1, wo: "raster", label: "AP4" }],
  // «ein Dutzend» = 12
  ["ein Dutzend Soldaten AK7 H04", { kind: "feind", melder: "H04", count: 12, wo: "raster", label: "AK7", desc: "12" }],
  ["H04 2 Fz AK7 um 1015", { kind: "feind", melder: "H04", sym: "fz", count: 2, wo: "raster", label: "AK7", time: "10:15" }],
];

function check(text: string, x: Exp, c = ctx()) {
  const d = parseMeldung(text, c);
  expect(d.kind, "Einordnung").toBe(x.kind);
  expect(d.melder, "Melder").toBe(x.melder);
  expect(d.unit, "Element").toBe(x.unit ?? (x.kind === "eigen" ? x.melder : ""));
  if (x.sym) expect(d.sym, "Zeichen").toBe(x.sym);
  if (x.count !== undefined) expect(d.count, "Anzahl").toBe(x.count ?? undefined);
  expect(d.where?.kind ?? null, "Ort").toBe(x.wo);
  if (x.label) expect(d.where?.label, "Ort").toBe(x.label);
  if (x.time) { expect(d.t.slice(11, 16), "Zeit").toBe(x.time); expect(d.timeFromText, "Zeit aus Text").toBe(true); }
  else { expect(d.t.slice(11, 16), "Zeit = jetzt").toBe("07:30"); expect(d.timeFromText).toBe(false); }
  if (x.desc) expect(d.desc ?? "", "Sinn").toContain(x.desc);
  if (x.problem) expect(d.problems?.map((p) => p.text), "Problem").toContain(x.problem);
  else expect(d.problems, "kein Problem").toBeUndefined();
  if (d.problems?.some((p) => p.kind === "ort")) { expect(d.pos).toBeUndefined(); expect(d.where).toBeUndefined(); }
  return d;
}

describe("Laien-Sätze Runde 2: nie still falsch (40 Eingaben)", () => {
  it("alle 40 Sätze sind abgedeckt", () => expect(ROWS.length).toBe(40));
  it.each(ROWS)("%s", (text, x) => { check(text, x); });
});

describe("Zahlwörter verschmelzen beim Tippen nicht mit Ziffern", () => {
  it.each([
    ["acht 2 Fz", "acht 2 Fz"],
    ["Um zwanzig nach acht 2 Fz AF3 H02", "0820 2 Fz AF3 H02"],
    ["H03 punkt neun Uhr 4 Pers AH9", "0900 H03 4 Pers AH9"],
    ["H01 sieben Pers AK7", "H01 7 Pers AK7"],
  ])("getippt: %s → %s", (s, out) => {
    expect(normalizeTyped(s, { blau: ex.units.blau, now: new Date(2030, 4, 15, 7, 30) }).text).toBe(out);
  });
  it("diktiert: Ziffernfolgen aus Zahlwörtern bleiben («null vier» → 04, «eins drei» → 13)", () => {
    expect(normalizeSpoken("Hotel null vier zwo Fahrzeuge Alpha Golf eins drei").text).toBe("H04 2 Fz AG13");
    expect(normalizeSpoken("zwanzig nach acht 2 Fahrzeuge").text).toBe("0820 2 Fz");
  });
  it("«ein paar» ist keine Anzahl, «ein Dutzend» schon (auch diktiert)", () => {
    expect(normalizeSpoken("ein paar Soldaten").text).toBe("ein paar Sdt");
    expect(normalizeSpoken("ein Dutzend Fahrzeuge").text).toBe("12 Fz");
    expect(normalizeSpoken("zwei Dutzend Personen").text).toBe("24 Pers");
  });
});

describe("Anzahl in Worten", () => {
  it.each([
    ["H02 ein Panzer AN10", 1], ["H04 sieht einen weissen Lieferwagen AK7", 1], ["ein Dutzend Soldaten AK7", 12],
    ["zwei Dutzend Pers AK7", 24], ["ein halbes Dutzend Fz AK7", 6], ["fünf Leute AD9", 5],
  ] as const)("%s → %d", (s, n) => {
    expect(parseMeldung(s, ctx()).count).toBe(n);
  });
  it("«ein paar»: keine Anzahl, kein Problem, Sinn behält es", () => {
    const d = parseMeldung("ein paar Soldaten AK7 H04", ctx());
    expect(d.count).toBeUndefined();
    expect(d.problems).toBeUndefined();
    expect(d.desc).toContain("ein paar");
  });
  it("Artikel vor Nicht-Zählbarem bleibt Artikel («eine Sperre»)", () => {
    expect(countWords("eine Sperre AK7")).toBe("eine Sperre AK7");
    expect(parseMeldung("H04 meldet eine Strassensperre bei AG12", ctx()).count).toBeUndefined();
  });
  it("Meldungstext bleibt wie getippt", () => {
    expect(parseMeldung("H02 ein Panzer AN10", ctx()).text).toBe("H02 ein Panzer AN10");
  });
});

describe("Zeit irgendwo im Satz", () => {
  it.each([
    ["H04 2 Fz AK7 1015", "10:15"], ["H04 2 Fz AK7 10:15", "10:15"], ["H04 2 Fz AK7, Zeit 1015", "10:15"], ["H05 Lieferwagen AE14 halb zehn", "09:30"],
    ["H04 sieht um halb zehn 2 Fz AK7", "09:30"], ["H04 ab 1015 in Stellung AK7", "10:15"], ["Um 0820 2 Fz AF3 H02", "08:20"], ["H04 2 Fz um acht Uhr in AK7", "08:00"],
  ])("%s → %s", (s, t) => {
    const d = parseMeldung(s, ctx());
    expect(d.t.slice(11, 16)).toBe(t);
    expect(d.timeFromText).toBe(true);
    expect(d.problems).toBeUndefined();
    expect(d.count ?? 2).toBe(2);
  });
  it("Zeit mitten im Satz bleibt im Meldungstext, Zeit am Anfang nicht", () => {
    expect(parseMeldung("H04 2 Fz AK7 um 1015", ctx()).text).toBe("H04 2 Fz AK7 um 1015");
    expect(parseMeldung("H04 1015 2 Fz AK7", ctx()).text).toBe("H04 2 Fz AK7");
  });
  it.each(["H04 2 Fz AK7 1250 m Rtg N", "H04 2 Fz AK7 Distanz 1500", "weisser Golf BE 1234 AK7", "H04 2 Fz AK7, seit 1h30 dort", "H04 2 Fz AK7 bis 1100", "H04 2 Fz Rtg N AK7"])("keine Meldezeit, kein Problem: %s", (s) => {
    const d = parseMeldung(s, ctx());
    expect(d.timeFromText).toBe(false);
    expect(d.problems).toBeUndefined();
  });
  it("Richtungskürzel vor der Zeit ist kein Kontrollschild («Rtg SO 1015»)", () => {
    expect(parseMeldung("H04 2 Fz AK7 Rtg SO 1015", ctx()).t.slice(11)).toBe("10:15");
  });
  it("zweite, andere Zeitangabe wird nicht still übergangen", () => {
    const d = parseMeldung("H04 1015 2 Fz AK7, 1030 weiter Rtg N", ctx());
    expect(d.t.slice(11)).toBe("10:15");
    expect(d.problems?.[0]).toMatchObject({ kind: "zeit", token: "1030" });
  });
  it("ungültige Zeit am Ende ist ein Problem («2510»)", () => {
    expect(parseMeldung("H04 2 Fz AK7 2510", ctx()).problems?.[0]?.kind).toBe("zeit");
  });
});

describe("Zeitfeld beim Bearbeiten: nie still kappen", () => {
  it.each([["1015", 615], ["10:15", 615], ["9.05", 545], ["0000", 0], ["23:59", 1439]] as const)("%s → %d min", (s, m) => {
    expect(clockField(s)).toBe(m);
  });
  it("leer = unverändert", () => expect(clockField("  ")).toBeNull());
  it.each(["25:70", "24:00", "10:60", "abc", "1", "10:1"])("ungültig: %s", (s) => {
    expect(clockField(s)).toMatchObject({ kind: "zeit", text: `«${s}» ist keine gültige Uhrzeit` });
  });
});

describe("Sommerzeit: Reihenfolge bei der Rückstellung", () => {
  const base = parseMeldung("H01 Beo Stao bezogen AE7", ctx());
  const ev = (id: string, t: string, createdAt: string, tOffset?: string): LageEvent =>
    ({ ...eventFromDraft({ ...base, t }, "dev-test", new Date(createdAt)), id, t, createdAt, tOffset });
  it("gleiche Lokalzeit: Eingang (`createdAt`) entscheidet, nicht die ID", () => {
    const a = ev("z", "2030-05-15T10:15", "2030-05-15T08:15:00.000Z");
    const b = ev("a", "2030-05-15T10:15", "2030-05-15T08:16:00.000Z");
    expect([b, a].sort(compareEvents).map((e) => e.id)).toEqual(["z", "a"]);
  });
  it("02:50 Sommerzeit vor 02:10 Winterzeit (mit Offset)", () => {
    const sommer = ev("s", "2026-10-25T02:50", "2026-10-25T00:50:00.000Z", "+02:00");
    const winter = ev("w", "2026-10-25T02:10", "2026-10-25T01:10:00.000Z", "+01:00");
    expect([winter, sommer].sort(compareEvents).map((e) => e.id)).toEqual(["s", "w"]);
    // Lage: der spätere Eintrag (Winterzeit) gilt
    const H = { ...sommer, unit: "H01", pos: { e: 2600000, n: 1200000 } };
    const W = { ...winter, unit: "H01", pos: { e: 2601000, n: 1200000 } };
    expect(situationAt([W, H], "2026-10-25T03:00").units[0]!.pos.e).toBe(2601000);
  });
  it("Offset beim Eintragen: «jetzt» mit dem Offset der Uhr", () => {
    const now = new Date(2030, 4, 15, 10, 40);
    const e = eventFromDraft(parseMeldung("H01 Beo Stao bezogen AE7", ctx({ now })), "dev-test", now);
    expect(e.tOffset).toBe(offsetFor(e.t, now));
    expect(e.tOffset).toMatch(/^[+-]\d{2}:\d{2}$/);
  });
  it("doppelte Stunde (Zürich, 25.10.2026): Offset der Uhr, wenn er passt", () => {
    const old = process.env.TZ;
    process.env.TZ = "Europe/Zurich";
    try {
      // 02:20 Winterzeit (01:20 UTC): «0210» ist 02:10 Winterzeit
      expect(offsetFor("2026-10-25T02:10", new Date("2026-10-25T01:20:00Z"))).toBe("+01:00");
      // 02:50 Sommerzeit (00:50 UTC): «0210» ist 02:10 Sommerzeit
      expect(offsetFor("2026-10-25T02:10", new Date("2026-10-25T00:50:00Z"))).toBe("+02:00");
      // 03:30 Winterzeit: «0150» liegt vor der Umstellung (Sommerzeit)
      expect(offsetFor("2026-10-25T01:50", new Date("2026-10-25T02:30:00Z"))).toBe("+02:00");
    } finally {
      if (old === undefined) delete process.env.TZ; else process.env.TZ = old;
    }
  });
  it("neue Ereigniszeit beim Korrigieren: Offset neu", () => {
    const now = new Date(2030, 4, 15, 10, 40);
    const e = eventFromDraft(parseMeldung("H01 Beo Stao bezogen AE7", ctx({ now })), "dev-test", now);
    const r = reviseEvent({ ...e, tOffset: "+09:00" }, { t: "2030-05-15T09:00" }, "dev-test", now);
    expect(r.tOffset).toBe(offsetFor("2030-05-15T09:00", now));
  });
});
