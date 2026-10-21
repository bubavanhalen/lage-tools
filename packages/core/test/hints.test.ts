import { describe, expect, it } from "vitest";
import {
  HINT_RULES, HINT_THRESHOLDS, analyzeJournal, computeHints, decisionFor, demoExercise, eventFromDraft, eventQuality, lastPosition, parseMeldung, reviseEvent,
  type Exercise, type Hint, type HintDecision, type LageEvent,
} from "../src";

// Fiktive Übung Raum Bern (Raster BERN AA–AU × 1–15 à 500 m, NAI 1–3 aus der Beispielübung) – keine Übungsdaten.
// NAI 1 ≈ AA–AD × 6–8 (Trupp H01), NAI 2 ≈ AO–AQ × 1–4 (Trupp H03), NAI 3 ≈ AK–AM × 11–13 (Engnis, Trupp H05).

let idc = 0;
/** Übung mit den Flächen der Beispielübung und eigenen Meldungen (Zeilen wie im Journal) */
function build(lines: string[], setup?: (ex: Exercise) => void): Exercise {
  const ex = demoExercise();
  setup?.(ex);
  const events: LageEvent[] = [];
  const now = new Date(2030, 4, 15, 8, 0);
  for (const line of lines) {
    const d = parseMeldung(line, {
      sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now,
      lastPos: (u, s) => lastPosition(events, s, u),
    });
    const ev = eventFromDraft(d, "dev-test", now);
    ev.id = `ev${String(++idc).padStart(4, "0")}`;
    events.push(ev);
  }
  ex.events = events;
  return ex;
}

const T2 = (hhmm: string) => `2030-05-15T${hhmm}`;
const T1 = (hhmm: string) => `2030-05-14T${hhmm}`;
const hints = (ex: Exercise, t = T2("08:00"), disabled?: string[]) => computeHints(ex, { t, strict: true, disabled });
const of = (hs: Hint[], rule: string) => hs.filter((h) => h.rule === rule);
const textOf = (ex: Exercise, h: Hint) => h.events.map((id) => ex.events!.find((e) => e.id === id)!.text);

/** Normallage in NAI 2: 3 Fz in den ersten 2 Stunden, Richtungen N/S */
const BASE_NAI2 = [
  "T1 1830 H03 Beo Stao AP4 D",
  "T1 1855 H03: 1 Fz in NAI 2 Rtg N",
  "T1 1930 H03: 1 Fz in NAI 2 Rtg S",
  "T1 2010 H03: 1 Fz in NAI 2 Rtg S",
];

describe("Regelwerk", () => {
  it("alle Regeln A1–E4 mit Gruppe, Name, Regeltext und Quelle", () => {
    expect(HINT_RULES.map((r) => r.id)).toEqual(["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3", "C4", "C5", "C6", "D1", "D2", "D3", "E1", "E2", "E3", "E4"]);
    for (const r of HINT_RULES) {
      expect(r.name.length).toBeGreaterThan(3);
      expect(r.rule.length).toBeGreaterThan(20);
      expect(r.source).toMatch(/^(53\.005\.\d\d|TF 17|GS 17)/);
      expect(r.rule).not.toMatch(/ß/);
    }
  });
  it("leeres Journal → keine Hinweise", () => {
    expect(hints(build([]))).toEqual([]);
  });
});

describe("A – Normallage", () => {
  it("A1: Normallage nach 2 Stunden mit genügend Meldungen (info)", () => {
    const ex = build(BASE_NAI2);
    const a1 = of(hints(ex), "A1");
    expect(a1).toHaveLength(1);
    expect(a1[0]).toMatchObject({ id: "A1:NAI 2", level: "info", nai: "NAI 2", t: T1("20:30"), unit: "H03" });
    expect(a1[0]!.text).toMatch(/1,5 Fz\/Std/);
    expect(a1[0]!.text).toMatch(/N↔S/);
  });
  it("A1: nicht vor Ablauf der Lernzeit und nicht mit zu wenig Meldungen", () => {
    expect(of(hints(build(BASE_NAI2), T1("20:20")), "A1")).toHaveLength(0);
    expect(of(hints(build(BASE_NAI2.slice(0, 3))), "A1")).toHaveLength(0);
  });
  /** Normallage mit 5 Richtungen (genug, um eine neue Richtung zu erkennen) */
  const BASE_DIRS = [...BASE_NAI2, "T1 1945 H03: 1 Fz in NAI 2 Rtg N", "T1 2020 H03: 1 Fz in NAI 2 Rtg N"];
  it("A2: deutlich mehr Verkehr und neue Richtung", () => {
    const ex = build([...BASE_DIRS, "T1 2100 H03: 1 Fz in NAI 2 Rtg N", "T1 2130 H03: 4 Fz in NAI 2 Rtg O", "T1 2140 H03: 3 Fz in NAI 2 Rtg O"]);
    const a2 = of(hints(ex), "A2");
    expect(a2).toHaveLength(1);
    expect(a2[0]!.id).toMatch(/^A2:NAI 2:/);
    expect(a2[0]!.text).toMatch(/neue Richtung O/);
    expect(a2[0]!.text).toMatch(/8 Fz innert 60 Min/);
    expect(a2[0]!.level).toBe("mittel");
  });
  it("A2: neue Richtung erst ab 5 Meldungen mit Richtung; Gegenrichtung auf Strasse bekannt; einmal gemeldet = gelernt", () => {
    // nur 3 Richtungen in der Normallage → keine «neue Richtung»
    expect(of(hints(build([...BASE_NAI2, "T1 2130 H03: 1 Fz in NAI 2 Rtg O"])), "A2")).toHaveLength(0);
    // Normallage nur Rtg N, NAI 2 ist eine Strasse → Rtg S ist die Gegenrichtung, nicht neu
    const north = ["T1 1830 H03 Beo Stao AP4 D", ...["1840", "1900", "1920", "1940", "2000"].map((x) => `T1 ${x} H03: 1 Fz in NAI 2 Rtg N`)];
    expect(of(hints(build([...north, "T1 2100 H03: 1 Fz in NAI 2 Rtg S"])), "A2")).toHaveLength(0);
    // neue Richtung O einmal, nach einer Pause nochmals O → nur ein Hinweis
    const twice = of(hints(build([...north, "T1 2100 H03: 1 Fz in NAI 2 Rtg O", "T1 2300 H03: 1 Fz in NAI 2 Rtg O"])), "A2");
    expect(twice).toHaveLength(1);
    expect(twice[0]!.until).toBe(T1("22:00"));
  });
  it("A2: zufällige Häufung bei wenig Verkehr ist keine Abweichung", () => {
    // Normallage ~1,5 Fz/Std: 3–4 Fz in einer Stunde sind Zufall
    expect(of(hints(build([...BASE_NAI2, "T1 2100 H03: 2 Fz in NAI 2 Rtg N", "T1 2120 H03: 2 Fz in NAI 2 Rtg S"])), "A2")).toHaveLength(0);
  });
  it("A2: neuer Fz-Typ", () => {
    const ex = build([...BASE_NAI2, "T1 2100 H03: 2 Kpz in NAI 2 Rtg S"]);
    expect(of(hints(ex), "A2")[0]!.text).toMatch(/neuer Fz-Typ/);
  });
  it("A2: normaler Verkehr löst nichts aus", () => {
    const ex = build([...BASE_NAI2, "T1 2100 H03: 1 Fz in NAI 2 Rtg N", "T1 2140 H03: 1 Fz in NAI 2 Rtg S"]);
    expect(of(hints(ex), "A2")).toHaveLength(0);
  });
  it("A3: auffällige Ruhe, wenn ~3 Meldungen ausbleiben (hier 1,5/Std → 2 Std), beendet durch neue Meldung; ID bleibt gleich", () => {
    const ex = build([...BASE_NAI2, "T1 2040 H03: 1 Fz in NAI 2 Rtg N"]);
    expect(of(hints(ex, T1("21:45")), "A3")).toHaveLength(0);
    const at = of(hints(ex, T1("22:45")), "A3");
    expect(at).toHaveLength(1);
    expect(at[0]!.t).toBe(T1("22:40"));
    expect(at[0]!.until).toBeUndefined();
    const later = build([...BASE_NAI2, "T1 2040 H03: 1 Fz in NAI 2 Rtg N", "T1 2300 H03: 1 Fz in NAI 2 Rtg S"]);
    // gleiche Meldungs-IDs nötig für den Vergleich der Hinweis-IDs: dieselbe Übung zu zwei Lagezeiten
    const h1 = of(hints(later, T1("22:45")), "A3")[0]!;
    const h2 = of(hints(later, T1("23:30")), "A3")[0]!;
    expect(h1.id).toBe(h2.id);
    expect(h2.until).toBe(T1("23:00"));
    expect(h2.text).toMatch(/Ruhe 20:40–23:00/);
  });
  it("A3: keine Ruhe-Meldung ohne Normallage oder bei laufendem Verkehr", () => {
    expect(of(hints(build(BASE_NAI2.slice(0, 3)), T2("02:00")), "A3")).toHaveLength(0);
    const busy = build([...BASE_NAI2, "T1 2050 H03: 1 Fz in NAI 2 Rtg N", "T1 2140 H03: 1 Fz in NAI 2 Rtg S"]);
    expect(of(hints(busy, T1("22:00")), "A3")).toHaveLength(0);
  });
});

