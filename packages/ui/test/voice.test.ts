import { describe, expect, it } from "vitest";
import { cleanWhisper, WHISPER_MODELS } from "../src/stt/whisper";
import { toMono16k, fmtDuration } from "../src/audio";
import { getSpeechPrefs, setSpeechPrefs } from "../src/stt";

describe("Whisper-Ausgabe säubern", () => {
  it.each([
    ["Hotel 04 2 Fahrzeuge, Alpha Golf 1 3 Richtung Nord.", "Hotel 04 2 Fahrzeuge, Alpha Golf 1 3 Richtung Nord."],
    ["Untertitel im Auftrag des ZDF, 2021", ""],
    ["Untertitelung des ZDF für funk, 2017", ""],
    ["Untertitel der Amara.org-Community", ""],
    ["Vielen Dank fürs Zuschauen!", ""],
    ["[Musik] Hotel 02 Checkpoint bezogen", "Hotel 02 Checkpoint bezogen"],
    ["*Rauschen* Hotel 05 keine Feindsicht.", "Hotel 05 keine Feindsicht."],
    ["  Hotel   01   kommen ", "Hotel 01 kommen"],
  ])("%s", (inp, out) => expect(cleanWhisper(inp)).toBe(out));
});

describe("Ton aufbereiten", () => {
  it("mittelt Kanäle und rechnet 48 kHz → 16 kHz um", () => {
    const n = 4800;
    const l = new Float32Array(n).fill(0.5), r = new Float32Array(n).fill(-0.1);
    const out = toMono16k([l, r], 48000);
    expect(out.length).toBe(1600);
    expect(out[0]).toBeCloseTo(0.2, 5);
    expect(out[1599]).toBeCloseTo(0.2, 5);
  });
  it("lässt 16 kHz Mono unverändert", () => {
    const a = Float32Array.from([0, 0.25, -0.5, 1]);
    expect(Array.from(toMono16k([a], 16000))).toEqual(Array.from(a));
  });
  it("Dauer anzeigen", () => {
    expect(fmtDuration(0)).toBe("0:00");
    expect(fmtDuration(7.4)).toBe("0:07");
    expect(fmtDuration(83)).toBe("1:23");
  });
});

describe("Einstellungen Spracherkennung", () => {
  it("Standard: offline, Modell «small», Browser nicht erlaubt", () => {
    const p = getSpeechPrefs();
    expect(p.mode).toBe("offline");
    expect(p.model).toBe("small");
    expect(p.browserOk).toBe(false);
    expect(WHISPER_MODELS.small.mb).toBeGreaterThan(WHISPER_MODELS.base.mb);
  });
  it("Browser-Erkennung nur mit Zustimmung", () => {
    expect(setSpeechPrefs({ mode: "browser" }).mode).toBe("offline");
    expect(setSpeechPrefs({ mode: "browser", browserOk: true }).mode).toBe("browser");
    expect(setSpeechPrefs({ browserOk: false }).mode).toBe("offline");
  });
});

describe("Wiederholungsschleifen entfernen", () => {
  it.each([
    ["0820 Hotel 03 Ein Schützenpanzer Ende 0820 Hotel 03 Ein Schützenpanzer Ende 0820 Hotel 03 Ein Schützenpanzer Ende 0820 Hotel", "0820 Hotel 03 Ein Schützenpanzer Ende"],
    ["0815 Hotel 01 Checkpoint bezogen Ende 0820 Hotel 03 Spz in NAI 3 Ende", "0815 Hotel 01 Checkpoint bezogen Ende 0820 Hotel 03 Spz in NAI 3 Ende"],
    ["Hotel null null vier", "Hotel null null vier"],
    ["a b c d a b c d.", "a b c d"],
  ])("%s", (inp, out) => expect(cleanWhisper(inp)).toBe(out));
});
