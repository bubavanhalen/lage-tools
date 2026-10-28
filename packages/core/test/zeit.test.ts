// Zeit, Übungstag und Zeitzone; Zusammenführen von Übungen (nur fiktive Daten, Raum Bern)
process.env.TZ = "Europe/Zurich";
import { describe, expect, it } from "vitest";
import {
  addDays, dayDiff, demoExercise, eventFromDraft, localDay, localIso, mergeExercise, mergeReportText, nearestDay, newExercise,
  parseLocalIso, parseMeldung, reviseEvent, withDay, zoneMismatch, zoneOf, areaFromRing, type Exercise, type JournalContext,
} from "../src";

const ctx = (ex: Exercise, now: Date, extra: Partial<JournalContext> = {}): JournalContext => ({
  sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[ex.days.length - 1]!, now, ...extra,
});

describe("Uhr und Tage (Lokalzeit)", () => {
  it("Tag und Zeit lokal, nicht UTC", () => {
    const d = new Date("2026-10-29T00:30:00+01:00"); // = 28.10. 23:30 UTC
    expect(d.toISOString().slice(0, 10)).toBe("2026-10-28");
    expect(localDay(d)).toBe("2026-10-29");
    expect(localIso(d)).toBe("2026-10-29T00:30");
    expect(localIso(parseLocalIso("2026-10-29T00:30"))).toBe("2026-10-29T00:30");
  });
  it("Tage rechnen über Monatsende und Zeitumstellung", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-10-25", -1)).toBe("2026-10-24"); // Umstellung auf Winterzeit
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30"); // Umstellung auf Sommerzeit
    expect(dayDiff("2026-10-24", "2026-10-26")).toBe(2);
    expect(withDay(["2026-10-29"], "2026-10-28")).toEqual(["2026-10-28", "2026-10-29"]);
    expect(withDay(["2026-10-28"], "2026-10-28")).toEqual(["2026-10-28"]);
  });
  it("Zeitzone mit Offset (Winter/Sommer)", () => {
    expect(zoneOf(new Date("2026-01-15T12:00:00Z"))).toEqual({ zone: "Europe/Zurich", offset: "+01:00" });
    expect(zoneOf(new Date("2026-07-15T12:00:00Z")).offset).toBe("+02:00");
    expect(zoneMismatch({ zone: "Europe/Zurich", offset: "+01:00" })).toBeNull();
    expect(zoneMismatch({ zone: "America/New_York", offset: "-05:00" })).toMatch(/Zeitzone Europe\/Zurich/);
    expect(zoneMismatch(undefined)).toBeNull();
  });
  it("newExercise: erster Tag lokal, Zeitzone gespeichert", () => {
    const ex = newExercise("Test", new Date("2026-10-29T00:30:00+01:00"));
    expect(ex.days).toEqual(["2026-10-29"]);
    expect(ex.tz).toEqual({ zone: "Europe/Zurich", offset: "+01:00" });
    expect(ex.createdAt).toBe("2026-10-28T23:30:00.000Z");
  });
  it("nearestDay: getippte Zeit > 12 h in der Zukunft → Vortag", () => {
    const now = new Date(2026, 9, 29, 0, 15);
    expect(nearestDay("2026-10-29", 23 * 60 + 55, now)).toBe("2026-10-28");
    expect(nearestDay("2026-10-29", 7 * 60, now)).toBe("2026-10-29");
    expect(nearestDay("2026-10-29", 0, now)).toBe("2026-10-29");
  });
});

describe("parseMeldung: Zeit «jetzt» und Tag folgt der Uhr", () => {
  const ex = newExercise("Bern", new Date(2026, 9, 28, 9, 0)); // T1 = 28.10.
  it("ohne Zeit: jetzt (Zeit aus ctx.now)", () => {
    const d = parseMeldung("H02 Beo Stao bezogen", ctx(ex, new Date(2026, 9, 28, 10, 40)));
    expect(d.t).toBe("2026-10-28T10:40");
    expect(d.timeFromText).toBe(false);
  });
  it("nach Mitternacht: Tag aus der Uhr (T2 noch nicht angelegt)", () => {
    const now = new Date(2026, 9, 29, 0, 15);
    const d = parseMeldung("H01 2 Pers AE8 Rtg S", ctx(ex, now, { dayFromClock: true }));
    expect(d.t).toBe("2026-10-29T00:15");
    expect(d.day).toBe("2026-10-29");
    // ohne dayFromClock (Tag von Hand gewählt): bleibt T1
    expect(parseMeldung("H01 2 Pers AE8", ctx(ex, now)).t).toBe("2026-10-28T00:15");
  });
  it("Nachtrag «2355» um 00:15 → Vortag 23:55", () => {
    const d = parseMeldung("2355 H02 1 Fz AF7", ctx(ex, new Date(2026, 9, 29, 0, 15), { dayFromClock: true }));
    expect(d.t).toBe("2026-10-28T23:55");
    expect(d.timeFromText).toBe(true);
  });
  it("getippte Zeit am selben Tag bleibt heute (auch leicht in der Zukunft)", () => {
    const now = new Date(2026, 9, 29, 10, 0);
    expect(parseMeldung("1015 H04 2 Fz", ctx(ex, now, { dayFromClock: true })).t).toBe("2026-10-29T10:15");
    expect(parseMeldung("0730 H04 2 Fz", ctx(ex, now, { dayFromClock: true })).t).toBe("2026-10-29T07:30");
  });
  it("T2 in der ersten Nacht: nächster Tag, auch wenn noch nicht angelegt", () => {
    const d = parseMeldung("T2 0315 H01 Beo Stao bezogen", ctx(ex, new Date(2026, 9, 28, 23, 0)));
    expect(d.t).toBe("2026-10-29T03:15");
    expect(d.problems ?? []).toEqual([]);
  });
  it("T-Angabe, die es nicht gibt → Problem (nie still falsch)", () => {
    const d = parseMeldung("T5 0315 H01 Beo Stao bezogen", ctx(ex, new Date(2026, 9, 28, 23, 0)));
    expect(d.problems?.[0]).toMatchObject({ kind: "zeit" });
    expect(d.problems?.[0]?.text).toMatch(/T5/);
  });
  it("ausdrückliches T1 schlägt die Uhr", () => {
    const d = parseMeldung("T1 2355 H02 1 Fz", ctx(ex, new Date(2026, 9, 29, 0, 15), { dayFromClock: true }));
    expect(d.t).toBe("2026-10-28T23:55");
  });
});

