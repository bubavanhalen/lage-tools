/**
 * Art-Regeln MVP 3.5 (Spez. MVP 3.5, Kap. 3.4 D1.1–D1.9): Auftrag und Rückfrage von oben, Ausgang nach oben, Quittung,
 * Abschluss, Funkverbindung verloren, Empfänger bei gewählter Art. Nur fiktive Sätze (Beispiel Bern, H01–H05).
 */
process.env.TZ = "Europe/Zurich";
import { describe, expect, it } from "vitest";
import { artText, demoExercise, entryState, lastPosition, parseMeldung, readArt, type EntryArt, type Exercise, type LageEvent } from "../src";

const blau = ["H01", "H02", "H03", "H04", "H05"];
const lies = (t: string, o: { vorgabe?: EntryArt; blau?: string[] } = {}) => readArt(t, { blau: o.blau ?? blau, ...(o.vorgabe ? { vorgabe: o.vorgabe } : {}) });

describe("D1.1 Auftrag von oben (stark)", () => {
  it("«Kp Kdt: Auftrag an H03 …», «Bat: Befehl an H02 …», «Bat befiehlt: H02 …»", () => {
    expect(lies("Kp Kdt: Auftrag an H03 NAI 2 überwachen bis 1200")).toMatchObject({ art: "auftrag", stark: true, an: "H03", quelle: "Kdt", frist: "1200" });
    expect(lies("Bat: Befehl an H02 Beo AK10")).toMatchObject({ art: "auftrag", stark: true, an: "H02", quelle: "Bat" });
    expect(lies("Bat befiehlt: H02 Beo AK10 halten bis 1000")).toMatchObject({ art: "auftrag", stark: true, an: "H02", quelle: "Bat", frist: "1000" });
    expect(lies("Btl befiehlt H4 Stellungswechsel")).toMatchObject({ art: "auftrag", an: "H04", quelle: "Bat" });
    expect(lies("0715 Kdt: Auftrag an H01: Vbk alle 30 min")).toMatchObject({ art: "auftrag", an: "H01", quelle: "Kdt" });
  });
  it("Empfänger muss ein eigener Trupp sein («Bat befiehlt: Det 2 …» bleibt Orientierung)", () => {
    expect(lies("Bat befiehlt: Det 2 ist auszuschalten").art).toBe("orientierung");
  });
});

describe("D1.2 «an H02: …» am Anfang (stark)", () => {
  it("Auftrag an den Trupp, mit Frist", () => {
    expect(lies("an H02: Stellungswechsel nach AH10 bis 0900")).toMatchObject({ art: "auftrag", stark: true, an: "H02", frist: "0900" });
    expect(lies("An H01, Beo NAI 1")).toMatchObject({ art: "auftrag", an: "H01" });
    expect(lies("An H05 Stellungsbezug AQ12")).toMatchObject({ art: "auftrag", an: "H05" });
  });
  it("nur am Anfang: «2 Fz fahren an H02 vorbei» ist eine Meldung (Risiko Kap. 7)", () => {
    expect(lies("2 Fz fahren an H02 vorbei Rtg N").art).toBe("meldung");
    expect(lies("H04 2 Fz fahren an H02 vorbei Rtg N").art).toBe("meldung");
  });
});

