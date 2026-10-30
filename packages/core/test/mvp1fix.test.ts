import { describe, expect, it } from "vitest";
import {
  bundleHints, cleanOcr, closestTerm, correctEvent, demoExercise, entryState, eventFromDraft, historyText, kindLabel, mergeEventsDetailed,
  mergeExercise, mergeReportText, newExercise, normalizeMelder, parseMeldung, situationAt, unitKey,
  type EntryStateOptions, type Exercise, type Hint, type JournalContext,
} from "../src";

// fiktiv: Beispiel Bern (Raster BERN AA–AU × 1–15, NAI 1–3, Trupps H01–H05, Det 1/2), T1 = 2030-05-14, T2 = 2030-05-15
const bern = demoExercise();
const now = new Date(2030, 4, 15, 7, 30);
const ctxOf = (ex: Exercise, o: Partial<JournalContext> = {}): JournalContext => ({ sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: "2030-05-15", now, dayFromClock: true, ...o });
const opt = (ex: Exercise, o: Partial<EntryStateOptions> = {}): EntryStateOptions => ({
  hasRaster: ex.sheets.length > 0, online: true, placePending: false, manualPos: false, now, sheets: ex.sheets, areas: ex.areas, days: ex.days, ...o,
});
const parse = (t: string, ex = bern, c: Partial<JournalContext> = {}) => parseMeldung(t, ctxOf(ex, c));
const state = (t: string, ex = bern, o: Partial<EntryStateOptions> = {}, c: Partial<JournalContext> = {}) => entryState(parse(t, ex, c), opt(ex, o));
const prepared = { knownUnits: bern.units.blau, unitsPrepared: true };

describe("Zeit in der Zukunft (K1)", () => {
  it("«1535» um 07:30 ohne Tag: geht nicht, mit Vorschlag 07:35", () => {
    const s = state("1535 H02 2 Pers in AK9");
    expect(s.level).toBe("geht-nicht");
    expect(s.reasons[0]).toMatchObject({ code: "zukunft", token: "1535", suggest: "0735" });
    expect(s.reasons[0]!.text).toBe("15:35 liegt in der Zukunft – meintest du 07:35?");
    expect(s.reasons[0]!.hint).toContain("T1 1535");
  });
  it("mit Tagesangabe nur prüfen; bis 10 min in der Zukunft bereit", () => {
    const s = state("T2 1535 H02 2 Pers in AK9");
    expect(s.level).toBe("pruefen");
    expect(s.reasons.map((r) => r.code)).toEqual(["zukunft"]);
    expect(state("0738 H02 2 Pers in AK9").level).toBe("bereit");
  });
  it("Übung in der Zukunft (Beispiel 2030 mit heutiger Uhr): keine Sperre", () => {
    const today = new Date(2026, 9, 29, 7, 30);
    const d = parseMeldung("0715 H02 2 Pers in AK9", { ...ctxOf(bern), now: today, day: "2030-05-14", dayFromClock: false });
    expect(entryState(d, opt(bern, { now: today })).level).toBe("bereit");
  });
});

describe("Unbekannter Trupp (H1, M4) und Schreibweise «h3»", () => {
  it("Trupps vorbereitet: neuer Name gelb (MVP 3.5: «H07 ist kein Trupp dieser Übung.», 2. Enter ohne Trupp)", () => {
    const s = state("H07 2 Fz in AK7", bern, prepared);
    expect(s.level).toBe("pruefen");
    expect(s.reasons[0]).toMatchObject({ code: "trupp-neu", token: "H07", suggest: "H07" });
    expect(s.reasons[0]!.text).toBe("H07 ist kein Trupp dieser Übung.");
    expect(s.reasons[0]!.ask).toBe("Nochmals Enter trägt ohne Trupp ein.");
  });
  it("(MVP 3.5, S16) auch ohne vorbereitete Trupps gelb – nie still lernen", () => {
    expect(state("H07 2 Fz in AK7").level).toBe("pruefen");
    expect(state("H07 2 Fz in AK7", bern, { knownUnits: bern.units.blau }).reasons.map((r) => r.code)).toContain("trupp-neu");
    expect(parse("H07 2 Fz in AK7")).toMatchObject({ melder: "", truppNeu: "H07" });
  });
  it("«h3», «H3» → H03 (bekannt, bereit); «H6» → H06 (neu)", () => {
    for (const t of ["h3 2 Fz in AK7", "H3 2 Fz in AK7", "h03 2 Fz in AK7"]) {
      expect(parse(t).melder).toBe("H03");
      expect(state(t, bern, prepared).level).toBe("bereit");
    }
    expect(parse("H6 2 Fz in AK7")).toMatchObject({ melder: "", truppNeu: "H06" });
    expect(state("H6 2 Fz in AK7", bern, prepared).reasons[0]!.text).toContain("H06 ist kein Trupp");
  });
  it("leere Übung: «h3» wird H03; «H13» bei H01 bleibt gesperrt (kein doppelter Grund)", () => {
    const leer = newExercise("Leer (fiktiv)");
    expect(parseMeldung("h3 2 Fz", ctxOf(leer))).toMatchObject({ melder: "", truppNeu: "H03" });
    const s = state("H13 2 Fz in AK7", bern, prepared);
    expect(s.level).toBe("geht-nicht");
    expect(s.reasons.map((r) => r.code)).not.toContain("trupp-neu");
  });
  it("normalizeMelder folgt der Schreibweise der Übung", () => {
    expect(normalizeMelder("h3", ["H01", "H02"])).toBe("H03");
    expect(normalizeMelder("h3", ["H1", "H2"])).toBe("H3");
    expect(normalizeMelder("h3", [])).toBe("H03");
    expect(normalizeMelder("det 2", [])).toBe("Det 2");
    expect(normalizeMelder("h3", ["H03"])).toBe("H03");
  });
});

