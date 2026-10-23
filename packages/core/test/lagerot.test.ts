import { describe, expect, it } from "vitest";
import {
  COA_THRESHOLDS, STRENGTH_THRESHOLDS, allRedCoas, analyzeJournal, compareStrength, computeRedCoas, demoExercise, estimateRedForce,
  eventFromDraft, lastPosition, parseMeldung, parseStrength, type Exercise, type LageEvent, type RedForce, type StrengthEstimate,
} from "../src";

// Lage Rot: Kräfte Rot und mögliche Aktionen Rot – nur fiktive Daten (Beispiel Bern, Raster BERN AA–AU × 1–15 à 500 m,
// NAI 1 ≈ AA–AD × 6–8 (H01), NAI 2 ≈ AO–AQ × 1–4 (H03), NAI 3 ≈ AK–AM × 11–13 (Engnis, H05)).

let idc = 0;
function build(lines: string[], setup?: (ex: Exercise) => void): Exercise {
  const ex = demoExercise();
  delete ex.feindannahme;
  setup?.(ex);
  const events: LageEvent[] = [];
  const now = new Date(2030, 4, 15, 8, 0);
  for (const line of lines) {
    const d = parseMeldung(line, {
      sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now,
      lastPos: (u, s) => lastPosition(events, s, u),
    });
    const ev = eventFromDraft(d, "dev-test", now);
    ev.id = `rt${String(++idc).padStart(4, "0")}`;
    events.push(ev);
  }
  ex.events = events;
  return ex;
}
const T2 = (hhmm: string) => `2030-05-15T${hhmm}`;
const row = (f: RedForce, key: string) => f.rows.find((r) => r.key === key);
const mm = (r: StrengthEstimate | undefined) => (r ? [r.min, r.max] : null);
const coas = (ex: Exercise, t = T2("08:00")) => {
  const { hints } = analyzeJournal(ex, { t, strict: true });
  return { all: allRedCoas(ex, { t, hints }), sel: computeRedCoas(ex, { t, hints }) };
};
const kinds = (ex: Exercise, t?: string) => coas(ex, t).all.map((c) => c.id);

// ---------------------------------------------------------------------------------------------
describe("parseStrength – Feindannahme in Kurzschrift", () => {
  const cnt = (text: string) => Object.fromEntries(parseStrength(text).rows.map((r) => [r.key, r.count]));
  const cases: Array<[string, Record<string, number>]> = [
    ["2 Det, 14 Pers, 5 Fz, 1 Drohne", { "elemente:det": 2, pers: 14, fz: 5, drohne: 1 }],
    ["5 Fz (2 Kpz)", { fz: 5, kpz: 2 }],
    ["2 Det à 6 Pers", { "elemente:det": 2, pers: 12 }],
    ["3 Zug à 30", { "elemente:zug": 3, pers: 90 }],
    ["Det 1, Det 2", { "elemente:det": 2 }],
    ["ca. 12–15 Pers", { pers: 14 }], // Spanne: Mitte, dazu min/max
    ["zwei Drohnen", { drohne: 2 }],
    ["3 Mg + 1 Pzaw", { mg: 3, pzaw: 1 }],
    ["2 Kpz, 3 Lastw", { fz: 5, kpz: 2, lw: 3 }],
    ["1 Gr; 4 Trp\n2 Spz", { "elemente:gr": 1, "elemente:trp": 4, fz: 2, spz: 2, pers: 22 }], // Pers aus Stufe 18–26
    ["14 Personen und 2 Fahrzeuge", { pers: 14, fz: 2 }],
    ["2 Det (14 Pers, 5 Fz)", { "elemente:det": 2, pers: 14, fz: 5 }],
    ["1 Heli, 2 Pw", { heli: 1, fz: 2 }],
    ["mind. 20 Sdt", { pers: 20 }],
    ["2 Det à 6 Pers, 14 Pers", { "elemente:det": 2, pers: 14 }],
    ["Drohne", { drohne: 1 }],
    ["3 x Kpz", { fz: 3, kpz: 3 }],
    ["eine Gruppe, 8 Mann", { "elemente:gr": 1, pers: 8 }],
    ["1 Hz und 2 Trp", { "elemente:hz": 1, "elemente:trp": 2, pers: 22 }],
  ];
  for (const [text, want] of cases) it(`«${text.replace(/\n/g, " / ")}»`, () => {
    expect(cnt(text)).toEqual(want);
    expect(parseStrength(text).unknown).toEqual([]);
  });
  it("Zeilen: Namen, Kürzel, davon", () => {
    const s = parseStrength("Det 1, Det 2, 5 Fz (2 Kpz)");
    expect(s.rows[0]).toMatchObject({ key: "elemente:det", name: "Elemente", abbr: "Det", count: 2, names: ["Det 1", "Det 2"] });
    expect(s.rows.find((r) => r.key === "kpz")).toMatchObject({ name: "davon Kpz", parent: "fz", abbr: "Kpz" });
    expect(s.rows.map((r) => r.key)).toEqual(["elemente:det", "fz", "kpz"]);
  });
  it("Unverstandenes in `unknown`, Rest trotzdem gelesen", () => {
    const s = parseStrength("2 Det, viele Leute, 14 Pers, 3 Bananen");
    expect(s.unknown).toEqual(["viele Leute", "3 Bananen"]);
    expect(s.rows.map((r) => r.key)).toEqual(["elemente:det", "pers"]);
    expect(parseStrength("")).toEqual({ rows: [], unknown: [] });
    expect(parseStrength("   ,  ;")).toEqual({ rows: [], unknown: [] });
  });
});

