// Live/Rückblick-Automat (Spez. MVP 1, Kap. 3.5) mit Fake-Timern – fiktive Zeiten (Beispiel Bern, T2 = 2030-05-15)
process.env.TZ = "Europe/Zurich";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LageZeitCtl, GO_LIVE_TEXT, isLiveKey, lastReportOf, liveIso } from "../src/time/useLageZeit";
import type { GoLiveGrund } from "../src/shell/contracts";

const LIVE_T = "2030-05-15T07:25";

function make(o: { tLive?: string } = {}) {
  const calls = { change: 0, live: [] as Array<[GoLiveGrund, boolean]> };
  const ctl = new LageZeitCtl({
    tLive: () => o.tLive ?? LIVE_T,
    onChange: () => { calls.change++; },
    onGoLive: (g, war) => calls.live.push([g, war]),
  });
  return { ctl, calls };
}

describe("LageZeitCtl", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2030-05-15T07:25:10+02:00")); });
  afterEach(() => vi.useRealTimers());

  it("Start: LIVE, alles, kein Timer (R5)", () => {
    const { ctl } = make();
    expect(ctl.zeit).toEqual({ kind: "live" });
    expect(ctl.tNow()).toBe(LIVE_T);
    expect(ctl.from()).toBeNull();
    expect(ctl.remaining).toBeNull();
  });

  it("Zurückblicken → Rückblick, 120 s ohne Bedienung → LIVE (R1), Vorwarnung 20 s (R2)", () => {
    const { ctl, calls } = make();
    ctl.lookBack("2030-05-15T05:30");
    expect(ctl.zeit).toEqual({ kind: "rueckblick", t: "2030-05-15T05:30", playing: false });
    expect(ctl.tNow()).toBe("2030-05-15T05:30");
    expect(ctl.remaining).toBe(120);
    vi.advanceTimersByTime(99_000);
    expect(ctl.zeit.kind).toBe("rueckblick");
    expect(ctl.remaining).toBe(30); // grob (10-s-Schritte) bis 20 s vor Ablauf
    vi.advanceTimersByTime(1_000);
    expect(ctl.remaining).toBe(20);
    vi.advanceTimersByTime(1_000);
    expect(ctl.remaining).toBe(19);
    vi.advanceTimersByTime(19_000);
    expect(ctl.zeit.kind).toBe("live");
    expect(ctl.remaining).toBeNull();
    expect(calls.live).toEqual([["zeitablauf", true]]);
  });

  it("jede Bedienung setzt den Timer zurück", () => {
    const { ctl } = make();
    ctl.lookBack("2030-05-15T05:30");
    vi.advanceTimersByTime(110_000);
    expect(ctl.remaining).toBe(10);
    ctl.touch();
    expect(ctl.remaining).toBe(120);
    vi.advanceTimersByTime(110_000);
    expect(ctl.zeit.kind).toBe("rueckblick");
    vi.advanceTimersByTime(10_000);
    expect(ctl.zeit.kind).toBe("live");
  });

  it("Bedienung zeichnet oberhalb der Vorwarnung höchstens alle 10 s neu", () => {
    const { ctl, calls } = make();
    ctl.lookBack("2030-05-15T05:30");
    const n = calls.change;
    for (let i = 0; i < 20; i++) { vi.advanceTimersByTime(200); ctl.touch(); }
    expect(calls.change - n).toBe(0);
  });

  it("Eintragen → sofort LIVE (R3), Taste → LIVE", () => {
    const { ctl, calls } = make();
    ctl.lookBack("2030-05-15T06:00");
    ctl.goLive("eintragen");
    expect(ctl.zeit.kind).toBe("live");
    ctl.goLive("eintragen"); // schon LIVE: keine Meldung
    expect(calls.live).toEqual([["eintragen", true], ["eintragen", false]]);
    expect(GO_LIVE_TEXT.eintragen).toBe("Eingetragen – Ansicht wieder LIVE");
  });

  it("Zeit ≥ LIVE → LIVE (R6)", () => {
    const { ctl } = make();
    ctl.lookBack("2030-05-15T06:00");
    ctl.lookBack("2030-05-15T07:25");
    expect(ctl.zeit.kind).toBe("live");
    ctl.lookBack("2030-05-15T09:00");
    expect(ctl.zeit.kind).toBe("live");
    ctl.lookBack("unsinn");
    expect(ctl.zeit.kind).toBe("live");
  });

  it("Abspielen und suspend lassen den Timer ruhen (R4)", () => {
    const { ctl } = make();
    ctl.lookBack("2030-05-15T05:00");
    ctl.setPlaying(true);
    expect(ctl.remaining).toBeNull();
    ctl.lookBack("2030-05-15T05:10"); // Abspielen schiebt die Zeit, bleibt am Spielen
    expect(ctl.zeit).toEqual({ kind: "rueckblick", t: "2030-05-15T05:10", playing: true });
    vi.advanceTimersByTime(600_000);
    expect(ctl.zeit.kind).toBe("rueckblick");
    ctl.setPlaying(false);
    expect(ctl.remaining).toBe(120);
    ctl.suspend("praesentation", true);
    vi.advanceTimersByTime(600_000);
    expect(ctl.zeit.kind).toBe("rueckblick");
    ctl.suspend("menu", true);
    ctl.suspend("praesentation", false);
    vi.advanceTimersByTime(600_000);
    expect(ctl.zeit.kind).toBe("rueckblick");
    ctl.suspend("menu", false);
    expect(ctl.remaining).toBe(120);
    vi.advanceTimersByTime(120_000);
    expect(ctl.zeit.kind).toBe("live");
  });

  it("verborgene Seite: beim Zurückkehren nach > 120 s sofort LIVE (R4)", () => {
    const { ctl } = make();
    ctl.lookBack("2030-05-15T05:00");
    // Browser drosselt Timer im Hintergrund: Uhr springt, ohne dass das Intervall lief
    vi.setSystemTime(Date.now() + 300_000);
    ctl.visible();
    expect(ctl.zeit.kind).toBe("live");
  });

  it("Zeige letzte rechnet ab Lagezeit (R8), fester Anfang (Experte) schliesst es aus", () => {
    const { ctl } = make();
    ctl.setShowLast(120);
    expect(ctl.from()).toBe("2030-05-15T05:25");
    ctl.lookBack("2030-05-15T06:00");
    expect(ctl.from()).toBe("2030-05-15T04:00");
    ctl.setAb("2030-05-15T05:30");
    expect(ctl.showLast).toBeNull();
    expect(ctl.from()).toBe("2030-05-15T05:30");
    ctl.lookBack("2030-05-15T05:00"); // Anfang nach der Lagezeit → alles
    expect(ctl.from()).toBeNull();
    ctl.setShowLast(30);
    expect(ctl.ab).toBeNull();
  });

  it("Übungswechsel → LIVE und alles (R5)", () => {
    const { ctl } = make();
    ctl.setShowLast(60);
    ctl.lookBack("2030-05-15T06:00");
    ctl.reset();
    expect(ctl.zeit.kind).toBe("live");
    expect(ctl.showLast).toBeNull();
    expect(ctl.remaining).toBeNull();
    vi.advanceTimersByTime(200_000);
    expect(ctl.zeit.kind).toBe("live");
  });
});

