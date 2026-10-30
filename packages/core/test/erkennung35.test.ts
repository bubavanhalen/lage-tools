/**
 * Erkennung MVP 3.5 (Spez. MVP 3.5, Kap. 3.3, Regeln C1–C15) – je Regel einzeln, am Beispiel Bern (fiktiv, Raster BERN,
 * Trupps H01–H05), Uhr T2 07:31. Die Sätze der Prüfungen stehen zusätzlich in `saetze35.test.ts` (Regressionstest).
 */
process.env.TZ = "Europe/Zurich";
import { describe, expect, it } from "vitest";
import {
  bestaetigtVon, clockDay, demoExercise, entryState, eventFromDraft, lastPosition, parseMeldung, situationAt, type Draft, type EntryStateOptions,
  type Exercise, type JournalContext, type LageEvent,
} from "../src";

const Z = "Europe/Zurich";
const NOW = new Date("2030-05-15T07:31:00+02:00");

function ctxOf(ex: Exercise, now = NOW, over: Partial<JournalContext> = {}): JournalContext {
  const events = ex.events ?? [];
  const clk = clockDay(ex.days, now);
  return {
    sheets: ex.sheets, areas: ex.areas, units: ex.units, places: ex.places ?? [], days: ex.days, day: clk.day, now, dayFromClock: clk.follow,
    lastPos: (u, s) => lastPosition(events, s, u), events, ex, zone: Z, ...over,
  };
}
function optsOf(ex: Exercise, now = NOW, over: Partial<EntryStateOptions> = {}): EntryStateOptions {
  return {
    hasRaster: true, online: false, placePending: false, manualPos: false, now, sheets: ex.sheets, areas: ex.areas, knownUnits: ex.units.blau,
    unitsPrepared: true, days: ex.days, ortsnamen: "aus", zone: Z, ...over,
  };
}
const lies = (s: string, ex = demoExercise(), now = NOW, over: Partial<JournalContext> = {}) => {
  const d = parseMeldung(s, ctxOf(ex, now, over));
  return { d, st: entryState(d, optsOf(ex, now)), ex };
};
const codes = (st: ReturnType<typeof entryState>) => st.reasons.map((r) => r.code);
/** Eintragen wie das Meldungsfeld (zweites Enter bei Gelb) und Lage bei LIVE (+10 min) */
function trage(ex: Exercise, d: Draft, now = NOW): { e: LageEvent; vor: ReturnType<typeof situationAt>; nach: ReturnType<typeof situationAt> } {
  const t = "2030-05-15T07:41+02:00";
  const vor = situationAt([...(ex.events ?? [])], t);
  const e = eventFromDraft(d, "dev-c", now, { nr: 900 });
  ex.events = [...(ex.events ?? []), e];
  return { e, vor, nach: situationAt([...ex.events], t) };
}
const zeichen = (s: ReturnType<typeof situationAt>) => s.units.length + s.loose.length;
const ortVon = (s: ReturnType<typeof situationAt>, u: string) => s.units.find((x) => x.side === "blau" && x.unit === u)?.pos;

