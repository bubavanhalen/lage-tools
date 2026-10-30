/**
 * Online-Dienste MVP 3.5 (Spez. MVP 3.5, K2, S1–S3, A1; Paket A): Standard aus, nur ausdrückliches `true` schaltet ein,
 * eine Datei schaltet beim Zusammenführen nie etwas ein, Kartenkacheln sind kein Online-Dienst, nur Ortsnamen gehen an
 * die Ortssuche (Raster- und Funktexte nie). Nur fiktive Daten (Beispiel Bern).
 */
import { describe, expect, it } from "vitest";
import {
  KACHELN_SIND_ONLINE_DIENST, ONLINE_STANDARD, SW_KACHEL_TIMEOUT_MS, SW_NETZ_TIMEOUT_MS, demoExercise, isPlaceName, mergeExercise, mergeHull,
  onlineAllowed, type Exercise,
} from "../src";

const mit = (o: Exercise["onlineDienste"]): Exercise => { const ex = demoExercise(); if (o) ex.onlineDienste = o; else delete ex.onlineDienste; return ex; };

describe("onlineAllowed (S2)", () => {
  it("Standard aus, auch für Beispiel und Übung ohne Wahl", () => {
    expect(ONLINE_STANDARD).toBe(false);
    expect(onlineAllowed(null, "ortssuche")).toBe(false);
    expect(onlineAllowed(mit(undefined), "ortssuche")).toBe(false);
    expect(onlineAllowed(mit(undefined), "strassen")).toBe(false);
    expect(onlineAllowed(demoExercise(), "ortssuche")).toBe(false);
  });
  it("nur ausdrückliches true schaltet ein, je Dienst getrennt", () => {
    expect(onlineAllowed(mit({ at: "2030-05-15T05:00:00.000Z" }), "ortssuche")).toBe(false);
    expect(onlineAllowed(mit({ ortssuche: true }), "ortssuche")).toBe(true);
    expect(onlineAllowed(mit({ ortssuche: true }), "strassen")).toBe(false);
    expect(onlineAllowed(mit({ ortssuche: false, strassen: true }), "strassen")).toBe(true);
    // ein falscher Typ (alte/kaputte Datei) schaltet nie ein
    expect(onlineAllowed(mit({ ortssuche: "ja" as unknown as boolean }), "ortssuche")).toBe(false);
  });
  it("Kartenkacheln zählen nicht als Online-Dienst (Frage 9.1, Kundenentscheid)", () => {
    expect(KACHELN_SIND_ONLINE_DIENST).toBe(false);
  });
});

describe("Zusammenführen: lokal gewinnt (S2)", () => {
  it("Datei mit ortssuche/strassen an → bestehende Übung ohne Wahl bleibt aus", () => {
    const r = mergeExercise(mit(undefined), mit({ ortssuche: true, strassen: true, at: "2030-05-15T05:00:00.000Z" }));
    expect(r.ex.onlineDienste).toBeUndefined();
    expect(onlineAllowed(r.ex, "ortssuche")).toBe(false);
  });
  it("lokale Wahl bleibt auch gegen eine Datei mit «aus»", () => {
    const r = mergeExercise(mit({ ortssuche: true, at: "2030-05-15T06:00:00.000Z" }), mit({ ortssuche: false, at: "2030-05-15T07:00:00.000Z" }));
    expect(onlineAllowed(r.ex, "ortssuche")).toBe(true);
  });
  it("Fenster desselben Geräts (mergeHull) übernehmen die Wahl des anderen Fensters", () => {
    const h = mergeHull(mit(undefined), mit({ ortssuche: true }));
    expect(onlineAllowed(h.ex, "ortssuche")).toBe(true);
  });
});

describe("Ortssuche nur für Ortsnamen (S3)", () => {
  it("Ortsnamen ja, Raster- und Funktexte nie", () => {
    for (const q of ["Gasthof Bären", "Kirche Wabern", "Bahnhof Belp"]) expect(isPlaceName(q), q).toBe(true);
    for (const q of ["AK7", "AK 7 C", "NAI 2", "H04", "Alpha Kilo sieben", "2600000 1200000", "Det 2"]) expect(isPlaceName(q), q).toBe(false);
  });
});

describe("Service Worker: Zeitlimits an einer Stelle (S4)", () => {
  it("Seite 3 s, Kacheln 8 s", () => {
    expect(SW_NETZ_TIMEOUT_MS).toBe(3000);
    expect(SW_KACHEL_TIMEOUT_MS).toBe(8000);
  });
});
