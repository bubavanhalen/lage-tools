import { describe, expect, it } from "vitest";
import { roadMark } from "../src/roadmark";

const pos = { e: 2600000, n: 1199000 };
const mark = (sym: string, angle: number | undefined = 30) => roadMark({ sym, angle, pos });

describe("roadMark", () => {
  it("Sperren bekommen den Sperrbalken", () => {
    for (const k of ["sperre", "strassensperre", "panzersperre"]) expect(mark(k), k).toBe("sperre");
  });
  it("Checkpoint und Verkehrsposten als Schranke", () => {
    expect(mark("kontrollposten")).toBe("checkpoint");
    expect(mark("verkehrsposten")).toBe("checkpoint");
  });
  it("IED, VBIED, Minen, Sprengobjekt, Unfall nur als Punkt (kein Sperrbalken)", () => {
    for (const k of ["ied", "vbied", "minensperre", "sprengobjekt", "unfall"]) expect(mark(k), k).toBe("punkt");
  });
  it("ohne Ausrichtung, ohne Ort oder ohne Strassen-Platzierung: nichts", () => {
    expect(roadMark({ sym: "sperre", pos })).toBeNull();
    expect(roadMark({ sym: "sperre", angle: 10 })).toBeNull();
    expect(mark("inf")).toBeNull();
    expect(mark("mine")).toBeNull(); // Einzelmine liegt frei, nicht auf der Strasse
  });
});
