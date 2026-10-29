import { describe, expect, it } from "vitest";
import { DEFAULT_FLAGS, type LayerFlags } from "../src/layers";
import { effectiveFlags } from "../src/shell/contracts";

const user = (o: Partial<LayerFlags> = {}): LayerFlags => ({ ...DEFAULT_FLAGS, ...o });

describe("effectiveFlags (Kap. 3.7)", () => {
  it("Experte: Wahl des Benutzers unverändert", () => {
    const u = user({ spuren: true, anhaenge: true, flaechen: false });
    expect(effectiveFlags({ modus: "lage", experte: true }, u)).toEqual(u);
  });
  it("Basis: Flächen folgen Eigene/Feind, keine Wege und Fotos", () => {
    const f = effectiveFlags({ modus: "lage", experte: false }, user({ flaechen: false, eigene: false, feind: true }));
    expect(f.flaechen).toBe(true);
    expect(f.spuren).toBe(false);
    expect(f.anhaenge).toBe(false);
    expect(f.hinweise).toBe(true);
    expect(f.aktionen).toBe(true);
    expect(effectiveFlags({ modus: "lage", experte: false }, user({ eigene: false, feind: false, flaechen: true })).flaechen).toBe(false);
  });
  it("Basis: Raster, NAI, Eigene, Feind, Legende nach Wahl", () => {
    const u = user({ raster: false, nai: false, legende: false });
    const f = effectiveFlags({ modus: "lage", experte: false }, u);
    expect([f.raster, f.nai, f.eigene, f.feind, f.legende]).toEqual([false, false, true, true, false]);
  });
  it("Vorbereiten: Raster und NAI immer sichtbar", () => {
    const f = effectiveFlags({ modus: "vorbereiten", experte: false }, user({ raster: false, nai: false }));
    expect([f.raster, f.nai]).toEqual([true, true]);
  });
  it("ändert die Eingabe nicht", () => {
    const u = user({ spuren: true });
    effectiveFlags({ modus: "lage", experte: false }, u);
    expect(u.spuren).toBe(true);
  });
});

describe("MVP 3 Verträge (Kap. 5.4)", () => {
  it("Kürzel 2–6 Zeichen, gross, A–Z/0–9", async () => {
    const { kuerzelNorm } = await import("../src/shell/contracts");
    expect(kuerzelNorm(" mu ")).toBe("MU");
    expect(kuerzelNorm("BSP1")).toBe("BSP1");
    expect(kuerzelNorm("M")).toBeNull();
    expect(kuerzelNorm("ABCDEFG")).toBeNull();
    expect(kuerzelNorm("M-U")).toBeNull();
  });
  it("Schlüssel und Klassifizierung", async () => {
    const { NR_KEY, SCHICHT_KEY, klassifizierungOf } = await import("../src/shell/contracts");
    expect(SCHICHT_KEY("ex-1")).toBe("lage-tools.schicht.ex-1");
    expect(NR_KEY("ex-1")).toBe("lage-tools.nr.ex-1");
    expect(klassifizierungOf({ sheets: [] })).toBe("INTERN");
    expect(klassifizierungOf({ klassifizierung: "VERTRAULICH", sheets: [] })).toBe("VERTRAULICH");
  });
});
