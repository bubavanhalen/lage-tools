import ms from "milsymbol";
import { describe, expect, it } from "vitest";
import { buildSidc, CATALOG, ECHELONS } from "@lage/core";
import { germanPin, germanTextFor, KEEP_TEXT } from "../src/symboltext";

const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);

/** wie die Karte: milsymbol + deutsche Nachbearbeitung, alle Zugehörigkeiten, Status und Stufen */
function allTexts(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of CATALOG) {
    for (const aff of ["F", "H", "U", "N"] as const) {
      const echs = e.echelonable ? [undefined, ...ECHELONS.map((x) => x.key)] : [undefined];
      for (const status of ["present", "anticipated"] as const) for (const echelon of echs) {
        const sidc = buildSidc(e, aff, { echelon, status });
        for (const t of texts(germanPin(new ms.Symbol(sidc, { size: 30 }).asSVG(), sidc, e.tag))) {
          out.set(t, [...(out.get(t) ?? []), e.key]);
        }
      }
    }
  }
  return out;
}

describe("Deutsche Kürzel in Zeichen", () => {
  it("keine englischen Kürzel mehr im ganzen Katalog (ausser international gebräuchlichen)", () => {
    const english = /^(SOF|EW|MP|CSS|DPRE|MASS|RIOT|ACC|BOMB|TCP|CKP|ASP|CCP|EPW|LRP|LU|RLY|B|D|K|S|U|CML|BIO)$/;
    const found = [...allTexts().keys()].filter((t) => english.test(t));
    expect(found).toEqual([]);
  });
  it("Ersetzungen wie festgelegt", () => {
    const t = allTexts();
    for (const [de, key] of [["Spez", "spez"], ["EKF", "ekf"], ["Mil Pol", "mp"], ["Krawall", "unruhen"], ["Flü", "fluechtlinge"], ["Demo", "demo"],
      ["Unf", "unfall"], ["Spr Obj", "sprengobjekt"], ["Spreng", "sprengung"], ["Bus", "bus"], ["Entf", "entfuehrung"], ["Scharfs", "scharfschuetze"],
      ["Trsp", "heli_einheit"], ["Zerst", "zerstoerung"], ["Log", "log"], ["Vrk", "verkehrsposten"], ["Kontr", "kontrollposten"]] as const) {
      expect(t.get(de), de).toContain(key);
    }
    for (const k of KEEP_TEXT) expect(t.has(k), k).toBe(true);
  });
  it("Einzelbuchstaben nur beim passenden Zeichen; Schrift wird kleiner, nie grösser", () => {
    expect(germanTextFor("S", "OHVPS----------")).toBe("Scharfs");
    expect(germanTextFor("S", "SHGPUCI--------")).toBeUndefined();
    const sidc = "OHOPD----------";
    const svg = germanPin(new ms.Symbol(sidc, { size: 30 }).asSVG(), sidc);
    expect(texts(svg)).toEqual(["Demo"]);
    const riot = "EHIPAC---------";
    const r = germanPin(new ms.Symbol(riot, { size: 30 }).asSVG(), riot);
    const before = +(/<text[^>]*font-size="([\d.]+)"/.exec(new ms.Symbol(riot, { size: 30 }).asSVG())![1]!);
    const after = +(/<text[^>]*font-size="([\d.]+)"/.exec(r)![1]!);
    expect(after).toBeLessThanOrEqual(before);
    expect(texts(r)).toEqual(["Krawall"]);
  });
});
