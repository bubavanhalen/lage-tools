// Review 6 Einsatz M5: «bei Hxx»-Zeichen neben den Trupp, nie deckungsgleich (fiktive Orte Raum Bern)
import { describe, expect, it } from "vitest";
import { beiTruppZuordnung, beiVersatz } from "../src/map/beiTrupp";

const it_ = (id: string, kind: string, isUnit: boolean, e: number, n: number, t = "2030-05-15T07:00") => ({ kind, isUnit, pos: { e, n }, e: { id, t } });

describe("beiTruppZuordnung", () => {
  it("Sichtungen am Standort eines Trupps → Plätze, neueste zuerst; andere Orte und Strassen-Hindernisse nicht", () => {
    const h03 = it_("h03", "eigen", true, 2600100, 1199900);
    const a = it_("a", "unklar", false, 2600100, 1199900, "2030-05-15T07:51");
    const b = it_("b", "feind", false, 2600100.4, 1199900, "2030-05-15T08:14");
    const c = it_("c", "feind", false, 2600400, 1199900);
    const d = { ...it_("d", "feind", false, 2600100, 1199900), road: {} };
    const z = beiTruppZuordnung([h03, a, b, c, d]);
    expect(z.get(b)).toEqual({ trupp: h03, slot: 0 });
    expect(z.get(a)).toEqual({ trupp: h03, slot: 1 });
    expect(z.has(c)).toBe(false);
    expect(z.has(d)).toBe(false);
    expect(z.has(h03)).toBe(false);
  });
});

describe("beiVersatz", () => {
  const trupp: [number, number, number, number] = [-17, -21, 17, 11];
  const zeichen: [number, number, number, number] = [-20, -20, 20, 20];
  const ueber = (a: number[], b: number[]) => a[0]! < b[2]! && b[0]! < a[2]! && a[1]! < b[3]! && b[1]! < a[3]!;
  it("berührungsfrei in allen Plätzen, Platz 0 oben", () => {
    expect(beiVersatz(0, trupp, zeichen)).toEqual([0, -44]);
    for (let s = 0; s < 10; s++) {
      const [dx, dy] = beiVersatz(s, trupp, zeichen);
      expect(ueber(trupp, [zeichen[0] + dx, zeichen[1] + dy, zeichen[2] + dx, zeichen[3] + dy]), `Platz ${s}`).toBe(false);
    }
  });
});
