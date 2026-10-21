import { describe, expect, it } from "vitest";
import {
  cellBounds, clipPolyline, demoExercise, matchRoadNames, normRoadText, parseTlmIdentify, placeAlongRoad, placeOnRoad, roadRank,
  roadTiles, roadsInBounds, tlmRoadsUrl, type Bounds, type RoadSegment,
} from "../src";

// Synthetische Strassen (fiktiv, Raum Bern) – keine Übungsdaten
const cell: Bounds = { minE: 2600000, maxE: 2600500, minN: 1199000, maxN: 1199500 };
const seg = (id: string, cls: number, pts: Array<[number, number]>, name?: string, vb?: number): RoadSegment =>
  ({ id, cls, name, vb, pts: pts.map(([e, n]) => ({ e, n })) });
const inside = (p: { e: number; n: number }, b: Bounds) => p.e >= b.minE && p.e <= b.maxE && p.n >= b.minN && p.n <= b.maxN;

describe("roadRank", () => {
  it("Hauptstrassen vor Nebenstrassen vor Wegen", () => {
    expect(roadRank(2)).toBeGreaterThan(roadRank(21)); // Autobahn > Autostrasse
    expect(roadRank(8)).toBeGreaterThan(roadRank(20)); // 10m > 8m
    expect(roadRank(20)).toBeGreaterThan(roadRank(9)); // 8m > 6m
    expect(roadRank(9)).toBeGreaterThan(roadRank(10));
    expect(roadRank(10)).toBeGreaterThan(roadRank(11));
    expect(roadRank(11)).toBeGreaterThan(roadRank(15)); // 3m Strasse > 2m Weg
    expect(roadRank(15)).toBeGreaterThan(roadRank(16));
    expect(roadRank(14)).toBe(0); // Fähre
    expect(roadRank(22)).toBe(0); // Klettersteig
    expect(roadRank(99)).toBe(1); // unbekannt: tief, aber brauchbar
  });
  it("Durchgangsstrasse zählt mehr", () => {
    expect(roadRank(9, 200)).toBeGreaterThan(roadRank(20));
    expect(roadRank(9, 300)).toBeGreaterThan(roadRank(9));
  });
});

describe("clipPolyline", () => {
  it("schneidet eine durchquerende Strasse auf das Gebiet zu", () => {
    const parts = clipPolyline([{ e: 2599800, n: 1199250 }, { e: 2600800, n: 1199250 }], cell);
    expect(parts).toHaveLength(1);
    expect(parts[0]![0]!.e).toBeCloseTo(2600000);
    expect(parts[0]![1]!.e).toBeCloseTo(2600500);
  });
  it("mehrfaches Ein- und Austreten ergibt mehrere Stücke; konkaves Polygon", () => {
    // U-förmiges Gebiet: Strasse quer durch beide Schenkel
    const u = [
      { e: 0, n: 0 }, { e: 300, n: 0 }, { e: 300, n: 300 }, { e: 200, n: 300 }, { e: 200, n: 100 },
      { e: 100, n: 100 }, { e: 100, n: 300 }, { e: 0, n: 300 },
    ];
    const parts = clipPolyline([{ e: -50, n: 200 }, { e: 350, n: 200 }], u);
    expect(parts).toHaveLength(2);
    expect(parts[0]![0]!.e).toBeCloseTo(0);
    expect(parts[0]![1]!.e).toBeCloseTo(100);
    expect(parts[1]![0]!.e).toBeCloseTo(200);
  });
  it("Strasse ausserhalb → nichts", () => {
    expect(clipPolyline([{ e: 2601000, n: 1199000 }, { e: 2601000, n: 1200000 }], cell)).toHaveLength(0);
  });
});

