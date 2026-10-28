import { describe, expect, it } from "vitest";
import {
  demoExercise,
  lastPosition,
  looksSpoken,
  normalizeTyped,
  parseMeldung,
  type Draft,
  type JournalContext,
  type WhereKind,
} from "../src";

// Regression «nie still falsch»: 58 freie Eingaben von Ungeschulten (UX-Prüfung Einfachheit, 28.10.2026), nur fiktive
// Daten (Beispiel Bern, Raster BERN AA–AU × 1–15, NAI 1–3, Trupps H01–H05, Rot Det 1/2). Jede Zeile ist entweder richtig
// erkannt oder trägt ein Problem (`problems`), das das Eintragen sperrt – falsch ohne Problem gibt es nicht.
const ex = demoExercise();
const ctx = (o: Partial<JournalContext> = {}): JournalContext => ({
  sheets: ex.sheets, areas: ex.areas, units: ex.units, places: [], days: ex.days, day: ex.days[1]!, now: new Date(2030, 4, 15, 7, 30),
  lastPos: (u, s) => lastPosition(ex.events!, s, u), ...o,
});

interface Exp {
  kind: Draft["kind"];
  melder: string;
  /** Element auf der Karte (Standard: Melder bei «eigen», sonst leer) */
  unit?: string;
  sym?: string;
  count?: number | null;
  wo: WhereKind | null;
  label?: string;
  time?: string;
  /** Teil des Sinns */
  desc?: string;
  q?: string | null;
  /** erwartetes Problem (Teil des Klartexts) – Eintragen gesperrt */
  problem?: string;
}

