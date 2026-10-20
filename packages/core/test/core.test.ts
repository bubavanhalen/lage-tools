import { describe, expect, it } from "vitest";
import {
  cellAt,
  cellBounds,
  demoFeldSheet,
  detectAffiliation,
  detectSymbol,
  findCells,
  findCoordinates,
  findTimes,
  formatLv95,
  lv95ToWgs84,
  makeBlattSheet,
  mergeEvents,
  wgs84ToLv95,
  type LageEvent,
} from "../src";

describe("LV95 ↔ WGS84", () => {
  it("Bern (Nullpunkt) liegt bei 2'600'000 / 1'200'000", () => {
    const p = wgs84ToLv95({ lat: 46.95108, lon: 7.43864 });
    expect(Math.abs(p.e - 2600000)).toBeLessThan(5);
    expect(Math.abs(p.n - 1200000)).toBeLessThan(5);
  });
  it("Hin- und Rückweg auf unter 2 m genau", () => {
    const a = { e: 2700000, n: 1250000 };
    const b = wgs84ToLv95(lv95ToWgs84(a));
    expect(Math.hypot(a.e - b.e, a.n - b.n)).toBeLessThan(2);
  });
  it("formatiert mit Tausendertrennern", () => {
    expect(formatLv95({ e: 2600465.2, n: 1200243 })).toBe("2'600'465 / 1'200'243");
  });
});

describe("Koordinaten in Meldungen", () => {
  const cases: Array<[string, number, number]> = [
    ["H07 2'600'465, 1'200'243", 2600465, 1200243],
    ["Beobachtungsstandort H06 2‘601‘708/1‘199‘709", 2601708, 1199709],
    ["Koordinaten: 2600 721 / 1200 853", 2600721, 1200853],
    ["Patrouille in G-Wagen 2'600'670, 1'201'049.75, fährt hangaufwärts", 2600670, 1201049.75],
    ["Beob-Stao 2'602'071, 1'201'571.12", 2602071, 1201571.12],
    ["Referenz 600'175 / 199'101", 2600175, 1199101],
  ];
  for (const [text, e, n] of cases) {
    it(text, () => {
      const f = findCoordinates(text);
      expect(f).toHaveLength(1);
      expect(f[0]!.lv95.e).toBeCloseTo(e, 1);
      expect(f[0]!.lv95.n).toBeCloseTo(n, 1);
    });
  }
  it("swisstopo-App-Link", () => {
    const f = findCoordinates("H09 beantrage PuP https://swisstopo.app/poi?lat=46.95108&lon=7.43864");
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("link");
    expect(Math.abs(f[0]!.lv95.e - 2600000)).toBeLessThan(5);
  });
  it("keine Koordinate in normalen Zahlen", () => {
    expect(findCoordinates("Sicht 80%, MMM 100%, 3 G-Klassen um 0531")).toHaveLength(0);
  });
});

describe("Raster Variante feld", () => {
  const s = demoFeldSheet(); // fiktiv: 24 Zeilen × 30 Spalten à 500 m ab 2'592'000 / 1'206'000
  const pt = (row: number, col: number) => ({ e: 2592000 + col * 500 + 250, n: 1206000 - row * 500 - 250 });
  it.each([
    ["A1", 0, 0],
    ["W18", 22, 17],
    ["S17", 18, 16],
    ["X30", 23, 29],
  ] as const)("%s", (label, row, col) => {
    expect(cellAt(s, pt(row, col), false)!.label).toBe(label);
  });
  it("ausserhalb des Blattes", () => {
    expect(cellAt(s, { e: 2500000, n: 1100000 })).toBeNull();
  });
  it("findet Planquadrate in Meldungen", () => {
    const f = findCells("H04 Kurzmeldung 0748 1x G-Klasse auf Strasse (O21,22) Fahrtrichtung Osten. PQ: O20 (C)", [s], {
      exclude: ["H04"],
    });
    expect(f.map((x) => x.label)).toEqual(["O21", "O22", "O20 C"]);
  });
  it("phonetische Unterquadranten", () => {
    const f = findCells("O: Kreuzung im Planquad. G 19 Delta", [s]);
    expect(f.map((x) => x.label)).toEqual(["G19 D"]);
  });
  it("Truppbezeichnungen mit führender Null sind keine Planquadrate", () => {
    expect(findCells("H01, H04, NAI 4, MMM 100", [s])).toHaveLength(0);
  });
  it("Truppbezeichnung H10 lässt sich ausschliessen", () => {
    expect(findCells("H10 Kurzmeldung", [s], { exclude: ["H10"] })).toHaveLength(0);
  });
});

