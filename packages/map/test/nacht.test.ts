// Review 6 Erstbenutzer H2: nachts Pfeil, Stiel und Grössenangabe hell, Saum schwarz, Rahmen und Innenzeichen unverändert
import { describe, expect, it } from "vitest";
import ms from "milsymbol";
import { nachtHell } from "../src/nacht";
import { KARTE } from "../src/kartenfarben";

const svgVon = (sidc: string, dir?: string) =>
  new ms.Symbol(sidc, { size: 28, outlineWidth: 8, outlineColor: KARTE.haloNacht, strokeWidth: 7, fill: true, ...(dir ? { direction: dir } : {}) }).asSVG();

describe("nachtHell", () => {
  it("Feind-Kpz-Kp Rtg W: Pfeil, Stiel und ●●● hell, Saum bleibt schwarz", () => {
    const vor = svgVon("SHGPUCA----D---", "270");
    const nach = nachtHell(vor, KARTE.haloNacht);
    const pfeil = [...nach.matchAll(/<path d="M100,100 l0,-75[^>]*>/g)].map((m) => m[0]);
    expect(pfeil).toHaveLength(2);
    expect(pfeil[0]).toContain(`stroke="${KARTE.haloNacht}"`); // Saum
    expect(pfeil[1]).toContain(`stroke="${KARTE.halo}"`);
    expect(pfeil[1]).toContain(`fill="${KARTE.halo}"`);
    const stiel = [...nach.matchAll(/<path d="M 100,172l0,100"[^>]*>/g)].map((m) => m[0]);
    expect(stiel[1]).toContain(`stroke="${KARTE.halo}"`);
    // Grössenangabe (drei Kreise) hell
    expect(nach.match(new RegExp(`<circle stroke="${KARTE.halo}"[^>]*fill="${KARTE.halo}"`, "g"))).toHaveLength(3);
    // Rahmen (Füllung rot) und Innenzeichen (Kettenfahrzeug) bleiben schwarz
    expect(nach).toMatch(/Z" stroke-width="7" stroke="black" fill="rgb\(255,128,128\)"/);
    expect(nach).toMatch(/<path d="M125,80 C150,80[^>]*stroke="black"/);
  });
  it("ohne Pfeil und ohne Saum: unverändert", () => {
    const tag = svgVon("SFGPUCI--------");
    expect(nachtHell(tag, "#ffffff")).toBe(tag);
  });
});
