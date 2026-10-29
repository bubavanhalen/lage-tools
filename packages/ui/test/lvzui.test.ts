// Paket C (MVP 3): Standard «Zeige letzte», Übergabe-Inhalt, Kopie für `update` – nur fiktive Daten (Beispiel Bern)
process.env.TZ = "Europe/Zurich";
import { describe, expect, it } from "vitest";
import { demoExercise, demoLang, offenePunkte, type Exercise } from "@lage/core";
import { showLastStandard, LANG_AB } from "../src/time/useLageZeit";
import { uebergabeDaten, dauerText, standText, NEU_MAX } from "../src/lvzui/uebergabeDaten";
import { cloneForUpdate } from "../src/lvzui/clone";
import { hauptAktion, seitLabel } from "../src/lvzui/OffenPanel";
import type { LageRotState } from "../src/lageRot";

const LEER_ROT: LageRotState = { coas: [], more: [], force: { rows: [], notSeen: [] }, spec: null, compare: [], from: null, hints: [] };

describe("Zeige letzte: Standard beim Laden (E16)", () => {
  it("ab 200 Meldungen 6 h, sonst alles", () => {
    expect(LANG_AB).toBe(200);
    expect(showLastStandard(demoExercise().events)).toBeNull();
    expect(showLastStandard(demoLang().events)).toBe(360);
    expect(showLastStandard([])).toBeNull();
  });
});