describe("placeOnRoad", () => {
  it("ohne Strasse → null", () => {
    expect(placeOnRoad(cell, [])).toBeNull();
    expect(placeOnRoad(cell, [seg("w", 10, [[2602000, 1199000], [2602000, 1199500]])])).toBeNull();
  });

  it("Hauptstrasse vor Nebenstrasse, auch wenn die Nebenstrasse näher an der Mitte liegt", () => {
    const roads = [
      seg("neben", 11, [[2600000, 1199250], [2600500, 1199250]], "Feldweg"), // genau durch die Mitte
      seg("haupt", 8, [[2600400, 1198900], [2600400, 1199600]], "Hauptstrasse"), // am Rand, N–S
    ];
    const r = placeOnRoad(cell, roads)!;
    expect(r.road).toBe("Hauptstrasse");
    expect(r.segId).toBe("haupt");
    expect(r.pos.e).toBeCloseTo(2600400);
    expect(r.pos.n).toBeCloseTo(1199250); // auf Höhe der Mitte
    expect(r.angle).toBeCloseTo(0); // Nord–Süd
    expect(r.kind).toBe("10m Strasse");
    expect(inside(r.pos, cell)).toBe(true);
  });

  it("Strasse, die das Gebiet nur durchquert (keine Stützpunkte im Gebiet), wird gefunden", () => {
    const r = placeOnRoad(cell, [seg("d", 9, [[2599000, 1198000], [2601500, 1200500]], "Diagonale")])!;
    expect(r).not.toBeNull();
    expect(inside(r.pos, cell)).toBe(true);
    expect(r.pos.e).toBeCloseTo(2600250, -1);
    expect(r.pos.n).toBeCloseTo(1199250, -1);
    expect(r.angle).toBeCloseTo(45);
  });

  it("Richtung 0–180°: Ost–West = 90, Richtung der Zeichnung egal", () => {
    const a = placeOnRoad(cell, [seg("ow", 9, [[2599900, 1199200], [2600600, 1199200]])])!;
    const b = placeOnRoad(cell, [seg("wo", 9, [[2600600, 1199200], [2599900, 1199200]])])!;
    expect(a.angle).toBeCloseTo(90);
    expect(b.angle).toBeCloseTo(90);
    const c = placeOnRoad(cell, [seg("nw", 9, [[2600500, 1199000], [2600000, 1199500]])])!;
    expect(c.angle).toBeCloseTo(135);
  });

  it("Kurve: Richtung folgt dem Strassenstück an der gewählten Stelle", () => {
    // Bogen um die Mitte (Viertelkreis, Radius 200 m um die SW-Ecke)
    const pts: Array<[number, number]> = [];
    for (let k = 0; k <= 30; k++) {
      const t = (k / 30) * (Math.PI / 2);
      pts.push([2600000 + 200 * Math.cos(t) + 50, 1199000 + 200 * Math.sin(t) + 50]);
    }
    const r = placeOnRoad(cell, [seg("bogen", 9, pts, "Ringstrasse")])!;
    // nächster Punkt zur Mitte liegt auf der Winkelhalbierenden (45°) → Tangente 135°
    expect(r.angle).toBeGreaterThan(125);
    expect(r.angle).toBeLessThan(145);
    expect(inside(r.pos, cell)).toBe(true);
  });

  it("Strasse, die nur die Ecke streift, verliert gegen eine Strasse quer durchs Gebiet", () => {
    const roads = [
      seg("ecke", 8, [[2600440, 1198960], [2600540, 1199060]], "Kantonsstrasse"), // ca. 28 m im Gebiet
      seg("quer", 10, [[2600000, 1199300], [2600500, 1199300]], "Dorfstrasse"),
    ];
    expect(placeOnRoad(cell, roads)!.road).toBe("Dorfstrasse");
    // nur die Ecke da → die Ecke ist besser als nichts
    expect(placeOnRoad(cell, [roads[0]!])!.road).toBe("Kantonsstrasse");
  });

  it("Gleichstand: ohne prefer die längste, mit prefer die nächste", () => {
    const roads = [
      seg("lang", 9, [[2600000, 1199100], [2600500, 1199100]], "Lange Strasse"),
      seg("kurz", 9, [[2600300, 1199300], [2600300, 1199500]], "Kurze Strasse"),
    ];
    expect(placeOnRoad(cell, roads)!.road).toBe("Lange Strasse");
    const r = placeOnRoad(cell, roads, { e: 2600310, n: 1199420 })!;
    expect(r.road).toBe("Kurze Strasse");
    expect(r.pos.n).toBeCloseTo(1199420);
  });

  it("Strassenstücke mit gleichem Namen zählen zusammen", () => {
    const roads = [
      seg("a1", 10, [[2600000, 1199200], [2600150, 1199200]], "Bahnhofstrasse"),
      seg("a2", 10, [[2600150, 1199200], [2600300, 1199210]], "Bahnhofstrasse"),
      seg("a3", 10, [[2600300, 1199210], [2600500, 1199220]], "Bahnhofstrasse"),
      seg("b", 10, [[2600250, 1199000], [2600250, 1199300]], "Querweg"),
    ];
    const r = placeOnRoad(cell, roads)!;
    expect(r.road).toBe("Bahnhofstrasse");
    expect(r.length).toBeGreaterThan(450);
  });

  it("Benannte Strasse über Klassenwechsel: ganze Strasse zählt, Punkt nahe der Mitte", () => {
    const roads = [
      // kurzes Stück mit Verkehrsbedeutung am Nordrand, Rest ohne
      seg("k1", 8, [[2600400, 1199500], [2600420, 1199460]], "Landstrasse", 300),
      seg("k2", 8, [[2600420, 1199460], [2600250, 1199250], [2600000, 1199050]], "Landstrasse"),
    ];
    const r = placeOnRoad(cell, roads)!;
    expect(r.road).toBe("Landstrasse");
    expect(r.rank).toBe(8);
    expect(Math.hypot(r.pos.e - 2600250, r.pos.n - 1199250)).toBeLessThan(5);
  });

  it("Unbenannte, zusammenhängende Stücke zählen zusammen", () => {
    const roads = [
      seg("u1", 11, [[2600000, 1199400], [2600200, 1199400]]),
      seg("u2", 11, [[2600200, 1199400], [2600500, 1199400]]),
      seg("u3", 11, [[2600100, 1199000], [2600100, 1199350]]),
    ];
    const r = placeOnRoad(cell, roads)!;
    expect(r.length).toBeCloseTo(500, -1);
    expect(r.angle).toBeCloseTo(90);
  });

  it("Autobahn nur, wenn nichts anderes da ist (ausser mit motorway: true)", () => {
    const roads = [
      seg("a1", 2, [[2600250, 1198800], [2600250, 1199700]]),
      seg("dorf", 11, [[2600000, 1199100], [2600500, 1199100]], "Dorfweg"),
    ];
    expect(placeOnRoad(cell, roads)!.road).toBe("Dorfweg");
    expect(placeOnRoad(cell, roads, undefined, { motorway: true })!.segId).toBe("a1");
    expect(placeOnRoad(cell, [roads[0]!])!.segId).toBe("a1");
  });

  it("Durchgangsstrasse (Verkehrsbedeutung) schlägt breitere Quartierstrasse", () => {
    const roads = [
      seg("quartier", 20, [[2600000, 1199300], [2600500, 1199300]], "Quartierstrasse"),
      seg("durch", 9, [[2600200, 1199000], [2600200, 1199500]], "Landstrasse", 200),
    ];
    expect(placeOnRoad(cell, roads)!.road).toBe("Landstrasse");
  });

  it("Punkt bleibt im Gebiet und weg vom Rand, auch wenn prefer ausserhalb liegt", () => {
    const r = placeOnRoad(cell, [seg("x", 9, [[2599500, 1199250], [2601000, 1199250]])], { e: 2602000, n: 1199250 })!;
    expect(inside(r.pos, cell)).toBe(true);
    expect(r.pos.e).toBeLessThan(cell.maxE - 10);
  });

  it("Wege nur ab minRank", () => {
    const roads = [seg("w", 15, [[2600000, 1199250], [2600500, 1199250]])];
    expect(placeOnRoad(cell, roads)).not.toBeNull();
    expect(placeOnRoad(cell, roads, undefined, { minRank: 3 })).toBeNull();
  });

  it("NAI (Polygon) als Zielgebiet", () => {
    const nai = demoExercise().areas.find((a) => a.name === "NAI 3")!;
    const r = placeOnRoad(nai.ring, [seg("n", 9, [[2600500, 1196000], [2600500, 1198000]], "Nordstrasse")])!;
    expect(r.road).toBe("Nordstrasse");
    expect(r.pos.e).toBeCloseTo(2600500);
    expect(r.pos.n).toBeGreaterThan(1196300);
    expect(r.pos.n).toBeLessThan(1197400);
  });

  it("Unterquadrant eines Planquadrats (Raster BERN)", () => {
    const sheet = demoExercise().sheets[0]!;
    const q = cellBounds(sheet, 6, 12, "C"); // AG13 C
    expect(q.maxE - q.minE).toBeCloseTo(250);
    const r = placeOnRoad(q, [seg("h", 8, [[q.minE - 100, q.minN + 60], [q.maxE + 100, q.minN + 60]], "Hauptstrasse")])!;
    expect(inside(r.pos, q)).toBe(true);
    expect(r.angle).toBeCloseTo(90);
  });
});

