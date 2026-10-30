/**
 * Zeit mit UTC-Offset (Spez. MVP 3.5, Kap. 3.3 «Zeit-Kern», 3.6, 5.2, 8.6) – Phase-0-Funktionen in clock.ts.
 * Zone immer ausdrücklich «Europe/Zurich» (CI läuft in UTC). Nur fiktive Zeiten (Umstellungen 2030: 31.03. und 27.10.).
 * Paket C erweitert diese Datei (Lesart in der Erkennung, Zukunft), Paket E nutzt die Funktionen in der Oberfläche.
 */
import { describe, expect, it } from "vitest";
import {
  addMinuten, compareEvents, eventFromDraft, jetztLagezeit, lesart, mitOffset, offsetOf, offsetsAt, parseLocalIso, umstellTage, zeitBis,
  zeitCmp, zeitMax, zeitMs, zeitTeile, zeitText, type Draft, type ZeitEreignis,
} from "../src";

const Z = "Europe/Zurich";
/** 02:50 Sommerzeit (MESZ) am Tag der Rückstellung 27.10.2030 */
const e0250MESZ: ZeitEreignis = { t: "2030-10-27T02:50", tOffset: "+02:00" };
const e0210MEZ: ZeitEreignis = { t: "2030-10-27T02:10", tOffset: "+01:00" };