describe("Übergabe-Inhalt (Kap. 2.7, 3.8)", () => {
  const ex: Exercise = { ...demoExercise(), schichten: [{ id: "s1", art: "beginn", at: "2030-05-15T04:00:00.000Z", t: "2030-05-15T06:00", an: "BSP", device: "d" }] };
  const t = "2030-05-15T07:30";
  const d = uebergabeDaten({ ex, tLive: t, hints: [], lage: LEER_ROT, items: offenePunkte(ex, t), kuerzel: "BSP", seit: "2030-05-15T04:00:00.000Z", seitT: "2030-05-15T06:00" });
  it("Kopf: Stand mit Tag und Datum, Schicht mit Dauer", () => {
    expect(d.stand).toBe("T2 15.05.2030 07:30");
    expect(d.schichtZeile).toMatch(/^Schicht BSP seit T2 06:00 \(1 h 30 min\) · \d+ Einträge in der Schicht$/);
    expect(d.klass).toBe("INTERN");
  });
  it("Lage Blau: H03 steht AP4 D seit T1 18:45 (F1)", () => {
    const h03 = d.blau.find((z) => z.trupp === "H03")!;
    expect(h03.ort).toBe("AP4 D");
    expect(h03.seit).toBe("T1 18:45");
  });
  it("Lage Rot ohne Sichtung im Zustand: Text aus den Meldungen, höchstens zwei Möglichkeiten", () => {
    expect(d.rot.gesehen).toMatch(/^Rot gesehen: mind\. \d+ Pers, \d+ Fz$/);
    expect(d.rot.moeglich.length).toBeLessThanOrEqual(2);
  });
  it("Neu: höchstens 12 Zeilen, Rest als «weitere»", () => {
    expect(d.neu.zeilen.length).toBeLessThanOrEqual(NEU_MAX);
    expect(d.neu.weitere).toBe(Math.max(0, d.neu.total - NEU_MAX));
    // Schicht nur mit dem Kürzel begonnen: «Neu in dieser Schicht» (nicht «seit der letzten Übergabe»)
    expect(d.neu.titel).toMatch(/^Neu in dieser Schicht \(seit T2 06:00\) – \d+ Einträge$/);
    expect(d.neu.zeilen.every((z) => z.nr && !z.text.startsWith(z.nr))).toBe(true);
  });
  it("Von oben (gültig): letzte 3 Orientierungen, jüngste zuerst, unabhängig von der Schicht", () => {
    const o = (id: string, t: string, text: string) => ({ id, rev: 1, device: "d", updatedAt: "2030-05-14T16:00:00.000Z", t, side: "blau" as const, unit: "", text,
      sym: "einheit", aff: "F" as const, source: { kind: "text" as const }, confirmed: true, art: "orientierung" as const, notiz: true, quelle: "Bat" });
    const ex2: Exercise = { ...ex, events: [...(ex.events ?? []), o("o1", "2030-05-14T19:00", "Bat: alt"), o("o2", "2030-05-14T20:00", "Bat: Lagerapport 1800 im KP"),
      o("o3", "2030-05-15T03:00", "Kp: Feind Kp-Stärke ab 2200"), o("o4", "2030-05-15T05:00", "Bat: neu")] };
    const d2 = uebergabeDaten({ ex: ex2, tLive: t, hints: [], lage: LEER_ROT, items: [], kuerzel: "BSP", seit: "2030-05-15T04:00:00.000Z", seitT: "2030-05-15T06:00" });
    // Fix 3: «Lagerapport 1800» (T1 20:00 erfasst) ist vorbei – steht nicht vor gültigen, «alt» (ohne Termin) rückt nach
    expect(d2.vonOben.map((z) => z.key)).toEqual(["o4", "o3", "o1"]);
    // Zeit eines anderen Tages mit Tageskürzel
    expect(d2.vonOben[2]!.t).toBe("T1 19:00");
    expect(d2.vonOben[0]!.t).toBe("05:00");
  });
  it("Von oben (gültig): Abgelaufenes «· vorbei» und nach unten, nie als gültig (Fix 3)", () => {
    const o = (id: string, t: string, text: string) => ({ id, rev: 1, device: "d", updatedAt: "2030-05-15T06:00:00.000Z", t, side: "blau" as const, unit: "", text,
      sym: "einheit", aff: "F" as const, source: { kind: "text" as const }, confirmed: true, art: "orientierung" as const, notiz: true, quelle: "Bat" });
    const ex2: Exercise = { ...ex, events: [o("p1", "2030-05-15T06:30", "Bat: Lagerapport 0700 im KP"), o("p2", "2030-05-15T06:40", "Kdt: ab sofort Funkstille bis 0715"),
      o("p3", "2030-05-15T06:50", "Bat: Feind erwartet ab 0900")] };
    const d2 = uebergabeDaten({ ex: ex2, tLive: t, hints: [], lage: LEER_ROT, items: [], kuerzel: "BSP", seit: "2030-05-15T04:00:00.000Z", seitT: "2030-05-15T06:00" });
    expect(d2.vonOben.map((z) => [z.key, z.meta])).toEqual([["p3", ""], ["p2", "vorbei (07:15)"], ["p1", "vorbei (07:00)"]]);
  });
  it("Zahlen: Schicht und ganze Übung", () => {
    expect(d.zahlen.map((z) => z[0])).toEqual(["Einträge", "Feind / Unklar / Eigene gesehen", "Aufträge (offen)", "Rückfragen (offen)", "Dringend (offen)", "Korrigiert / gestrichen", "Hinweise zu Rot offen / erledigt"]);
    expect(+d.zahlen[0]![2]).toBeGreaterThanOrEqual(+d.zahlen[0]![1]);
  });
  it("ohne Kürzel: «Kürzel fehlt»", () => {
    const o = uebergabeDaten({ ex, tLive: t, hints: [], lage: LEER_ROT, items: [], kuerzel: null, seit: null, seitT: null });
    expect(o.schichtZeile).toMatch(/^Kürzel fehlt/);
  });
  it("Texte", () => {
    expect(dauerText(45)).toBe("45 min");
    expect(dauerText(91)).toBe("1 h 31 min");
    expect(dauerText(120)).toBe("2 h");
    expect(standText("2030-05-16T08:05", ["2030-05-14", "2030-05-15"])).toBe("16.05.2030 08:05");
    expect(seitLabel(11)).toBe("seit 11 min");
    expect(seitLabel(65)).toBe("seit 1 h 05 min");
    expect(hauptAktion({ art: "rueckfrage" })).toBe("Antwort eintragen");
    expect(hauptAktion({ art: "still" })).toBe("Vbk eintragen");
    expect(hauptAktion({ art: "ohne-ort" })).toBe("Ort setzen");
    expect(hauptAktion({ art: "auftrag" })).toBe("Erledigt");
  });
});

describe("cloneForUpdate (P3)", () => {
  it("kopiert tief, übernimmt Bilddaten als Zeichenkette", () => {
    const ex = demoExercise();
    ex.overlays = [{ id: "o1", name: "Bild", dataUrl: "data:image/png;base64,AAAA", width: 10, height: 10, affine: [1, 0, 0, 1, 0, 0], opacity: 0.5, visible: true } as unknown as NonNullable<Exercise["overlays"]>[number]];
    const c = cloneForUpdate(ex);
    expect(c).toEqual(ex);
    expect(c.events).not.toBe(ex.events);
    expect(c.events![0]).not.toBe(ex.events![0]);
    expect(c.overlays![0]).not.toBe(ex.overlays[0]);
    expect(c.overlays![0]!.dataUrl).toBe(ex.overlays[0]!.dataUrl);
  });
});