const ROWS: Array<[string, Exp]> = [
  ["H04 meldet: 2 Fahrzeuge fahren Richtung Norden bei NAI 3", { kind: "feind", melder: "H04", sym: "fz", count: 2, wo: "nai", label: "NAI 3" }],
  ["um 10:15 hat H04 zwei Autos gesehen in AK7", { kind: "feind", melder: "H04", sym: "fz", count: 2, wo: "raster", label: "AK7", time: "10:15" }],
  ["zwei Personen mit Waffen beim Waldrand AK7", { kind: "feind", melder: "", sym: "inf_trp", count: 2, wo: "raster", label: "AK7" }],
  ["H03 sieht 3 Männer bewaffnet AJ9 C", { kind: "feind", melder: "H03", sym: "inf_trp", count: 3, wo: "raster", label: "AJ9 C" }],
  ["Panzer! AJ9", { kind: "feind", melder: "", sym: "pz", wo: "raster", label: "AJ9" }],
  ["H02 in Stellung bei AK9", { kind: "eigen", melder: "H02", sym: "stellung", wo: "raster", label: "AK9" }],
  ["H05 hat Kontakt, wird beschossen aus Richtung Osten", { kind: "feind", melder: "H05", sym: "kontakt", wo: "melder" }],
  ["H01 ist jetzt in AF12", { kind: "eigen", melder: "H01", wo: "raster", label: "AF12" }],
  ["H01 verschiebt nach AG10", { kind: "eigen", melder: "H01", wo: "raster", label: "AG10" }],
  ["H01 Stellungsbezug AG10 abgeschlossen", { kind: "eigen", melder: "H01", wo: "raster", label: "AG10" }],
  // Sichtung verschiebt nie den Melder: H03 bleibt, das Fz ist bei AN6
  ["schwarzer Golf fährt langsam vorbei, AN6, H03", { kind: "unklar", melder: "H03", unit: "", wo: "raster", label: "AN6" }],
  ["Drohne über H05", { kind: "feind", melder: "H05", sym: "drohne", wo: "melder" }],
  ["H04: nichts los, alles ruhig", { kind: "eigen", melder: "H04", wo: "zuletzt" }],
  ["H02 Verbindungskontrolle i.O.", { kind: "eigen", melder: "H02", wo: "zuletzt" }],
  // «bei der Brücke» ist der Ort, nicht das Zeichen
  ["Det 1 gesichtet bei der Brücke", { kind: "feind", melder: "", unit: "Det 1", sym: "einheit", wo: "zuletzt" }],
  ["H04 zwei feindliche Soldaten zu Fuss Richtung Wald", { kind: "feind", melder: "H04", sym: "inf_trp", count: 2, wo: "melder" }],
  ["1 LKW AK 7", { kind: "feind", melder: "", sym: "lw", count: 1, wo: "raster", label: "AK7" }],
  ["zwei fz ak7", { kind: "feind", melder: "", sym: "fz", count: 2, wo: "raster", label: "AK7" }],
  ["H3 1 Fz NAI2", { kind: "feind", melder: "H03", sym: "fz", count: 1, wo: "nai", label: "NAI 2" }],
  // Funksprache beim Tippen; «Alpha Kilo» geht nicht in die Ortssuche
  ["Hotel 4 meldet zwei Fahrzeuge in Alpha Kilo 7", { kind: "feind", melder: "H04", sym: "fz", count: 2, wo: "raster", label: "AK7", q: null }],
  ["H04 2 Pw parkiert bei Kreuzung, Insassen steigen aus", { kind: "feind", melder: "H04", sym: "fz", count: 2, wo: "melder", q: null }],
  ["Sperre auf Strasse AG13 von H04", { kind: "feind", melder: "H04", sym: "sperre", wo: "raster", label: "AG13" }],
  ["Verletzter bei H02, brauchen Sanität", { kind: "unklar", melder: "H02", sym: "verletzte", wo: "melder" }],
  // Bedarf ist kein Munitionslager
  ["H05 Mun Nachschub benötigt", { kind: "eigen", melder: "H05", sym: "einheit", wo: "zuletzt" }],
  ["H01 hört Schüsse aus Süden", { kind: "feind", melder: "H01", sym: "kontakt", wo: "melder" }],
  ["Gegner zieht sich zurück Rtg Bern", { kind: "feind", melder: "", wo: null }],
  ["10.15 H04 2 Fz AK7", { kind: "feind", melder: "H04", sym: "fz", count: 2, wo: "raster", label: "AK7", time: "10:15" }],
  ["viertel nach zehn H04 2 Fz AK7", { kind: "feind", melder: "H04", sym: "fz", count: 2, wo: "raster", label: "AK7", time: "10:15" }],
  ["H04 2 Fz Koordinate 2600100 1200200", { kind: "feind", melder: "H04", count: 2, wo: "koordinate" }],
  ["H04 2 Fz bei 600100/200200", { kind: "feind", melder: "H04", count: 2, wo: "koordinate" }],
  ["H04 meldet um 1015 dass 2 Fz in AK7 stehen", { kind: "feind", melder: "H04", count: 2, wo: "raster", label: "AK7", time: "10:15" }],
  ["Fz in AK7, 2 Stück, H04", { kind: "feind", melder: "H04", sym: "fz", count: 2, wo: "raster", label: "AK7" }],
  ["Feind Patrouille 4 Mann AK7", { kind: "feind", melder: "", sym: "patrouille", count: 4, wo: "raster", label: "AK7" }],
  ["zivilist mit Hund AK7 verdächtig", { kind: "unklar", melder: "", sym: "zivil", wo: "raster", label: "AK7" }],
  ["H04 Position unverändert", { kind: "eigen", melder: "H04", wo: "zuletzt" }],
  // Ziel, kein feindlicher Checkpoint
  ["H04 erreicht Checkpoint 2", { kind: "eigen", melder: "H04", sym: "einheit", wo: "zuletzt" }],
  ["H02 wurde angegriffen, 1 Verwundeter", { kind: "feind", melder: "H02", sym: "kontakt", wo: "melder", desc: "1 Verwundeter" }],
  ["H04 2 Fz AK 7 C", { kind: "feind", melder: "H04", count: 2, wo: "raster", label: "AK7 C" }],
  ["H04 2 Fz Planquadrat AK7 Unterquadrant C", { kind: "feind", melder: "H04", count: 2, wo: "raster", label: "AK7 C" }],
  ["H05 Stao bezogen in AQ11", { kind: "eigen", melder: "H05", wo: "raster", label: "AQ11" }],
  ["IED gefunden AF13", { kind: "feind", melder: "", sym: "ied", wo: "raster", label: "AF13" }],
  ["H04 kein Feindkontakt", { kind: "eigen", melder: "H04", wo: "zuletzt" }],
  ["2 Fz NAI 3", { kind: "feind", melder: "", count: 2, wo: "nai", label: "NAI 3" }],
  ["H04 Ablösung erfolgt", { kind: "eigen", melder: "H04", wo: "zuletzt" }],
  ["H4: 2 Fz ak7c", { kind: "feind", melder: "H04", count: 2, wo: "raster", label: "AK7 C" }],
  ["Trupp 4 meldet 2 Fz AK7", { kind: "feind", melder: "H04", count: 2, wo: "raster", label: "AK7" }],
  // Aufzählung: alle Teile im Sinn, keine falsche Einzelanzahl
  ["H04 sieht ein Auto, einen Lastwagen und 3 Personen in AK7", { kind: "feind", melder: "H04", count: null, wo: "raster", label: "AK7", desc: "1 Auto, 1 Lastwagen, 3 Personen" }],
  ["H04 2 Fz AK7 fahren weg", { kind: "feind", melder: "H04", count: 2, wo: "raster", label: "AK7" }],
  ["H04 13:70 2 Fz AK7", { kind: "feind", melder: "H04", count: 2, wo: "raster", label: "AK7", problem: "«13:70» ist keine gültige Uhrzeit" }],
  ["H04 2 Fz AK77", { kind: "feind", melder: "H04", count: 2, wo: null, problem: "«AK77» gibt es nicht" }],
  ["H04 2 Fz in NAI 9", { kind: "feind", melder: "H04", count: 2, wo: null, problem: "«NAI 9» gibt es nicht" }],
  // gesehenes eigenes Element ist am Ort, nicht der Melder
  ["H02 sieht H04 in AK9", { kind: "eigen", melder: "H02", unit: "H04", wo: "raster", label: "AK9" }],
  ["Rot: 2 Fz AK7", { kind: "feind", melder: "", count: 2, wo: "raster", label: "AK7" }],
  ["H04 Feind 2 Fz Rtg H05", { kind: "feind", melder: "H04", count: 2, wo: "melder" }],
  ["H04 2 Fz ZZ3", { kind: "feind", melder: "H04", count: 2, wo: null, problem: "«ZZ3» gibt es nicht" }],
  ["H04 Drohne gesichtet, fliegt Rtg Süd", { kind: "feind", melder: "H04", sym: "drohne", wo: "melder" }],
  ["H04 Helikopter über AK7", { kind: "feind", melder: "H04", sym: "heli", wo: "raster", label: "AK7" }],
  ["H03 Kontakt", { kind: "feind", melder: "H03", sym: "kontakt", wo: "melder" }],
];