// ---------------------------------------------------------------------------------------------
describe("estimateRedForce – erkannte Kräfte", () => {
  it("zu Fuss erklärbar (500 m in 30 Min) = dieselbe Gruppe; gleichzeitig weit auseinander = verschieden", () => {
    const same = estimateRedForce(build(["T2 0100 H01: 3 Pers AC6", "T2 0130 H02: 3 Pers AD6"]), T2("08:00"));
    expect(mm(row(same, "pers"))).toEqual([3, 3]);
    const apart = estimateRedForce(build(["T2 0100 H01: 3 Pers AC6", "T2 0105 H04: 4 Pers AP12"]), T2("08:00"));
    expect(mm(row(apart, "pers"))).toEqual([7, 7]);
  });
  it("Tempo: 5 km in 10 Min ist mit Fz möglich, zu Fuss nicht", () => {
    const fz = estimateRedForce(build(["T2 0100 H01: 2 Fz AC6", "T2 0110 H03: 2 Fz AM6"]), T2("08:00"));
    expect(row(fz, "fz")!.min).toBe(2);
    const pers = estimateRedForce(build(["T2 0100 H01: 2 Pers AC6", "T2 0110 H03: 2 Pers AM6"]), T2("08:00"));
    expect(row(pers, "pers")!.min).toBe(4);
  });
  it("Obergrenze = Summe der Sichtungen, gedeckelt auf das Doppelte; Untergrenze über Zeit zusammengefasst", () => {
    const f = estimateRedForce(build(["T2 0100 H01: 2 Pers AC6", "T2 0300 H03: 2 Pers AP12", "T2 0500 H02: 2 Pers AH3"]), T2("08:00"));
    expect(row(f, "pers")!.min).toBe(2);
    expect(row(f, "pers")!.max).toBe(2 * 2); // Summe 6, Deckel MAX_FACTOR × 2
    expect(STRENGTH_THRESHOLDS.MAX_FACTOR).toBe(2);
  });
  it("Doppelmeldung (zweiter Melder, gleicher Ort) zählt auch in der Obergrenze nur einmal", () => {
    const f = estimateRedForce(build(["T2 0710 H02: 2 Kpz AK9 Rtg W", "T2 0712 H05: 2 Kpz AJ9 Rtg W"]), T2("08:00"));
    expect(mm(row(f, "kpz"))).toEqual([2, 2]);
    expect(row(f, "kpz")).toMatchObject({ name: "davon Kpz", parent: "fz" });
    expect(mm(row(f, "fz"))).toEqual([2, 2]);
  });
  it("fremde Quelle («angeblich») zählt nicht zur Untergrenze", () => {
    const f = estimateRedForce(build(["T2 0450 H02: Zivilperson meldet angeblich 3 Fz AT3 Rtg N"]), T2("08:00"));
    expect(mm(row(f, "fz"))).toEqual([0, 3]);
  });
  it("benannte Elemente einmal, je Element das Maximum; unbenannte Sichtung, die das Element erklärt, zählt nicht doppelt", () => {
    const f = estimateRedForce(build(["T2 0100 H02: Det 1 2 Fz AK9", "T2 0300 H02: Det 1 3 Fz AK10", "T2 0320 H03: 2 Fz AM10", "T2 0200 H04: Det 2 4 Pers AF12"]), T2("08:00"));
    expect(row(f, "elemente:det")).toMatchObject({ min: 2, max: 2, names: ["Det 1", "Det 2"] });
    expect(row(f, "fz")!.min).toBe(3);
    // 2 Fz AM10 20 Min nach Det 1 (3 Fz) AK10: erreichbar, nicht mehr – auch in der Obergrenze dasselbe Element
    expect(row(f, "fz")!.max).toBe(3);
    expect(mm(row(f, "pers"))).toEqual([4, 4]);
  });
  it("Stufe als Spanne (Gr Inf 6–10 Pers); Art unklar nur als eigene Zeile", () => {
    const f = estimateRedForce(build(["T2 0655 H04: 1 gn Gr Inf AH12 Rtg N", "T1 2140 H01 3 Pers bei NAI 1, Zugehörigkeit unklar"]), T2("08:00"));
    expect(mm(row(f, "pers"))).toEqual([6, 10]);
    expect(row(f, "unklar")).toMatchObject({ min: 1, max: 1, name: "Unklar (nicht gezählt)" });
  });
  it("nur Meldungen bis zur Lagezeit, gelöschte zählen nicht", () => {
    const ex = build(["T2 0100 H01: 3 Pers AC6", "T2 0300 H04: 4 Pers AP12"]);
    expect(row(estimateRedForce(ex, T2("02:00")), "pers")!.min).toBe(3);
    ex.events![0] = { ...ex.events![0]!, deleted: true, rev: 2 };
    expect(row(estimateRedForce(ex, T2("08:00")), "pers")!.min).toBe(4);
    expect(estimateRedForce(build([]), T2("08:00"))).toEqual({ rows: [], notSeen: [] });
  });
  it("nicht mehr gesehen: benannte Elemente ohne Meldung seit über 60 Min, längste zuerst", () => {
    const ex = build(["T2 0310 H02: Det 2 3 Pers AJ8", "T2 0650 H03: Det 1 2 Fz AN6"]);
    const f = estimateRedForce(ex, T2("07:25"));
    expect(f.notSeen).toEqual([{ unit: "Det 2", since: T2("03:10"), minutes: 255, event: ex.events![0]!.id }]);
    expect(estimateRedForce(ex, T2("08:30")).notSeen.map((n) => n.unit)).toEqual(["Det 2", "Det 1"]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("compareStrength – erkannt ↔ erwartet", () => {
  const f = estimateRedForce(build([
    "T2 0100 H02: Det 1 2 Fz AK9", "T2 0110 H02: Det 2 3 Pers AJ8", "T2 0710 H02: 2 Kpz AK9 Rtg W", "T2 0300 H05: Drohne über AQ11",
    "T2 0400 H01 4 Pers AD7 unklar",
  ]), T2("08:00"));
  it("Zustände vollständig, teilweise (Anteil), fehlt, unerwartet, mehr; unklar bleibt offen", () => {
    const c = compareStrength(f, parseStrength("2 Det, 6 Pers, 3 Fz, 1 Mg"));
    const st = Object.fromEntries(c.map((x) => [x.row.key, [x.state, x.ratio === undefined ? undefined : Math.round(x.ratio * 100)]]));
    expect(st).toEqual({
      // 2 Kpz können die 2 Fz von Det 1 sein (erreichbar, nicht mehr): mind. 2 Fz
      "elemente:det": ["vollstaendig", 100], pers: ["teilweise", 50], fz: ["teilweise", 67], kpz: ["unerwartet", undefined],
      drohne: ["unerwartet", undefined], mg: ["fehlt", 0], unklar: ["offen", undefined],
    });
    expect(c.find((x) => x.row.key === "mg")!.expected).toBe(1);
    expect(c.find((x) => x.row.key === "mg")!.found).toBeUndefined();
  });
  it("ohne Feindannahme nur «erkannt» (alle Zeilen offen)", () => {
    const c = compareStrength(f, null);
    expect(c.length).toBe(f.rows.length);
    expect(c.every((x) => x.state === "offen" && x.expected === undefined)).toBe(true);
  });
  it("Reihenfolge: Elemente, Personen, Fahrzeuge, davon, Luft, Waffen, unklar", () => {
    expect(compareStrength(f, parseStrength("1 Mg")).map((x) => x.row.key)).toEqual(["elemente:det", "pers", "fz", "kpz", "drohne", "mg", "unklar"]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("computeRedCoas – mögliche Aktionen Rot", () => {
  const H05 = ["T1 1920 H05 Beo Stao AQ11 C", "T2 0330 H05 Beo Stao AQ11 C"];
  it("Überfall auf eigenen Stao: Drohne über dem Stao + Schwergewicht nahe; Zeitraum und Annäherung mit Strassenname", () => {
    const ex = build([...H05, "T2 0450 H05: Drohne über AQ11", "T2 0640 H05: 6 Pers AP10 am Waldrand", "T2 0645 H05: 2 Fz AP10 an der Seftigenstrasse, stehen mit laufendem Motor"]);
    const c = coas(ex, T2("07:00")).all.find((x) => x.id === "ueberfall:H05")!;
    expect(c.title).toBe("Überfall auf Stao H05 (AQ11)");
    expect(c.indicators.filter((i) => i.met).map((i) => i.rule)).toEqual(["D1", "C4", "still"]);
    expect(c.approachText).toBe("aus AP10 über Seftigenstrasse");
    expect(c.approach).toHaveLength(2);
    // Zeitraum ab dem letzten starken Indikator (C4 06:45), nicht ab der Lagezeit
    expect(c.window!.from >= T2("06:45") && c.window!.to > c.window!.from).toBe(true);
    expect(c.windowState).toBe("erwartet");
    expect(c.check[0]).toBe("Stellungswechsel H05");
    expect(c.events.length).toBeGreaterThan(2);
  });
  it("Überfall: ohne Schlüssel-Indikator (nur still + Formation) keine Möglichkeit", () => {
    expect(kinds(build([...H05, "T2 0725 H02: 4 Pers in Linie AP12 Rtg N"]), T2("07:30")).filter((k) => k.startsWith("ueberfall"))).toEqual([]);
  });
  it("Hinterhalt am Engnis: Sperre im Engnis + wiederholte Aufklärung", () => {
    const L = ["T2 0535 H05: Drohne über NAI 3", "T2 0610 H05: Drohne über NAI 3", "T2 0620 H05: Sperre aus Baumstämmen in NAI 3, Strasse blockiert"];
    const c = coas(build(L), T2("06:30")).all.find((x) => x.kind === "hinterhalt")!;
    expect(c.id).toBe("hinterhalt:NAI 3");
    expect(c.title).toBe("Hinterhalt an Engnis NAI 3 auf eigene Verschiebung");
    expect(c.indicators.filter((i) => i.met).map((i) => i.rule)).toEqual(["C5", "C3"]);
    expect(c.check).toContain("Verschiebungen nicht über NAI 3");
    // nur die Sperre: ein Indikator – kein Lärm
    expect(kinds(build([L[2]!]), T2("06:30")).some((k) => k.startsWith("hinterhalt"))).toBe(false);
  });
  it("Sperren/Kanalisieren: mehrere Hindernisse nahe beieinander, IED, eigenes Element nahe", () => {
    const ex = build(["T1 1850 H04 Beo Stao AF12 A", "T2 0700 H05: mögliche IED in AF13", "T2 0705 H04: gn Sperre in AG13"]);
    const c = coas(ex, T2("07:10")).all.find((x) => x.kind === "sperren")!;
    expect(c.indicators.filter((i) => i.met).map((i) => i.rule)).toEqual(["sperren", "ied", "eigene"]);
    expect(c.title).toBe("Sperren/Kanalisieren im Raum AF13–AG13");
    expect(kinds(build(["T2 0650 H03: Sperre AM5"]), T2("07:00")).some((k) => k.startsWith("sperren"))).toBe(false);
  });
  const PENDEL = ["T2 0542 H02: 1 ziv Fz (schwarzer Pw) AK9 Rtg O", "T2 0610 H03: 1 ziv Fz (schwarzer Pw) AN6 Rtg N", "T2 0640 H02: 1 ziv Fz (schwarzer Pw) AK9 Rtg W", "T2 0710 H03: 1 ziv Fz (schwarzer Pw) AN6"];
  it("Versorgung/Übergabe: Pendel + Übergabe am Pendel-Ende, Prognose der nächsten Durchfahrt", () => {
    const c = coas(build([...PENDEL, "T2 0645 H02: 2 Pers AL9 laden Kisten in Kofferraum"]), T2("07:15")).all.find((x) => x.kind === "versorgung")!;
    expect(c.title).toBe("Versorgung/Übergabe Pendel AK9 ↔ AN6 (nächste ca. 07:40)");
    expect(c.window).toBeUndefined(); // Prognose steht im Titel (aus `next` des Pendels)
    expect(c.indicators.filter((i) => i.met).map((i) => i.rule)).toEqual(["C2", "C1"]);
    // Pendel allein: kein zweiter Indikator
    expect(kinds(build(PENDEL), T2("07:15")).some((k) => k.startsWith("versorgung"))).toBe(false);
    // überfällig: keine Prognose mehr im Titel
    const late = coas(build([...PENDEL, "T2 0645 H02: 2 Pers AL9 laden Kisten in Kofferraum"]), T2("08:00")).all.find((x) => x.kind === "versorgung")!;
    expect(late.title).toBe("Versorgung/Übergabe Pendel AK9 ↔ AN6");
    expect(late.indicators[0]!.text).toMatch(/seit 07:40 überfällig \(C2\)$/);
  });
  it("Aufklärung zur Vorbereitung: Drohne 2× beim eigenen Stao", () => {
    const c = coas(build([...H05, "T2 0430 H05 Drohne über AR10", "T2 0450 H05: Drohne über AQ11"]), T2("05:00")).all;
    // zwei Drohnen-Meldungen = höchstens zwei zählende Indikatoren; «Drohne 2×» ist schon gezählt
    const a = c.find((x) => x.id === "aufklaerung:H05")!;
    expect(a.indicators.filter((i) => i.met).map((i) => i.rule)).toEqual(["C3", "D1"]);
    expect(a.indicators.find((i) => i.rule === "drohne")!.text).toMatch(/schon gezählt$/);
    expect(kinds(build([...H05, "T2 0430 H01: Drohne über AB3"]), T2("05:00")).some((k) => k.startsWith("aufklaerung"))).toBe(false);
  });
  it("Infiltration: NAI mit stummem Trupp und Checkpoint Rot im NAI", () => {
    const L = ["T2 0100 H01 Beo Stao AE5 C", "T2 0150 H02: Det 1 Checkpoint AC8", "T2 0320 H02: 2 Pers AB7 Rtg O"];
    const c = coas(build(L), T2("03:30")).all.find((x) => x.kind === "infiltration")!;
    expect(c.id).toBe("infiltration:NAI 1");
    expect(c.indicators.filter((i) => i.met).map((i) => i.rule)).toEqual(["D3", "B2"]);
    // Trupp meldet sich regelmässig: keine Lücke, keine Infiltration
    expect(kinds(build([...L, "T2 0325 H01 Beo Stao AE5 C, keine Bewegung"]), T2("03:30")).some((k) => k.startsWith("infiltration"))).toBe(false);
    // «Rot nahe» zählt nicht zusätzlich, wenn es schon die Lücke (D3) auslöst
    expect(kinds(build(["T2 0100 H01 Beo Stao AE5 C", "T2 0220 H01: 2 Pers AC7", "T2 0320 H02: 2 Pers AB7 Rtg O"]), T2("03:30")).some((k) => k.startsWith("infiltration"))).toBe(false);
  });
  it("Absetzen/Ausweichen: Meldungen nehmen ab, Rot entfernt sich von den eigenen Elementen", () => {
    const busy = ["T2 0500 H02: 2 Pers AJ9", "T2 0510 H02: 1 Fz AJ10", "T2 0520 H02: 2 Pers AJ8", "T2 0530 H02: 1 Fz AJ9", "T2 0540 H02: 3 Pers AJ10"];
    const L = ["T1 1840 H02 Beo Stao AK9 B", ...busy, "T2 0620 H02: Det 1 2 Fz AH9 Rtg W", "T2 0630 H02: Det 1 2 Fz AG9 Rtg W"];
    const c = coas(build(L), T2("06:45")).all.find((x) => x.kind === "absetzen")!;
    expect(c.title).toBe("Absetzen/Ausweichen von Rot Rtg W");
    expect(c.indicators.filter((i) => i.met).map((i) => i.rule)).toEqual(["abnahme", "weg"]);
    expect(kinds(build(["T1 1840 H02 Beo Stao AK9 B", ...busy]), T2("05:45")).some((k) => k.startsWith("absetzen"))).toBe(false);
  });
  it("Beispielübung zur Demo-Endzeit: wahrscheinlichste Überfall H05, gefährlichste Hinterhalt NAI 3, weitere Versorgung", () => {
    const ex = demoExercise();
    const end = ex.events!.map((e) => e.t).sort().at(-1)!;
    const { sel } = coas(ex, end);
    expect(sel.map((c) => [c.label, c.id])).toEqual([
      ["wahrscheinlichste", "ueberfall:H05"], ["gefaehrlichste", "hinterhalt:NAI 3"], ["weitere", "versorgung:C2:fz:schwarz-pw:AK9~AN6"],
    ]);
    const [u, h, v] = sel;
    expect(u!.indicators.map((i) => i.met)).toEqual([true, true, true, true, false]);
    expect(u!.indicators.map((i) => i.text)).toEqual([
      "Drohne über H05 02:50 (D1)", "Schwergewicht 6 Pers + 2 Fz AP10 06:40 (C4)", "Formation Linie AP11 07:25 (C6)", "H05 nicht verschoben seit 03:30",
      "Annäherung auf Achse AP10 → AQ11 noch nicht gemeldet",
    ]);
    expect(u!.approachText).toBe("aus AP10 über Seftigenstrasse");
    expect(u!.window).toEqual({ from: T2("07:45"), to: T2("08:35") });
    expect(u!.windowState).toBe("erwartet");
    expect(h!.indicators.filter((i) => i.met).map((i) => i.text)).toEqual(["Sperre NAI 3 06:20 (C5)", "Aufklärung NAI 3 2× (C3)"]);
    expect(v!.title).toBe("Versorgung/Übergabe Pendel AK9 ↔ AN6 (nächste ca. 07:40)");
    expect(u!.score).toBeGreaterThan(h!.score);
    expect(h!.danger).toBeGreaterThan(u!.danger);
    // jede erfüllte Indikator-Meldung gehört zu den Auslösern
    for (const c of sel) for (const i of c.indicators.filter((x) => x.met)) for (const e of i.events ?? []) expect(c.events).toContain(e);
  });
  it("Beispielübung: Kräfte Rot gegenüber der Feindannahme", () => {
    const ex = demoExercise();
    const end = ex.events!.map((e) => e.t).sort().at(-1)!;
    const f = estimateRedForce(ex, end);
    const c = compareStrength(f, parseStrength(ex.feindannahme!));
    const st = Object.fromEntries(c.map((x) => [x.row.key, x.state]));
    expect(ex.feindannahme).toBe("2 Det, 14 Pers, 5 Fz, 1 Drohne");
    expect(st).toMatchObject({ "elemente:det": "vollstaendig", pers: "teilweise", fz: "teilweise", kpz: "unerwartet", drohne: "vollstaendig", unklar: "offen" });
    expect(row(f, "elemente:det")!.names).toEqual(["Det 1", "Det 2"]);
    const p = row(f, "pers")!;
    // «mind.» ehrlich: Sichtungen, die Det 1/Det 2 sein können, zählen nicht dazu
    expect(p.min).toBeGreaterThanOrEqual(8);
    expect(p.max).toBeGreaterThan(p.min);
    expect(f.notSeen.map((n) => n.unit)).toEqual(["Det 2", "Det 1"]);
  });
  it("gefährlichste nur, wenn gefährlicher als die wahrscheinlichste; weitere möglichst andere Art", () => {
    const L = ["T1 1850 H04 Beo Stao AF12 A", "T2 0535 H05: Drohne über NAI 3", "T2 0610 H05: Drohne über NAI 3", "T2 0620 H05: Sperre aus Baumstämmen in NAI 3, Strasse blockiert",
      "T2 0700 H05: mögliche IED in AF13", "T2 0705 H04: gn Sperre in AG13"];
    const { all, sel } = coas(build(L), T2("07:10"));
    expect(all[0]!.kind).toBe("hinterhalt");
    expect(sel.map((c) => c.label)).not.toContain("gefaehrlichste");
    expect(sel[0]!.label).toBe("wahrscheinlichste");
    expect(sel[1]).toMatchObject({ label: "weitere" });
    expect(sel[1]!.kind).not.toBe("hinterhalt");
    expect(sel.length).toBeLessThanOrEqual(3);
  });
  it("Lagezeit: nur Meldungen und Hinweise bis dahin; IDs stabil über spätere Lagezeiten", () => {
    const ex = demoExercise();
    const early = coas(ex, T2("02:00")).all;
    expect(early.some((c) => c.kind === "ueberfall")).toBe(false);
    const tMs = Date.parse(T2("06:45"));
    for (const c of coas(ex, T2("06:45")).all) for (const id of c.events) expect(Date.parse(ex.events!.find((e) => e.id === id)!.t)).toBeLessThanOrEqual(tMs);
    const a = coas(ex, T2("07:25")).sel.map((c) => c.id), b = coas(ex, T2("07:30")).sel.map((c) => c.id);
    expect(b).toEqual(a);
    expect(computeRedCoas(build([]), { t: T2("08:00"), hints: [] })).toEqual([]);
  });
  it("Schwellen dokumentiert", () => {
    expect(COA_THRESHOLDS.MIN_MET).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Leistung", () => {
  it("1000 Meldungen: Kräfte und Möglichkeiten zusammen < 30 ms (nach Aufwärmen)", () => {
    const ex = demoExercise();
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <X,>(xs: X[]) => xs[Math.floor(rnd() * xs.length)]!;
    const base = Date.parse("2030-05-14T18:00");
    const p2 = (n: number) => String(n).padStart(2, "0");
    const iso = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
    const texts = ["2 Fz halten", "wendet", "1 ziv Fz (weisser Lieferwagen)", "Kolonne", "in Linie", "Kofferraum", "blockiert", "angeblich dringend", "bezieht Stellung", "3 Pers", "Rtg N"];
    const events: LageEvent[] = [];
    for (let i = 0; i < 1000; i++) {
      const blau = rnd() < 0.25;
      events.push({
        id: `p${i}`, rev: 1, device: "d", updatedAt: "", t: iso(base + i * 54000), side: blau ? "blau" : "rot", aff: blau ? "F" : rnd() < 0.8 ? "H" : "U",
        unit: blau ? pick(["H01", "H02", "H03", "H04", "H05"]) : rnd() < 0.5 ? pick(["Det 1", "Det 2", "Det 3"]) : "",
        melder: pick(["H01", "H02", "H03", "H04", "H05"]), text: pick(texts),
        sym: blau ? pick(["beob_aufkl", "patrouille", "einheit"]) : pick(["fz", "inf_trp", "drohne", "kontrollposten", "sperre", "kpz", "ziv_fz", "stellung", "ied"]),
        pos: { e: 2595000 + rnd() * 10000, n: 1196000 + rnd() * 6500 }, count: rnd() < 0.5 ? 1 + Math.floor(rnd() * 4) : undefined,
        dir: rnd() < 0.5 ? Math.floor(rnd() * 8) * 45 : undefined, where: "Karte", confirmed: true,
      });
    }
    ex.events = events;
    const t = "2030-05-15T12:00";
    const { hints } = analyzeJournal(ex, { t });
    const run = () => { estimateRedForce(ex, t); return computeRedCoas(ex, { t, hints }); };
    for (let k = 0; k < 6; k++) run();
    const times: number[] = [];
    for (let k = 0; k < 7; k++) {
      const t0 = performance.now();
      const r = run();
      times.push(performance.now() - t0);
      expect(r.length).toBeLessThanOrEqual(3);
    }
    times.sort((a, b) => a - b);
    expect(times[3]!).toBeLessThan(90); // Ziel < 30 ms allein; grosszügig wegen paralleler Testläufe
  });
});