describe("B – Präsenz", () => {
  const PATROL = ["T2 0100 H05 Beo Stao AQ11 C", "T2 0300 H05 eig Pat AN10", "T2 0330 H05 zurück, Beo Stao AQ11 C"];
  it("B1: Rot mit Tätigkeit bzw. bekanntes Element bis 30 Min nach Abzug der Patrouille im gleichen/benachbarten PQ", () => {
    const ex = build([...PATROL, "T2 0345 H02: Det 2 2 Pers AO10 Rtg S"]);
    const b1 = of(hints(ex), "B1");
    expect(b1).toHaveLength(1);
    expect(b1[0]).toMatchObject({ level: "mittel", unit: "H05", t: T2("03:45") });
    expect(b1[0]!.text).toMatch(/um 03:30 verlassen; 15 Min später/);
    expect(of(hints(build([...PATROL, "T2 0345 H02: 1 Fz hält AO10, Personen laden aus"])), "B1")).toHaveLength(1);
  });
  it("B1: ziviler Durchgangsverkehr nach der Patrouille ist keine Reaktion", () => {
    expect(of(hints(build([...PATROL, "T2 0345 H02: 1 Fz AM10 Rtg W"])), "B1")).toHaveLength(0);
    expect(of(hints(build([...PATROL, "T2 0345 H02: 2 Pers AO10 Rtg S"])), "B1")).toHaveLength(0);
  });
  it("B1: nicht nach mehr als 30 Min, nicht weit weg, nicht während die Patrouille noch da ist", () => {
    expect(of(hints(build([...PATROL, "T2 0410 H02: 2 Pers AN10"])), "B1")).toHaveLength(0);
    expect(of(hints(build([...PATROL, "T2 0340 H02: 2 Pers AE5"])), "B1")).toHaveLength(0);
    expect(of(hints(build([...PATROL.slice(0, 2), "T2 0310 H02: 2 Pers AN10"])), "B1")).toHaveLength(0);
  });
  it("B2: Checkpoint steht über 25 Min", () => {
    const ex = build(["T2 0105 H03: Det 1 Checkpoint in NAI 2"]);
    expect(of(hints(ex, T2("01:25")), "B2")).toHaveLength(0);
    const b2 = of(hints(ex, T2("01:40")), "B2");
    expect(b2).toHaveLength(1);
    expect(b2[0]).toMatchObject({ t: T2("01:30"), level: "mittel", nai: "NAI 2" });
    expect(b2[0]!.title).toMatch(/Checkpoint Det 1 in NAI 2 steht seit 01:05/);
  });
  it("B2: abgebauter Checkpoint vor Ablauf → kein Hinweis; danach mit Ende", () => {
    expect(of(hints(build(["T2 0105 H03: Det 1 Checkpoint in NAI 2", "T2 0115 H03: Checkpoint NAI 2 abgebaut"])), "B2")).toHaveLength(0);
    const b2 = of(hints(build(["T2 0105 H03: Det 1 Checkpoint in NAI 2", "T2 0150 H03: Checkpoint NAI 2 abgebaut"])), "B2");
    expect(b2[0]!.until).toBe(T2("01:50"));
  });
  it("B3: Fz wendet beim Checkpoint (hoch)", () => {
    const ex = build(["T2 0105 H03: Det 1 Checkpoint in NAI 2", "T2 0120 H03: 1 Fz wendet in NAI 2 Rtg N"]);
    const b3 = of(hints(ex), "B3");
    expect(b3).toHaveLength(1);
    expect(b3[0]!.level).toBe("hoch");
    expect(b3[0]!.events).toHaveLength(2);
  });
  it("B3: Fz entfernt sich vom eigenen Checkpoint (nur Richtung) → höchstens «mittel – prüfen»", () => {
    const ex = build(["T2 0100 H02 eig Checkpoint AK9", "T2 0110 H02: 1 Fz AK8 Rtg N"]);
    const b3 = of(hints(ex), "B3");
    expect(b3).toHaveLength(1);
    expect(b3[0]!.level).toBe("mittel");
    expect(b3[0]!.title).toMatch(/prüfen/);
    // ausdrücklich gewendet → hoch (gleiche ID)
    const turned = of(hints(build(["T2 0100 H02 eig Checkpoint AK9", "T2 0110 H02: 1 Fz AK8 Rtg N", "T2 0115 H02: 1 Fz dreht ab AJ9"])), "B3");
    expect(turned[0]!.level).toBe("hoch");
  });
  it("B3: Durchgangsverkehr nach Kontrolle ist kein Ausweichen", () => {
    // Verkehr N/S durch den CP: Hauptachse N–S
    const through = build(["T1 2000 H03 eig Checkpoint AO3", "T1 2010 H03: 1 Fz AO2 Rtg N", "T1 2015 H03: 1 Fz AO4 Rtg S", "T1 2040 H03: 1 Fz AO2 Rtg N"]);
    expect(of(hints(through, T1("21:00")), "B3")).toHaveLength(0);
    // ausdrücklich kontrolliert / passiert
    expect(of(hints(build(["T2 0100 H02 eig Checkpoint AK9", "T2 0110 H02: 1 Fz kontrolliert, AK8 Rtg N"])), "B3")).toHaveLength(0);
  });
  it("B3: Wenden ohne Checkpoint bzw. weit weg → nichts", () => {
    expect(of(hints(build(["T2 0120 H03: 1 Fz wendet in NAI 2 Rtg N"])), "B3")).toHaveLength(0);
    expect(of(hints(build(["T2 0105 H03: Det 1 Checkpoint in NAI 2", "T2 0120 H01: 1 Fz wendet AC10"])), "B3")).toHaveLength(0);
  });
});