describe("Richtung auf eigene Stellung (H1 Erstbenutzer)", () => {
  it("«Rtg eigene Stellung» verschiebt den Trupp nicht und macht nicht «eigene»", () => {
    const d = parse("H03 3 Pers bei AJ7 Rtg eigene Stellung");
    expect(d.kind).toBe("feind");
    expect(d.melder).toBe("H03");
    expect(d.unit).toBe("");
    expect(d.cells).toEqual(["AJ7"]);
    expect(d.dirLabel).toBe("Rtg eigene Stellung");
    expect(d.desc).toContain("gegnerische");
    const before = situationAt(bern.events!, "2030-05-15T07:30").units.find((u) => u.key === unitKey("blau", "H03"))!;
    const ev = { ...eventFromDraft(d, "dev-test", now) };
    const after = situationAt([...bern.events!, ev], "2030-05-15T07:30").units.find((u) => u.key === unitKey("blau", "H03"))!;
    expect(after.pos).toEqual(before.pos);
  });
  it("Varianten «Rtg eig Stao», «Richtung unsere Stellung»", () => {
    expect(parse("H01 2 Fz in AK7 Rtg eig Stao")).toMatchObject({ kind: "feind", unit: "", dirLabel: "Rtg eig Stao" });
    expect(parse("H01 2 Pers in AK7 Richtung unsere Stellung")).toMatchObject({ kind: "feind", unit: "" });
  });
  it("eigene Lage bleibt eigene Lage", () => {
    expect(parse("H02 Stellung bezogen AK7")).toMatchObject({ kind: "eigen", unit: "H02" });
    expect(parse("H02 eig Stao AK7")).toMatchObject({ kind: "eigen", unit: "H02" });
  });
});

describe("Unbekanntes Wort statt geratener Art", () => {
  it("«schützenpnzr»: Art unklar, gelb «Was gesehen?», Vorschlag Schützenpanzer", () => {
    const d = parse("H03 2 schützenpnzr in AK7");
    expect(d).toMatchObject({ kind: "unklar", sym: "einheit", count: 2, desc: "2 ? («schützenpnzr»)" });
    expect(d.unknownWord).toMatchObject({ token: "schützenpnzr", suggest: "spz", suggestLabel: "Schützenpanzer" });
    const s = entryState(d, opt(bern));
    expect(s.level).toBe("pruefen");
    // (MVP 3.5, C1) Vorschlag = Ersatzwort, Text nach Kap. 4
    expect(s.reasons[0]).toMatchObject({ code: "was", token: "schützenpnzr", suggest: "Schützenpanzer" });
    expect(s.reasons[0]!.text).toBe("Was gesehen? «schützenpnzr» – meinst du «Schützenpanzer»?");
    expect(s.reasons[0]!.ask).toBe("Nochmals Enter trägt «2 ?» als Unklar ein.");
    expect(d.ersatz).toEqual({ token: "schützenpnzr", wort: "Schützenpanzer" });
  });
  it("richtig geschrieben bzw. ausdrücklich Feind", () => {
    expect(parse("H03 2 Schützenpanzer in AK7")).toMatchObject({ sym: "spz", kind: "feind" });
    expect(parse("H03 2 Schützenpanzer in AK7").unknownWord).toBeUndefined();
    expect(parse("H03 2 gn schützenpnzr in AK7").kind).toBe("feind");
  });
  it("ohne Anzahl und Tippfehler ohne Wortteil-Treffer", () => {
    expect(parse("H03 schützenpnzr in AK7").unknownWord?.token).toBe("schützenpnzr");
    expect(parse("H03 2 Lastwgen in AK7").unknownWord?.suggest).toBe("lw");
  });
  it("bekannte Sichtungen und Wörter ohne nahen Begriff bleiben wie bisher", () => {
    for (const t of ["H03 1 weisser Lieferwagen in AK7", "H03 2 schwarze Pw in AK7", "H03 3 Wanderer bei AK7", "H03 Lastwagenkolonne in AK7", "H03 2 Fz in AK7 Rtg N", "H04 1 Pers in AK7 seit 10 min"]) {
      expect(parse(t).unknownWord, t).toBeUndefined();
    }
  });
  it("closestTerm: Vorschlag nur bei kleinem Abstand", () => {
    expect(closestTerm("schützenpnzr")?.entry.key).toBe("spz");
    expect(closestTerm("Schützenpanzer")).toBeUndefined();
    expect(closestTerm("Golf")).toBeUndefined();
  });
});