describe("Laien-Sätze: nie still falsch (58 Eingaben)", () => {
  it("alle 58 Sätze sind abgedeckt", () => expect(ROWS.length).toBe(58));
  it.each(ROWS)("%s", (text, x) => {
    const d = parseMeldung(text, ctx());
    expect(d.kind, "Einordnung").toBe(x.kind);
    expect(d.melder, "Melder").toBe(x.melder);
    expect(d.unit, "Element").toBe(x.unit ?? (x.kind === "eigen" ? x.melder : ""));
    if (x.sym) expect(d.sym, "Zeichen").toBe(x.sym);
    if (x.count !== undefined) expect(d.count, "Anzahl").toBe(x.count ?? undefined);
    expect(d.where?.kind ?? null, "Ort").toBe(x.wo);
    if (x.label) expect(d.where?.label, "Ort").toBe(x.label);
    if (x.time) { expect(d.t.slice(11, 16), "Zeit").toBe(x.time); expect(d.timeFromText).toBe(true); }
    if (x.desc) expect(d.desc ?? "", "Sinn").toContain(x.desc);
    if (x.q !== undefined) expect(d.placeQuery, "Ortssuche").toBe(x.q ?? undefined);
    if (x.problem) {
      expect(d.problems?.map((p) => p.text), "Problem").toContain(x.problem);
    } else {
      expect(d.problems, "kein Problem").toBeUndefined();
    }
    // Ortsproblem: nie ein Ersatzort
    if (d.problems?.some((p) => p.kind === "ort")) {
      expect(d.pos).toBeUndefined();
      expect(d.where).toBeUndefined();
    }
  });
  it("Originaltext bleibt erhalten, Lesart in `normalized`", () => {
    const d = parseMeldung("Hotel 4 meldet zwei Fahrzeuge in Alpha Kilo 7", ctx());
    expect(d.text).toBe("Hotel 4 meldet zwei Fahrzeuge in Alpha Kilo 7");
    expect(d.normalized).toBe("H4 meldet 2 Fz in AK7");
    expect(parseMeldung("H04 2 Fz AK7", ctx()).normalized).toBeUndefined();
  });
});