describe("C – Absicht", () => {
  it("C1: «Kofferraum» / «umladen» → mögliche Übergabe", () => {
    const ex = build(["T2 0345 H02: 2 Pers AN10 laden Kisten in Kofferraum"]);
    expect(of(hints(ex), "C1")[0]).toMatchObject({ level: "hoch", cells: ["AN10"] });
    expect(of(hints(build(["T2 0345 H02: gn Pat AN10 lädt Material um"])), "C1")).toHaveLength(1);
  });
  it("C1: zwei haltende Fz innert 10 Min im Nachbar-PQ = mittel; mit Umladen = hoch", () => {
    const ex = build(["T2 0420 H03: 1 Fz hält AO5", "T2 0426 H03: 1 Fz hält AO6"]);
    const c1 = of(hints(ex), "C1");
    expect(c1).toHaveLength(1);
    expect(c1[0]!.level).toBe("mittel");
    expect(c1[0]!.events).toHaveLength(2);
    expect(c1[0]!.t).toBe(T2("04:26"));
    const strong = of(hints(build(["T1 2100 H02: 1 Fz hält AK8", "T1 2105 H02: 1 Fz hält AL8, Personen laden Kisten um"])), "C1");
    expect(strong).toHaveLength(1);
    expect(strong[0]!.level).toBe("hoch");
  });
  it("C1: Stau, Ampel, Haltestelle, Bus, Parkplatz, Tankstelle sind keine Übergabe", () => {
    for (const lines of [
      ["T1 2100 H03: 2 Fz stehen im Stau AO3", "T1 2104 H03: 1 Fz steht AO2 hinter Traktor im Stau"],
      ["T1 2100 H03: 1 Bus hält AO3", "T1 2106 H03: 1 PW hält AO3, Person steigt um in Bus"],
      ["T1 2100 H03: 1 Fz hält an Ampel AO3", "T1 2102 H03: 1 Fz hält an Ampel AO3"],
      ["T1 2100 H01: 1 Fz parkiert AE6", "T1 2105 H01: 1 Fz hält auf Parkplatz AE6"],
      ["T1 2100 H01: 1 Fz hält bei Tankstelle AE6", "T1 2105 H01: 1 Fz hält bei Tankstelle AE6"],
    ]) expect(of(hints(build(lines)), "C1"), lines[0]).toHaveLength(0);
  });
  it("C1: eine einzelne Meldung «3 Fz stehen» oder Halte weit auseinander → nichts", () => {
    expect(of(hints(build(["T2 0640 H04: 3 Fz AH11, stehen"])), "C1")).toHaveLength(0);
    expect(of(hints(build(["T2 0420 H03: 1 Fz hält AO5", "T2 0445 H03: 1 Fz hält AO6"])), "C1")).toHaveLength(0);
    expect(of(hints(build(["T2 0420 H03: 1 Fz hält AO5", "T2 0425 H03: 1 Fz hält AE10"])), "C1")).toHaveLength(0);
  });
  const VAN = (hhmm: string, where: string) => `T2 ${hhmm} H03: 1 ziv Fz (weisser Lieferwagen) ${where}`;
  it("C2: Pendel eines gleichartigen Fz mit Takt und Prognose; ID bleibt bei weiterer Durchfahrt", () => {
    const lines = [VAN("0130", "AN6 Rtg N"), VAN("0155", "in NAI 2"), VAN("0225", "AN6 Rtg S"), VAN("0255", "in NAI 2"), VAN("0325", "AN7")];
    const ex = build(lines);
    expect(of(hints(ex, T2("02:50")), "C2")).toHaveLength(0);
    const at3 = of(hints(ex, T2("03:00")), "C2");
    expect(at3).toHaveLength(1);
    expect(at3[0]).toMatchObject({ level: "mittel", t: T2("02:55"), next: T2("03:25") });
    expect(at3[0]!.title).toMatch(/weisser Lieferwagen zwischen AN6 und NAI 2/);
    const at4 = of(hints(ex, T2("03:30")), "C2");
    expect(at4[0]!.id).toBe(at3[0]!.id);
    expect(at4[0]!.events.length).toBeGreaterThan(at3[0]!.events.length);
    expect(at4[0]!.text).toMatch(/4 Durchfahrten/);
    // Prognose nur im Feld `next`, nie im Text
    expect(at4[0]!.text).not.toMatch(/nächste|ca\. \d\d:\d\d/);
    expect(at4[0]!.until).toBeUndefined();
    // nach 3 Takten ohne Durchfahrt vorbei: letzte 03:25, Takt 30 Min → 04:55
    expect(of(hints(ex, T2("04:50")), "C2")[0]!.until).toBeUndefined();
    expect(of(hints(ex, T2("05:00")), "C2")[0]!.until).toBe(T2("04:55"));
  });
  it("C2: auch für ein bekanntes Rot-Element (gleiche Einheit)", () => {
    const ex = build(["T2 0100 Det 1 1 Fz AC3", "T2 0130 Det 1 1 Fz AH3", "T2 0200 Det 1 1 Fz AC3", "T2 0230 Det 1 1 Fz AH3"]);
    expect(of(hints(ex), "C2")[0]!.title).toMatch(/Det 1 zwischen AC3 und AH3/);
  });
  it("C2: verschiedene Fz bzw. nur zwei Wechsel → kein Pendel", () => {
    expect(of(hints(build([VAN("0130", "AN6"), "T2 0155 H03: 1 ziv Fz (schwarzer PW) in NAI 2", VAN("0225", "AN6"), "T2 0255 H03: 1 ziv Fz (roter Bus) in NAI 2"])), "C2")).toHaveLength(0);
    expect(of(hints(build([VAN("0130", "AN6"), VAN("0155", "in NAI 2"), VAN("0225", "AN6")])), "C2")).toHaveLength(0);
  });
  it("C3: Drohne 2× innert 60 Min im gleichen/benachbarten PQ", () => {
    const c3 = of(hints(build(["T2 0230 H05 Drohne über AR10", "T2 0250 H05: Drohne über AQ11"])), "C3");
    expect(c3).toHaveLength(1);
    expect(c3[0]!.t).toBe(T2("02:50"));
    expect(of(hints(build(["T2 0230 H05 Drohne über AR10", "T2 0350 H05: Drohne über AQ11"])), "C3")).toHaveLength(0);
    expect(of(hints(build(["T2 0230 H05 Drohne über AR10", "T2 0250 H05: Drohne über AB3"])), "C3")).toHaveLength(0);
  });
  it("C3: dasselbe einzelne Fz 2× im gleichen Raum (ohne Pendel)", () => {
    const ex = build(["T2 0300 H02: 1 ziv Fz (grauer Kastenwagen) AJ9", "T2 0340 H02: 1 ziv Fz (grauer Kastenwagen) AJ10"]);
    expect(of(hints(ex), "C3")).toHaveLength(1);
  });
  it("C4: ≥ 3 stehende Fz bzw. ≥ 6 Pers in einem PQ innert 30 Min", () => {
    expect(of(hints(build(["T2 0640 H04: 3 Fz AH11, stehen mit laufendem Motor"])), "C4")).toHaveLength(1);
    const pers = of(hints(build(["T2 0640 H04: 4 Pers AH11", "T2 0655 H02: 3 Pers AH11"])), "C4");
    expect(pers).toHaveLength(1);
    expect(pers[0]!.t).toBe(T2("06:55"));
  });
  it("C4: dieselbe Gruppe mehrmals gemeldet zählt einmal; «weitere» wird dazugezählt; Stau nicht", () => {
    expect(of(hints(build(["T2 0640 H04: 2 Pers AH11", "T2 0650 H04: 2 Pers AH11", "T2 0700 H04: 2 Pers AH11"])), "C4")).toHaveLength(0);
    expect(of(hints(build(["T2 0640 H04: 4 Pers AH11", "T2 0650 H04: weitere 3 Pers AH11"])), "C4")).toHaveLength(1);
    expect(of(hints(build(["T2 0640 H04: 5 Fz stehen im Stau AH11"])), "C4")).toHaveLength(0);
  });
  it("C4: fahrende Fz oder verteilt über 30 Min → nichts", () => {
    expect(of(hints(build(["T2 0640 H04: 3 Fz AH11 Rtg N"])), "C4")).toHaveLength(0);
    expect(of(hints(build(["T2 0600 H04: 4 Pers AH11", "T2 0650 H04: 3 Pers AH11"])), "C4")).toHaveLength(0);
  });
  it("C4: hoch, wenn es gleichzeitig anderswo ruhiger wird", () => {
    // Stunde davor 3 Meldungen anderswo, letzte Stunde nur noch 1
    const ex = build(["T2 0410 H01: 1 Fz AC4", "T2 0420 H01: 1 Fz AD4", "T2 0440 H03: 1 Fz AQ2", "T2 0530 H03: 1 Fz AQ2", "T2 0600 H04: 3 Fz AH11, stehen"]);
    expect(of(hints(ex), "C4")[0]!.level).toBe("hoch");
    expect(of(hints(ex), "C4")[0]!.text).toMatch(/anderswo weniger Meldungen/);
  });
  it("C5: Hindernis im Engnis-NAI oder Text «blockiert»", () => {
    const c5 = of(hints(build(["T2 0620 H05: Sperre in NAI 3"])), "C5");
    expect(c5[0]).toMatchObject({ level: "hoch", nai: "NAI 3" });
    const outside = of(hints(build(["T2 0620 H02: Strasse AJ9 blockiert, gn Sperre"])), "C5");
    expect(outside).toHaveLength(1);
    // ausserhalb eines Engnisses höchstens mittel
    expect(outside[0]!.level).toBe("mittel");
    // kurze Blockade durch Zivil-Fz ist keine Hinterhalt-Gefahr
    expect(of(hints(build(["T1 1930 H04: Holzlaster blockiert kurz Strasse AG12 beim Wenden"])), "C5")).toHaveLength(0);
    expect(of(hints(build(["T1 1930 H05: Traktor blockiert kurz Strasse in NAI 3"])), "C5")).toHaveLength(0);
    expect(of(hints(build(["T2 0650 H03: Sperre AM5"])), "C5")).toHaveLength(0);
    // gleiche Sperre in einem Strassen-NAI: kein Engnis
    expect(of(hints(build(["T2 0650 H03: Sperre in NAI 2"])), "C5")).toHaveLength(0);
  });
  it("C6: Formation – Linie hoch, Kolonne mittel; ohne Formation nichts", () => {
    const hs = hints(build(["T2 0715 H05: 3 Fz in Kolonne AP10 Rtg W", "T2 0725 H02: 4 Pers in Linie AK10 Rtg N", "T2 0730 H02: 2 Pers AK10"]));
    const c6 = of(hs, "C6");
    expect(c6.map((h) => h.level).sort()).toEqual(["hoch", "mittel"]);
    expect(c6.find((h) => h.level === "hoch")!.text).toMatch(/Kontakt erwartet/);
    // Formation ist eine Momentaufnahme: nach 60 Min vorbei
    expect(c6.every((h) => !h.until)).toBe(true);
    expect(of(hints(build(["T2 0715 H05: 3 Fz in Kolonne AP10 Rtg W"]), T2("08:30")), "C6")[0]!.until).toBe(T2("08:15"));
  });
  it("C6: keine Formation bei «Bus Linie 10», «Y-Kreuzung», Wanderern; Schützenlinie/Y-Formation/Igel ja", () => {
    const traps = build(["T1 1910 H02: 1 Fz AK8 an Y-Kreuzung Rtg W", "T1 1920 H03: 1 Bus Linie 10 AO2 Rtg N", "T1 1940 H05: 3 Pers in Kolonne AR12 Rtg N (Wanderer)", "T1 1950 H03: 1 Fz Linie 3 AO3"]);
    expect(of(hints(traps, T1("20:00")), "C6")).toHaveLength(0);
    const real = of(hints(build(["T1 1910 H02: 6 Pers in Schützenlinie AK8", "T1 1920 H01: Det 2 in Y-Formation AC7", "T1 1930 H05: 5 Pers im Igel AR12"]), T1("20:00")), "C6");
    expect(real.map((h) => h.title.split(" ")[1]).sort()).toEqual(["Igel", "Linie", "Y"]);
  });
});