describe("Eingang getrennt von Ereigniszeit", () => {
  it("eventFromDraft setzt tReported (lokal) und createdAt (UTC)", () => {
    const ex = newExercise("Bern", new Date(2026, 9, 28, 9, 0));
    const now = new Date(2026, 9, 28, 10, 40, 12);
    const e = eventFromDraft(parseMeldung("1015 H04 2 Fz in NAI 3", ctx(ex, now)), "dev-test", now);
    expect(e.t).toBe("2026-10-28T10:15");
    expect(e.tReported).toBe("2026-10-28T10:40");
    expect(e.createdAt).toBe(now.toISOString());
    // Korrektur ändert den Eingang nicht
    const r = reviseEvent(e, { t: "2026-10-28T10:16" }, "dev-test", new Date(2026, 9, 28, 11, 0));
    expect(r.tReported).toBe("2026-10-28T10:40");
    expect(r.createdAt).toBe(e.createdAt);
  });
});

describe("mergeExercise: Öffnen = Zusammenführen", () => {
  const base = () => {
    const ex = demoExercise();
    ex.events = ex.events!.slice(0, 4);
    return ex;
  };
  it("neu · aktualisiert · unverändert, nichts geht verloren", () => {
    const local = base();
    const file: Exercise = structuredClone(local);
    // Datei: 1 Meldung geändert, 2 neu; lokal: 1 neu (nur hier)
    file.events![1] = reviseEvent(file.events![1]!, { text: "korrigiert" }, "dev-b", new Date(2030, 4, 15, 9, 0));
    const n1 = structuredClone(file.events![0]!); n1.id = "zzz-neu-1"; n1.device = "dev-b";
    const n2 = structuredClone(file.events![0]!); n2.id = "zzz-neu-2"; n2.device = "dev-b";
    file.events!.push(n1, n2);
    const mine = structuredClone(local.events![0]!); mine.id = "zzz-hier"; local.events!.push(mine);
    const { ex, report } = mergeExercise(local, file);
    expect(report).toMatchObject({ neu: 2, aktualisiert: 1, unveraendert: 3, nurHier: 1 });
    expect(ex.events!.length).toBe(7);
    expect(ex.events!.find((e) => e.id === local.events![1]!.id)!.text).toBe("korrigiert");
    expect(mergeReportText(report)).toBe("2 neu · 1 aktualisiert · 3 unverändert · 1 nur hier");
  });
  it("ältere Datei überschreibt nichts (lokal neuere Revision bleibt)", () => {
    const old = base();
    const local: Exercise = structuredClone(old);
    local.events![0] = reviseEvent(local.events![0]!, { deleted: true }, "dev-a", new Date(2030, 4, 15, 9, 0));
    const { ex, report } = mergeExercise(local, old);
    expect(report).toMatchObject({ neu: 0, aktualisiert: 0, unveraendert: 4 });
    expect(ex.events![0]!.deleted).toBe(true);
  });
  it("Flächen, Anhänge, Entscheide, Tage, Elemente zusammen", () => {
    const local = base();
    const file: Exercise = structuredClone(local);
    file.areas.push(areaFromRing("NAI 4", [{ e: 2600000, n: 1199000 }, { e: 2600500, n: 1199000 }, { e: 2600500, n: 1199500 }], "nai"));
    file.areas[0] = { ...file.areas[0]!, trupp: "H09" }; // gleiche ID, anders → lokal bleibt
    file.attachments = [{ id: "a1", kind: "audio", mime: "audio/webm", createdAt: "2030-05-15T06:00:00Z", text: "Transkript" }];
    local.attachments = [{ id: "a1", kind: "audio", mime: "audio/webm", createdAt: "2030-05-15T06:00:00Z" }];
    file.hintDecisions = { h1: { state: "verworfen", at: "2030-05-15T07:00:00Z" } };
    local.hintDecisions = { h1: { state: "bestaetigt", at: "2030-05-15T06:00:00Z" }, h2: { state: "bestaetigt", at: "2030-05-15T06:00:00Z" } };
    file.days = [...file.days, "2030-05-16"];
    file.units.blau = [...file.units.blau, "H06"];
    file.name = "anderer Name";
    const { ex, report } = mergeExercise(local, file);
    expect(ex.areas.length).toBe(local.areas.length + 1);
    expect(ex.areas[0]!.trupp).toBe(local.areas[0]!.trupp);
    expect(ex.attachments![0]!.text).toBe("Transkript");
    expect(ex.hintDecisions!.h1!.state).toBe("verworfen");
    expect(ex.hintDecisions!.h2!.state).toBe("bestaetigt");
    expect(ex.days).toContain("2030-05-16");
    expect(ex.units.blau).toContain("H06");
    expect(ex.name).toBe(local.name);
    expect(report).toMatchObject({ areas: 1, decisions: 1, abweichend: 1 });
    expect(mergeReportText(report)).toContain("+ 1 Fläche, 1 Entscheid");
  });
});
