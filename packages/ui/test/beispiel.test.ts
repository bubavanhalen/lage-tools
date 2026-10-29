import { describe, expect, it } from "vitest";
import { demoExercise } from "@lage/core";
import { BEISPIEL_LEER_ID, beispielAusUrl, beispielUebung } from "../src/beispiel";

describe("Testzugang ?beispiel", () => {
  it("liest die Adresse", () => {
    expect(beispielAusUrl("")).toBeNull();
    expect(beispielAusUrl("?foo=1")).toBeNull();
    expect(beispielAusUrl("?beispiel")).toBe("voll");
    expect(beispielAusUrl("?beispiel=1")).toBe("voll");
    expect(beispielAusUrl("?x=2&beispiel=leer")).toBe("leer");
    expect(beispielAusUrl("?beispiel=LEER")).toBe("leer");
  });
  it("voll = Beispiel Bern wie im Menü", () => {
    const d = demoExercise();
    const b = beispielUebung("voll");
    expect(b.id).toBe(d.id);
    expect(b.events?.length).toBe(d.events?.length);
  });
  it("leer = gleiche Vorbereitung, keine Meldungen, eigene ID", () => {
    const d = demoExercise();
    const b = beispielUebung("leer");
    expect(b.id).toBe(BEISPIEL_LEER_ID);
    expect(b.id).not.toBe(d.id);
    expect(b.events).toEqual([]);
    expect(b.sheets.map((s) => s.name)).toEqual(d.sheets.map((s) => s.name));
    expect(b.areas.map((a) => a.name)).toEqual(d.areas.map((a) => a.name));
    expect(b.units).toEqual(d.units);
    expect(b.feindannahme).toBe(d.feindannahme);
    expect(b.days).toEqual(d.days);
  });
});