describe("D – Rot sieht Blau", () => {
  it("D1: Drohne ≤ 500 m vom eigenen Stao", () => {
    const ex = build(["T1 1920 H05 Beo Stao AQ11 C", "T2 0250 H05: Drohne über AQ11"]);
    const d1 = of(hints(ex), "D1");
    expect(d1).toHaveLength(1);
    expect(d1[0]).toMatchObject({ unit: "H05", level: "hoch", radius: 500 });
    expect(d1[0]!.pos).toEqual(ex.events![0]!.pos);
  });
  it("D1: Person mit Handy (hoch) / haltendes Fz ≤ 250 m (mittel) nahe Stao; nicht weit weg, nicht bei anderem Zeichen", () => {
    expect(of(hints(build(["T1 1840 H02 Beo Stao AK9 B", "T2 0300 H02: 1 Pers AK9 fotografiert mit Handy"])), "D1")[0]!.level).toBe("hoch");
    const halt = of(hints(build(["T1 1840 H02 Beo Stao AK9 B", "T2 0300 H02: 1 Fz hält AK9"])), "D1");
    expect(halt).toHaveLength(1);
    expect(halt[0]).toMatchObject({ level: "mittel", radius: 250 });
    // haltendes Fz 400 m vom Stao, Bus an der Haltestelle → nichts
    expect(of(hints(build(["T1 1840 H01 Beo Stao AE5 C", "T1 2030 H01: 1 Fz parkiert AE6"])), "D1")).toHaveLength(0);
    expect(of(hints(build(["T1 1840 H02 Beo Stao AK9 B", "T2 0300 H02: 1 Bus hält an Haltestelle AK9"])), "D1")).toHaveLength(0);
    expect(of(hints(build(["T1 1840 H02 Beo Stao AK9 B", "T2 0300 H02: Drohne über AE4"])), "D1")).toHaveLength(0);
    expect(of(hints(build(["T1 1840 H02 Beo Stao AK9 B", "T2 0300 H02: 1 Fz AK9 Rtg W"])), "D1")).toHaveLength(0);
  });
  it("D1: «Vbk i.O.» und Patrouille sind kein neuer Stao – gleiche ID, Entscheid haftet; Stellungswechsel beendet", () => {
    const ex = build(["T1 1920 H05 Beo Stao AQ11 C", "T1 2000 H05: Drohne über AQ11", "T1 2030 H05 Vbk i.O.", "T1 2040 H05 eig Pat AN10", "T1 2050 H05 zurück, Beo Stao AQ11 C", "T1 2100 H05: Drohne über AQ11", "T1 2200 H05 Stellungswechsel, Beo Stao AS13 A"]);
    const a = of(hints(ex, T1("20:10")), "D1"), b = of(hints(ex, T1("21:10")), "D1");
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(b[0]!.id).toBe(a[0]!.id);
    expect(b[0]!.text).not.toMatch(/letzter Standort/);
    expect(b[0]!.until).toBeUndefined();
    expect(of(hints(ex, T1("22:10")), "D1")[0]!.until).toBe(T1("22:00"));
  });
  it("D1: neuer Stao → neuer Hinweis (Schlüssel Element + Stao)", () => {
    const ex = build(["T1 1840 H02 Beo Stao AK9 B", "T2 0300 H02: Drohne über AK9", "T2 0400 H02 Beo Stao AE4 C", "T2 0500 H02: Drohne über AE4"]);
    const d1 = of(hints(ex), "D1");
    expect(d1).toHaveLength(2);
    expect(new Set(d1.map((h) => h.id)).size).toBe(2);
  });
  it("D2: eigener Stao im Nachbar-PQ eines Rot-Stao", () => {
    const ex = build(["T2 0530 H02: Det 2 bezieht Stellung AM9", "T2 0540 H02 Ablösung, Beo Stao AL9 A"]);
    const d2 = of(hints(ex), "D2");
    expect(d2).toHaveLength(1);
    expect(d2[0]).toMatchObject({ unit: "H02", t: T2("05:40") });
    expect(d2[0]!.text).toMatch(/Nachbar-PQ/);
  });
  it("D2: endet mit dem Stellungswechsel", () => {
    const ex = build(["T1 1801 H02 Beo Stao AK9 B", "T1 1900 H02: Det 2 bezieht Stellung AL9", "T1 2000 H02 Stellungswechsel, Beo Stao AF8 A"]);
    expect(of(hints(ex, T1("19:30")), "D2")[0]!.until).toBeUndefined();
    expect(of(hints(ex, T1("21:00")), "D2")[0]!.until).toBe(T1("20:00"));
  });
  it("D2: Rot-Element über 30 Min am gleichen Ort gilt als Stao", () => {
    const ex = build(["T1 1840 H02 Beo Stao AK9 B", "T2 0100 Det 1 2 Pers AL9", "T2 0140 Det 1 2 Pers AL10"]);
    expect(of(hints(ex), "D2")[0]!.t).toBe(T2("01:40"));
    const short = build(["T1 1840 H02 Beo Stao AK9 B", "T2 0100 Det 1 2 Pers AL9", "T2 0115 Det 1 2 Pers AL10"]);
    expect(of(hints(short), "D2")).toHaveLength(0);
  });
  it("D2: Rot-Stao weit weg → nichts", () => {
    expect(of(hints(build(["T2 0530 H02: Det 2 bezieht Stellung AE3", "T2 0540 H02 Beo Stao AL9 A"])), "D2")).toHaveLength(0);
  });
  it("D3: Trupp > 60 Min stumm, während Rot nahe am NAI aktiv ist", () => {
    const ex = build(["T1 2140 H01 Beo Stao AE5 C", "T2 0035 H02: Det 2 3 Pers AB6", "T2 0115 H02: Det 2 2 Pers AE8 Rtg W"]);
    const d3 = of(hints(ex), "D3");
    expect(d3).toHaveLength(1);
    expect(d3[0]).toMatchObject({ nai: "NAI 1", unit: "H01", level: "hoch", t: T2("00:35") });
    expect(d3[0]!.events).toHaveLength(3);
  });
  it("D3: endet, sobald sich der Trupp wieder meldet", () => {
    const ex = build(["T1 1830 H03 Beo Stao AP4 D", "T1 1830 H03: 1 Fz in NAI 2", "T1 2010 H02: 2 Fz AO3 Rtg N", "T1 2200 H03: 1 Fz in NAI 2 Rtg S"]);
    const open = of(hints(ex, T1("21:15")), "D3");
    expect(open).toHaveLength(1);
    expect(open[0]!.until).toBeUndefined();
    const done = of(hints(ex, T1("23:00")), "D3");
    expect(done[0]!.id).toBe(open[0]!.id);
    expect(done[0]!.until).toBe(T1("22:00"));
  });
  it("D3: Trupp meldet regelmässig bzw. Rot weit weg → nichts", () => {
    expect(of(hints(build(["T2 0010 H01 Beo Stao AE5 C", "T2 0035 H02: Det 2 3 Pers AB6", "T2 0050 H01: nichts Neues"])), "D3")).toHaveLength(0);
    // Trupp meldet die Rot-Tätigkeit selbst
    expect(of(hints(build(["T1 2140 H01 Beo Stao AE5 C", "T2 0035 H01: Det 2 3 Pers AB6", "T2 0120 H01: nichts Neues"])), "D3")).toHaveLength(0);
    expect(of(hints(build(["T1 2140 H01 Beo Stao AE5 C", "T2 0035 H02: Det 2 3 Pers AT14"])), "D3")).toHaveLength(0);
  });
  it("D3: NAI ohne Trupp nur, wenn in der Übung Trupps zugeteilt werden", () => {
    const lines = ["T2 0035 H02: Det 2 3 Pers AB6"];
    const none = (ex: Exercise) => { for (const a of ex.areas) delete a.trupp; };
    expect(of(hints(build(lines, none)), "D3")).toHaveLength(0);
    const oneMissing = (ex: Exercise) => { delete ex.areas.find((a) => a.name === "NAI 1")!.trupp; };
    const d3 = of(hints(build(lines, oneMissing)), "D3");
    expect(d3).toHaveLength(1);
    expect(d3[0]!.id).toMatch(/^D3:NAI 1:ohne:/);
  });
});

