/**
 * MVP 3.5 Nachbesserung (Review 6), Agent UI – reine Funktionen: Datei schaltet Online nie still ein (Feld H2),
 * Absender in «Von oben» genau einmal, Spalte «Art» im Journal-PDF ohne Worttrennung,
 * MESZ/MEZ in der doppelten Stunde (Übergabe/Offen). Nur fiktive Daten (Raum Bern).
 */
import { describe, expect, it } from "vitest";
import { demoExercise, type Exercise } from "@lage/core";
import { ohneOnline } from "../src/betrieb/dateiOnline";
import { mitQuelle } from "../src/lvzui/uebergabeDaten";
import { artZeilen } from "../src/journalpdf";
import { zeitKurz } from "../src/entry/labels";

describe("Datei öffnen: Online-Dienste aus, einmalige Frage (Feld H2)", () => {
  it("Datei mit Ortsnamen/Strassen an → Übung aus, Frage nennt beide", () => {
    const x: Exercise = { ...demoExercise(), onlineDienste: { ortssuche: true, strassen: true, at: "2030-05-15T05:00:00Z" } };
    const r = ohneOnline(x);
    expect(r.file.onlineDienste).toBeUndefined();
    expect(r.online?.namen).toBe("Ortsnamen/Strassen");
    expect(r.online?.dienste).toEqual({ ortssuche: true, strassen: true });
  });
  it("Datei ohne Wahl oder alles aus → keine Frage", () => {
    expect(ohneOnline(demoExercise()).online).toBeNull();
    const r = ohneOnline({ ...demoExercise(), onlineDienste: { ortssuche: false } });
    expect(r.online).toBeNull();
    expect(r.file.onlineDienste).toBeUndefined();
  });
});

describe("Übergabe «Von oben»: Absender genau einmal (Einsatz N)", () => {
  it("«Kdt: an H05: Kdt: …» → «Kdt: an H05: …»", () => {
    expect(mitQuelle("Kdt", "an H05: Kdt: H05 sofort Stellungswechsel nach AR12")).toBe("Kdt: an H05: H05 sofort Stellungswechsel nach AR12");
    expect(mitQuelle("Bat", "Bat: Lagerapport 1000 im KP")).toBe("Bat: Lagerapport 1000 im KP");
    expect(mitQuelle("Bat", "ab 0837 Feind Det erwartet")).toBe("Bat: ab 0837 Feind Det erwartet");
  });
});

describe("Journal-PDF Spalte «Art»: nie mitten im Wort (Einsatz N «Orientierun-g»)", () => {
  // Breite wie Helvetica 8 pt (mm): ~1.28 mm je Zeichen
  const doc = { getTextWidth: (t: string) => t.length * 1.28 };
  it("«Orientierung» bleibt ganz, «Ausgang an Bat» bricht an Leerschlägen", () => {
    expect(artZeilen(doc, "Orientierung", 16.1)).toEqual(["Orientierung"]);
    expect(artZeilen(doc, "Ausgang an Bat", 16.1)).toEqual(["Ausgang an", "Bat"]);
  });
  it("zu langes Wort wird mit Punkt gekürzt, nie getrennt", () => {
    const z = artZeilen(doc, "Verbindungskontrolle", 16.1);
    expect(z).toHaveLength(1);
    expect(z[0]!.endsWith(".")).toBe(true);
  });
});

describe("doppelte Stunde: «02:30 MESZ» / «02:30 MEZ» in Übergabe und Offen (Einsatz N)", () => {
  it("am 27.10.2030 mit Offset, sonst nur HH:MM", () => {
    const tage = ["2030-10-26", "2030-10-27"];
    expect(zeitKurz("2030-10-27T02:30", "2030-10-27T03:10", tage, { t: "2030-10-27T02:30", tOffset: "+02:00" })).toBe("02:30 MESZ");
    expect(zeitKurz("2030-10-27T02:30", "2030-10-27T03:10", tage, { t: "2030-10-27T02:30", tOffset: "+01:00" })).toBe("02:30 MEZ");
    expect(zeitKurz("2030-10-27T07:30", "2030-10-27T08:10", tage, { t: "2030-10-27T07:30", tOffset: "+01:00" })).toBe("07:30");
  });
});