describe("Lagezeit zerlegen und bauen", () => {
  it("zeitTeile / mitOffset", () => {
    expect(zeitTeile("2030-10-27T02:10")).toEqual({ t: "2030-10-27T02:10" });
    expect(zeitTeile("2030-10-27T02:10+01:00")).toEqual({ t: "2030-10-27T02:10", off: "+01:00" });
    expect(zeitTeile("2030-10-27T02:10:00+0100")).toEqual({ t: "2030-10-27T02:10", off: "+01:00" });
    expect(zeitTeile("2030-10-27T01:10Z")).toEqual({ t: "2030-10-27T01:10", off: "+00:00" });
    expect(mitOffset("2030-10-27T02:10", "+01:00")).toBe("2030-10-27T02:10+01:00");
    expect(mitOffset("2030-10-27T02:10:00", "x")).toBe("2030-10-27T02:10");
  });
  it("Date.parse und parseLocalIso vertragen die Endung (Anzeige)", () => {
    expect(Date.parse("2030-10-27T02:10+01:00")).toBe(Date.parse("2030-10-27T01:10:00Z"));
    expect(parseLocalIso("2030-10-27T02:10+01:00").getHours()).toBe(2);
  });
  it("jetztLagezeit trägt den Offset des Geräts", () => {
    expect(jetztLagezeit(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });
});

describe("offsetsAt / umstellTage (Europe/Zurich)", () => {
  it("doppelte Stunde: zwei Offsets, früher Zeitpunkt zuerst", () => {
    expect(offsetsAt("2030-10-27T02:30", Z)).toEqual(["+02:00", "+01:00"]);
    expect(offsetsAt("2030-10-27T01:59", Z)).toEqual(["+02:00"]);
    expect(offsetsAt("2030-10-27T03:00", Z)).toEqual(["+01:00"]);
  });
  it("fehlende Stunde: keiner", () => {
    expect(offsetsAt("2030-03-31T02:30", Z)).toEqual([]);
    expect(offsetsAt("2030-03-31T03:00", Z)).toEqual(["+02:00"]);
    expect(offsetsAt("2030-03-31T01:59", Z)).toEqual(["+01:00"]);
  });
  it("gewöhnliche Tage, andere Zonen", () => {
    expect(offsetsAt("2030-05-15T07:30", Z)).toEqual(["+02:00"]);
    expect(offsetsAt("2030-01-15T07:30", Z)).toEqual(["+01:00"]);
    expect(offsetsAt("2030-10-27T02:30", "UTC")).toEqual(["+00:00"]);
    expect(offsetsAt("kein Datum", Z)).toEqual([]);
  });
  it("Umstellungstage 2030", () => {
    expect(umstellTage(Z, 2030)).toEqual(["2030-03-31", "2030-10-27"]);
    expect(umstellTage("UTC", 2030)).toEqual([]);
  });
});

describe("offsetOf: Offset ableiten, nie schreiben", () => {
  it("eigener Offset gilt", () => {
    expect(offsetOf({ t: "2030-10-27T02:50", tOffset: "+01:00" }, Z)).toBe("+01:00");
  });
  it("eindeutig: Sommer/Winter", () => {
    expect(offsetOf({ t: "2030-05-15T07:30" }, Z)).toBe("+02:00");
    expect(offsetOf({ t: "2030-12-01T07:30" }, Z)).toBe("+01:00");
  });
  it("doppelte Stunde: passend zum Eingang (createdAt), ohne Eingang Sommerzeit", () => {
    const e = { t: "2030-10-27T02:50" };
    expect(offsetOf({ ...e, createdAt: "2030-10-27T00:52:00.000Z" }, Z)).toBe("+02:00");
    expect(offsetOf({ ...e, createdAt: "2030-10-27T01:52:00.000Z" }, Z)).toBe("+01:00");
    // Nachtrag später: der nähere Zeitpunkt vor dem Eingang
    expect(offsetOf({ ...e, createdAt: "2030-10-27T03:30:00.000Z" }, Z)).toBe("+01:00");
    expect(offsetOf(e, Z)).toBe("+02:00");
  });
  it("Zeit gibt es nicht: Offset vor der Umstellung", () => {
    expect(offsetOf({ t: "2030-03-31T02:30" }, Z)).toBe("+01:00");
  });
  it("schreibt nichts", () => {
    const e = { t: "2030-10-27T02:50", createdAt: "2030-10-27T00:52:00.000Z" };
    const vorher = JSON.stringify(e);
    offsetOf(e, Z); zeitMs(e, Z); zeitCmp(e, e0210MEZ, Z);
    expect(JSON.stringify(e)).toBe(vorher);
  });
});

describe("zeitCmp / zeitBis / zeitMax / zeitMs", () => {
  it("02:50 MESZ liegt vor 02:10 MEZ", () => {
    expect(zeitCmp(e0250MESZ, e0210MEZ, Z)).toBeLessThan(0);
    expect(zeitCmp(e0210MEZ, e0250MESZ, Z)).toBeGreaterThan(0);
    expect(zeitBis(e0250MESZ, "2030-10-27T02:10+01:00", Z)).toBe(true);
    expect(zeitBis("2030-10-27T02:10+01:00", e0250MESZ, Z)).toBe(false);
    expect(zeitMax("2030-10-27T02:50+02:00", "2030-10-27T02:10+01:00", Z)).toBe("2030-10-27T02:10+01:00");
  });
  it("gleiche Zeit = 0, zeitBis gleich wahr", () => {
    expect(zeitCmp("2030-05-15T07:30", { t: "2030-05-15T07:30", tOffset: "+02:00" }, Z)).toBe(0);
    expect(zeitBis("2030-05-15T07:30", "2030-05-15T07:30+02:00", Z)).toBe(true);
  });
  it("ohne Offset in der doppelten Stunde: über den Eingang abgeleitet", () => {
    const alt = { t: "2030-10-27T02:50", createdAt: "2030-10-27T00:52:00.000Z" }; // MESZ
    const neu = { t: "2030-10-27T02:20", createdAt: "2030-10-27T01:21:00.000Z" }; // MEZ
    expect(zeitCmp(alt, neu, Z)).toBeLessThan(0);
  });
  it("zeitMs", () => {
    expect(zeitMs(e0250MESZ, Z)).toBe(Date.parse("2030-10-27T00:50:00Z"));
    expect(zeitMs("2030-10-27T02:10+01:00", Z)).toBe(Date.parse("2030-10-27T01:10:00Z"));
    expect(zeitMs("2030-05-15T07:30", Z)).toBe(Date.parse("2030-05-15T05:30:00Z"));
  });
  it("Schnellweg = Millisekunden für 10 000 Zufallspaare (auch an Umstellungstagen)", () => {
    // fester Zufall (reproduzierbar)
    let s = 4711;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const tage = ["2030-03-30", "2030-03-31", "2030-04-01", "2030-05-15", "2030-10-26", "2030-10-27", "2030-10-28", "2030-12-31"];
    const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: Z, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const wand = (ms: number) => fmt.format(ms).replace(" ", "T");
    const off = (ms: number) => { const w = Date.parse(wand(ms) + ":00Z"); const m = Math.round((w - Math.floor(ms / 60000) * 60000) / 60000); return `+${String(m / 60).padStart(2, "0")}:00`; };
    const zufall = (): ZeitEreignis | string => {
      const tag = tage[Math.floor(rnd() * tage.length)]!;
      const ms = Date.parse(`${tag}T00:00:00Z`) - 2 * 3600000 + Math.floor(rnd() * 26 * 60) * 60000;
      const t = wand(ms);
      const r = rnd();
      if (r < 0.3) return { t, tOffset: off(ms), createdAt: new Date(ms + Math.floor(rnd() * 5) * 60000).toISOString() };
      if (r < 0.55) return { t, createdAt: new Date(ms + Math.floor(rnd() * 5) * 60000).toISOString() };
      if (r < 0.8) return t + off(ms);
      // ohne Offset nur ausserhalb der doppelten Stunde eindeutig
      return offsetsAt(t, Z).length === 1 ? t : t + off(ms);
    };
    const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0);
    let geprueft = 0;
    for (let i = 0; i < 10000; i++) {
      const a = zufall(), b = zufall();
      const ms = zeitMs(a, Z) - zeitMs(b, Z);
      expect(sign(zeitCmp(a, b, Z)), `${JSON.stringify(a)} ${JSON.stringify(b)}`).toBe(sign(ms));
      geprueft++;
    }
    expect(geprueft).toBe(10000);
  });
  it("compareEvents: Verhalten bei gleicher Zeit unverändert (Eingang, dann ID)", () => {
    const a = { id: "a", t: "2030-05-15T07:30", createdAt: "2030-05-15T05:31:00Z" };
    const b = { id: "b", t: "2030-05-15T07:30", createdAt: "2030-05-15T05:30:00Z" };
    expect(compareEvents(a, b)).toBeGreaterThan(0);
    expect(compareEvents({ ...a, createdAt: b.createdAt }, b)).toBeLessThan(0);
    expect(compareEvents({ id: "x", ...e0250MESZ }, { id: "y", ...e0210MEZ })).toBeLessThan(0);
  });
});

describe("addMinuten / zeitText", () => {
  it("über die Umstellung", () => {
    expect(addMinuten("2030-10-27T02:50+02:00", 30, Z)).toBe("2030-10-27T02:20+01:00");
    expect(addMinuten("2030-03-31T01:50", 20, Z)).toBe("2030-03-31T03:10");
    expect(addMinuten("2030-05-15T23:50", 20, Z)).toBe("2030-05-16T00:10");
  });
  it("Anzeige in der doppelten Stunde mit MESZ/MEZ, sonst nur die Uhrzeit", () => {
    expect(zeitText(e0250MESZ, { zone: Z })).toBe("02:50 MESZ");
    expect(zeitText(e0210MEZ, { zone: Z })).toBe("02:10 MEZ");
    expect(zeitText("2030-10-27T02:50+01:00", { zone: Z })).toBe("02:50 MEZ");
    expect(zeitText({ t: "2030-10-27T03:10", tOffset: "+01:00" }, { zone: Z })).toBe("03:10");
    expect(zeitText("2030-05-15T07:31", { zone: Z })).toBe("07:31");
  });
});

describe("lesart (Erkennung, Spez. Satz #53/#54)", () => {
  it("#53 «0255» um 02:10 MEZ am 27.10. → 02:55 MESZ (vor 75 min)", () => {
    const l = lesart("2030-10-27", 2 * 60 + 55, new Date("2030-10-27T02:10:00+01:00"), Z);
    expect(l).toMatchObject({ t: "2030-10-27T02:55", off: "+02:00", mehrdeutig: true, fehlt: false });
  });
  it("doppelte Stunde, beide möglich → die spätere", () => {
    const l = lesart("2030-10-27", 2 * 60 + 5, new Date("2030-10-27T02:20:00+01:00"), Z);
    expect(l.off).toBe("+01:00");
  });
  it("#54 «0230» am 31.03. → gibt es nicht, Vorschlag 03:30", () => {
    const l = lesart("2030-03-31", 2 * 60 + 30, new Date("2030-03-31T03:40:00+02:00"), Z);
    expect(l).toMatchObject({ off: null, fehlt: true, vorschlag: "03:30" });
  });
  it("gewöhnliche Zeit eindeutig", () => {
    expect(lesart("2030-05-15", 7 * 60 + 35, new Date("2030-05-15T07:31:00+02:00"), Z)).toMatchObject({ off: "+02:00", mehrdeutig: false, fehlt: false });
  });
});

describe("eventFromDraft: LageEvent.t bleibt 16 Zeichen, tOffset aus dem Entwurf", () => {
  const draft = (t: string, tOffset?: string): Draft => ({
    minutes: 0, day: t.slice(0, 10), t, timeFromText: true, kind: "feind", kindFrom: "inhalt", side: "rot", melder: "H01", unit: "", sym: "inf_trp",
    aff: "H", sidc: "", status: "present", text: "H01 1 Pers AC7", art: "meldung", artFrom: "standard", ...(tOffset ? { tOffset } : {}),
  });
  it("Lagezeit mit Endung → t ohne, Offset aus der Endung", () => {
    const e = eventFromDraft(draft("2030-10-27T02:55+02:00"), "dev-test", new Date("2030-10-27T02:10:00+01:00"));
    expect(e.t).toBe("2030-10-27T02:55");
    expect(e.t.length).toBe(16);
    expect(e.tOffset).toBe("+02:00");
  });
  it("Draft.tOffset (Lesart) gilt vor offsetFor", () => {
    const e = eventFromDraft(draft("2030-10-27T02:55", "+02:00"), "dev-test", new Date("2030-10-27T02:10:00+01:00"));
    expect(e.tOffset).toBe("+02:00");
  });
});