describe("E – Qualität", () => {
  it("E1: bestätigt durch zweiten Melder (gleicher Typ, Nachbar-PQ, innert 30 Min), sonst unbestätigt", () => {
    const ex = build(["T2 0710 H02: 2 Kpz AK9 Rtg W", "T2 0712 H05: 2 Kpz AJ9 Rtg W", "T2 0715 H05: 1 Fz AE3", "T2 0716 H04: Sperre AE3"]);
    const q = eventQuality(ex.events!, T2("08:00"), ex);
    const [a, b, c, d] = ex.events!;
    expect(q.get(a!.id)).toMatchObject({ status: "bestaetigt", confirmedBy: [b!.id] });
    expect(q.get(b!.id)).toMatchObject({ status: "bestaetigt", confirmedBy: [a!.id] });
    // anderer Zeichen-Typ bestätigt nicht
    expect(q.get(c!.id)!.status).toBe("unbestaetigt");
    expect(q.get(d!.id)!.status).toBe("unbestaetigt");
    // vor der zweiten Meldung: noch unbestätigt
    expect(eventQuality(ex.events!, T2("07:11"), ex).get(a!.id)!.status).toBe("unbestaetigt");
  });
  it("E1: gleicher Melder bestätigt sich nicht selbst; eigene Meldungen ohne Qualitätsmarke", () => {
    const ex = build(["T2 0710 H02: 2 Kpz AK9", "T2 0712 H02: 2 Kpz AK9", "T2 0720 H02 Beo Stao AL9 A"]);
    const q = eventQuality(ex.events!, T2("08:00"), ex);
    expect(q.get(ex.events![0]!.id)!.status).toBe("unbestaetigt");
    expect(q.has(ex.events![2]!.id)).toBe(false);
  });
  it("E2: fehlender Ort bzw. Melder", () => {
    const ex = build(["T1 1850 H04 Beo Stao AF12 A", "T1 2215 H04 Kontakt mit Gegner", "T2 0605 Det 1 2 Fz AO7 Rtg W"]);
    const q = eventQuality(ex.events!, T2("08:00"), ex);
    expect(q.get(ex.events![1]!.id)!.missing).toEqual(["Ort"]);
    expect(q.get(ex.events![2]!.id)!.missing).toEqual(["Melder"]);
  });
  it("E3: zu schnell zu Fuss bzw. mit Fz", () => {
    const foot = of(hints(build(["T2 0020 H02 Det 2 2 Pers AJ8", "T2 0035 H02: Det 2 3 Pers AB6"])), "E3");
    expect(foot).toHaveLength(1);
    expect(foot[0]!.text).toMatch(/zu Fuss/);
    const fz = of(hints(build(["T2 0100 Det 1 2 Fz AA1", "T2 0103 Det 1 2 Fz AU15"])), "E3");
    expect(fz[0]!.text).toMatch(/für Fz/);
  });
  it("E3: Tippfehler beim eigenen Stao (eigene Beo zu Fuss; Sprung > 2 km in 5 Min immer)", () => {
    const e3 = of(hints(build(["T1 1802 H03 Beo Stao AP4 D", "T1 1900 H03 Beo Stao AP14 D", "T1 1905 H03 Beo Stao AP4 D"]), T1("21:00")), "E3");
    expect(e3).toHaveLength(1);
    expect(e3[0]!.unit).toBe("H03");
    expect(e3[0]!.text).toMatch(/zu Fuss/);
    // eigenes Element mit Fz («rollt») darf schneller sein
    expect(of(hints(build(["T1 1800 H05 Beo Stao AQ11 C", "T1 1830 H05 rollt ab AL13"]), T1("21:00")), "E3")).toHaveLength(0);
  });
  it("E3: plausible Verschiebung → nichts", () => {
    expect(of(hints(build(["T2 0020 H02 Det 2 2 Pers AJ8", "T2 0120 H02: Det 2 3 Pers AH9"])), "E3")).toHaveLength(0);
    expect(of(hints(build(["T2 0100 Det 1 2 Fz AA1", "T2 0130 Det 1 2 Fz AU15"])), "E3")).toHaveLength(0);
  });
  it("E4: dringend/angeblich und unbestätigt → Täuschung prüfen; bestätigt → nichts", () => {
    expect(of(hints(build(["T2 0450 H02: Zivilperson meldet angeblich 3 Fz AT3 Rtg N"])), "E4")).toHaveLength(1);
    const conf = build(["T2 0450 H02: Zivilperson meldet angeblich 3 Fz AT3 Rtg N", "T2 0500 H05: 3 Fz AT4 Rtg N"]);
    expect(of(hints(conf), "E4")).toHaveLength(0);
    expect(of(hints(conf, T2("04:55")), "E4")).toHaveLength(1);
    expect(of(hints(build(["T2 0450 H02: 3 Fz AT3 Rtg N"])), "E4")).toHaveLength(0);
    for (const l of ["T2 0450 H02: anonymer Anruf, Sprengsatz in AT3", "T2 0450 H02: Gerücht: Rot sammelt sich in AT3", "T2 0450 H02: 3 Fz sollen in AT3 stehen", "T2 0450 H02: es heisst, Det 2 sei in AT3"]) {
      expect(of(hints(build([l])), "E4"), l).toHaveLength(1);
    }
  });
  it("E4: eigene Beobachtung mit «sofort»/«dringend» ist keine Täuschung", () => {
    expect(of(hints(build(["T1 1900 H01: 2 Pers AC7 verschwinden sofort im Haus"])), "E4")).toHaveLength(0);
    expect(of(hints(build(["T1 1900 H01: dringend, 3 gn Pers AC7 Rtg N"])), "E4")).toHaveLength(0);
  });
});

