import { describe, expect, it } from "vitest";
import {
  COA_THRESHOLDS, STRENGTH_THRESHOLDS, allRedCoas, analyzeJournal, analyzeRedCoas, compareStrength, computeRedCoas, demoExercise, estimateRedForce,
  eventFromDraft, lastPosition, parseMeldung, parseStrength, type Exercise, type HintDecision, type LageEvent, type RedForce,
} from "../src";

// Lage Rot – Nachbesserung nach unabhängiger Prüfung (Szenarien des Prüfers). Nur fiktive Daten (Beispiel Bern,
// Raster BERN AA–AU × 1–15 à 500 m, Buchstaben West → Ost, Zahlen Nord → Süd; NAI 1 ≈ AA–AD × 6–8, NAI 3 ≈ AK–AM × 11–13 Engnis).

let idc = 0;
function build(lines: string[]): Exercise {
  const ex = demoExercise();
  delete ex.feindannahme;
  const events: LageEvent[] = [];
  const now = new Date(2030, 4, 15, 8, 0);
  for (const line of lines) {
    const d = parseMeldung(line, { sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now, lastPos: (u, s) => lastPosition(events, s, u) });
    const ev = eventFromDraft(d, "dev-pruef", now);
    ev.id = `pr${String(++idc).padStart(4, "0")}`;
    events.push(ev);
  }
  ex.events = events;
  return ex;
}
const T2 = (hhmm: string) => `2030-05-15T${hhmm}`;
const run = (ex: Exercise, t: string, decisions?: Record<string, HintDecision>) => {
  const { hints } = analyzeJournal(ex, { t });
  return { hints, ...analyzeRedCoas(ex, { t, hints, decisions }) };
};
const ids = (ex: Exercise, t: string) => run(ex, t).all.map((c) => c.id);
const metRules = (c: { indicators: Array<{ met: boolean; rule?: string; against?: boolean }> }) => c.indicators.filter((i) => i.met && !i.against).map((i) => i.rule);
const row = (f: RedForce, key: string) => f.rows.find((r) => r.key === key);
const mm = (f: RedForce, key: string) => { const r = row(f, key); return r ? [r.min, r.max] : null; };

const STAO = ["T1 1830 H01 Beo Stao AE5 C", "T1 1840 H02 Beo Stao AK9 B", "T1 1845 H03 Beo Stao AP4 D", "T1 1850 H04 Beo Stao AF12 A", "T1 1920 H05 Beo Stao AQ11 C"];
const RUHIG = [...STAO, "T1 1930 H03: 1 Fz in NAI 2 Rtg N", "T1 2030 H03: 1 Fz in NAI 2 Rtg S", "T1 2130 H03: 1 Fz in NAI 2 Rtg N",
  "T1 2230 H03: 1 Fz in NAI 2 Rtg S", "T1 2300 H01 Beo Stao AE5 C, keine Bewegung", "T1 2300 H05 Beo Stao AQ11 C, keine Bewegung",
  "T2 0000 H03: 1 Fz in NAI 2 Rtg N", "T2 0100 H03: 1 Fz in NAI 2 Rtg S", "T2 0130 H05 Beo Stao AQ11 C, keine Bewegung", "T2 0200 H01 Beo Stao AE5 C, keine Bewegung",
  "T2 0230 H03: 1 Fz in NAI 2 Rtg N", "T2 0300 H02 Beo Stao AK9 B, keine Bewegung", "T2 0330 H04 Beo Stao AF12 A, keine Bewegung"];
const ANGRIFF = [...STAO, "T2 0300 H04: Drohne über AF12", "T2 0400 H04: 1 Pers mit Feldstecher AG12",
  "T2 0510 H04: 8 Pers AH13 am Waldrand", "T2 0515 H04: 2 Fz AH13 stehen", "T2 0530 H01: 4 Pers in Linie AG13 Rtg W", "T2 0535 H04: 6 Pers AG12 Rtg W"];
