// «Zeige letzte» und Texte zur Lagezeit (MVP 1, Kap. 3.5) – nur fiktive Zeiten (Beispiel Bern)
process.env.TZ = "Europe/Zurich";
import { describe, expect, it } from "vitest";
import {
  countdownText, dauerText, dayTag, lageZeitText, parseLageZeit, rueckblickTitel, shiftMinutes, showLastLabel, showLastStart,
  SHOW_LAST_MIN, zeitAbstand,
} from "../src";

const days = ["2030-05-14", "2030-05-15"];

describe("Zeige letzte", () => {
  it("Wahl und Beschriftung", () => {
    expect([...SHOW_LAST_MIN]).toEqual([30, 60, 120]);
    expect([30, 60, 120, null].map(showLastLabel)).toEqual(["30 min", "1 h", "2 h", "alles"]);
    expect(showLastLabel(90)).toBe("1 h 30 min");
  });
  it("rechnet ab Lagezeit (R8), auch über Mitternacht", () => {
    expect(showLastStart(null, "2030-05-15T07:25")).toBeNull();
    expect(showLastStart(30, "2030-05-15T07:25")).toBe("2030-05-15T06:55");
    expect(showLastStart(120, "2030-05-15T01:00")).toBe("2030-05-14T23:00");
  });
});

describe("Texte zur Lagezeit", () => {
  it("Tag und Zeit", () => {
    expect(dayTag("2030-05-15T05:30", days)).toBe("T2");
    expect(dayTag("2030-05-16T05:30", days)).toBe("16.05.");
    expect(lageZeitText("2030-05-14T23:10", days)).toBe("T1 23:10");
  });
  it("Dauer und Rückblick-Titel", () => {
    expect(dauerText(0)).toBe("weniger als 1 min");
    expect(dauerText(25 * 60000)).toBe("25 min");
    expect(dauerText(120 * 60000)).toBe("2 h");
    expect(dauerText(115 * 60000 + 30000)).toBe("1 h 55 min");
    expect(zeitAbstand("2030-05-15T05:30", "2030-05-15T07:25")).toBe(115 * 60000);
    expect(rueckblickTitel("2030-05-15T05:30", "2030-05-15T07:25", days)).toBe("RÜCKBLICK · Lage um T2 05:30 (vor 1 h 55 min)");
  });
  it("Countdown", () => {
    expect(countdownText(20)).toBe("0:20");
    expect(countdownText(65)).toBe("1:05");
    expect(countdownText(0.2)).toBe("0:01");
    expect(countdownText(-3)).toBe("0:00");
  });
  it("Minuten verschieben über Mitternacht", () => {
    expect(shiftMinutes("2030-05-15T00:20", -30)).toBe("2030-05-14T23:50");
    expect(shiftMinutes("2030-05-15T07:25", 60)).toBe("2030-05-15T08:25");
  });
});

describe("Eingabe «Lage um»", () => {
  const ctx = { days, t: "2030-05-15T06:25", tLive: "2030-05-15T07:25" };
  it("Uhrzeit ohne Tag: Tag aus dem Kontext", () => {
    expect(parseLageZeit("05:30", ctx)).toBe("2030-05-15T05:30");
    expect(parseLageZeit("0530", ctx)).toBe("2030-05-15T05:30");
    expect(parseLageZeit(" 5.30 ", ctx)).toBe("2030-05-15T05:30");
    expect(parseLageZeit("0530 Uhr", ctx)).toBe("2030-05-15T05:30");
  });
  it("nach LIVE → Vortag", () => {
    expect(parseLageZeit("2300", ctx)).toBe("2030-05-14T23:00");
  });
  it("mit Übungstag", () => {
    expect(parseLageZeit("T1 2300", ctx)).toBe("2030-05-14T23:00");
    expect(parseLageZeit("t2 07:10", ctx)).toBe("2030-05-15T07:10");
    expect(parseLageZeit("T5 0700", ctx)).toBeNull();
  });
  it("ungültig", () => {
    expect(parseLageZeit("13:70", ctx)).toBeNull();
    expect(parseLageZeit("2560", ctx)).toBeNull();
    expect(parseLageZeit("gestern", ctx)).toBeNull();
    expect(parseLageZeit("", ctx)).toBeNull();
  });
});
