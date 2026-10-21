import { describe, expect, it } from "vitest";
import { softHyphens } from "../src/hyphen";

const show = (s: string) => softHyphens(s).replace(/­/g, "-");

describe("softHyphens", () => {
  it("trennt lange Wörter an Wortfugen", () => {
    expect(show("Sanitätshilfsstelle / Spital")).toBe("Sanitäts-hilfs-stelle / Spital");
    expect(show("Verwundetennest")).toBe("Verwundeten-nest");
    expect(show("Bereitstellungsraum / Sammelraum")).toBe("Bereit-stellungs-raum / Sammel-raum");
    expect(show("Mannschaftstransportwagen")).toBe("Mann-schafts-transport-wagen");
  });
  it("lässt kurze Wörter und Wörter ohne Fuge in Ruhe", () => {
    expect(show("IED (Sprengfalle)")).toBe("IED (Spreng-falle)");
    expect(show("Infanterie")).toBe("Infanterie");
    expect(show("Kp")).toBe("Kp");
  });
});
