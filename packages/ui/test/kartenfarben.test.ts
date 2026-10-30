/**
 * Ein Rot auf der Karte (MVP 1-Nachbesserung, M5): feste Kartenfarben `--karte-*` (theme.css), `KARTE`
 * (packages/map) und `LAGE_KARTE` (colors.ts) stimmen überein und entsprechen den hellen Vertragswerten.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KARTE } from "../../map/src/kartenfarben";
import { FARBEN, LAGE_KARTE } from "../src/colors";

const css = readFileSync(fileURLToPath(new URL("../src/theme.css", import.meta.url)), "utf8");
const tok = (n: string) => new RegExp(`--karte-${n}:\\s*(#[0-9A-Fa-f]{6});`).exec(css)?.[1]?.toUpperCase();

describe("Kartenfarben", () => {
  it("KARTE = --karte-* = LAGE_KARTE = helle Vertragswerte", () => {
    const paare: Array<[keyof typeof KARTE, string, string | undefined]> = [
      ["feind", "feind", FARBEN.hell.feind], ["eigen", "eigen", FARBEN.hell.eigen], ["unklar", "unklar", FARBEN.hell.unklar],
      ["unklarFill", "unklar-fill", FARBEN.hell["unklar-fill"]], ["neutral", "neutral", FARBEN.hell.neutral],
      ["zivil", "zivil", FARBEN.hell.zivil], ["ink", "ink", FARBEN.hell.ink], ["halo", "halo", LAGE_KARTE.halo], ["haloNacht", "halo-nacht", LAGE_KARTE.haloNacht],
      ["nai", "nai", undefined], ["ao", "ao", undefined],
    ];
    for (const [k, t, v] of paare) {
      expect(tok(t), `--karte-${t}`).toBe(KARTE[k].toUpperCase());
      if (v) expect(KARTE[k].toUpperCase(), k).toBe(v.toUpperCase());
    }
    expect(LAGE_KARTE.feind).toBe(KARTE.feind);
  });
  it("ein Rot: --m-rot und die Kartenebenen nehmen Feind #C62828", () => {
    expect(css).toMatch(/--m-rot:\s*var\(--karte-feind\)/);
    // Kartenebenen (journalLayer.ts lädt Leaflet – hier nur der Quelltext): Farben nur aus LAGE_KARTE
    const jl = readFileSync(fileURLToPath(new URL("../src/journalLayer.ts", import.meta.url)), "utf8");
    expect(jl).toMatch(/rot: LAGE_KARTE\.feind/);
    expect(jl).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    expect(css).not.toMatch(/#D3262D|#B3242A/i);
  });
});