describe("Funksprache beim Tippen: Kurzmeldungen bleiben unverändert", () => {
  it("Demo-Meldungen werden nicht verändert", () => {
    for (const e of ex.events!) expect(normalizeTyped(e.text, { blau: ex.units.blau }).changed, e.text).toBe(false);
  });
  it.each([
    "H04 2 Fz AK7", "1015 Rot 2 Fz in NAI 3 Rtg N", "T2 0315 Det 2 angekommen Wabern", "H05 eine Drohne über NAI 3", "schwarzer Golf AN6",
    "H01 eig Gr Beo", "Hotel Bellevue Rtg N", "H02 Kontakt mit gn Gr, 1 Verletzter",
  ])("unverändert: %s", (s) => {
    expect(looksSpoken(s)).toBe(false);
    expect(normalizeTyped(s, { blau: ex.units.blau }).text).toBe(s);
  });
  it.each([
    ["Hotel null vier zwei Fz in Alpha Kilo sieben Charlie", "H04", 2, "AK7 C"],
    ["Hotel vier, drei Personen in Alpha Golf 13", "H04", 3, "AG13"],
    ["H04 zwo Fz AK7", "H04", 2, "AK7"],
  ] as const)("Funksprache: %s", (s, melder, count, label) => {
    const d = parseMeldung(s, ctx());
    expect(d.melder).toBe(melder);
    expect(d.count).toBe(count);
    expect(d.where?.label).toBe(label);
    expect(d.placeQuery).toBeUndefined();
  });
  it("Buchstabierfolge, die es nicht gibt, ist ein Problem («Zulu Zulu 3» → ZZ3)", () => {
    const d = parseMeldung("H04 2 Fz Zulu Zulu 3", ctx());
    expect(d.problems?.[0]).toMatchObject({ kind: "ort", token: "ZZ3" });
    expect(d.pos).toBeUndefined();
  });
  it("Uhrzeit in Worten folgt der Tageszeit («viertel nach neun» abends → 21:15)", () => {
    expect(parseMeldung("viertel nach neun H04 2 Fz AK7", ctx({ now: new Date(2030, 4, 15, 21, 40) })).t.slice(11)).toBe("21:15");
    expect(parseMeldung("viertel nach neun H04 2 Fz AK7", ctx({ now: new Date(2030, 4, 15, 9, 40) })).t.slice(11)).toBe("09:15");
    expect(parseMeldung("halb elf H04 2 Fz AK7", ctx({ now: new Date(2030, 4, 15, 10, 50) })).t.slice(11)).toBe("10:30");
  });
  it("«Trupp 4» nur, wenn eindeutig ein eigenes Element mit Nummer 4", () => {
    expect(parseMeldung("Trupp 4 meldet 2 Fz AK7", ctx({ units: { blau: ["H04", "Zug 4"], rot: [], ul: [] } })).melder).not.toBe("H04");
  });
});

