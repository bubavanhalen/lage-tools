import { describe, expect, it } from "vitest";
import {
  boxBlur,
  cropGray,
  detectAllOutlines,
  overlayColor,
  fitScaleShift,
  locateCoarse,
  locateFine,
  prepareSearch,
  resizeGray,
  runSync,
  type Gray,
  type RGBAImage,
} from "../src";

/** Fiktives «Kartenbild»: Rauschen in mehreren Massstäben (wie Gelände mit Strassen und Wald). */
function texture(w: number, h: number, seed = 7): Gray {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out = new Float32Array(w * h);
  for (const [r, amp] of [[12, 120], [4, 60], [1, 30]] as const) {
    const n: Gray = { width: w, height: h, data: new Float32Array(w * h).map(() => rnd() * 255) };
    const b = boxBlur(boxBlur(n, r), r);
    for (let i = 0; i < out.length; i++) out[i]! += (b.data[i]! - 128) * (amp / 60);
  }
  return { width: w, height: h, data: out };
}

describe("Kartenausschnitt einpassen (nur Massstab + Verschiebung)", () => {
  it("2 Punkte reichen, Restfehler pro Punkt", () => {
    const src = [{ x: 10, y: 20 }, { x: 800, y: 500 }, { x: 400, y: 100 }];
    const dst = src.map((p) => ({ x: 2600000 + 2.5 * p.x, y: 1200000 - 2.5 * p.y }));
    dst[2] = { x: dst[2]!.x + 30, y: dst[2]!.y }; // Fehlklick
    const two = fitScaleShift(src.slice(0, 2), dst.slice(0, 2));
    expect(two.t.a).toBeCloseTo(2.5, 6);
    expect(two.t.e).toBeCloseTo(-2.5, 6);
    expect(two.t.b).toBe(0);
    const three = fitScaleShift(src, dst);
    expect(three.residuals[2]).toBeGreaterThan(15);
    expect(Math.max(three.residuals[0]!, three.residuals[1]!)).toBeLessThan(15);
  });
});

describe("Bildvergleich (NCC)", () => {
  it("findet einen vergrösserten Ausschnitt in der Karte wieder (Lage und Massstab)", () => {
    const map = texture(320, 240);
    // Ausschnitt ab (101, 63), 120×90 Kartenpixel, im «Bildschirmfoto» 1.7-fach vergrössert
    const k = 1 / 1.7;
    const crop = cropGray(map, 101, 63, 120, 90);
    const img = resizeGray(crop, 120 / k, 90 / k);
    const search = prepareSearch(map);
    const coarse = runSync(locateCoarse(search, img, { minFrac: 0.2, maxFrac: 0.6, step: 1.05 }))[0];
    expect(coarse).toBeDefined();
    expect(coarse!.score).toBeGreaterThan(0.8);
    expect(Math.abs(coarse!.k / k - 1)).toBeLessThan(0.05);
    expect(Math.abs(coarse!.x - 101)).toBeLessThan(4);
    expect(Math.abs(coarse!.y - 63)).toBeLessThan(4);
    const fine = runSync(locateFine(search, img, coarse!, { range: 0.05, step: 0.01 }));
    expect(Math.abs(fine!.k / k - 1)).toBeLessThan(0.015);
    expect(Math.abs(fine!.x - 101)).toBeLessThan(1);
    expect(Math.abs(fine!.y - 63)).toBeLessThan(1);
  });

  it("falscher Ort ergibt tiefe Übereinstimmung", () => {
    const map = texture(256, 200, 3);
    // anderes Gelände: gleiche Art Textur, aber gespiegelt und aus anderem Ausschnitt
    const src = cropGray(map, 120, 90, 100, 80);
    const flipped: Gray = { width: 100, height: 80, data: new Float32Array(8000).map((_, i) => src.data[(79 - Math.floor(i / 100)) * 100 + (i % 100)]!) };
    const other = resizeGray(flipped, 200, 160);
    const r = runSync(locateCoarse(prepareSearch(map), other, { minFrac: 0.2, maxFrac: 0.6, step: 1.08 }))[0];
    expect(r!.score).toBeLessThan(0.5);
  });
});

describe("Alle NAI erkennen", () => {
  it("findet zwei umrandete Flächen, ignoriert offene Linien und Buchstaben", () => {
    const w = 300, h = 200;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const blue = (x: number, y: number) => { const k = (y * w + x) * 4; data[k] = 60; data[k + 1] = 150; data[k + 2] = 245; };
    const rect = (x0: number, y0: number, x1: number, y1: number, t = 3) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x - x0 < t || x1 - x < t || y - y0 < t || y1 - y < t) blue(x, y);
    };
    rect(20, 20, 120, 100);
    rect(160, 40, 260, 160);
    rect(200, 80, 206, 86, 2); // «Buchstabe»: winziger Innenraum
    for (let x = 0; x < w; x++) blue(x, 185); // offene Linie bis an den Rand
    const img: RGBAImage = { width: w, height: h, data };
    const rings = detectAllOutlines(img, [60, 150, 245], { lineWidth: 3 });
    expect(rings.length).toBe(2);
  });
});

describe("Linienfarbe aus dem Vergleich mit der Karte", () => {
  it("findet die eingezeichnete Farbe, nicht die Kartenfarben", () => {
    const w = 200, h = 150;
    const ref = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      const green = (x >> 3) % 2 === 0; // Wald-Streifen und gelbe Strasse
      ref.set(green ? [120, 190, 90, 255] : (x % 50 < 3 ? [240, 200, 40, 255] : [245, 245, 240, 255]), i * 4);
    }
    const img = new Uint8ClampedArray(ref);
    for (let y = 30; y < 120; y++) for (let x = 40; x < 160; x++) {
      if (x - 40 < 3 || 159 - x < 3 || y - 30 < 3 || 119 - y < 3) img.set([200, 30, 30, 255], (y * w + x) * 4);
    }
    const c = overlayColor({ width: w, height: h, data: img }, { width: w, height: h, data: ref }, (x, y) => ({ x, y }), 1);
    expect(c).toEqual([200, 30, 30]);
  });
});
