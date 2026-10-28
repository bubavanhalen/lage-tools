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

describe("onlineAllowed: pro Übung schaltbar, Standard an", () => {
  it("ohne Einstellung an", () => {
    expect(onlineAllowed({}, "ortssuche")).toBe(true);
    expect(onlineAllowed(null, "strassen")).toBe(true);
  });
  it("einzeln aus", () => {
    const ex = { onlineDienste: { ortssuche: false } };
    expect(onlineAllowed(ex, "ortssuche")).toBe(false);
    expect(onlineAllowed(ex, "strassen")).toBe(true);
    expect(onlineAllowed({ onlineDienste: { strassen: false } }, "strassen")).toBe(false);
  });
});