// MVP 3 (Entscheid E2): starke Hinweise («Rückfrage:», «Auftrag an», «Befehl an») sind grün als eigene Art; nur schwache
// («… ?», «Frage:», «befohlen») bleiben gelb mit `kindHint: "notiz"` (Code jetzt `art-schwach`). Kein Zeichen in beiden Fällen.
describe("Rückfrage, Auftrag, Frage → Notiz ohne Zeichen (K4, MVP 3: eigene Arten)", () => {
  it("«H04 Rückfrage: Standort Det 2?»: grün als Rückfrage, kein Zeichen, Det 2 nicht gesetzt", () => {
    const d = parse("H04 Rückfrage: Standort Det 2?");
    expect(d).toMatchObject({ art: "rueckfrage", artStark: true, melder: "H04", unit: "", side: "blau" });
    expect(d.kindHint).toBeUndefined();
    expect(d.pos).toBeUndefined();
    const s = entryState(d, opt(bern, prepared));
    expect(s.level).toBe("bereit");
    const w = entryState(parse("H03 wo ist Det 1?"), opt(bern, prepared));
    expect(w.reasons.map((r) => r.code)).toEqual(["art-schwach"]);
    expect(w.reasons[0]!.text).toContain("Als Rückfrage ohne Zeichen?");
    const ev = eventFromDraft(d, "dev-test", now);
    expect(ev.notiz).toBe(true);
    expect(kindLabel(ev)).toBe("Notiz");
    const sit = situationAt([...bern.events!, ev], "2030-05-15T07:30");
    expect(sit.units.find((u) => u.unit === "Det 2")?.event.id).not.toBe(ev.id);
  });
  it("«Auftrag an H01: Beo NAI 1 bis 0800»: H01 wird nicht versetzt, kein Melder", () => {
    const d = parse("Auftrag an H01: Beo NAI 1 bis 0800");
    expect(d).toMatchObject({ art: "auftrag", an: "H01", melder: "", unit: "", orte: ["NAI 1"] });
    expect(d.nai).toBeUndefined();
    expect(d.pos).toBeUndefined();
    const before = situationAt(bern.events!, "2030-05-15T07:30").units.find((u) => u.unit === "H01")!;
    const after = situationAt([...bern.events!, eventFromDraft(d, "dev-test", now)], "2030-05-15T07:30").units.find((u) => u.unit === "H01")!;
    expect(after.pos).toEqual(before.pos);
  });
  it("weitere Stichwörter; normale Meldungen und Einordnung von Hand ohne Hinweis", () => {
    expect(parse("Befehl an H02: Stao halten")).toMatchObject({ art: "auftrag", an: "H02", artStark: true });
    expect(parse("H03 Frage: Ablösung wann").kindHint).toBe("notiz");
    expect(parse("H03 wo ist Det 1?").kindHint).toBe("notiz");
    expect(parse("H04 2 Fz in AK7 Rtg N").kindHint).toBeUndefined();
    const k = parse("H04 Rückfrage: Standort Det 2?", bern, { kind: "feind" });
    expect(k.kindHint).toBeUndefined();
  });
});

describe("Texterkennung: «HO04» → H04 (K2)", () => {
  it("überzählige Null bzw. O statt 0", () => {
    expect(cleanOcr("0715 HO04 2 Fz AK7")).toBe("0715 H04 2 Fz AK7");
    expect(cleanOcr("H0O4 Beo Stao")).toBe("H04 Beo Stao");
    expect(cleanOcr("HO4")).toBe("H04");
    expect(cleanOcr("HO04", { units: ["H4"] })).toBe("H4");
    expect(cleanOcr("H00")).toBe("H00");
  });
});