describe("Lagezeit, Revisionen, Stabilität", () => {
  const ex = demoExercise();
  it("Beispielübung: jede Hinweis-Regel löst mindestens einmal aus", () => {
    const hs = hints(ex);
    const rules = new Set(hs.map((h) => h.rule));
    for (const r of ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3", "C4", "C5", "C6", "D1", "D2", "D3", "E3", "E4"]) expect(rules.has(r), r).toBe(true);
    expect(hs.length).toBeLessThan(40);
  });
  it("Beispielübung: realistisch dosiert – bei Demo-Ende höchstens 8 offene hoch/mittel", () => {
    const end = ex.events!.map((e) => e.t).sort().at(-1)!;
    const open = hints(ex, end).filter((h) => h.level !== "info" && !(h.until && h.until <= end));
    expect(open.length).toBeLessThanOrEqual(8);
  });
  it("Beispielübung: Pendel des weissen Lieferwagens mit Prognose, Drohne über Stao H05", () => {
    const hs = hints(ex);
    const c2 = of(hs, "C2")[0]!;
    expect(c2.next).toBe(T2("03:25"));
    expect(textOf(ex, c2).every((t) => /weisser Lieferwagen/.test(t))).toBe(true);
    expect(of(hs, "D1")[0]!.unit).toBe("H05");
  });
  it("Sortierung: hoch > mittel > info, dann neueste", () => {
    const hs = hints(ex);
    const rank = { hoch: 0, mittel: 1, info: 2 } as const;
    for (let i = 1; i < hs.length; i++) {
      const a = hs[i - 1]!, b = hs[i]!;
      expect(rank[a.level] < rank[b.level] || (rank[a.level] === rank[b.level] && a.t >= b.t), `${a.id} vor ${b.id}`).toBe(true);
    }
  });
  it("nur Meldungen bis zur Lagezeit; Hinweise wie sie damals erschienen wären", () => {
    for (const t of [T1("20:00"), T1("23:00"), T2("02:00"), T2("05:00"), T2("08:00")]) {
      const tMs = Date.parse(t);
      for (const h of hints(ex, t)) {
        expect(h.t <= t, `${h.id} ${h.t} > ${t}`).toBe(true);
        for (const id of h.events) expect(Date.parse(ex.events!.find((e) => e.id === id)!.t)).toBeLessThanOrEqual(tMs);
      }
    }
    expect(of(hints(ex, T2("02:00")), "C2")).toHaveLength(0);
    expect(of(hints(ex, T2("03:00")), "C2")).toHaveLength(1);
  });
  it("IDs stabil über Neuberechnung und spätere Lagezeiten", () => {
    const a = hints(ex, T2("08:00")).map((h) => h.id);
    expect(hints(ex, T2("08:00")).map((h) => h.id)).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
    const early = hints(ex, T2("04:00"));
    const late = new Set(a);
    // was um 04:00 schon galt (ohne die bis dahin offene Ruhe), gilt um 08:00 mit derselben ID
    for (const h of early.filter((x) => x.rule !== "C3")) expect(late.has(h.id), h.id).toBe(true);
  });
  it("gelöschte Meldungen zählen nicht, aktuelle Revision gilt", () => {
    const x = build(["T2 0345 H02: 2 Pers AN10 laden Kisten in Kofferraum"]);
    expect(of(hints(x), "C1")).toHaveLength(1);
    const e = x.events![0]!;
    expect(of(hints({ ...x, events: [{ ...e, deleted: true, rev: 2 }] }), "C1")).toHaveLength(0);
    // alte und neue Revision im Journal (z. B. vor dem Zusammenführen): neue gilt
    const revised = reviseEvent(e, { text: "H02: 2 Pers AN10 warten" }, "dev-2");
    expect(of(hints({ ...x, events: [e, revised] }), "C1")).toHaveLength(0);
    expect(of(hints({ ...x, events: [revised, e] }), "C1")).toHaveLength(0);
  });
  it("Regeln abschalten", () => {
    const hs = hints(ex, T2("08:00"), ["C2", "A1"]);
    expect(hs.some((h) => h.rule === "C2" || h.rule === "A1")).toBe(false);
    expect(hs.length).toBeGreaterThan(5);
  });
  it("ungültige Lagezeit → alle Meldungen", () => {
    expect(computeHints(ex, { t: "" }).length).toBe(hints(ex).length);
  });
  it("Hinweise je Regel begrenzt: älteste beendete zuerst weglassen, offene nie", () => {
    const lines: string[] = [];
    // 40 Kolonnen alle 3 Min ab 01:00 (bis 02:57)
    for (let i = 0; i < 40; i++) { const m = 60 + i * 3; lines.push(`T2 ${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")} H02: ${i % 2 ? 2 : 3} Fz in Kolonne AE${(i % 12) + 2} Rtg W`); }
    const ex = build(lines);
    // 08:00: alle beendet → die neuesten 12
    const late = of(hints(ex), "C6");
    expect(late.length).toBe(HINT_THRESHOLDS.MAX_PER_RULE);
    expect(late.map((h) => h.t).sort()[0]).toBe(T2("02:24"));
    // 03:00: die 19 Kolonnen nach 02:00 sind noch offen (mehr als die Höchstzahl) → alle bleiben, keine beendete dazu
    const now = of(hints(ex, T2("03:00")), "C6");
    expect(now.filter((h) => !h.until).length).toBe(19);
    expect(now.length).toBe(19);
  });
});

describe("Leistung", () => {
  it("1000 Meldungen deutlich unter 50 ms (nach Aufwärmen)", () => {
    const ex = demoExercise();
    let seed = 7;
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
        sym: blau ? pick(["beob_aufkl", "patrouille", "einheit"]) : pick(["fz", "inf_trp", "drohne", "kontrollposten", "sperre", "kpz", "ziv_fz", "stellung"]),
        pos: { e: 2595000 + rnd() * 10000, n: 1196000 + rnd() * 6500 }, count: rnd() < 0.5 ? 1 + Math.floor(rnd() * 4) : undefined,
        dir: rnd() < 0.5 ? Math.floor(rnd() * 8) * 45 : undefined, where: "Karte", confirmed: true,
      });
    }
    ex.events = events;
    const o = { t: "2030-05-15T12:00", strict: true };
    for (let k = 0; k < 8; k++) analyzeJournal(ex, o);
    const times: number[] = [];
    for (let k = 0; k < 7; k++) {
      const t0 = performance.now();
      const { hints: hs, quality } = analyzeJournal(ex, o);
      times.push(performance.now() - t0);
      expect(hs.length).toBeGreaterThan(10);
      expect(quality.size).toBeGreaterThan(100);
    }
    times.sort((a, b) => a - b);
    expect(times[3]!).toBeLessThan(50);
  });
});