describe("placeAlongRoad", () => {
  it("Punkt neben der Strasse, zur Gebietsmitte hin versetzt", () => {
    const r = placeAlongRoad(cell, [seg("s", 9, [[2600000, 1199100], [2600500, 1199100]], "Uferstrasse")], undefined, 25)!;
    expect(r.onRoad!.n).toBeCloseTo(1199100);
    expect(r.pos.n).toBeCloseTo(1199125); // Mitte liegt nördlich
    expect(r.angle).toBeCloseTo(90);
    expect(Math.abs(r.side!)).toBe(1);
  });
});

describe("Daten (geo.admin identify)", () => {
  it("parseTlmIdentify: Linien, Name, Klasse, Verkehrsbedeutung; Fähre fällt weg", () => {
    const json = { results: [
      { id: 1, geometry: { type: "MultiLineString", coordinates: [[[2600000.04, 1199000], [2600100, 1199000]]] }, properties: { objektart: 9, strassenname: "Beispielweg", verkehrsbedeutung: 200 } },
      { id: 2, geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] }, properties: { objektart: 15, strassenname: "", verkehrsbedeutung: 999998 } },
      { id: 3, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { objektart: 14 } },
      { id: 4, geometry: { type: "LineString", coordinates: [[0, 0]] }, properties: { objektart: 10 } },
    ] };
    const r = parseTlmIdentify(json);
    expect(r.map((s) => s.id)).toEqual(["1", "2-0", "2-1"]);
    expect(r[0]).toMatchObject({ name: "Beispielweg", cls: 9, vb: 200 });
    expect(r[0]!.pts[0]!.e).toBe(2600000);
    expect(r[1]!.name).toBeUndefined();
    expect(r[1]!.vb).toBeUndefined();
    expect(parseTlmIdentify(null)).toEqual([]);
    expect(parseTlmIdentify({ status: "error" })).toEqual([]);
  });
  it("roadTiles: 1-km-Kacheln, ausgerichtet", () => {
    const t = roadTiles({ minE: 2599500, maxE: 2601000, minN: 1199000, maxN: 1199999 });
    expect(t.map((x) => x.key)).toEqual(["1000:2599:1199", "1000:2600:1199"]);
    expect(t[0]!.b).toEqual({ minE: 2599000, maxE: 2600000, minN: 1199000, maxN: 1200000 });
  });
  it("tlmRoadsUrl und roadsInBounds", () => {
    const u = tlmRoadsUrl({ minE: 2600000, maxE: 2601000, minN: 1199000, maxN: 1200000 }, 200);
    expect(u).toContain("geometry=2600000,1199000,2601000,1200000");
    expect(u).toContain("layers=all:ch.swisstopo.swisstlm3d-strassen");
    expect(u).toContain("offset=200");
    const roads = [seg("in", 9, [[2600100, 1199100], [2600200, 1199200]]), seg("out", 9, [[2605000, 1199100], [2605100, 1199200]])];
    expect(roadsInBounds(roads, cell).map((r) => r.id)).toEqual(["in"]);
  });
});