describe("C1 Unbekanntes Gesehenes → gelb «Was gesehen?» mit Ersatzwort (auch ohne Anzahl)", () => {
  it("«H03 3 Persohnen in AN6»: Vorschlag «Personen», 2. Enter «3 ?» Unklar", () => {
    const { d, st } = lies("H03 3 Persohnen in AN6");
    expect(st.level).toBe("pruefen");
    const r = st.reasons.find((x) => x.code === "was")!;
    expect(r).toMatchObject({ token: "Persohnen", suggest: "Personen" });
    expect(r.text).toBe("Was gesehen? «Persohnen» – meinst du «Personen»?");
    expect(r.ask).toBe("Nochmals Enter trägt «3 ?» als Unklar ein.");
    expect(d.ersatz).toEqual({ token: "Persohnen", wort: "Personen" });
    expect(d).toMatchObject({ kind: "unklar", count: 3, sym: "einheit" });
  });
  it("ohne Anzahl: «Lastwagn», «drohen» (nicht «Drohnen»)", () => {
    expect(lies("H01 Lastwagn AE5").d.ersatz?.wort).toBe("Lastwagen");
    expect(lies("H05 drohen über AQ11").d.ersatz?.wort).toBe("Drohne");
    expect(lies("H05 drohen über AQ11").st.reasons[0]!.ask).toBe("Nochmals Enter trägt «?» als Unklar ein.");
  });
  it("gewöhnliche Wörter und Lagemeldungen sind nie «Was gesehen?»", () => {
    for (const s of ["H01 alles ruhig, keine Bewegung", "H05 Stao bezogen in AQ11", "H04 Ablösung erfolgt", "H04 Position unverändert"]) {
      expect(codes(lies(s).st), s).not.toContain("was");
    }
  });
});

describe("C2 Wörterbuch (grün)", () => {
  it("Fzg, Nrd: «H04 2 Fzg in AK7 Rtg Nrd»", () => {
    const { d, st } = lies("H04 2 Fzg in AK7 Rtg Nrd");
    expect(st.level).toBe("bereit");
    expect(d).toMatchObject({ kind: "feind", sym: "fz", count: 2, dir: 0 });
  });
  it("Typen mit Gewehr = bewaffnete Personen (nie Sturmgewehr)", () => {
    const { d } = lies("hier H02, sehe drei Typen mit Gewehr bei AK9");
    expect(d).toMatchObject({ kind: "feind", sym: "inf_trp", count: 3, melder: "H02" });
    expect(d.desc).toBe("3 gegnerische Personen (bewaffnet)");
    // ausdrücklich «Stgw» bleibt Ausrüstung im Sinn
    expect(lies("H02 3 gn Pers mit Stgw AK9").d.desc).toBe("3 gegnerische Personen mit Sturmgewehr");
  });
  it("Pinz = Fahrzeug (Typ im Zusatz), Zahlwort «zwei»", () => {
    const { d } = lies("H02: zwei Pinz fahren Rtg Bern");
    expect(d).toMatchObject({ kind: "feind", sym: "fz", count: 2, dirLabel: "Rtg Bern" });
    expect(d.desc).toBe("2 gegnerische Fahrzeuge (Pinzgauer)");
  });
  it("Golf = 1 Personenwagen, Zugehörigkeit unklar; Melder am Ende", () => {
    const { d, st } = lies("schwarzer Golf fährt langsam vorbei, AN6, H03");
    expect(st.level).toBe("bereit");
    expect(d).toMatchObject({ kind: "unklar", count: 1, melder: "H03", unit: "" });
    expect(d.desc).toMatch(/Personenwagen/);
  });
});

describe("C3 Kein neues Zeichen bei Verneinung/Abgang", () => {
  it("«H01 Feind hat AD7 verlassen Rtg N»: gelb, Notiz, Text nach Kap. 4", () => {
    const { d, st, ex } = lies("H01 Feind hat AD7 verlassen Rtg N");
    expect(d.art).toBe("notiz");
    const r = st.reasons.find((x) => x.code === "kein-zeichen")!;
    expect(r.text).toBe("Kein neues Zeichen? «Feind hat AD7 verlassen».");
    expect(r.ask).toBe("Nochmals Enter trägt als Notiz ein. Ist es eine Sichtung: Feind oder Unklar wählen.");
    const { vor, nach } = trage(ex, d);
    expect(zeichen(nach)).toBe(zeichen(vor));
  });
  it("«H03 Det 2 Standort unbekannt»: Notiz, Det 2 unverändert; mit Gesehenem bleibt es Meldung", () => {
    const { d, st } = lies("H03 Det 2 Standort unbekannt");
    expect(codes(st)).toContain("kein-zeichen");
    expect(d).toMatchObject({ art: "notiz", unit: "" });
    expect(lies("H01 2 Fz haben AD7 verlassen Rtg N").d.art).toBe("meldung");
  });
});