describe("Vertrag: analyzeJournal und decisionFor", () => {
  it("analyzeJournal = computeHints + eventQuality in einem Durchgang", () => {
    const ex = demoExercise();
    for (const t of [T2("02:00"), T2("07:30")]) {
      const r = analyzeJournal(ex, { t, strict: true });
      expect(r.hints).toEqual(computeHints(ex, { t, strict: true }));
      expect([...r.quality.entries()]).toEqual([...eventQuality(ex.events!, t, ex).entries()]);
    }
    expect(analyzeJournal(build([]), { t: T2("08:00") })).toEqual({ hints: [], quality: new Map() });
  });
  const dec = (h: Hint, state: HintDecision["state"] = "verworfen"): HintDecision => ({ state, at: T2("08:00"), rule: h.rule, events: [...h.events] });
  it("decisionFor: zuerst über die ID", () => {
    const h = of(hints(build(["T2 0345 H02: 2 Pers AN10 laden Kisten in Kofferraum"])), "C1")[0]!;
    expect(decisionFor(h, { [h.id]: { state: "bestaetigt", at: T2("08:00") } })?.state).toBe("bestaetigt");
    expect(decisionFor(h, undefined)).toBeUndefined();
    expect(decisionFor(h, {})).toBeUndefined();
  });
  it("decisionFor: nachgetragene frühere Meldung ändert die ID – Entscheid haftet über Regel und Auslöser", () => {
    const L = ["T1 2100 H02: 1 Fz hält AK8", "T1 2105 H02: 1 Fz hält AL8"];
    const ex = build(L);
    const before = of(hints(ex, T1("21:30")), "C1")[0]!;
    const decisions = { [before.id]: dec(before) };
    // Nachtrag: früheres haltendes Fz (andere ID der ersten Meldung), alte Meldungen bleiben dieselben
    const nachtrag = eventFromDraft(parseMeldung("T1 2055 H04: 1 Fz hält AK9", { sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now: new Date(2030, 4, 15, 8, 0) }), "dev-2");
    nachtrag.id = "nachtrag-1";
    const after = of(hints({ ...ex, events: [...ex.events!, nachtrag] }, T1("21:30")), "C1")[0]!;
    expect(after.id).not.toBe(before.id);
    expect(decisionFor(after, decisions)?.state).toBe("verworfen");
  });
  it("decisionFor: C3 → C2 übernimmt den Entscheid; andere Regel oder zu wenig Überlappung nicht", () => {
    const VAN = (hhmm: string, where: string) => `T2 ${hhmm} H03: 1 ziv Fz (weisser Lieferwagen) ${where}`;
    const ex = build([VAN("0130", "AN6 Rtg N"), VAN("0155", "in NAI 2"), VAN("0225", "AN6 Rtg S"), VAN("0255", "in NAI 2")]);
    const c3 = of(hints(ex, T2("02:30")), "C3")[0]!;
    const c2 = of(hints(ex, T2("03:00")), "C2")[0]!;
    expect(of(hints(ex, T2("03:00")), "C3")).toHaveLength(0);
    expect(decisionFor(c2, { [c3.id]: dec(c3, "bestaetigt") })?.state).toBe("bestaetigt");
    // gleiche Auslöser, aber andere Regel → nicht übernehmen
    expect(decisionFor({ ...c2, rule: "C1", id: "C1:x" }, { [c3.id]: dec(c3) })).toBeUndefined();
    // weniger als die Hälfte der entschiedenen Auslöser im neuen Hinweis → nicht übernehmen
    expect(decisionFor({ ...c2, id: "C2:y", events: [c3.events[0]!, "x1", "x2"] }, { [c3.id]: { ...dec(c3), events: [...c3.events, "z1", "z2"] } })).toBeUndefined();
    // Entscheid eines anderen, noch vorhandenen Hinweises wird nicht doppelt vergeben
    expect(decisionFor(c2, { [c3.id]: dec(c3) }, [c3.id])).toBeUndefined();
  });
  it("decisionFor: alte Entscheide ohne Auslöser haften nur über die ID", () => {
    const h = of(hints(build(["T2 0345 H02: 2 Pers AN10 laden Kisten in Kofferraum"])), "C1")[0]!;
    expect(decisionFor({ ...h, id: "C1:anders" }, { [h.id]: { state: "verworfen", at: T2("08:00") } })).toBeUndefined();
  });
});
