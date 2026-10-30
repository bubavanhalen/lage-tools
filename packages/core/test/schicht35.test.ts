/**
 * Übergabe MVP 3.5 (Spez. MVP 3.5, Kap. 3.4 D3/D4/D5): «Von oben (gültig)» mit allen Orientierungen und Aufträgen von
 * oben («bis» = Ende, «ab/um/erwartet» = Beginn), Zahlen mit Ausgang/Begehren, Übergabe-Eintrag zählt nicht, offene
 * Hinweise = `offeneHinweise`. Nur fiktive Daten (Beispiel Bern).
 */
process.env.TZ = "Europe/Zurich";
import { describe, expect, it } from "vitest";
import {
  VON_OBEN_MAX, demoExercise, eventFromDraft, lastPosition, nextNr, offeneHinweise, parseMeldung, rapportZahlen, terminInfo, terminOf,
  uebergabeEintrag, uebergabeEintragZu, uebergabeText, vonOben, type Exercise, type Hint, type LageEvent,
} from "../src";

const at = (hhmm: string) => new Date(`2030-05-15T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00+02:00`);
function trage(ex: Exercise, s: string, hhmm: string): LageEvent {
  const now = at(hhmm);
  const d = parseMeldung(s, { sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now, lastPos: (u, si) => lastPosition(ex.events!, si, u), events: ex.events, ex, zone: "Europe/Zurich" });
  const e = eventFromDraft(d, "dev-a", now, { nr: nextNr(ex, 0), kuerzel: "BSP" });
  ex.events = [...(ex.events ?? []), e];
  return e;
}

describe("terminInfo: Ende und Beginn (D4)", () => {
  const e = { t: "2030-05-15T07:47" };
  it("«bis» = Ende; «ab/um/ca./erwartet» = Beginn; Zeit ohne Wort = Termin (danach vorbei)", () => {
    expect(terminInfo(e, "ab 0907 Feind Det mit 2 Fz aus Rtg Belp erwartet")).toEqual({ termin: "2030-05-15T09:07", art: "ab" });
    expect(terminInfo(e, "Funkstille bis 1100")).toEqual({ termin: "2030-05-15T11:00", art: "bis" });
    expect(terminInfo(e, "Verpflegung um 1200 im KP")).toEqual({ termin: "2030-05-15T12:00", art: "ab" });
    expect(terminInfo(e, "Feind erwartet ca. 0930")).toEqual({ termin: "2030-05-15T09:30", art: "ab" });
    expect(terminInfo(e, "Lagerapport 1000 im KP Bat")).toEqual({ termin: "2030-05-15T10:00", art: "bis" });
    expect(terminInfo({ t: "2030-05-15T20:00" }, "ab 2200 Ruhe bis 0600")).toEqual({ termin: "2030-05-16T06:00", art: "bis" });
    expect(terminInfo(e, "Nachbar Kp 61/2 links")).toBeNull();
  });
  it("terminOf bleibt: nur Ende/Termin", () => {
    expect(terminOf(e, "ab 0907 Feind erwartet")).toBeNull();
    expect(terminOf(e, "Lagerapport 1000")).toBe("2030-05-15T10:00");
  });
});

describe("vonOben: alle von oben, gültige zuerst (D4)", () => {
  it("10 Einträge von oben, Uhr 10:10: «ab 09:07» bleibt gültig, Aufträge mit Quelle dabei, vorbei hinten", () => {
    const ex = demoExercise();
    trage(ex, "Bat: Lagerapport 1000 im KP Bat", "0730");
    trage(ex, "Kdt: ab sofort Funkstille bis 0800", "0735");
    trage(ex, "Bat: ab 0907 Feind Det mit 2 Fz aus Rtg Belp erwartet", "0747");
    trage(ex, "Kp Kdt: Auftrag an H03 NAI 2 überwachen bis 1200", "0750");
    trage(ex, "Auftrag an H02: Beo NAI 3 bis 0900", "0751"); // ohne Quelle: kein «von oben»
    for (let i = 0; i < 7; i++) trage(ex, `Bat: Orientierung ${i + 1} Nachbar links`, `08${String(10 + i).padStart(2, "0")}`);
    const v = vonOben(ex, "2030-05-15T10:10");
    expect(v.length).toBe(11);
    const gueltig = v.filter((z) => !z.vorbei);
    expect(gueltig.length).toBe(9);
    expect(v.slice(-2).map((z) => z.text)).toEqual(["ab sofort Funkstille bis 0800", "Lagerapport 1000 im KP Bat"]);
    const ab = v.find((z) => z.text.startsWith("ab 0907"))!;
    expect(ab).toMatchObject({ terminArt: "ab", termin: "2030-05-15T09:07", art: "orientierung", quelle: "Bat" });
    expect(ab.vorbei).toBe(false);
    expect(v.find((z) => z.art === "auftrag")).toMatchObject({ quelle: "Kdt", text: "an H03: NAI 2 überwachen bis 1200", terminArt: "bis" });
    expect(VON_OBEN_MAX).toBe(8);
    expect(vonOben(ex, "2030-05-15T10:10", 3)).toHaveLength(3);
  });
});

describe("Zahlen (D3, D5)", () => {
  it("Übergabe-Eintrag zählt nicht; Ausgang nach Empfänger; Hinweise = offeneHinweise", () => {
    const ex = demoExercise();
    trage(ex, "Meldung an Bat: 2 Kpz AK9", "0731");
    trage(ex, "Lagemeldung an Kp: ruhig", "0732");
    trage(ex, "Meldung an Nachbar links: ruhig", "0733");
    const z0 = rapportZahlen(ex, null, "2030-05-15T08:00");
    const w = { id: "w1", art: "uebergabe" as const, at: "2030-05-15T05:40:00.000Z", t: "2030-05-15T07:40", an: "MU", von: "BSP", device: "dev-a", stand: { offen: 2, neu: 3 } };
    ex.events = [...ex.events!, uebergabeEintrag(w, { nr: nextNr(ex, 0), device: "dev-a" })];
    const z1 = rapportZahlen(ex, null, "2030-05-15T08:00");
    expect(z1.eintraege).toBe(z0.eintraege);
    expect(z1.ausgang).toEqual({ bat: 1, kp: 1, andere: 1 });
    const h = (id: string, level: Hint["level"], extra: Partial<Hint> = {}): Hint => ({ id, rule: id.split(":")[0]!, level, title: id, text: "", events: [], t: "2030-05-15T07:00", ...extra });
    const hints = [h("C1:a", "hoch"), h("D1:b", "info"), h("C2:c", "mittel", { bundled: 3 })];
    expect(rapportZahlen(ex, null, "2030-05-15T08:00", hints).hinweise).toEqual({ offen: offeneHinweise(hints, ex.hintDecisions).offen, erledigt: 0 });
    expect(uebergabeEintragZu(ex, "w1")?.text).toBe("Übergabe BSP → MU · 2 offen · 3 neu");
    expect(uebergabeText({ an: "MU" })).toBe("Übergabe – → MU");
  });
});
