import { describe, expect, it } from "vitest";
import { demoExercise, entryState, naiRange, newExercise, rasterRange, parseMeldung, type EntryStateOptions, type Exercise, type JournalContext } from "../src";

// fiktiv: Beispiel Bern (Raster BERN AA–AU × 1–15, NAI 1–3, Trupps H01–H05), T2 = 2030-05-15
const now = new Date(2030, 4, 15, 7, 30);
const ctxOf = (ex: Exercise): JournalContext => ({ sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1] ?? "2030-05-15", now });
const bern = demoExercise();
const opt = (o: Partial<EntryStateOptions> = {}): EntryStateOptions => ({ hasRaster: true, online: true, placePending: false, manualPos: false, now, ...o });
const state = (text: string, ex = bern, o: Partial<EntryStateOptions> = {}) => entryState(parseMeldung(text, ctxOf(ex)), opt({ hasRaster: ex.sheets.length > 0, ...o }));
const codes = (s: ReturnType<typeof entryState>) => s.reasons.map((r) => r.code);

describe("entryState – Zustand des Meldungsfelds (Kap. 3.2)", () => {
  it("bereit: Trupp, Ort, Einordnung, Zeit nicht in der Zukunft", () => {
    expect(state("H04 2 Fz in AK7 Rtg N")).toEqual({ level: "bereit", reasons: [] });
  });
  it("bitte prüfen: Trupp fehlt", () => {
    const s = state("3 Pers bei AJ7");
    expect(s.level).toBe("pruefen");
    expect(codes(s)[0]).toBe("melder");
    expect(s.reasons[0]!.text).toBe("Wer meldet? fehlt");
  });
  it("bitte prüfen: Ort fehlt", () => {
    const s = state("H04 2 Fz Rtg N");
    expect(s.level).toBe("pruefen");
    expect(codes(s)).toContain("ort");
  });
  it("geht nicht: Planquadrat gibt es nicht (Textstelle markiert)", () => {
    const s = state("H04 2 Fz in AK77");
    expect(s.level).toBe("geht-nicht");
    expect(s.reasons[0]).toMatchObject({ code: "problem", token: "AK77" });
    expect(codes(s)).not.toContain("ort");
  });
  it("Ort von Hand gesetzt löst Ortsprobleme", () => {
    expect(state("H04 2 Fz in AK77", bern, { manualPos: true }).level).toBe("bereit");
  });
  it("Planquadrat ohne Führungsraster: nur prüfen, nicht sperren", () => {
    const leer = newExercise("Leer (fiktiv)");
    leer.units.blau = ["H04"];
    const s = state("H04 2 Fz in AK7", leer);
    expect(s.level).toBe("pruefen");
    expect(s.reasons[0]).toMatchObject({ code: "kein-raster", token: "AK7" });
  });
  it("Zeit mehr als 10 min in der Zukunft: ohne Tag geht nicht, mit Tag prüfen", () => {
    const s = state("0750 H04 2 Fz in AK7");
    expect(s.level).toBe("geht-nicht");
    expect(codes(s)).toEqual(["zukunft"]);
    expect(s.reasons[0]!.text).toContain("07:50");
    const t = state("T2 0750 H04 2 Fz in AK7");
    expect(t.level).toBe("pruefen");
    expect(codes(t)).toEqual(["zukunft"]);
  });
  it("Ortsname offline bzw. noch gesucht", () => {
    const off = state("H04 2 Fz in Wabern", bern, { online: false });
    expect(codes(off)).toContain("ort-offline");
    const busy = state("H04 2 Fz in Wabern", bern, { placePending: true });
    expect(codes(busy)).toContain("ort-suche");
  });
  it("geht nicht: Klartext mit Raster und Bereich (Kap. 4.6), Ausweg als hint", () => {
    const d = parseMeldung("H04 2 Fz in AK77", ctxOf(bern));
    const s = entryState(d, opt({ sheets: bern.sheets, areas: bern.areas }));
    expect(s.reasons[0]!.text).toBe("«AK77» gibt es nicht im Raster BERN (AA–AU, 1–15).");
    expect(s.reasons[0]!.hint).toContain("Ort auf Karte setzen");
    expect(s.reasons[0]!.problem).toBe("ort");
    const n = entryState(parseMeldung("H04 2 Fz in NAI 9", ctxOf(bern)), opt({ sheets: bern.sheets, areas: bern.areas }));
    expect(n.level).toBe("geht-nicht");
    expect(n.reasons[0]!.text).toBe("«NAI 9» gibt es nicht (vorhanden: NAI 1–3).");
  });
  it("geht nicht: ungültige Zeit, auch mit Ort von Hand", () => {
    const s = state("1370 H04 2 Fz in AK7", bern, { manualPos: true });
    expect(s.level).toBe("geht-nicht");
    expect(s.reasons[0]).toMatchObject({ problem: "zeit", token: "1370" });
    expect(s.reasons[0]!.text).toBe("«1370» ist keine Uhrzeit.");
  });
  it("geht nicht: unbekannter Trupp (Ausweg «als neuen Trupp aufnehmen»), zwei Orte", () => {
    const m = state("H13 2 Fz in AK7");
    expect(m.level).toBe("geht-nicht");
    expect(m.reasons[0]).toMatchObject({ problem: "melder", token: "H13" });
    expect(m.reasons[0]!.hint).toContain("als neuen Trupp aufnehmen");
    const o = state("H04 2 Fz AK7 und 3 Pers AL8", bern, { manualPos: true });
    expect(o.level).toBe("geht-nicht");
    expect(o.reasons[0]!.problem).toBe("orte");
  });
  it("Frage beim ersten Enter («Nochmals Enter»)", () => {
    expect(state("3 Pers bei AJ7").reasons[0]!.ask).toBe("Ohne Trupp eintragen? Nochmals Enter.");
    expect(state("H04 2 Fz Rtg N").reasons.find((r) => r.code === "ort")!.ask).toContain("Nochmals Enter");
  });
  it("Trupp per Chip vorangestellt: bereit (Aufgabe 2)", () => {
    expect(state("H02 3 Pers bei AJ7").level).toBe("bereit");
  });
  it("Einordnung von Hand gewählt bleibt bereit", () => {
    const d = parseMeldung("H04 2 Fz in AK7", { ...ctxOf(bern), kind: "unklar" });
    expect(entryState(d, opt()).level).toBe("bereit");
  });
  it("Ort anderweitig bekannt (hasPos): kein «Ort fehlt», Probleme bleiben", () => {
    expect(state("H04 2 Fz Rtg N", bern, { hasPos: true }).level).toBe("bereit");
    expect(state("H04 2 Fz in AK77", bern, { hasPos: true }).level).toBe("geht-nicht");
  });
  it("Ort nur beim Trupp angenommen: prüfen", () => {
    const ex = demoExercise();
    const ctx = { ...ctxOf(ex), lastPos: () => ({ e: 2600000, n: 1199000 }) };
    const d = parseMeldung("H04 2 Fz Rtg N", ctx);
    if (d.where?.kind === "melder") expect(entryState(d, opt()).reasons.map((r) => r.code)).toContain("ort-bei-trupp");
  });
  it("Bereichstexte", () => {
    expect(rasterRange(bern.sheets[0]!)).toBe("BERN (AA–AU, 1–15)");
    expect(naiRange(bern.areas)).toBe("NAI 1–3");
  });
});