describe("D1.3 Ausgang nach oben (kein Zeichen)", () => {
  it("Meldung/Lagemeldung/Antwort an Bat/Kp, «An Bat:», weitergemeldet", () => {
    expect(lies("Meldung an Bat: 2 Kpz AK9 Rtg W")).toMatchObject({ art: "ausgang", stark: true, an: "Bat", rest: "2 Kpz AK9 Rtg W" });
    expect(lies("An Bat: Lage unverändert")).toMatchObject({ art: "ausgang", an: "Bat", rest: "Lage unverändert" });
    expect(lies("Lagemeldung an Kp: ruhig")).toMatchObject({ art: "ausgang", an: "Kp" });
    expect(lies("Weitergemeldet an Bat: Nr 54")).toMatchObject({ art: "ausgang", an: "Bat", bezugNr: "54", bezugArt: "weiter" });
    expect(lies("Nr 54 an Btl weitergeleitet")).toMatchObject({ art: "ausgang", an: "Bat", bezugNr: "54", bezugArt: "weiter" });
    expect(lies("Meldung an Kp 61/2: Det 1 Rtg W")).toMatchObject({ art: "ausgang", an: "Kp 61/2" });
    expect(lies("Meldung an Nachbar links: 2 Fz")).toMatchObject({ art: "ausgang", an: "Nachbar links" });
  });
  it("«Antwort an Bat» ist Ausgang mit Bezug-Art Antwort; «Antwort an H02» bleibt Antwort an den Trupp (Notiz)", () => {
    expect(lies("Antwort an Bat: 2 Kpz")).toMatchObject({ art: "ausgang", an: "Bat", bezugArt: "antwort" });
    expect(lies("Antwort an Bat zu 61: H02 in AL9")).toMatchObject({ art: "ausgang", bezugNr: "61", bezugArt: "antwort" });
    expect(lies("Antwort an H02: ja")).toMatchObject({ art: "notiz", an: "H02", bezugArt: "antwort" });
  });
  it("Zahlen im Inhalt sind kein Bezug («Meldung an Bat: 2 Kpz»)", () => {
    expect(lies("Meldung an Bat: 2 Kpz AK9").bezugNr).toBeUndefined();
  });
  it("Text «Ausgang an Bat»", () => {
    const e = { art: "ausgang", an: "Bat", notiz: true } as LageEvent;
    expect(artText(e)).toBe("Ausgang an Bat");
  });
});

describe("D1.4 Rückfrage von oben", () => {
  it("«Bat fragt: …», «Rückfrage Bat: …», «Rückfrage von Kdt: …», «Kdt: …?»", () => {
    expect(lies("Bat fragt: Standort H02?")).toMatchObject({ art: "rueckfrage", stark: true, quelle: "Bat", rest: "Standort H02?" });
    expect(lies("Rückfrage Bat: wie viele Fz in AK9?")).toMatchObject({ art: "rueckfrage", stark: true, quelle: "Bat" });
    expect(lies("Rückfrage von Kdt: Lage H05?")).toMatchObject({ art: "rueckfrage", quelle: "Kdt" });
    expect(lies("Kdt: wann ist H03 bereit?")).toMatchObject({ art: "rueckfrage", stark: true, quelle: "Kdt" });
    expect(lies("Bat frage: Stärke Det 2")).toMatchObject({ art: "rueckfrage", quelle: "Bat" });
  });
  it("Text «Rückfrage von Bat»; Rückfrage an Trupp bleibt", () => {
    expect(artText({ art: "rueckfrage", quelle: "Bat", notiz: true } as LageEvent)).toBe("Rückfrage von Bat");
    expect(lies("Rückfrage an H02: Anzahl Fz bestätigen")).toMatchObject({ art: "rueckfrage", an: "H02" });
    expect(lies("Bat: Lagerapport 1000 im KP Bat").art).toBe("orientierung");
  });
});

describe("D1.5 Absender von oben + Trupp + Tätigkeit ohne «Auftrag» (schwach)", () => {
  it("«Kdt: H05 sofort Stellungswechsel nach AR12» → Auftrag an H05, gelb", () => {
    expect(lies("Kdt: H05 sofort Stellungswechsel nach AR12")).toMatchObject({ art: "auftrag", stark: false, an: "H05", quelle: "Kdt" });
    expect(lies("Kdt: H02 sofort Stellungswechsel nach AH10")).toMatchObject({ art: "auftrag", stark: false, an: "H02" });
  });
  it("Mitteilung ohne Tätigkeit bleibt Orientierung («Bat: H02 verschiebt nach AL9», «Kp: H04 wird um 1200 abgelöst»)", () => {
    expect(lies("Bat: H02 verschiebt nach AL9").art).toBe("orientierung");
    expect(lies("Kp: H04 wird um 1200 abgelöst").art).toBe("orientierung");
  });
});

