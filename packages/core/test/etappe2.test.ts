import { describe, expect, it } from "vitest";
import {
  applyAffine,
  blattFromRect,
  cellAt,
  detectOutline,
  exerciseFromFile,
  exerciseToFile,
  feldFromRect,
  fitAffine,
  formatShortRef,
  invertAffine,
  kmlUrlFromGeoAdminLink,
  newExercise,
  nextPrefix,
  niceCellSize,
  parseGisText,
  pointInRing,
  ringArea,
  simplifyRing,
  type RGBAImage,
} from "../src";

describe("Affine Georeferenzierung", () => {
  it("3 Punkte → exakte Transformation (Drehung + Massstab + Verschiebung)", () => {
    const truth = { a: 2.5 * Math.cos(0.1), b: -2.5 * Math.sin(0.1), c: 2600000, d: -2.5 * Math.sin(0.1), e: -2.5 * Math.cos(0.1), f: 1200000 };
    const src = [{ x: 10, y: 20 }, { x: 900, y: 40 }, { x: 300, y: 700 }];
    const dst = src.map((p) => applyAffine(truth, p));
    const { t, rms } = fitAffine(src, dst);
    expect(rms).toBeLessThan(1e-6);
    const q = applyAffine(t, { x: 500, y: 500 });
    const r = applyAffine(truth, { x: 500, y: 500 });
    expect(q.x).toBeCloseTo(r.x, 4);
    const back = applyAffine(invertAffine(t), q);
    expect(back.x).toBeCloseTo(500, 6);
    expect(back.y).toBeCloseTo(500, 6);
  });
  it("Punkte auf einer Linie werden abgelehnt", () => {
    expect(() => fitAffine([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toThrow();
  });
});

describe("Polygone", () => {
  it("vereinfachen, Fläche, Punkt-in-Polygon", () => {
    const ring = [];
    for (let i = 0; i <= 100; i++) ring.push({ x: i, y: 0 });
    for (let i = 1; i <= 100; i++) ring.push({ x: 100, y: i });
    for (let i = 99; i >= 0; i--) ring.push({ x: i, y: 100 });
    for (let i = 99; i >= 1; i--) ring.push({ x: 0, y: i });
    const s = simplifyRing(ring, 0.5);
    expect(s.length).toBe(4);
    expect(ringArea(s)).toBeCloseTo(10000, 0);
    expect(pointInRing({ x: 50, y: 50 }, s)).toBe(true);
    expect(pointInRing({ x: 150, y: 50 }, s)).toBe(false);
  });
});

/** Weisses Bild mit blauer Rechteck-Umrandung (Linienbreite 4) und einer grauen Strasse quer durch. */
function testImage(): RGBAImage {
  const w = 200, h = 150;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const set = (x: number, y: number, c: number[]) => { const p = (y * w + x) * 4; data[p] = c[0]!; data[p + 1] = c[1]!; data[p + 2] = c[2]!; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(y - 75) < 2) set(x, y, [120, 120, 120]);
  for (let y = 30; y <= 110; y++) for (let x = 40; x <= 160; x++) {
    const onLine = (x <= 43 || x >= 157 || y <= 33 || y >= 107);
    if (onLine) set(x, y, [30, 60, 220]);
  }
  return { width: w, height: h, data };
}

describe("Umriss-Erkennung per Klick", () => {
  it("findet das Rechteck bis zur Linienmitte", () => {
    const ring = detectOutline(testImage(), { x: 100, y: 60 }, [30, 60, 220], { lineWidth: 4, simplify: 1 })!;
    expect(ring).not.toBeNull();
    const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(39);
    expect(Math.min(...xs)).toBeLessThanOrEqual(43);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(157);
    expect(Math.max(...ys)).toBeLessThanOrEqual(111);
    expect(ring.length).toBeLessThan(12);
  });
  it("Klick ausserhalb eines geschlossenen Umrisses → null", () => {
    expect(detectOutline(testImage(), { x: 10, y: 10 }, [30, 60, 220])).toBeNull();
  });
});

describe("GIS-Import", () => {
  it("GeoJSON (WGS84) → LV95", () => {
    const gj = { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "NAI 1" }, geometry: { type: "Polygon", coordinates: [[[7.43, 46.95], [7.44, 46.95], [7.44, 46.96], [7.43, 46.95]]] } }] };
    const f = parseGisText(JSON.stringify(gj));
    expect(f).toHaveLength(1);
    expect(f[0]!.name).toBe("NAI 1");
    expect(f[0]!.coords).toHaveLength(3); // Ring ohne Wiederholung
    expect(f[0]!.coords[0]!.e).toBeGreaterThan(2590000);
  });
  it("KML wie aus map.geo.admin.ch (mit Stil-Farbe)", () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Style id="s1"><LineStyle><color>ffe0661f</color></LineStyle></Style>
      <Placemark><name>NAI 2</name><styleUrl>#s1</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>
        7.43,46.95,0 7.44,46.95,0 7.44,46.96,0 7.43,46.95,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      <Placemark><name><![CDATA[Route &amp; Weg]]></name><LineString><coordinates>7.43,46.95 7.45,46.97</coordinates></LineString></Placemark>
      <Placemark><name>CP</name><Point><coordinates>7.44,46.955</coordinates></Point></Placemark>
    </Document></kml>`;
    const f = parseGisText(kml);
    expect(f.map((x) => [x.name, x.kind])).toEqual([["NAI 2", "polygon"], ["Route & Weg", "line"], ["CP", "point"]]);
    expect(f[0]!.color).toBe("#1f66e0");
  });
  it("GPX Track und Wegpunkt", () => {
    const gpx = `<gpx version="1.1"><wpt lat="46.95" lon="7.43"><name>PuP</name></wpt><trk><name>Infil</name><trkseg><trkpt lat="46.95" lon="7.43"/><trkpt lat="46.96" lon="7.44"/></trkseg></trk></gpx>`;
    const f = parseGisText(gpx);
    expect(f.map((x) => [x.name, x.kind, x.coords.length])).toEqual([["PuP", "point", 1], ["Infil", "line", 2]]);
  });
  it("KML-URL aus map.geo.admin.ch-Teilen-Link", () => {
    const link = "https://map.geo.admin.ch/#/map?lang=de&center=2600000,1200000&z=8&layers=KML%7C%7Chttps:%2F%2Fpublic.geo.admin.ch%2Fapi%2Fkml%2Ffiles%2FAbC123xyz";
    expect(kmlUrlFromGeoAdminLink(link)).toBe("https://public.geo.admin.ch/api/kml/files/AbC123xyz");
  });
});

describe("Übung und Raster aus Rechteck", () => {
  it("Blatt-Raster deckt das Rechteck ab, Feldgrösse ist «schön»", () => {
    const r = { minE: 2595000, maxE: 2603000, minN: 1197000, maxN: 1203000 };
    const s = blattFromRect(r, "GESAMT", "A");
    expect(s.cellW).toBe(400); // 8000/21 = 381 → 400
    expect(s.colLabels[0]).toBe("AA");
    expect(cellAt(s, { e: 2595100, n: 1202900 })).not.toBeNull();
    expect(cellAt(s, { e: 2602900, n: 1197100 })).not.toBeNull();
    expect(formatShortRef(s.reference!)).toMatch(/^\d{3}'\d{3} \/ \d{3}'\d{3}$/);
  });
  it("Feld-Raster: Zeilen/Spalten aus Feldgrösse", () => {
    const s = feldFromRect({ minE: 2590000, maxE: 2605000, minN: 1190000, maxN: 1208000 }, "AOR", 500);
    expect(s.colLabels).toHaveLength(30);
    expect(s.rowLabels).toHaveLength(36);
    expect(s.rowLabels[35]).toBe("AJ");
  });
  it("Präfixe vergeben, schöne Feldgrössen", () => {
    const ex = newExercise("Test");
    ex.sheets.push(blattFromRect({ minE: 0, maxE: 8000, minN: 0, maxN: 6000 }, "GESAMT", nextPrefix(ex.sheets)));
    expect(nextPrefix(ex.sheets)).toBe("B");
    expect(nextPrefix(ex.sheets, "U")).toBe("U");
    expect(niceCellSize(83)).toBe(100);
    expect(niceCellSize(190)).toBe(200);
  });
  it("Datei speichern und laden", () => {
    const ex = newExercise("Übung X");
    const back = exerciseFromFile(exerciseToFile(ex));
    expect(back.name).toBe("Übung X");
    expect(() => exerciseFromFile('{"foo":1}')).toThrow();
  });
});