const ABSETZEN = [...STAO, "T2 0300 H02: Det 1 2 Fz AJ9", "T2 0310 H02: 3 Pers AJ8", "T2 0320 H02: Det 1 4 Pers AJ10", "T2 0330 H02: 1 Fz AJ9", "T2 0340 H02: 2 Pers AJ8",
  "T2 0350 H02: Det 1 2 Fz AJ9", "T2 0420 H02: Det 1 2 Fz in Kolonne AH9 Rtg W", "T2 0435 H01: Det 1 2 Fz AF8 Rtg W"];

// ---------------------------------------------------------------------------------------------
describe("Vertrag: analyzeRedCoas, Gegenindikatoren, Zeitraum-Zustand, Entscheide, Zählung im Zeitfenster", () => {
  it("analyzeRedCoas rechnet einmal; computeRedCoas/allRedCoas sind Hüllen (Auswahl zuerst)", () => {
    const ex = demoExercise();
    const t = T2("07:25");
    const { hints } = analyzeJournal(ex, { t });
    const a = analyzeRedCoas(ex, { t, hints });
    expect(computeRedCoas(ex, { t, hints })).toEqual(a.picked);
    expect(allRedCoas(ex, { t, hints }).map((c) => c.id)).toEqual(a.all.map((c) => c.id));
    expect(a.all.slice(0, a.picked.length)).toEqual(a.picked);
    expect(a.all.slice(a.picked.length).every((c) => c.label === "weitere")).toBe(true);
    expect(analyzeRedCoas(build([]), { t, hints: [] })).toEqual({ picked: [], all: [] });
  });
  it("estimateRedForce mit Zeitfenster: zusätzlich «im Fenster», «nicht mehr gesehen» unabhängig vom Fenster", () => {
    const ex = build(["T2 0100 H02: Det 1 6 Pers AK9", "T2 0110 H04: Det 2 5 Pers AF12", "T2 0700 H03: 2 Pers AP3"]);
    const all = estimateRedForce(ex, T2("08:00"));
    const win = estimateRedForce(ex, T2("08:00"), { from: T2("06:00") });
    expect(mm(win, "pers")).toEqual(mm(all, "pers"));
    expect(row(win, "pers")!.inWindow).toEqual({ min: 2, max: 2 });
    expect(row(win, "elemente:det")!.inWindow).toEqual({ min: 0, max: 0 });
    expect(row(all, "pers")!.inWindow).toBeUndefined();
    expect(win.notSeen).toEqual(all.notSeen);
    expect(win.notSeen.map((n) => n.unit)).toEqual(["Det 1", "Det 2"]);
  });
  it("Entscheide: verworfener Hinweis zählt nicht, bestätigter stärker (gedeckelt)", () => {
    const ex = demoExercise();
    const t = T2("07:25");
    const base = run(ex, t);
    const d1 = base.hints.find((h) => h.rule === "D1" && h.unit === "H05")!;
    const c5 = base.hints.find((h) => h.rule === "C5" && h.nai === "NAI 3")!;
    const at = "2030-05-15T07:26";
    const rej = run(ex, t, { [d1.id]: { state: "verworfen", at } }).all.find((c) => c.id === "ueberfall:H05")!;
    expect(rej.indicators[0]).toMatchObject({ met: false, rule: "D1" });
    expect(rej.score).toBeLessThan(base.all.find((c) => c.id === "ueberfall:H05")!.score);
    const conf = run(ex, t, { [c5.id]: { state: "bestaetigt", at } }).all.find((c) => c.id === "hinterhalt:NAI 3")!;
    const h0 = base.all.find((c) => c.id === "hinterhalt:NAI 3")!;
    expect(conf.score).toBeGreaterThan(h0.score);
    expect(conf.indicators[0]!.weight).toBeCloseTo(Math.min(0.45 * COA_THRESHOLDS.CONFIRMED_FACTOR, COA_THRESHOLDS.CONFIRMED_MAX), 3);
    // Standard: Entscheide aus der Übung
    const ex2 = { ...ex, hintDecisions: { [d1.id]: { state: "verworfen", at } as HintDecision } };
    expect(run(ex2, t).all.find((c) => c.id === "ueberfall:H05")!.indicators[0]!.met).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Keine Doppelzählung, kein Lärm", () => {
  it("ruhige Lage: keine Möglichkeit; + 1 Drohne über H05: nur Hinweis D1, kein Überfall", () => {
    expect(ids(build(RUHIG), T2("03:40"))).toEqual([]);
    const r = run(build([...RUHIG, "T2 0335 H05: Drohne über AQ11"]), T2("03:40"));
    expect(r.hints.map((h) => h.rule)).toContain("D1");
    expect(r.all).toEqual([]);
    // Beobachter nahe H02: Lücke NAI 3 + «Rot nahe» (dieselbe Meldung) ist keine Infiltration
    expect(ids(build([...RUHIG, "T2 0335 H02: 1 Pers mit Feldstecher AK10"]), T2("03:40"))).toEqual([]);
  });
  it("«nicht verschoben» zählt nicht zur Mindestzahl; gleiche Meldungen zählen einmal", () => {
    // D1 + still: nur ein Rot-Indikator
    expect(ids(build([...STAO, "T2 0300 H05: Drohne über AQ11"]), T2("03:10")).some((k) => k.startsWith("ueberfall"))).toBe(false);
    // Drohne 2× über NAI 3: C3 und «Drohne 2×» sind dieselben zwei Meldungen
    const L = ["T2 0535 H05: Drohne über NAI 3", "T2 0610 H05: Drohne über NAI 3"];
    expect(ids(build(L), T2("06:15")).some((k) => k.startsWith("aufklaerung"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Absetzen erkennen, Gegenindikatoren", () => {
  it("Abnahme ab ⅔, Rot entfernt sich, Kolonne weg = wahrscheinlichste Absetzen; kein Überfall aus Rot, das abzieht", () => {
    const r = run(build(ABSETZEN), T2("04:45"));
    expect(r.picked[0]).toMatchObject({ id: "absetzen:rot", label: "wahrscheinlichste", title: "Absetzen/Ausweichen von Rot Rtg W" });
    expect(metRules(r.picked[0]!)).toEqual(["abnahme", "weg", "C6"]);
    expect(r.picked[0]!.indicators.find((i) => i.rule === "C6")!.text).toMatch(/weg von eigenen Elementen/);
    expect(r.all.some((c) => c.kind === "ueberfall")).toBe(false);
    expect(COA_THRESHOLDS.DROP_RATIO).toBeCloseTo(2 / 3);
  });
  it("widersprüchlich (Kolonne weg + Linie auf H02 zu): beide Möglichkeiten mit Gegenindikator ✗", () => {
    const r = run(build([...ABSETZEN, "T2 0440 H02: 6 Pers in Linie AK10 Rtg N", "T2 0442 H02: Drohne über AK9"]), T2("04:45"));
    const u = r.all.find((c) => c.id === "ueberfall:H02")!;
    const a = r.all.find((c) => c.id === "absetzen:rot")!;
    expect(u.indicators.find((i) => i.against)).toMatchObject({ met: true, rule: "weg", against: true });
    expect(u.indicators.find((i) => i.against)!.text).toMatch(/^Rot entfernt sich von H02: Det 1/);
    expect(a.indicators.find((i) => i.against)).toMatchObject({ met: true, rule: "naehert" });
    // Linie und Annäherung sind dieselbe Meldung
    expect(u.indicators.find((i) => i.rule === "C6")!.text).toMatch(/schon gezählt$/);
    expect(r.picked.map((c) => c.id).sort()).toEqual(["absetzen:rot", "ueberfall:H02"]);
  });
  it("Hinterhalt: eigene Präsenz im Engnis als Gegenindikator; mehrere Hindernisse zählen, neueste genannt", () => {
    const L = ["T2 0535 H01: Drohne über NAI 3", "T2 0610 H01: Drohne über NAI 3", "T2 0620 H01: Sperre aus Baumstämmen in NAI 3, Strasse blockiert"];
    const own = run(build(["T1 1920 H05 Beo Stao AL12 C", ...L]), T2("06:30")).all.find((c) => c.id === "hinterhalt:NAI 3")!;
    const free = run(build(["T1 1920 H05 Beo Stao AQ11 C", ...L]), T2("06:30")).all.find((c) => c.id === "hinterhalt:NAI 3")!;
    expect(own.indicators.find((i) => i.against)).toMatchObject({ met: true, rule: "praesenz", text: "eigene Präsenz im Engnis NAI 3: H05" });
    expect(free.indicators.some((i) => i.against)).toBe(false);
    expect(own.score).toBeLessThan(free.score);
    const two = run(build(["T1 1920 H05 Beo Stao AQ11 C", "T2 0300 H05: Sperre in NAI 3", ...L]), T2("06:30")).all.find((c) => c.id === "hinterhalt:NAI 3")!;
    expect(two.indicators[0]!.text).toBe("Sperre NAI 3 06:20 (C5, 2×)");
  });
});

// ---------------------------------------------------------------------------------------------
describe("Zeitraum gleitet nicht", () => {
  it("echte Annäherung ≤ 1 km auf das Ziel: «jetzt», ohne Vorbereitungszeit", () => {
    const u = run(build(ANGRIFF), T2("05:40")).picked[0]!;
    expect(u.id).toBe("ueberfall:H04");
    expect(u.windowState).toBe("jetzt");
    expect(u.window).toEqual({ from: T2("05:40"), to: T2("06:10") }); // Annäherung 05:35, 500 m zu Fuss
  });
  it("Zeitraum bleibt beim Abspielen gleich; vorbei ⇒ «ueberfaellig»", () => {
    const ex = demoExercise();
    const at = (t: string) => run(ex, t).all.find((c) => c.id === "ueberfall:H05")!;
    const a = at(T2("07:25")), b = at(T2("08:20")), c = at(T2("08:40"));
    expect(a.window).toEqual({ from: T2("07:45"), to: T2("08:35") });
    expect(b.window).toEqual(a.window);
    expect(c.window).toEqual(a.window);
    expect([a.windowState, b.windowState, c.windowState]).toEqual(["erwartet", "erwartet", "ueberfaellig"]);
  });
  it("ohne Ausgangsraum: Zeitraum «offen», Prüfen ohne leeren Achsenanfang", () => {
    const ex = build(["T1 1920 H05 Beo Stao AQ11 C", "T2 0330 H05 Beo Stao AQ11 C", "T2 0600 H05: Drohne über AQ11", "T2 0610 H05: 4 Pers in Linie AQ11"]);
    const u = run(ex, T2("06:20")).picked[0]!;
    expect(u).toMatchObject({ id: "ueberfall:H05", windowState: "offen" });
    expect(u.window).toBeUndefined();
    expect(u.check).toContain("Annäherung auf AQ11 beobachten");
    expect(u.indicators.find((i) => i.rule === "annaeherung")!.text).toBe("Annäherung auf AQ11 noch nicht gemeldet");
  });
});

// ---------------------------------------------------------------------------------------------
describe("Stabil beim Abspielen", () => {
  it("Formation nur mit Richtung zum Ziel oder nahe: Linie AK10 Rtg N zählt nicht für H05 (AQ11)", () => {
    const L = ["T1 1920 H05 Beo Stao AQ11 C", "T2 0330 H05 Beo Stao AQ11 C", "T2 0450 H05: Drohne über AQ11", "T2 0640 H05: 6 Pers AP10 am Waldrand"];
    const far = run(build([...L, "T2 0700 H02: 4 Pers in Linie AK10 Rtg N"]), T2("07:05")).all.find((c) => c.id === "ueberfall:H05")!;
    expect(far.indicators.find((i) => i.rule === "C6")!.met).toBe(false);
    const toward = run(build([...L, "T2 0700 H02: 4 Pers in Linie AK10 Rtg O"]), T2("07:05")).all.find((c) => c.id === "ueberfall:H05")!;
    expect(toward.indicators.find((i) => i.rule === "C6")!.met).toBe(true);
  });
  it("Indikatoren altern (Halbwertszeit), Zustände nicht; ohne neue Meldungen bleibt die Bewertung", () => {
    expect(COA_THRESHOLDS.HALF_LIFE_MIN).toBe(90);
    const ex = demoExercise();
    const u = run(ex, T2("07:25")).picked[0]!;
    const c4 = u.indicators.find((i) => i.rule === "C4")!;
    expect(c4.weight).toBeCloseTo(0.35 * 0.5 ** (40 / 90), 3); // C4 zuletzt 06:45, letzte Meldung 07:25
    expect(u.indicators.find((i) => i.rule === "D1")!.weight).toBe(0.35);
    const later = run(ex, T2("08:20")).picked;
    expect(later.map((c) => [c.id, c.score])).toEqual(run(ex, T2("07:25")).picked.map((c) => [c.id, c.score]));
  });
  it("Prüfer-Verlauf 06:15–08:30 (jede Minute): Wechsel der Auswahl nur bei neuen Meldungen", () => {
    const ex = demoExercise();
    const times = new Set(ex.events!.map((e) => e.t));
    let prev = "";
    const changes: string[] = [];
    for (let m = 6 * 60 + 15; m <= 8 * 60 + 30; m++) {
      const t = T2(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
      const sig = run(ex, t).picked.map((c) => `${c.label}:${c.id}`).join("|");
      if (prev && sig !== prev) changes.push(t);
      prev = sig;
    }
    for (const t of changes) expect(times.has(t)).toBe(true);
    expect(changes.length).toBeLessThanOrEqual(6);
  });
  it("Hysterese: Wechsel der wahrscheinlichsten erst ab 0,05 Unterschied", () => {
    expect(COA_THRESHOLDS.HYSTERESIS).toBe(0.05);
    // widersprüchlich: Überfall knapp höher als das bisherige Absetzen – Absetzen bleibt wahrscheinlichste
    const r = run(build([...ABSETZEN, "T2 0440 H02: 6 Pers in Linie AK10 Rtg N", "T2 0442 H02: Drohne über AK9"]), T2("04:45"));
    const u = r.all.find((c) => c.id === "ueberfall:H02")!, a = r.all.find((c) => c.id === "absetzen:rot")!;
    expect(Math.abs(u.score - a.score)).toBeLessThan(0.05);
    expect(r.picked[0]!.id).toBe("absetzen:rot");
  });
});

// ---------------------------------------------------------------------------------------------
describe("Stellungswechsel", () => {
  it("nach Stellungswechsel zählt die Aufklärung des alten Stao nicht; kein «Stellungswechsel prüfen»", () => {
    const r = run(build([...ANGRIFF, "T2 0545 H04 verschiebt nach AD12", "T2 0600 H04 Beo Stao AD12 A"]), T2("06:05"));
    expect(r.all.filter((c) => c.target?.unit === "H04").every((c) => !c.indicators.some((i) => i.rule === "D1" && i.met))).toBe(true);
    expect(r.all.flatMap((c) => c.check).some((x) => x === "Stellungswechsel H04")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Kräfte: Doppelmeldungen über Erreichbarkeit, «mind.» ehrlich, nicht mehr gesehen", () => {
  const f = (lines: string[], t = T2("08:00")) => estimateRedForce(build(lines), t);
  it("dieselbe Gruppe mehrfach gemeldet ist nicht «bis 12»", () => {
    expect(mm(f(["T2 0100 H01: 6 Pers AC7", "T2 0130 H01: 6 Pers AC7", "T2 0200 H02: 6 Pers AC7", "T2 0300 H01: 6 Pers AC7"]), "pers")).toEqual([6, 6]);
    expect(mm(f(["T2 0100 H01: 4 Pers AC7", "T2 0130 H01: 6 Pers AC7", "T2 0200 H02: 5 Pers AC7"]), "pers")).toEqual([6, 6]);
    expect(mm(f(["T2 0100 H01: 6 Pers AC7", "T2 0200 H01: 6 Pers AD7", "T2 0300 H02: 6 Pers AE7", "T2 0400 H02: 6 Pers AF7", "T2 0500 H02: 6 Pers AG7", "T2 0600 H03: 6 Pers AH7"]), "pers")).toEqual([6, 6]);
    expect(mm(f(["T2 0100 H01: 6 Pers AC7", "T2 0105 H04: 5 Pers AH13", "T2 0400 H01: 6 Pers AC7", "T2 0405 H04: 5 Pers AH13"]), "pers")).toEqual([11, 11]);
    expect(mm(f(["T2 0100 H01: 6 Pers AC7", "T2 0105 H04: 5 Pers AH13"]), "pers")).toEqual([11, 11]);
  });
  it("Typen (Kpz): erreichbar = dieselben, auch Stunden später", () => {
    const r = f(["T2 0100 H02: 2 Kpz AK9", "T2 0400 H03: 2 Kpz AP3"]);
    expect(mm(r, "kpz")).toEqual([2, 2]);
    expect(mm(r, "fz")).toEqual([2, 2]);
  });
  it("«mind.»: Sichtung, die Teil eines benannten Elements sein kann, wird nicht addiert", () => {
    expect(mm(f(["T2 0100 H02: Det 1 6 Pers AK9", "T2 0130 H02: 6 Pers AK9", "T2 0300 H03: 4 Pers AP3"]), "pers")).toEqual([6, 10]);
    expect(mm(f(["T2 0100 H02: Det 1 6 Pers AK9", "T2 0110 H04: Det 2 5 Pers AF12", "T2 0200 H03: 3 Pers AP3"]), "pers")).toEqual([11, 11]);
    // Element war zur Zeit der Sichtung nachweislich anderswo: zählt dazu
    expect(mm(f(["T2 0400 H02: Det 1 4 Pers AJ10", "T2 0435 H01: Det 1 2 Fz AF8 Rtg W", "T2 0440 H02: 6 Pers in Linie AK10 Rtg N"]), "pers")).toEqual([10, 10]);
    expect(STRENGTH_THRESHOLDS.DUP_PLACE_MIN).toBeGreaterThan(STRENGTH_THRESHOLDS.DUP_MIN);
  });
  it("nicht mehr gesehen: ohne nur «unklar» gemeldete und ohne aufgeriebene Elemente", () => {
    expect(f(["T2 0300 H02: Det 2 2 Pers AK9 unklar"]).notSeen).toEqual([]);
    expect(f(["T2 0300 H02: Det 1 4 Pers AK9", "T2 0400 H02: Det 1 aufgerieben, 4 Pers gefangen AK9"]).notSeen).toEqual([]);
    expect(f(["T2 0300 H02: Det 1 4 Pers AK9"]).notSeen.map((n) => n.unit)).toEqual(["Det 1"]);
  });
  it("unbenannte Feindelemente mit Stufe ergeben Elemente-Zeilen; benannte bleiben einzeln", () => {
    const zug = f(["T2 0100 H02: 1 gn Zug Inf AK9"]);
    expect(row(zug, "elemente:zug")).toMatchObject({ min: 1, max: 1, name: "Züge", abbr: "Zug" });
    expect(row(zug, "elemente:zug")!.names).toBeUndefined();
    expect(compareStrength(zug, parseStrength("1 Zug verst")).find((c) => c.row.key === "elemente:zug")!.state).toBe("vollstaendig");
    // gleichzeitig weit auseinander = verschieden; «2 gn Gr» = 2
    expect(mm(f(["T2 0100 H01: 1 gn Gr AC7", "T2 0105 H04: 1 gn Gr AH13"]), "elemente:gr")).toEqual([2, 2]);
    expect(mm(f(["T2 0100 H01: 2 gn Gr AC7"]), "elemente:gr")).toEqual([2, 2]);
    // dieselbe Gr am gleichen Ort wieder gemeldet = 1; Stunden später anderswo: mind. 1, bis 2
    expect(mm(f(["T2 0100 H01: 1 gn Gr AC7", "T2 0300 H02: 1 gn Gr AC7"]), "elemente:gr")).toEqual([1, 1]);
    expect(mm(f(["T2 0100 H01: 1 gn Gr AC7", "T2 0400 H03: 1 gn Gr AP3"]), "elemente:gr")).toEqual([1, 2]);
    expect(mm(f(["T2 0100 H04: gn Hz AD12"]), "elemente:hz")).toEqual([1, 1]);
    // benannte Det einzeln mit Namen, unabhängig von Stufen-Sichtungen
    const mix = f(["T2 0100 H02: Det 1 6 Pers AK9", "T2 0110 H04: Det 2 5 Pers AF12", "T2 0120 H03: 1 gn Zug Inf AP3"]);
    expect(row(mix, "elemente:det")).toMatchObject({ min: 2, max: 2, names: ["Det 1", "Det 2"] });
    expect(mm(mix, "elemente:zug")).toEqual([1, 1]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("parseStrength – Eingaben des Prüfers", () => {
  // Wert: Anzahl bzw. [Anzahl (Mitte), min, max] bei Spanne/aus der Stufe geschätzt
  const cases: Array<[string, Record<string, number | [number, number, number]>, string[]?]> = [
    ["Zug verst", { "elemente:zug": 1, pers: [30, 25, 35] }],
    ["1 Zug verst", { "elemente:zug": 1, pers: [30, 25, 35] }],
    ["1 Zug (verst)", { "elemente:zug": 1, pers: [30, 25, 35] }],
    ["2 Gr à 8", { "elemente:gr": 2, pers: 16 }],
    ["2 Gr à 8 Pers", { "elemente:gr": 2, pers: 16 }],
    ["1 Hz Inf mit 2 Spz", { "elemente:hz": 1, pers: [15, 12, 18], fz: 2, spz: 2 }],
    ["ca. 15 Pers", { pers: 15 }],
    ["ca 15 Personen", { pers: 15 }],
    ["~15 Pers", { pers: 15 }],
    ["2 Det, 14 Pers, 5 Fz, 1 Drohne", { "elemente:det": 2, pers: 14, fz: 5, drohne: 1 }],
    ["2 Dte, 14 Pres, 5 Fzg", { fz: 5 }, ["2 Dte", "14 Pres"]],
    ["3 Fzg", { fz: 3 }],
    ["1 Kp (-)", { "elemente:kp": 1 }],
    ["1 Inf Zug mit 3 Mg", { "elemente:zug": 1, pers: [30, 25, 35], mg: 3 }],
    ["2 Gr Inf à 6 Pers + 2 Pw", { "elemente:gr": 2, pers: 12, fz: 2 }],
    ["15-20 Pers", { pers: [18, 15, 20] }],
    ["12 bis 15 Pers", { pers: [14, 12, 15] }],
    ["2 Det à 7 Pers, davon 1 Sniper", { "elemente:det": 2, pers: 14, scharfschuetze: 1 }],
    ["Det Nord, Det Süd", { "elemente:det": 2 }],
    ["Det 1 (6 Pers, 2 Fz)", { "elemente:det": 1, pers: 6, fz: 2 }],
    ["2 Trp à 4", { "elemente:trp": 2, pers: 8 }],
    ["1 Gr mot (2 Pw)", { "elemente:gr": 1, pers: [8, 6, 10], fz: 2 }],
    ["1 Lastw, 2 Lieferwagen", { fz: 3, lw: 1 }],
    ["2 Kpz Leopard", { fz: 2, kpz: 2 }],
    ["1 Pz Gren Zug", { "elemente:zug": 1, pers: [30, 25, 35] }],
    ["4 Pers bewaffnet", { pers: 4 }],
    ["1 Mw", { mw_geraet: 1 }],
    ["Drohnen 2", { drohne: 2 }],
    ["2x Drohne", { drohne: 2 }],
    ["2 Det; 1 Reserve-Gr", { "elemente:det": 2, "elemente:gr": 1 }],
    ["14 Pers (2 Sniper)", { pers: 14, scharfschuetze: 2 }],
    ["2 Det à 7", { "elemente:det": 2, pers: 14 }],
    ["1 Kdo Trp", { "elemente:trp": 1, pers: [4, 3, 4] }],
    ["6 Bewaffnete", { pers: 6 }],
    ["2 Kleinbusse", { fz: 2, bus: 2 }],
    ["3 Motorräder", { fz: 3, motorrad: 3 }],
  ];
  for (const [text, want, unknown] of cases) it(`«${text}»`, () => {
    const s = parseStrength(text);
    const got = Object.fromEntries(s.rows.map((r) => [r.key, r.min !== undefined ? [r.count, r.min, r.max!] : r.count]));
    expect(got).toEqual(want);
    expect(s.unknown).toEqual(unknown ?? []);
  });
  it("«Zug verst» ist nie ein benanntes Element; «davon Scharfschützen» unter Personen", () => {
    expect(parseStrength("Zug verst").rows[0]!.names).toBeUndefined();
    expect(parseStrength("14 Pers (2 Sniper)").rows.find((r) => r.key === "scharfschuetze")).toMatchObject({ name: "davon Scharfschützen", parent: "pers" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("Leistung", () => {
  it("analyzeRedCoas mit 4000 Meldungen < 40 ms (nach Aufwärmen, Median)", () => {
    const ex = demoExercise();
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <X,>(xs: X[]) => xs[Math.floor(rnd() * xs.length)]!;
    const base = Date.parse("2030-05-14T18:00");
    const p2 = (n: number) => String(n).padStart(2, "0");
    const iso = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
    const texts = ["2 Fz halten", "wendet", "1 ziv Fz (weisser Lieferwagen)", "Kolonne", "in Linie", "Kofferraum", "blockiert", "bezieht Stellung", "3 Pers", "Rtg N", "Beo Stao"];
    const events: LageEvent[] = [];
    for (let i = 0; i < 4000; i++) {
      const blau = rnd() < 0.25;
      events.push({
        id: `p${i}`, rev: 1, device: "d", updatedAt: "", t: iso(base + Math.floor((i * 14 * 3600000) / 4000)), side: blau ? "blau" : "rot", aff: blau ? "F" : rnd() < 0.85 ? "H" : "U",
        unit: blau ? pick(["H01", "H02", "H03", "H04", "H05"]) : rnd() < 0.4 ? pick(["Det 1", "Det 2", "Det 3"]) : "", melder: pick(["H01", "H02", "H03", "H04", "H05"]), text: pick(texts),
        sym: blau ? pick(["beob_aufkl", "patrouille", "einheit"]) : pick(["fz", "inf_trp", "drohne", "kontrollposten", "sperre", "kpz", "ziv_fz", "stellung", "ied", "einheit"]),
        pos: { e: 2595000 + rnd() * 10000, n: 1196000 + rnd() * 6500 }, count: rnd() < 0.5 ? 1 + Math.floor(rnd() * 6) : undefined,
        dir: rnd() < 0.5 ? Math.floor(rnd() * 8) * 45 : undefined, where: "Karte", confirmed: true,
      });
    }
    ex.events = events;
    const t = "2030-05-15T08:00";
    const { hints } = analyzeJournal(ex, { t });
    for (let k = 0; k < 6; k++) analyzeRedCoas(ex, { t, hints });
    const times: number[] = [];
    for (let k = 0; k < 9; k++) {
      const t0 = performance.now();
      const r = analyzeRedCoas(ex, { t, hints });
      times.push(performance.now() - t0);
      expect(r.picked.length).toBeLessThanOrEqual(3);
    }
    times.sort((a, b) => a - b);
    expect(times[4]!).toBeLessThan(120); // Ziel < 40 ms allein; grosszügig wegen paralleler Testläufe
  });
});