describe("D1.6 Quittung, D1.7 Abschluss", () => {
  it("«H03 Auftrag erhalten», «H02 Verstanden», «H05 wird ausgeführt» → Notiz mit Bezug-Art Quittung", () => {
    for (const s of ["H03 Auftrag erhalten", "H02 Verstanden", "H05 wird ausgeführt", "H01: verstanden, wird ausgeführt", "H04 wilco"]) {
      expect(lies(s), s).toMatchObject({ art: "notiz", stark: true, bezugArt: "quittung" });
    }
  });
  it("mit Ort oder Sichtung keine Quittung", () => {
    expect(lies("H02 verstanden, 2 Fz AK9").bezugArt).not.toBe("quittung");
  });
  it("«H03 erledigt» (ohne «Auftrag») → Meldung mit Abschluss-Vorschlag; mit «Auftrag» wie bisher", () => {
    expect(lies("H03 erledigt")).toMatchObject({ art: "meldung", abschluss: true });
    expect(lies("H01 Stellungsbezug AG10 abgeschlossen")).toMatchObject({ art: "meldung", abschluss: true });
    expect(lies("H05 Auftrag ausgeführt, Stao AQ12 bezogen")).toMatchObject({ art: "meldung", bezugArt: "ausgefuehrt" });
    expect(lies("H05 Auftrag ausgeführt, Stao AQ12 bezogen").abschluss).toBeUndefined();
    expect(lies("Det 2 erledigt").abschluss).toBeUndefined();
  });
});

describe("D1.8 Funkverbindung verloren, D1.9 Empfänger bei gewählter Art", () => {
  it("Vbk «keine» mit dem Trupp", () => {
    expect(lies("Funkkontakt verloren zu H03")).toMatchObject({ art: "vbk", vbk: "keine", an: "H03" });
    expect(lies("Verbindung mit H04 abgebrochen")).toMatchObject({ art: "vbk", vbk: "keine", an: "H04" });
    expect(lies("keine Funkverbindung zu H1")).toMatchObject({ art: "vbk", vbk: "keine", an: "H01" });
    expect(lies("Funkkontakt zu H02 verloren")).toMatchObject({ art: "vbk", vbk: "keine", an: "H02" });
  });
  it("Art «Auftrag» gewählt: «an H02» irgendwo ist der Empfänger", () => {
    expect(lies("Beo NAI 2 durch Patrouille an H02 übergeben", { vorgabe: "auftrag" })).toMatchObject({ art: "auftrag", an: "H02" });
    expect(lies("Beo NAI 2 durch Patrouille an H02 übergeben").art).toBe("meldung");
    expect(lies("Auftrag an H03: Beo AN7", { vorgabe: "auftrag" })).toMatchObject({ art: "auftrag", an: "H03", rest: "Beo AN7" });
  });
});

describe("parseMeldung und Vorschau (D1 in der Erkennung)", () => {
  const ex: Exercise = demoExercise();
  const now = new Date("2030-05-15T07:31:00+02:00");
  const ctx = { sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now, lastPos: (u: string, s: "rot" | "blau" | "ul") => lastPosition(ex.events!, s, u), events: ex.events, ex };
  const st = (s: string) => {
    const d = parseMeldung(s, ctx);
    return { d, st: entryState(d, { hasRaster: true, online: false, placePending: false, manualPos: false, now, sheets: ex.sheets, areas: ex.areas, knownUnits: ex.units.blau, unitsPrepared: true, days: ex.days }) };
  };
  it("Ausgang: grün, kein Ort, kein Zeichen, Empfänger", () => {
    const { d, st: s } = st("Meldung an Bat: 2 Kpz AK9 Rtg W");
    expect(s.level).toBe("bereit");
    expect(d).toMatchObject({ art: "ausgang", an: "Bat" });
    expect(d.pos).toBeUndefined();
    expect(d.cells).toBeUndefined();
  });
  it("Auftrag von oben grün, «Kdt: H05 sofort …» gelb (Art schwach)", () => {
    expect(st("Kp Kdt: Auftrag an H03 NAI 2 überwachen bis 1200").st.level).toBe("bereit");
    const s = st("Kdt: H05 sofort Stellungswechsel nach AR12");
    expect(s.st.level).toBe("pruefen");
    expect(s.st.reasons.map((r) => r.code)).toContain("art-schwach");
    expect(s.d).toMatchObject({ art: "auftrag", an: "H05" });
  });
});