describe("C4 Lagemeldung ohne Inhalt", () => {
  it("«H04 nichts Neues», «H01 alles ruhig, keine Bewegung»: Eigene, bereit, kein Zeichen, Standort bleibt", () => {
    for (const s of ["H04 nichts Neues", "H01 alles ruhig, keine Bewegung"]) {
      const { d, st, ex } = lies(s);
      expect(st.level, s).toBe("bereit");
      expect(d.kind).toBe("eigen");
      const { vor, nach } = trage(ex, d);
      expect(zeichen(nach)).toBe(zeichen(vor));
      expect(ortVon(nach, d.melder)).toEqual(ortVon(vor, d.melder));
    }
  });
});

describe("C5 Standortverb nötig zum Versetzen", () => {
  it("«wechselt nach AC7» versetzt (grün)", () => {
    const { d, st, ex } = lies("H01 sieht nichts mehr, wechselt nach AC7");
    expect(st.level).toBe("bereit");
    expect(d).toMatchObject({ kind: "eigen", unit: "H01" });
    const { nach } = trage(ex, d);
    expect(ortVon(nach, "H01")).toEqual(d.pos);
  });
  it("«H01 Rückzug nach AC5»: gelb «H01 selbst nach AC5?», 2. Enter versetzt; Gegner bleibt Feind", () => {
    const { d, st, ex } = lies("H01 Rückzug nach AC5");
    const r = st.reasons.find((x) => x.code === "seite")!;
    expect(r.text).toBe("H01 selbst nach AC5?");
    expect(r.ask).toBe("Nochmals Enter: H01 nach AC5. Ist es der Feind: Feind wählen.");
    expect(d.kind).toBe("eigen");
    const { vor, nach } = trage(ex, d);
    expect(ortVon(nach, "H01")).not.toEqual(ortVon(vor, "H01"));
    expect(lies("Gegner zieht sich zurück Rtg Bern").d.kind).toBe("feind");
  });
});

describe("C6 Zwei Orte", () => {
  it("«H02 wir weichen aus nach AK11, Kontakt mit 4 Pers AK10»: Entwurf = Feind AK10, Aufteilung in zwei Teile", () => {
    const { d, st, ex } = lies("H02 wir weichen aus nach AK11, Kontakt mit 4 Pers AK10");
    const r = st.reasons.find((x) => x.code === "zwei-orte")!;
    expect(r.text).toBe("Zwei Orte – Feind in AK10, H02 nach AK11?");
    expect(r.ask).toBe("Nochmals Enter: nur den Feind in AK10 eintragen (H02 bleibt in AL9 A).");
    expect(d).toMatchObject({ kind: "feind", sym: "kontakt", count: 4, where: { label: "AK10" }, melder: "H02" });
    expect(d.text).toBe("H02 wir weichen aus nach AK11, Kontakt mit 4 Pers AK10");
    expect(d.teile).toEqual(["H02 wir weichen aus nach AK11", "H02 Kontakt mit 4 Pers AK10"]);
    const { vor, nach } = trage(ex, d);
    expect(ortVon(nach, "H02")).toEqual(ortVon(vor, "H02"));
  });
  it("«von PQ1 nach PQ2» ist eine Bewegung, keine zwei Orte", () => {
    const { d, st } = lies("H04 2 Fz von AK7 nach AM9");
    expect(codes(st)).not.toContain("zwei-orte");
    expect(d.where?.label).toBe("AK7");
    expect(d.desc).toBe("2 gegnerische Fahrzeuge nach AM9");
    expect(d.dir).toBe(135);
  });
});

