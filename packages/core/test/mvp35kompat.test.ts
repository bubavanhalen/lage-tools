/**
 * Rückwärtskompatibilität und Migration MVP 3.5 (Spez. MVP 3.5, Kap. 5.8): alte Übungsdateien (MVP 3, ohne
 * `onlineDienste`, Meldungen ohne `tOffset`) öffnen und zusammenführen – Online-Dienste gelten als aus, Offsets werden
 * abgeleitet, **beim Öffnen wird nichts geschrieben**. Eine Datei schaltet beim Zusammenführen nie etwas ein. Nur fiktive
 * Daten (Beispiel Bern, Kürzel BSP/MU).
 */
import { describe, expect, it } from "vitest";
import {
  FILE_VERSION, compareEvents, demoExercise, eventFromDraft, exerciseFromFile, exerciseToFile, lastPosition, mergeExercise, mergeHull, offsetOf,
  onlineAllowed, parseMeldung, situationAt, zeitCmp, type Exercise, type LageEvent,
} from "../src";

const Z = "Europe/Zurich";

/** Übung, wie MVP 3 sie gespeichert hat: Beispiel Bern ohne `onlineDienste`, Meldungen ohne `tOffset` */
function mvp3Datei(o: { online?: Exercise["onlineDienste"] } = {}): string {
  const ex = demoExercise();
  delete ex.onlineDienste;
  if (o.online) ex.onlineDienste = o.online;
  ex.events = ex.events!.map((e) => { const { tOffset: _o, ...rest } = e; return rest as LageEvent; });
  return exerciseToFile(ex);
}

describe("MVP-3-Datei öffnen (Kap. 5.8)", () => {
  it("Datei-Version bleibt 1", () => expect(FILE_VERSION).toBe(1));
  it("ohne onlineDienste: alles aus, nichts geschrieben", () => {
    const ex = exerciseFromFile(mvp3Datei());
    const vorher = JSON.stringify(ex);
    expect(onlineAllowed(ex, "ortssuche")).toBe(false);
    expect(onlineAllowed(ex, "strassen")).toBe(false);
    expect(ex.onlineDienste).toBeUndefined();
    // Lage, Reihenfolge, Offsets abgeleitet – geschrieben wird nichts (rev, updatedAt gleich)
    const sorted = [...ex.events!].sort(compareEvents);
    expect(sorted.length).toBe(ex.events!.length);
    situationAt(ex.events!, "2030-05-15T07:30");
    for (const e of ex.events!) expect(offsetOf(e, Z)).toBe("+02:00");
    expect(JSON.stringify(ex)).toBe(vorher);
  });
  it("MVP-3-Wahl bleibt: false = aus, true = an (ausdrücklich)", () => {
    expect(onlineAllowed(exerciseFromFile(mvp3Datei({ online: { ortssuche: false } })), "ortssuche")).toBe(false);
    const an = exerciseFromFile(mvp3Datei({ online: { ortssuche: true } }));
    expect(onlineAllowed(an, "ortssuche")).toBe(true);
    expect(onlineAllowed(an, "strassen")).toBe(false);
  });
  it("Reihenfolge alter Meldungen ohne Offset unverändert (gewöhnlicher Tag)", () => {
    const ex = exerciseFromFile(mvp3Datei());
    const alt = [...ex.events!].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : (a.createdAt ?? "") < (b.createdAt ?? "") ? -1 : (a.createdAt ?? "") > (b.createdAt ?? "") ? 1 : a.id.localeCompare(b.id))); // zeit-ok: Vergleich mit der alten Sortierung
    expect([...ex.events!].sort(compareEvents).map((e) => e.id)).toEqual(alt.map((e) => e.id));
  });
});