describe("Strassenwahl an Kreuzungen (Kandidaten, mehrdeutig)", () => {
  // Kreuzung zweier gleichwertiger Hauptstrassen in der Feldmitte (fiktive Namen), dazu ein Feldweg
  const cross = [
    seg("ow", 20, [[2599800, 1199250], [2600700, 1199250]], "Talgutstrasse", 200),
    seg("ns", 20, [[2600250, 1198800], [2600250, 1199700]], "Bärenmattstrasse", 200),
    seg("fw", 15, [[2600050, 1199050], [2600450, 1199080]]),
  ];
  it("Kreuzung zweier Hauptstrassen ⇒ mehrdeutig, Kandidaten verschiedene Strassen, sortiert", () => {
    const r = placeOnRoad(cell, cross)!;
    expect(r.ambiguous).toBe(true);
    expect(r.named).toBeUndefined();
    const c = r.candidates!;
    expect(c).toHaveLength(3);
    expect(c[0]!.road).toBe(r.road);
    expect(new Set(c.slice(0, 2).map((x) => x.road))).toEqual(new Set(["Talgutstrasse", "Bärenmattstrasse"]));
    expect(c[2]!.road).toBeUndefined();
    expect(c[2]!.kind).toBe("2m Weg");
    expect(c[0]!.score!).toBeGreaterThanOrEqual(c[1]!.score!);
    expect(c[1]!.score!).toBeGreaterThan(c[2]!.score!);
    // jeder Kandidat liegt auf seiner Strasse und hat deren Richtung
    const ns = c.find((x) => x.road === "Bärenmattstrasse")!;
    expect(ns.pos.e).toBeCloseTo(2600250, 0);
    expect(ns.angle).toBe(0);
    expect(c.find((x) => x.road === "Talgutstrasse")!.angle).toBe(90);
  });
  it("Hauptstrasse in der Mitte, Nebenstrasse ⇒ nicht mehrdeutig", () => {
    const r = placeOnRoad(cell, [seg("h", 8, [[2599800, 1199250], [2600700, 1199250]], "Talgutstrasse"), seg("n", 11, [[2600250, 1198800], [2600250, 1199700]], "Lindenweg")])!;
    expect(r.road).toBe("Talgutstrasse");
    expect(r.ambiguous).toBe(false);
    expect(r.candidates!.map((x) => x.road)).toEqual(["Talgutstrasse", "Lindenweg"]);
  });
  it("gleich wichtige Strassen, eine am Rand ⇒ nicht mehrdeutig", () => {
    const r = placeOnRoad(cell, [seg("a", 9, [[2599800, 1199250], [2600700, 1199250]], "Mittelweg"), seg("b", 9, [[2599800, 1199460], [2600700, 1199460]], "Randweg")])!;
    expect(r.ambiguous).toBe(false);
  });
  it("Strassenname im Text gewinnt (auch abgekürzt, ohne Umlaut, als Teilwort ab 5 Zeichen)", () => {
    for (const text of ["H04: gn Sperre AG13 Bärenmattstr.", "Sperre AG13 baerenmatt strasse", "Sperre Baerenmatt", "Sperre Bärenmatt-Str"]) {
      const r = placeOnRoad(cell, cross, undefined, { text })!;
      expect(r.road, text).toBe("Bärenmattstrasse");
      expect(r.named).toBe("text");
      expect(r.ambiguous).toBe(false);
      expect(r.candidates![0]!.road).toBe("Bärenmattstrasse");
      expect(r.candidates!.some((x) => x.road === "Talgutstrasse")).toBe(true);
    }
    // gewinnt auch gegen eine wichtigere Strasse
    const r = placeOnRoad(cell, [seg("h", 8, [[2599800, 1199250], [2600700, 1199250]], "Talgutstrasse", 200), seg("n", 11, [[2600250, 1198800], [2600250, 1199700]], "Lindenweg")], undefined, { text: "Kontrollposten Lindenweg" })!;
    expect(r.road).toBe("Lindenweg");
    // zu kurze oder allgemeine Wörter zählen nicht
    expect(placeOnRoad(cell, cross, undefined, { text: "Sperre Bär Strasse" })!.named).toBeUndefined();
  });
  it("genannte Strasse knapp ausserhalb ⇒ nächster Punkt auf ihr; weit weg ⇒ Rang", () => {
    const roads = [...cross, seg("x", 10, [[2599900, 1198900], [2600700, 1198900]], "Gurtenblickweg")];
    const r = placeOnRoad(cell, roads, undefined, { text: "Sperre AG13 Gurtenblickweg" })!;
    expect(r.road).toBe("Gurtenblickweg");
    expect(r.pos.n).toBeCloseTo(1198900, 0);
    expect(r.pos.e).toBeCloseTo(2600250, 0);
    const far = [...cross, seg("y", 10, [[2599900, 1198500], [2600700, 1198500]], "Gurtenblickweg")];
    expect(placeOnRoad(cell, far, undefined, { text: "Sperre AG13 Gurtenblickweg" })!.named).toBeUndefined();
    // genannte Strasse, aber keine im Gebiet: trotzdem darauf
    expect(placeOnRoad(cell, [roads[3]!], undefined, { text: "Gurtenblickweg" })!.road).toBe("Gurtenblickweg");
  });
  it("genannte Strasse ausserhalb: Abstand zum Gebiet in `outside`; im Gebiet ohne", () => {
    const roads = [...cross, seg("x", 10, [[2599900, 1198950], [2600700, 1198950]], "Gurtenblickweg")];
    const r = placeOnRoad(cell, roads, undefined, { text: "Sperre Gurtenblickweg" })!;
    expect(r.outside).toBe(50);
    expect(r.pos.n).toBeLessThan(cell.minN);
    expect(placeOnRoad(cell, cross, undefined, { text: "Sperre Talgutstrasse" })!.outside).toBeUndefined();
    expect(placeOnRoad(cell, roads, undefined, { road: "Gurtenblickweg" })!.outside).toBe(50);
  });
  it("von Hand gewählt (Name oder Stück-Kennung) gewinnt vor Text und Rang", () => {
    expect(placeOnRoad(cell, cross, undefined, { road: "Talgutstrasse", text: "Bärenmattstr" })!).toMatchObject({ road: "Talgutstrasse", named: "wahl", ambiguous: false });
    const w = placeOnRoad(cell, cross, undefined, { segId: "fw" })!;
    expect(w.road).toBeUndefined();
    expect(w.kind).toBe("2m Weg");
    expect(w.candidates![0]!.segId).toBe("fw");
    // unbekannte Wahl ⇒ wie automatisch
    expect(placeOnRoad(cell, cross, undefined, { road: "Gibtsnichtweg" })!.ambiguous).toBe(true);
  });
  it("placeAlongRoad versetzt auch die Kandidaten", () => {
    const r = placeAlongRoad(cell, cross, undefined, 25)!;
    for (const c of r.candidates!) {
      expect(c.onRoad).toBeDefined();
      expect(Math.hypot(c.pos.e - c.onRoad!.e, c.pos.n - c.onRoad!.n)).toBeCloseTo(25, 0);
    }
  });
});