describe("C7 Eigene Verwundete", () => {
  it("«H01 Verletzter in AC7, braucht Sanität»: Eigene, dringend, Begehren Sanität, AC7 nur Text, kein Zeichen, H01 bleibt", () => {
    const { d, st, ex } = lies("H01 Verletzter in AC7, braucht Sanität");
    expect(st.level).toBe("bereit");
    expect(d).toMatchObject({ kind: "eigen", side: "blau", dringend: true, begehren: { was: "Sanität" }, orte: ["AC7"], ohneZeichen: "verwundet" });
    expect(d.pos).toBeUndefined();
    const { vor, nach } = trage(ex, d);
    expect(zeichen(nach)).toBe(zeichen(vor));
    expect(ortVon(nach, "H01")).toEqual(ortVon(vor, "H01"));
  });
  it("«H05 dringend: Verwundeter bei uns AQ11» eigen; «H02 2 Verletzte» allein bleibt Sichtung (unklar)", () => {
    expect(lies("H05 dringend: Verwundeter bei uns AQ11").d).toMatchObject({ kind: "eigen", orte: ["AQ11"] });
    expect(lies("H02 2 Verletzte").d.kind).toBe("unklar");
    expect(lies("H02 verlangt Sanität, 1 Verletzter").d).toMatchObject({ kind: "eigen", where: { label: "bei H02" }, begehren: { was: "Sanität" } });
  });
});

describe("C8 Ereignis am genannten Trupp grün", () => {
  it("Kontakt, Beschuss, Angriff: «bei H05», grün, dringend bei Beschuss", () => {
    const a = lies("H05 hat Kontakt, wird beschossen aus Richtung Osten");
    expect(a.st.level).toBe("bereit");
    expect(a.d).toMatchObject({ kind: "feind", sym: "kontakt", where: { kind: "melder", label: "bei H05" }, from: 90, dringend: true, amTrupp: true });
    expect(lies("H03 Kontakt").st.level).toBe("bereit");
    expect(lies("H02 wurde angegriffen, 1 Verwundeter").d).toMatchObject({ kind: "feind", dringend: true });
  });
  it("«Drohne über H05», «2 Fz fahren an H02 vorbei» (Melder H04): Ort beim genannten Trupp", () => {
    expect(lies("Drohne über H05").st.level).toBe("bereit");
    const d = lies("H04 2 Fz fahren an H02 vorbei Rtg N").d;
    expect(d).toMatchObject({ melder: "H04", where: { label: "bei H02" }, art: "meldung" });
  });
  it("Wahrnehmung bleibt gelb: «hört Schüsse», «Lärm»", () => {
    expect(codes(lies("H01 hört Schüsse aus Süden").st)).toContain("ort-bei-trupp");
    const l = lies("H03 Lärm von Motoren aus Rtg AP5");
    expect(codes(l.st)).toContain("ort-bei-trupp");
    expect(l.d).toMatchObject({ kind: "unklar", fromLabel: "aus Rtg AP5", where: { label: "bei H03" } });
    expect(l.d.cells).toBeUndefined();
  });
});

describe("C9/C10 Herkunft, Feuerkampf", () => {
  it("«von AP5 her» ist Herkunft, kein Ort", () => {
    const d = lies("H03 Schüsse von AP5 her").d;
    expect(d.fromLabel).toBe("aus Rtg AP5");
    expect(d.cells).toBeUndefined();
  });
  it("«H03 Feuerkampf AP 11»: Kontakt Feind, dringend, AP11", () => {
    expect(lies("H03 Feuerkampf AP 11").d).toMatchObject({ kind: "feind", sym: "kontakt", dringend: true, where: { label: "AP11" } });
  });
});