describe("Zusammenführen: lokal gewinnt bei Online-Diensten (S2)", () => {
  it("Datei mit ortssuche: true in bestehende Übung ohne Wahl → bleibt aus", () => {
    const local = exerciseFromFile(mvp3Datei());
    const file = exerciseFromFile(mvp3Datei({ online: { ortssuche: true, strassen: true, at: "2030-05-15T05:00:00.000Z" } }));
    const { ex } = mergeExercise(local, file);
    expect(onlineAllowed(ex, "ortssuche")).toBe(false);
    expect(onlineAllowed(ex, "strassen")).toBe(false);
    expect(ex.onlineDienste).toBeUndefined();
  });
  it("lokal an, Datei aus → bleibt an; lokal aus, Datei an → bleibt aus", () => {
    const an = exerciseFromFile(mvp3Datei({ online: { ortssuche: true } }));
    const aus = exerciseFromFile(mvp3Datei({ online: { ortssuche: false } }));
    expect(onlineAllowed(mergeExercise(an, aus).ex, "ortssuche")).toBe(true);
    expect(onlineAllowed(mergeExercise(aus, an).ex, "ortssuche")).toBe(false);
  });
  it("neue Übung aus der Datei (kein lokaler Stand) übernimmt die Wahl der Datei", () => {
    const file = exerciseFromFile(mvp3Datei({ online: { ortssuche: true } }));
    // Workspace: kein lokaler Stand → Datei wird als neue Übung übernommen (kein mergeExercise)
    expect(onlineAllowed(file, "ortssuche")).toBe(true);
  });
  it("zwei Fenster desselben Geräts (mergeHull): die Wahl im anderen Fenster geht nicht verloren", () => {
    const hier = exerciseFromFile(mvp3Datei());
    const anderes = exerciseFromFile(mvp3Datei({ online: { ortssuche: true, at: "2030-05-15T05:00:00.000Z" } }));
    expect(onlineAllowed(mergeHull(hier, anderes).ex, "ortssuche")).toBe(true);
  });
  it("Meldungen beider Seiten bleiben, Revisionen unverändert", () => {
    const json = mvp3Datei();
    const local = exerciseFromFile(json);
    const file = exerciseFromFile(json);
    file.onlineDienste = { ortssuche: true };
    const { ex } = mergeExercise(local, file);
    expect(ex.events!.length).toBe(local.events!.length);
    for (const e of ex.events!) {
      const l = local.events!.find((x) => x.id === e.id)!;
      expect([e.rev, e.updatedAt, e.tOffset]).toEqual([l.rev, l.updatedAt, undefined]);
    }
  });
});

describe("Zeit-Offset: alte Meldungen in der doppelten Stunde (S23)", () => {
  /** zwei alte Meldungen am 27.10.2030 (ohne tOffset): 02:50 MESZ und 02:10 MEZ, Eingang passend */
  const altePaar = (): LageEvent[] => {
    const base = demoExercise().events![0]!;
    const { tOffset: _o, ...b } = base;
    return [
      { ...b, id: "alt-mesz", t: "2030-10-27T02:50", createdAt: "2030-10-27T00:51:00.000Z", updatedAt: "2030-10-27T00:51:00.000Z" },
      { ...b, id: "alt-mez", t: "2030-10-27T02:10", createdAt: "2030-10-27T01:11:00.000Z", updatedAt: "2030-10-27T01:11:00.000Z" },
    ] as LageEvent[];
  };
  it("Reihenfolge richtig über den Eingang, nichts geschrieben", () => {
    const [mesz, mez] = altePaar();
    const vorher = JSON.stringify([mesz, mez]);
    expect(zeitCmp(mesz!, mez!, Z)).toBeLessThan(0);
    expect(offsetOf(mesz!, Z)).toBe("+02:00");
    expect(offsetOf(mez!, Z)).toBe("+01:00");
    expect(JSON.stringify([mesz, mez])).toBe(vorher);
  });
  it("Zusammenführen alter und neuer Meldungen: alte bleiben ohne tOffset", () => {
    const ex = exerciseFromFile(mvp3Datei());
    const neu = structuredClone(ex);
    const now = new Date("2030-05-15T07:31:00+02:00");
    const d = parseMeldung("H04 2 Fz in AK7 Rtg N", {
      sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now, lastPos: (u, s) => lastPosition(ex.events!, s, u), events: ex.events, ex,
    });
    neu.events = [...neu.events!, eventFromDraft(d, "dev-b", now)];
    const { ex: m } = mergeExercise(ex, neu);
    expect(m.events!.filter((e) => e.tOffset).length).toBe(1);
    expect(m.events!.length).toBe(ex.events!.length + 1);
  });
});
