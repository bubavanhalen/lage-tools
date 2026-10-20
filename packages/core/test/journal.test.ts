import { describe, expect, it } from "vitest";
import {
  areaFromRing,
  demoFeldSheet,
  eventFromDraft,
  journalToCsv,
  lastPosition,
  parseMeldung,
  reviseEvent,
  situationAt,
  type JournalContext,
} from "../src";

// Fiktive Übung im Raum Bern (keine Übungsdaten)
const sheet = demoFeldSheet(); // Zeilen A–X, Spalten 1–30, 500 m, ab 2'592'000 / 1'206'000
const nai3 = areaFromRing("NAI 3", [
  { e: 2600000, n: 1200000 }, { e: 2601000, n: 1200000 }, { e: 2601000, n: 1199000 }, { e: 2600000, n: 1199000 },
]);
const ctx = (over: Partial<JournalContext> = {}): JournalContext => ({
  sheets: [sheet],
  areas: [nai3],
  units: { rot: ["Det 2"], blau: ["H04", "H10"], ul: [] },
  places: [{ name: "Bümpliz", pos: { e: 2595500, n: 1199300 } }],
  side: "blau",
  days: ["2030-05-14", "2030-05-15"],
  day: "2030-05-15",
  now: new Date(2030, 4, 15, 14, 7),
  ...over,
});

describe("Meldung erkennen", () => {
  it("Zeit, Seite, Anzahl, NAI, Richtung", () => {
    const d = parseMeldung("1015 Rot 2 Fz in NAI 3 Rtg N", ctx());
    expect(d.t).toBe("2030-05-15T10:15");
    expect(d.timeFromText).toBe(true);
    expect(d.side).toBe("rot");
    expect(d.aff).toBe("H");
    expect(d.count).toBe(2);
    expect(d.sym).toBe("fz");
    expect(d.nai).toBe("NAI 3");
    expect(d.where).toEqual({ kind: "nai", label: "NAI 3" });
    expect(d.pos).toEqual({ e: 2600500, n: 1199500 });
    expect(d.dir).toBe(0);
    expect(d.text).toBe("2 Fz in NAI 3 Rtg N");
  });

  it("bekanntes Element bestimmt die Seite, Planquadrat mit Unterquadrant", () => {
    const d = parseMeldung("09:55 H04 Beo Stao C12 D", ctx({ side: "rot" }));
    expect(d.side).toBe("blau");
    expect(d.unit).toBe("H04");
    expect(d.sym).toBe("beob_aufkl");
    expect(d.cells).toEqual(["C12 D"]);
    expect(d.where?.kind).toBe("raster");
    // C12: Zeile C (3.), Spalte 12 → Feld 2'597'500–2'598'000 / 1'205'000–1'204'500, Quadrant D = unten links
    expect(d.pos).toEqual({ e: 2597625, n: 1204625 });
  });

  it("Tag T1, Element «Det 2» ohne Ort → letzter Standort", () => {
    const d = parseMeldung("T1 2330 Det 2 rollt", ctx({ lastPos: (u) => (u === "Det 2" ? { e: 2599000, n: 1201000 } : undefined) }));
    expect(d.day).toBe("2030-05-14");
    expect(d.t).toBe("2030-05-14T23:30");
    expect(d.side).toBe("rot");
    expect(d.unit).toBe("Det 2");
    expect(d.where?.kind).toBe("zuletzt");
  });

  it("ohne Zeit: jetzt; neues Element wird erkannt; Ort aus Liste und Ortsname zum Nachschlagen", () => {
    const a = parseMeldung("Det 5 bei Bümpliz", ctx());
    expect(a.t).toBe("2030-05-15T14:07");
    expect(a.timeFromText).toBe(false);
    expect(a.unit).toBe("Det 5");
    expect(a.where).toEqual({ kind: "ort", label: "Bümpliz" });
    const b = parseMeldung("Gr 3 angekommen in Wabern", ctx());
    expect(b.unit).toBe("Gr 3");
    expect(b.pos).toBeUndefined();
    expect(b.placeQuery).toBe("Wabern");
  });

  it("Koordinate hat Vorrang, H10 ist kein Planquadrat", () => {
    const d = parseMeldung("1100 H10 Kontakt mit Gegner 2'598'100 / 1'201'200", ctx());
    expect(d.unit).toBe("H10");
    expect(d.sym).toBe("kontakt");
    expect(d.pos).toEqual({ e: 2598100, n: 1201200 });
    expect(d.cells).toBeUndefined();
  });
});

describe("Lage zum Zeitpunkt", () => {
  const mk = (line: string, c = ctx()) => eventFromDraft(parseMeldung(line, c), "dev-test", new Date(2030, 4, 15, 12));
  const evs = [
    mk("0900 Rot Det 2 2 Fz in NAI 3"),
    mk("0930 Det 2 2 Fz C12"),
    mk("1000 Det 2 halt"),
    mk("0945 Rot 3 Pers bei Bümpliz"),
  ];
  // «1000 Det 2 halt» hat keinen Ort (ohne lastPos im Kontext)
  it("Element bleibt am letzten Standort, Spur wächst", () => {
    const s = situationAt(evs, "2030-05-15T10:05");
    expect(s.units).toHaveLength(1);
    expect(s.units[0]!.track).toHaveLength(2);
    expect(s.units[0]!.event.text).toBe("Det 2 halt");
    expect(s.loose).toHaveLength(1);
    expect(situationAt(evs, "2030-05-15T09:10").units[0]!.track).toHaveLength(1);
    expect(situationAt(evs, "2030-05-15T13:00").loose).toHaveLength(0); // älter als 2 h
  });
  it("Tätigkeit (Kontakt) wird eigenes Zeichen, Element behält sein Zeichen", () => {
    const c = ctx();
    const a = eventFromDraft(parseMeldung("0900 H04 Beo Stao C12", c), "d");
    const k = eventFromDraft(parseMeldung("0910 H04 Kontakt mit Gegner", { ...c, lastPos: () => a.pos }), "d");
    const s = situationAt([a, k], "2030-05-15T09:15");
    expect(s.units[0]!.event.sym).toBe("beob_aufkl");
    expect(s.loose.map((e) => e.sym)).toEqual(["kontakt"]);
  });
  it("letzter Standort und Revision", () => {
    expect(lastPosition(evs, "rot", "Det 2")).toEqual(evs[1]!.pos);
    const r = reviseEvent(evs[0]!, { text: "neu" }, "dev-b");
    expect(r.rev).toBe(2);
    expect(r.device).toBe("dev-b");
  });
  it("CSV mit Übungstag", () => {
    const csv = journalToCsv(evs, ["2030-05-14", "2030-05-15"]);
    expect(csv.split("\r\n")).toHaveLength(5);
    expect(csv).toContain("T2;09:00;Rot;Det 2;");
  });
});