describe("C11 Begehren", () => {
  it("«Mun Nachschub benötigt», «Mun Stand 60%», «Mun- und Verpflegungsnachschub benötigt»: Eigene, kein Zeichen, kein «Ort fehlt»", () => {
    for (const [s, was] of [["H05 Mun Nachschub benötigt", "Mun Nachschub"], ["H05 Mun Stand 60%", "Mun Stand 60%"], ["H02 Mun- und Verpflegungsnachschub benötigt", "Mun- und Verpflegungsnachschub"]] as const) {
      const { d, st, ex } = lies(s);
      expect(st.level, s).toBe("bereit");
      expect(d).toMatchObject({ kind: "eigen", sym: "einheit", begehren: { was }, ohneZeichen: "begehren" });
      const { vor, nach } = trage(ex, d);
      expect(zeichen(nach)).toBe(zeichen(vor));
    }
  });
  it("ohne bekannten Trupp oder mit Feindwort kein Begehren", () => {
    expect(lies("Feind benötigt Nachschub AK9").d.begehren).toBeUndefined();
  });
});

describe("C12 Unbekannter Trupp", () => {
  it("«H06 2 Pers AK5»: gelb trupp-neu, ohne Melder, H06 nie still angelegt – auch ohne vorbereitete Trupps", () => {
    const { d, st } = lies("H06 2 Pers AK5");
    expect(d).toMatchObject({ melder: "", truppNeu: "H06", kind: "feind", count: 2 });
    const r = st.reasons.find((x) => x.code === "trupp-neu")!;
    expect(r).toMatchObject({ token: "H06", suggest: "H06", text: "H06 ist kein Trupp dieser Übung.", ask: "Nochmals Enter trägt ohne Trupp ein." });
    expect(codes(st)).not.toContain("melder");
    const leer = demoExercise();
    leer.units = { rot: [], blau: [], ul: [] };
    const d2 = parseMeldung("H01 2 Fz AK7", ctxOf(leer));
    expect(entryState(d2, optsOf(leer, NOW, { unitsPrepared: false, knownUnits: [] })).reasons.map((x) => x.code)).toContain("trupp-neu");
    expect(eventFromDraft(d, "dev").melder).toBeUndefined();
  });
});

describe("C13 Ort mit unbekanntem Namen", () => {
  it("«H04 erreicht Checkpoint 2»: gelb «Ort «Checkpoint 2» unbekannt», H04 bleibt", () => {
    const { d, st } = lies("H04 erreicht Checkpoint 2");
    expect(st.reasons.find((x) => x.code === "ort")?.text).toBe("Ort «Checkpoint 2» unbekannt");
    expect(d.pos).toBeUndefined();
  });
  it("«Det 1 gesichtet bei der Brücke»: kein letzter Standort von Det 1 als Ersatz", () => {
    const { d, st } = lies("Det 1 gesichtet bei der Brücke");
    expect(st.level).toBe("pruefen");
    expect(d.pos).toBeUndefined();
    expect(d.where).toBeUndefined();
  });
  it("bekannter Ort aus der Übung gilt", () => {
    const ex = demoExercise();
    ex.places = [...(ex.places ?? []), { name: "Checkpoint 2", pos: { e: 2600000, n: 1199000 } }];
    expect(lies("H04 erreicht Checkpoint 2", ex).d.where).toMatchObject({ kind: "ort", label: "Checkpoint 2" });
  });
});

describe("C14 bestaetigtVon: verschiedene Melder", () => {
  it("H02 einmal, H04 zweimal → zwei Trupps; mit gerechneter Qualität gleich", () => {
    const ex = demoExercise();
    ex.events = [];
    const add = (s: string, min: number) => { const now = new Date(NOW.getTime() + min * 60000); const d = parseMeldung(s, ctxOf(ex, now)); const e = eventFromDraft(d, "dev", now); ex.events = [...(ex.events ?? []), e]; return e; };
    const a = add("H02 3 Kpz AK9", 0);
    add("H04 3 Kpz AK9", 1);
    add("H04 3 Kpz AK9", 2);
    expect(bestaetigtVon(a, ex.events!)).toEqual(["H02", "H04"]);
    // ohne zweiten Trupp: nichts
    expect(bestaetigtVon(a, ex.events!.filter((e) => e.melder !== "H04"))).toEqual([]);
  });
});

