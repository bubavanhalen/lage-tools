import { describe, expect, it } from "vitest";
import { CATALOG } from "@lage/core";
import { shapeIconSvg } from "../src/shapeicon";

describe("Bild für Flächen- und Linienzeichen (Liste, Auswahl, Legende)", () => {
  const areas = CATALOG.filter((e) => e.geometry === "flaeche");
  const lines = CATALOG.filter((e) => e.geometry === "linie");
  it("jede Fläche ein Vieleck, jede Linie ein Linienzug; Punktzeichen ohne (dann taktisches Zeichen)", () => {
    expect(areas.length).toBeGreaterThan(3);
    expect(lines.length).toBeGreaterThan(3);
    for (const e of areas) expect(shapeIconSvg(e.key, "H", 14)!.svg, e.key).toContain("<polygon");
    for (const e of lines) expect(shapeIconSvg(e.key, "H", 14)!.svg, e.key).toMatch(/<path/);
    expect(shapeIconSvg("inf", "H", 14)).toBeNull();
    expect(shapeIconSvg("sperre", "H", 14)).toBeNull();
  });
  it("Farbe nach Zugehörigkeit (auch aus dem SIDC), vermutet gestrichelt", () => {
    expect(shapeIconSvg("minensperre", "H")!.svg).toContain("#D3262D");
    expect(shapeIconSvg("minensperre", "F")!.svg).toContain("#1F5FB8");
    expect(shapeIconSvg("abc_gebiet", "U")!.svg).toContain("#B88A00");
    expect(shapeIconSvg("achse", "H", 14, { sidc: "GFGPGPP---****X" })!.svg).toContain("#1F5FB8");
    expect(shapeIconSvg("minensperre", "H", 14, { status: "anticipated" })!.svg).toContain("stroke-dasharray");
    expect(shapeIconSvg("minensperre", "H", 14)!.svg).not.toContain("stroke-dasharray");
  });
  it("Muster und Kürzel: Minen «M»; Kürzel erst ab 18 px; Grösse wächst mit", () => {
    expect(shapeIconSvg("minensperre", "H", 14)!.svg).toMatch(/>M<\/text>/);
    expect(shapeIconSvg("sammelraum", "H", 14)!.svg).not.toContain("<text");
    expect(shapeIconSvg("sammelraum", "H", 26)!.svg).toMatch(/>BR<\/text>/);
    const s = shapeIconSvg("stacheldraht", "H", 14)!, b = shapeIconSvg("stacheldraht", "H", 26)!;
    expect(b.w).toBeGreaterThan(s.w);
    expect(s.h).toBeGreaterThanOrEqual(14);
  });
});