describe("matchRoadNames", () => {
  const names = ["Seftigenstrasse", "Alte Bernstrasse", "Bernstrasse", "Lindenweg", "Hauptstrasse"];
  it("ganze Namen in allen Schreibweisen", () => {
    for (const t of ["Seftigenstrasse", "Seftigenstr.", "seftigenstr", "Seftigen-Strasse", "Seftigen Strasse", "SEFTIGENSTRASSE"]) {
      expect(matchRoadNames(`Sperre ${t} AG13`, names)[0], t).toEqual({ name: "Seftigenstrasse", score: 3 });
    }
    expect(matchRoadNames("Checkpoint Alte Bernstr", names)[0]).toEqual({ name: "Alte Bernstrasse", score: 3 });
    expect(matchRoadNames("Checkpoint Bernstrasse", names)[0]).toEqual({ name: "Bernstrasse", score: 3 });
  });
  it("Teilwörter ab 5 Zeichen, nicht kürzer, keine allgemeinen Wörter, keine Zahlen", () => {
    expect(matchRoadNames("Sperre Seftigen", names)[0]?.name).toBe("Seftigenstrasse");
    expect(matchRoadNames("Sperre Linden", names)[0]?.name).toBe("Lindenweg");
    expect(matchRoadNames("Sperre Bern", names)).toEqual([]);
    expect(matchRoadNames("Sperre auf der Strasse", names)).toEqual([]);
    expect(matchRoadNames("AG13 12345", ["12345er Weg"])).toEqual([]);
  });
  it("Strassentyp unterscheiden: Platz ≠ Strasse ≠ Gasse ≠ Weg; nur gleicher Typ oder ganzer Name", () => {
    const n = ["Lindenstrasse", "Lindenplatz", "Lindengasse", "Lindenweg"];
    expect(matchRoadNames("Sperre bei der Kreuzung Lindenplatz", ["Lindenstrasse"])).toEqual([]);
    expect(matchRoadNames("Sperre Lindenplatz", n)[0]).toEqual({ name: "Lindenplatz", score: 3 });
    expect(matchRoadNames("Sperre Lindengasse", ["Lindenstrasse", "Lindenweg"])).toEqual([]);
    expect(matchRoadNames("Sperre Lindenstr.", ["Lindenplatz", "Lindenstrasse"]).map((h) => h.name)).toEqual(["Lindenstrasse"]);
    // Teilwort mit Typ passt zum gleichen Typ in einem längeren Namen
    expect(matchRoadNames("Kontrolle Lindenstrasse", ["Obere Lindenstrasse", "Lindenplatz"]).map((h) => h.name)).toEqual(["Obere Lindenstrasse"]);
    // ohne Typ: alle Typen möglich
    expect(matchRoadNames("Sperre Linden", n).length).toBe(4);
  });
  it("normRoadText", () => {
    expect(normRoadText("Bärenmatt-Str. 5")).toBe("baerenmatt strasse 5");
    expect(normRoadText("Route de l'Église")).toBe("route de l eglise");
    expect(normRoadText("Straße")).toBe("strasse");
  });
});