describe("C15 Ortsnamen aus (K2)", () => {
  it("«H01 1 Pers beim Gasthof Bären»: gelb `ort-online-aus` (Text Kap. 4); online an ohne Netz: wie bisher", () => {
    const ex = demoExercise();
    const d = parseMeldung("H01 1 Pers beim Gasthof Bären", ctxOf(ex));
    const r = entryState(d, optsOf(ex)).reasons.find((x) => x.code === "ort-online-aus")!;
    expect(r.text).toBe("Ort «Gasthof Bären» – Ortsnamen sind aus (nichts geht ans Netz).");
    expect(r.hint).toBe("Planquadrat dazuschreiben oder Ort auf Karte setzen.");
    expect(r.ask).toBe("Nochmals Enter: ohne Ort eintragen.");
    expect(entryState(d, optsOf(ex, NOW, { ortsnamen: "kein-netz" })).reasons.map((x) => x.code)).toContain("ort-offline");
  });
  it("schwacher Auftrag von oben: «Auftrag an H05?» (Text Kap. 4)", () => {
    const { st } = lies("Kdt: H05 sofort Stellungswechsel nach AR12");
    const r = st.reasons.find((x) => x.code === "art-schwach");
    if (r) {
      expect(r.text).toBe("Auftrag an H05?");
      expect(r.ask).toBe("Nochmals Enter trägt als Auftrag ein (H05 bleibt, wo er ist).");
    }
  });
});

describe("Zeit in der Erkennung (S22/S23)", () => {
  const herbst = () => { const ex = demoExercise(); ex.days = ["2030-10-26", "2030-10-27"]; return ex; };
  it("#53 «0255» um 02:10 MEZ am 27.10.: 02:55 MESZ, grün, Zeichen bei LIVE", () => {
    const ex = herbst();
    const now = new Date("2030-10-27T02:10:00+01:00");
    const d = parseMeldung("0255 H01 1 Pers AC7", ctxOf(ex, now));
    expect(d).toMatchObject({ t: "2030-10-27T02:55", tOffset: "+02:00" });
    expect(entryState(d, optsOf(ex, now)).level).toBe("bereit");
    const e = eventFromDraft(d, "dev", now);
    expect(situationAt([e], "2030-10-27T02:20+01:00").loose.map((x) => x.id)).toEqual([e.id]);
  });
  it("#54 «0230» am 31.03.: rot `zeit-fehlt`, Vorschlag 0330, Text Kap. 4", () => {
    const ex = demoExercise();
    ex.days = ["2030-03-30", "2030-03-31"];
    const now = new Date("2030-03-31T03:40:00+02:00");
    const d = parseMeldung("0230 H01 1 Pers AC7", ctxOf(ex, now));
    const st = entryState(d, optsOf(ex, now));
    expect(st.level).toBe("geht-nicht");
    expect(st.reasons[0]).toMatchObject({ code: "zeit-fehlt", suggest: "0330", text: "02:30 gibt es heute nicht (Uhr um 02:00 auf 03:00 vorgestellt)." });
  });
  it("S22: «0735» um 07:31 gehört zur Lage (Toleranz), > 10 min bleibt Zukunft", () => {
    const ex = demoExercise();
    expect(lies("0735 H02 1 Fz AK9", ex).st.level).toBe("bereit");
    expect(codes(lies("0745 H02 1 Fz AK9").st)).toContain("zukunft");
  });
  it("gewöhnliche Tage: kein Offset im Entwurf (eventFromDraft bestimmt ihn wie bisher)", () => {
    const d = lies("0725 H02 1 Fz AK9").d;
    expect(d.tOffset).toBeUndefined();
    expect(eventFromDraft(d, "dev", NOW).tOffset).toBe("+02:00");
  });
});