describe("Zeit: getippt nach dem Melder, ungültig", () => {
  it("«H04 13:15 2 Fz AK7» übernimmt die Zeit", () => {
    const d = parseMeldung("H04 13:15 2 Fz AK7", ctx());
    expect(d.t.slice(11)).toBe("13:15");
    expect(d.count).toBe(2);
    expect(d.melder).toBe("H04");
  });
  it.each(["H04 25:10 2 Fz AK7", "1370 H04 2 Fz AK7", "H04 0975 2 Fz AK7"])("ungültig: %s", (s) => {
    expect(parseMeldung(s, ctx()).problems?.[0]?.kind).toBe("zeit");
  });
  it.each(["H04 2 Fz AK7 1250 m Rtg N", "H04 2 Fz Koordinate 2600100 1200200", "1015 H04 2 Fz AK7"])("kein Zeitproblem: %s", (s) => {
    expect(parseMeldung(s, ctx()).problems).toBeUndefined();
  });
});

describe("Ort: nie Ersatzort für einen genannten, unbekannten Ort", () => {
  it("Ortsname («in Wabern»): Ortssuche, kein «bei H04»", () => {
    const d = parseMeldung("H04 2 Fz in Wabern", ctx());
    expect(d.placeQuery).toBe("Wabern");
    expect(d.pos).toBeUndefined();
    expect(d.problems).toBeUndefined();
  });
  it("Richtung («Rtg Bern») ist kein Ort: Sichtung beim Melder", () => {
    expect(parseMeldung("H04 2 Fz Rtg Bern", ctx()).where?.kind).toBe("melder");
  });
  it("ohne Führungsraster: «AK7» ist ein Problem, kein Ortsname", () => {
    const d = parseMeldung("H04 2 Fz AK7", ctx({ sheets: [] }));
    expect(d.problems?.[0]).toMatchObject({ kind: "ort", token: "AK7" });
    expect(d.pos).toBeUndefined();
  });
  it.each(["H04 2 Fz AK7", "H04 Kp Gfs AK7", "2 Fz NAI 3", "H04 2 Fz in AK7 auf A1", "H04 2 Mg AK7", "H02 Det 2 3 Pers AB6"])("gültige Orte ohne Problem: %s", (s) => {
    expect(parseMeldung(s, ctx()).problems).toBeUndefined();
  });
});

describe("Eigene Lage nur mit Standortwort", () => {
  it.each([
    ["H01 AF12", "eigen"], ["H02 in AK9", "eigen"], ["H03 ist in AN6", "eigen"], ["H05 Stao AQ11", "eigen"], ["H01 erreicht AG10", "eigen"],
    ["H04 angekommen AF12", "eigen"], ["H01 eig AE5", "eigen"], ["H03 Fz fährt vorbei AN6", "sichtung"], ["H03 weisser Lieferwagen AN6", "sichtung"],
    ["H02 Person mit Hund AK9", "sichtung"], ["H03 schwarzer Golf AN6", "sichtung"],
  ] as const)("%s → %s", (s, kind) => {
    const d = parseMeldung(s, ctx());
    if (kind === "eigen") expect(d.kind).toBe("eigen");
    else { expect(d.kind).not.toBe("eigen"); expect(d.unit, "Melder verschiebt sich nicht").toBe(""); }
  });
});

describe("Ortsprobleme: keine Fehlalarme", () => {
  it.each(["H04 2 Fz Rtg SO 3 Pers", "H04 Vbk OK 2", "H04 2 Fz AK7, seit 1h30 dort", "H04 2 Fz AK7 Massstab 1:25000"])("%s", (s) => {
    expect(parseMeldung(s, ctx()).problems).toBeUndefined();
  });
});