describe("Zusammenführen: Konflikt bei gleicher Revision (K3)", () => {
  const orig = bern.events!.find((e) => e.t.endsWith("07:25")) ?? bern.events![0]!;
  const a = correctEvent(orig, { text: "5 Pers AP11", cells: ["AP11"], where: "AP11" }, "dev-a", new Date("2030-05-15T05:31:00Z"));
  const b = correctEvent(orig, { text: "4 Pers AP12", cells: ["AP12"], where: "AP12" }, "dev-b", new Date("2030-05-15T05:33:00Z"));
  const exA: Exercise = { ...bern, events: bern.events!.map((e) => (e.id === orig.id ? a : e)) };
  const exB: Exercise = { ...bern, events: bern.events!.map((e) => (e.id === orig.id ? b : e)) };
  it("zählt den Konflikt, neuere Korrektur gewinnt, die andere Fassung bleibt in history", () => {
    const { ex, report } = mergeExercise(exA, exB);
    expect(report.conflicts).toBe(1);
    expect(report.conflictIds).toEqual([orig.id]);
    expect(report.aktualisiert).toBe(0);
    const m = ex.events!.find((e) => e.id === orig.id)!;
    expect(m.text).toBe("4 Pers AP12");
    const lost = m.history!.find((h) => h.conflict)!;
    expect(lost).toMatchObject({ text: "5 Pers AP11", device: "dev-a", rev: a.rev });
    expect(m.history!.some((h) => !h.conflict && h.text === orig.text)).toBe(true);
    expect(mergeReportText(report)).toContain("1 Konflikt");
    expect(historyText(m)).toContain("Konflikt, nicht übernommen: ");
  });
  it("deterministisch in beide Richtungen; wiederholtes Zusammenführen zählt nicht doppelt", () => {
    const ab = mergeExercise(exA, exB).ex.events!.find((e) => e.id === orig.id)!;
    const ba = mergeExercise(exB, exA);
    expect(ba.report.conflicts).toBe(1);
    const bae = ba.ex.events!.find((e) => e.id === orig.id)!;
    expect(bae.text).toBe(ab.text);
    expect(bae.history).toEqual(ab.history);
    const again = mergeExercise(mergeExercise(exA, exB).ex, exA);
    expect(again.report.conflicts).toBe(0);
    expect(again.ex.events!.find((e) => e.id === orig.id)!.history!.filter((h) => h.conflict)).toHaveLength(1);
    const both = mergeExercise(mergeExercise(exA, exB).ex, mergeExercise(exB, exA).ex);
    expect(both.report.conflicts).toBe(0);
  });
  it("gleiche Revision mit gleichem Inhalt ist kein Konflikt", () => {
    const b2 = { ...a, device: "dev-b", updatedAt: "2030-05-15T05:35:00.000Z" };
    const r = mergeEventsDetailed([a], [b2]);
    expect(r.conflicts).toEqual([]);
    expect(r.events[0]!.history!.some((h) => h.conflict)).toBe(false);
  });
});

describe("Hinweise bündeln (M2)", () => {
  const h = (id: string, t: string, ev: string, o: Partial<Hint> = {}): Hint => ({
    id, rule: "C5", level: "hoch", title: "Hinterhalt-Gefahr in NAI 3", text: `${t.slice(11)} Sperre in NAI 3.`, events: [ev], t, last: t, cells: ["AL12"], nai: "NAI 3", ...o,
  });
  it("gleiche offene Hinweise (Regel + Ort) werden einer – ID des ältesten, alle Auslöser", () => {
    const out = bundleHints([h("C5:b", "2030-05-15T00:18", "b"), h("C5:a", "2030-05-14T18:16", "a"), h("C5:c", "2030-05-15T06:20", "c", { level: "mittel" })], "2030-05-15T07:25");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "C5:a", t: "2030-05-14T18:16", last: "2030-05-15T06:20", level: "hoch" });
    expect(out[0]!.events).toEqual(["a", "b", "c"]);
    expect(out[0]!.text).toContain("3 gleiche Hinweise seit 14.05. 18:16");
  });
  it("anderer Ort, andere Regel oder beendet bleiben einzeln", () => {
    const out = bundleHints([
      h("C5:a", "2030-05-15T06:00", "a"), h("C5:x", "2030-05-15T06:10", "x", { nai: "NAI 2", title: "Hinterhalt-Gefahr in NAI 2", cells: ["AP2"] }),
      h("C1:a", "2030-05-15T06:10", "y", { rule: "C1" }), h("C5:z", "2030-05-15T05:00", "z", { until: "2030-05-15T06:00" }),
    ], "2030-05-15T07:25");
    expect(out.map((x) => x.id).sort()).toEqual(["C1:a", "C5:a", "C5:x", "C5:z"]);
  });
});
