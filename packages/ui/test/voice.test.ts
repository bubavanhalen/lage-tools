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

import { fixHearing } from "../src/stt/hearing";
import { normalizeSpoken } from "@lage/core";
describe("Hörfehler der Spracherkennung (Funk)", () => {
  it.each([
    ["Hote 04, 2 Fahrzeuge, Alpha Golf 1/3 Richtung Nord.", "Hotel 04, 2 Fahrzeuge, Alpha Golf 1 3 Richtung Nord."],
    ["0815 Hote 01 Checkpoint Bezogen in Alpha Tilo 7 Schalli Ende", "0815 Hotel 01 Checkpoint Bezogen in Alpha Kilo 7 Charlie Ende"],
    ["Hodel 05, Beobachtungsposten bezogen, Alpha Fox droht 1, 2 Delta", "Hotel 05, Beobachtungsposten bezogen, Alpha Foxtrot 1, 2 Delta"],
    ["Hote 05, Alper Fox Trot 1-2 Delta, keine Feindsicht.", "Hotel 05, Alpha Foxtrot 1 2 Delta, keine Feindsicht."],
    ["Schützenpanzer in November Alpha Indian 3", "Schützenpanzer in November Alpha India 3"],
    ["bei Pravoscha-Li-05", "bei Pravoscha-Li-05"],
    ["Hotel 03 Ein Schützenpanzer", "Hotel 03 Ein Schützenpanzer"],
    ["Wir haben 1/3 der Strecke", "Wir haben 1/3 der Strecke"],
    ["Das Hotel ist zu", "Das Hotel ist zu"],
    ["Planquadrat Alpha Delta 9 Richtung Nordhorst. Kommen.", "Planquadrat Alpha Delta 9 Richtung Nordost. Kommen."],
    ["Richtung North-Host", "Richtung Nordost"],
    ["Richtung Südhorst", "Richtung Südost"],
  ])("%s", (inp, out) => expect(fixHearing(inp)).toBe(out));

  it("Whisper-Ausgabe → Kurzmeldung", () => {
    expect(normalizeSpoken(fixHearing("Hote 04, 2 Fahrzeuge, Alpha Golf 1/3 Richtung Nord.")).text).toMatch(/^H04 2 Fz AG13 Rtg N$/);
  });
});