describe("LIVE-Zeit und Taste", () => {
  it("jetzt, oder letzte Meldung, wenn die Übung vorbei ist", () => {
    const now = Date.parse("2030-05-15T07:25:30+02:00");
    expect(liveIso(null, now)).toBe("2030-05-15T07:25");
    expect(liveIso("2030-05-15T07:20", now)).toBe("2030-05-15T07:25");
    expect(liveIso("2030-05-15T07:40", now)).toBe("2030-05-15T07:40"); // Meldung mit Zeit in der Zukunft
    expect(liveIso("2030-05-14T06:50", now)).toBe("2030-05-14T06:50"); // > 12 h her
  });
  it("letzte Meldung ohne gelöschte", () => {
    expect(lastReportOf([{ t: "2030-05-15T07:00" }, { t: "2030-05-15T07:30", deleted: true }, { t: "2030-05-15T06:00" }] as never)).toBe("2030-05-15T07:00");
    expect(lastReportOf([])).toBeNull();
  });
  it("L nur ausserhalb von Eingabefeldern, ohne Ctrl", () => {
    const ev = (key: string, tagName = "DIV", ctrlKey = false) => ({ key, ctrlKey, altKey: false, metaKey: false, target: { tagName, isContentEditable: false } }) as unknown as KeyboardEvent;
    expect(isLiveKey(ev("l"))).toBe(true);
    expect(isLiveKey(ev("L"))).toBe(true);
    expect(isLiveKey(ev("l", "INPUT"))).toBe(false);
    expect(isLiveKey(ev("l", "TEXTAREA"))).toBe(false);
    expect(isLiveKey(ev("l", "DIV", true))).toBe(false);
    expect(isLiveKey(ev("k"))).toBe(false);
  });
});