describe("Raster Variante blatt", () => {
  const uranus = makeBlattSheet({ name: "URANUS", prefix: "U", center: { e: 2600000, n: 1200000 }, cellSize: 80 });
  it("Beschriftung UA–UU, 1–15", () => {
    expect(uranus.colLabels[0]).toBe("UA");
    expect(uranus.colLabels[20]).toBe("UU");
    expect(uranus.rowLabels[14]).toBe("15");
  });
  it("Unterquadranten A B / D C", () => {
    const b = cellBounds(uranus, 10, 6);
    const q = (fx: number, fy: number) =>
      cellAt(uranus, { e: b.minE + fx * uranus.cellW, n: b.maxN - fy * uranus.cellH })!.label;
    expect(q(0.25, 0.25)).toBe("UK7 A");
    expect(q(0.75, 0.25)).toBe("UK7 B");
    expect(q(0.75, 0.75)).toBe("UK7 C");
    expect(q(0.25, 0.75)).toBe("UK7 D");
  });
  it("findet «UK7 C» und «UK 7»", () => {
    expect(findCells("Fz in UK7 C, später UK 7", [uranus]).map((x) => x.label)).toEqual(["UK7 C", "UK7"]);
  });
});

describe("Zeichen und Zugehörigkeit", () => {
  it.each([
    ["1 G-Klasse Seite Rot Fahrtrichtung Passhöhe", "fz", "H"],
    ["4 Personen steigen aus G-Klasse aus", "fz", null],
    ["1 Drohne fliegt über unserem Beob", "drohne", null],
    ["Beginn Checkpoint", "kontrollposten", null],
    ["Untersuchen Gegebenheiten für Hinterhalt", "hinterhalt", null],
    ["10 Personen (Gegner) ausgestiegen", "inf_gr", "H"],
    ["nicht erkennbar ob freund oder feind", "einheit", "U"],
    ["Drohnenstart von Übungsleitung", "drohne", "N"],
  ])("%s", (text, sym, aff) => {
    expect(detectSymbol(text)).toBe(sym);
    expect(detectAffiliation(text)).toBe(aff);
  });
});

describe("Zeiten", () => {
  it("0531, 05:45, Zeitraum, relativ", () => {
    expect(findTimes("Kurzmeldung: 0531 1x G-Klasse").map((t) => t.minutes)).toEqual([331]);
    expect(findTimes("Wann: 05:45").map((t) => t.minutes)).toEqual([345]);
    const r = findTimes("Wann: 00:14-05:35");
    expect(r[0]!.minutes).toBe(14);
    expect(r[0]!.until).toBe(335);
    expect(findTimes("A: Vor 5min", 20 * 60 + 28)[0]!.minutes).toBe(20 * 60 + 23);
  });
  it("keine Zeit in Koordinaten und Prozenten", () => {
    expect(findTimes("2'600'465, 1'200'243 Sicht 1000 m, 2000 %")).toHaveLength(0);
  });
});

describe("Zusammenführen (vNext-Replikation)", () => {
  const base: LageEvent = {
    id: "a", rev: 1, device: "dev-1", updatedAt: "2026-10-20T05:00:00Z", t: "2026-10-20T05:00",
    side: "blau", unit: "H01", text: "x", sym: "fz", aff: "U", confirmed: true,
  };
  it("höhere Revision gewinnt", () => {
    const m = mergeEvents([base], [{ ...base, rev: 2, text: "y" }]);
    expect(m).toHaveLength(1);
    expect(m[0]!.text).toBe("y");
  });
  it("vereinigt verschiedene Einträge", () => {
    expect(mergeEvents([base], [{ ...base, id: "b" }])).toHaveLength(2);
  });
});
