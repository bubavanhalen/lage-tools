import { describe, expect, it } from "vitest";
import { isPlaceName, onlineAllowed } from "../src";

describe("isPlaceName: Online-Ortssuche nur für echte Ortsnamen", () => {
  it.each([
    "Wabern", "Gasthof Bären", "Bümpliz", "Köniz Schliern", "Hotel Bellevue", "Gurten Kulm", "Bahnhof Bern",
  ])("Ort: %s", (q) => expect(isPlaceName(q)).toBe(true));

  it.each([
    "Alpha Kilo", "Alpha Kilo 7", "alpha kilo sieben charlie", "Hotel null vier", "Kilo", "AK7", "AK77", "ak 7 c", "ZZ3",
    "NAI 9", "nai3", "H04", "Det 2", "2600000 1200000", "12", "ab", "", "  ", "Golf",
  ])("kein Ort: «%s»", (q) => expect(isPlaceName(q)).toBe(false));

  it("leer/undefiniert", () => {
    expect(isPlaceName(undefined)).toBe(false);
    expect(isPlaceName(null)).toBe(false);
  });
});

describe("onlineAllowed: pro Übung schaltbar, Standard aus (MVP 3.5, Entscheid K2)", () => {
  it("ohne Einstellung aus (neue, alte, Beispiel-Übung)", () => {
    expect(onlineAllowed({}, "ortssuche")).toBe(false);
    expect(onlineAllowed(null, "strassen")).toBe(false);
    expect(onlineAllowed({ onlineDienste: {} }, "ortssuche")).toBe(false);
  });
  it("nur ausdrücklich true schaltet ein, einzeln", () => {
    const ex = { onlineDienste: { ortssuche: true } };
    expect(onlineAllowed(ex, "ortssuche")).toBe(true);
    expect(onlineAllowed(ex, "strassen")).toBe(false);
    expect(onlineAllowed({ onlineDienste: { ortssuche: false, strassen: true } }, "ortssuche")).toBe(false);
    expect(onlineAllowed({ onlineDienste: { strassen: true } }, "strassen")).toBe(true);
  });
});
