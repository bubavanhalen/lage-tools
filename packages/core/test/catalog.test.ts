import ms from "milsymbol";
import { describe, expect, it } from "vitest";
import {
  CATALOG,
  CATEGORIES,
  ECHELONS,
  buildSidc,
  catalogEntry,
  demoFeldSheet,
  detectSymbol,
  eventFromDraft,
  parseMeldung,
  readTactical,
  searchCatalog,
  sidcFor,
  symbolDef,
  type JournalContext,
} from "../src";

// Fiktive Meldungen im Raum Bern (keine Übungsdaten)
const ctx = (over: Partial<JournalContext> = {}): JournalContext => ({
  sheets: [demoFeldSheet()],
  areas: [],
  units: { rot: [], blau: ["H04"], ul: [] },
  days: ["2030-05-14", "2030-05-15"],
  day: "2030-05-15",
  now: new Date(2030, 4, 15, 14, 7),
  ...over,
});

describe("Katalog: Aufbau", () => {
  it("eindeutige Schlüssel, alte Schlüssel vorhanden, Kategorien bekannt", () => {
    const keys = CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["einheit", "inf_gr", "inf_trp", "fz", "lw", "drohne", "patrouille", "beob_aufkl", "kontakt", "hinterhalt", "sperre", "kontrollposten", "mun_lager"]) {
      expect(catalogEntry(k), k).toBeDefined();
    }
    const cats = new Set(CATALOG.map((e) => e.category));
    for (const c of cats) expect(CATEGORIES as readonly string[]).toContain(c);
    expect(cats.size).toBeGreaterThanOrEqual(8);
    expect(cats.size).toBeLessThanOrEqual(13);
    expect(CATALOG.length).toBeGreaterThan(100);
  });
  it("Kürzel klein und ohne Punkte, SIDC-Vorlage 15 Stellen mit «?»", () => {
    for (const e of CATALOG) {
      expect(e.sidc, e.key).toHaveLength(15);
      expect(e.sidc[1], e.key).toBe("?");
      for (const a of e.aliases) expect(a, e.key).toBe(a.toLowerCase().replace(/[.]/g, ""));
    }
  });
  it("jedes Zeichen ist für alle Zugehörigkeiten, vermutet und mit Stufe gültig (milsymbol)", () => {
    const bad: string[] = [];
    for (const e of CATALOG) {
      const variants = (["F", "H", "U", "N"] as const).map((a) => buildSidc(e, a));
      for (const status of ["anticipated", "destroyed", "damaged"] as const) variants.push(buildSidc(e, "H", { status }));
      if (e.echelonable) for (const ech of ECHELONS) variants.push(buildSidc(e, "U", { echelon: ech.key }));
      for (const s of variants) {
        const sym = new ms.Symbol(s, { size: 30 });
        if (!sym.isValid()) bad.push(`${e.key} ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("SIDC: Zugehörigkeit, Status, Stufe; Stab behält das Stabszeichen", () => {
    const inf = catalogEntry("inf")!;
    expect(buildSidc(inf, "H", { echelon: "hz" })).toBe("SHGPUCI----C---");
    expect(buildSidc(inf, "F", { echelon: "kp", status: "anticipated" })).toBe("SFGAUCI----E---");
    expect(buildSidc(catalogEntry("kdo_po")!, "H", { echelon: "bat" })).toBe("SHGPU-----AF---");
    // Gerät hat keine Stufe
    expect(buildSidc(catalogEntry("kpz")!, "H", { echelon: "zug" })).toBe("SHGPEVATH-MQ---");
  });
  it("Suche: Kürzel zuerst, Umlaute egal, alte Schlüssel ausgeblendet", () => {
    expect(searchCatalog("pzgren")[0]!.key).toBe("pz_gren");
    expect(searchCatalog("Pz Gren")[0]!.key).toBe("pz_gren");
    expect(searchCatalog("kpz")[0]!.key).toBe("kpz");
    expect(searchCatalog("fluechtlinge")[0]!.key).toBe("fluechtlinge");
    expect(searchCatalog("Hindernisse").length).toBeGreaterThanOrEqual(8);
    expect(searchCatalog("").some((e) => e.key === "inf_gr")).toBe(false);
    expect(searchCatalog("Inf Gruppe").some((e) => e.hidden)).toBe(false);
  });
});

describe("Abwärtskompatibilität symbols.ts", () => {
  it("alte Schlüssel liefern Name und SIDC über den Katalog", () => {
    expect(sidcFor("inf_gr", "H")).toBe("SHGPUCI----B---");
    expect(sidcFor("inf_trp", "F")).toBe("SFGPUCI----A---");
    expect(sidcFor("unbekannt", "U")).toBe("SUGPU----------");
    expect(symbolDef("beob_aufkl").triangle).toBe(true);
    expect(symbolDef("kontakt").activity).toBe(true);
    expect(symbolDef("sperre").placement).toBe("strasse");
    expect(symbolDef("gibt-es-nicht").key).toBe("einheit");
  });
  it("detectSymbol über die Erkennung", () => {
    expect(detectSymbol("2 Kpz Rtg N")).toBe("kpz");
    expect(detectSymbol("Beginn Checkpoint")).toBe("kontrollposten");
    expect(detectSymbol("nichts Besonderes")).toBe("einheit");
  });
});

describe("Armee-Sprache lesen (readTactical)", () => {
  it("«1 gn hz inf» → 1 gegnerischer Halbzug Infanterie", () => {
    const r = readTactical("1 gn hz inf")!;
    expect(r.key).toBe("inf");
    expect(r.echelon).toBe("hz");
    expect(r.count).toBe(1);
    expect(r.aff).toBe("H");
    expect(r.status).toBe("present");
    expect(r.sidc).toBe("SHGPUCI----C---");
    expect(r.description).toBe("1 gegnerischer Halbzug Infanterie");
  });
  it("«mögliche IED in AF13» → vermutet, gestrichelt, bleibt Feind (inhärent feindlich)", () => {
    const r = readTactical("mögliche IED in AF13")!;
    expect(r.key).toBe("ied");
    expect(r.status).toBe("anticipated");
    expect(r.aff).toBe("H");
    expect(r.explicitAff).toBe(false);
    expect(r.sidc).toBe("SHGAEXI--------");
    expect(r.description).toBe("mögliche IED");
  });
  it.each([
    ["Sperre in AG13", "sperre", "Sperre"],
    ["gn Strassensperre AH10", "strassensperre", "gegnerische Strassensperre"],
    ["Checkpoint NAI 2", "kontrollposten", "Checkpoint"],
  ])("%s → auf die Strasse", (text, key, desc) => {
    const r = readTactical(text)!;
    expect(r.key).toBe(key);
    expect(catalogEntry(r.key)!.placement).toBe("strasse");
    expect(r.description).toBe(desc);
  });
  it.each([
    ["2 Kpz Rtg N", "kpz", { count: 2 }, "2 Kampfpanzer"],
    ["3 Spz", "spz", { count: 3 }, "3 Schützenpanzer"],
    ["gn Pz Gren Zug", "pz_gren", { echelon: "zug", aff: "H" }, "gegnerischer Zug Panzergrenadiere"],
    ["1 Kp Pz", "pz", { echelon: "kp", count: 1 }, "1 Kompanie Panzer"],
    ["Mw Stel AK5", "mw", {}, "Minenwerfer in Stellung"],
    ["Aufkl Trp", "aufkl", { echelon: "trp" }, "Trupp Aufklärung"],
    ["Scharfschütze", "scharfschuetze", {}, "Scharfschütze"],
    ["Drohne über AR10", "drohne", {}, "Drohne"],
    ["Kdo Po", "kdo_po", {}, "Kommandoposten"],
    ["Beob Po", "beob_aufkl", {}, "Beobachtungsposten"],
    ["Minensperre", "minensperre", {}, "Minensperre"],
    ["Brand", "brand", {}, "Brand"],
    ["Unfall mit Verletzten", "unfall", {}, "Unfall mit Verletzten"],
    ["Demo", "demo", {}, "Demonstration"],
    ["Flüchtlinge", "fluechtlinge", {}, "Flüchtlinge"],
    ["3 gn Gruppen Inf", "inf", { echelon: "gr", count: 3, aff: "H" }, "3 gegnerische Gruppen Infanterie"],
    ["gn Gr", "einheit", { echelon: "gr" }, "gegnerische Gruppe"],
    ["2 gn Fz", "fz", { count: 2 }, "2 gegnerische Fahrzeuge"],
    ["Pz.Gren.Zug", "pz_gren", { echelon: "zug" }, "Zug Panzergrenadiere"],
    ["Art Abt", "art", { echelon: "bat" }, "Abteilung Artillerie"],
    ["3 Mw", "mw_geraet", { count: 3 }, "3 Minenwerfer"],
    ["Infanteriezug", "inf", { echelon: "zug" }, "Zug Infanterie"],
    ["vermutlich gn Kpz", "kpz", { aff: "H", status: "anticipated" }, "vermuteter gegnerischer Kampfpanzer"],
    ["Lastwagenkolonne Rtg S", "kolonne", { of: "lw" }, "Lastwagen (Kolonne)"],
    ["mögl. VBIED", "vbied", { status: "anticipated" }, "mögliche Fahrzeug-IED"],
  ])("%s", (text, key, more, desc) => {
    const r = readTactical(text)!;
    expect(r.key).toBe(key);
    for (const [k, v] of Object.entries(more)) expect(r[k as keyof typeof r], k).toBe(v);
    expect(r.description).toBe(desc);
  });
  it("Elementnamen sind keine Stufe; ohne taktischen Begriff nichts", () => {
    expect(readTactical("Gr 5 bei Bümpliz")).toBeNull();
    expect(readTactical("Zug 2 bezieht Stellung")!.echelon).toBeUndefined();
    expect(readTactical("Det 2 rollt")).toBeNull();
    expect(readTactical("Sichtkontakt zu H04 hergestellt")).toBeNull();
  });
  it("schnell genug für jeden Tastendruck (< 2 ms)", () => {
    const texts = ["1 gn hz inf in AB12 Rtg N", "mögliche IED in AF13 bei der Brücke", "1015 H04 2 Kpz und 3 Spz Rtg Bern, gn", "Unfall mit Verletzten auf Hauptstrasse"];
    readTactical(texts[0]!);
    const t0 = performance.now();
    for (let i = 0; i < 400; i++) readTactical(texts[i % texts.length]!);
    expect((performance.now() - t0) / 400).toBeLessThan(2);
  });
});

describe("Meldung erkennen mit Katalog (parseMeldung)", () => {
  it("«1 gn hz inf»: Feind, Stufe, SIDC, Sinn; im Eintrag übernommen", () => {
    const d = parseMeldung("1015 H04 1 gn hz inf in C12", ctx());
    expect(d.kind).toBe("feind");
    expect(d.melder).toBe("H04");
    expect(d.sym).toBe("inf");
    expect(d.echelon).toBe("hz");
    expect(d.count).toBe(1);
    expect(d.sidc).toBe("SHGPUCI----C---");
    expect(d.desc).toBe("1 gegnerischer Halbzug Infanterie");
    const e = eventFromDraft(d, "dev");
    expect(e.sidc).toBe(d.sidc);
    expect(e.echelon).toBe("hz");
    expect(e.desc).toBe(d.desc);
    expect(e.status).toBeUndefined();
  });
  it("«mögliche IED in AF13» → Feind, gestrichelt (Doktrin: Zugehörigkeit bleibt H)", () => {
    const d = parseMeldung("mögliche IED in C13", ctx());
    expect(d.kind).toBe("feind");
    expect(d.aff).toBe("H");
    expect(d.status).toBe("anticipated");
    expect(d.sidc).toBe("SHGAEXI--------");
    expect(d.desc).toBe("mögliche IED");
    expect(eventFromDraft(d, "dev").status).toBe("anticipated");
  });
  it("Sperre / Strassensperre / Checkpoint sind Sichtungen mit Lage auf der Strasse", () => {
    for (const t of ["Sperre in C13", "gn Strassensperre D10", "Checkpoint bei C12"]) {
      const d = parseMeldung(t, ctx());
      expect(d.kind, t).toBe("feind");
      expect(catalogEntry(d.sym)!.placement, t).toBe("strasse");
    }
  });
  it("«1 Kp Pz»: «Kp» ist kein Melder; Anzahl → Feind", () => {
    const d = parseMeldung("1 Kp Pz in C12", ctx());
    expect(d.melder).toBe("");
    expect(d.kind).toBe("feind");
    expect(d.sidc).toBe("SHGPUCA----E---");
    expect(d.desc).toBe("1 gegnerische Kompanie Panzer");
  });
  it("eigene Elemente bleiben eigen", () => {
    const a = parseMeldung("0955 H04 Beo Stao C12 D", ctx());
    expect(a.kind).toBe("eigen");
    expect(a.sym).toBe("beob_aufkl");
    const b = parseMeldung("1000 Zug 2 bezieht Stellung C12", ctx());
    expect(b.kind).toBe("eigen");
    expect(b.melder).toBe("Zug 2");
    expect(b.sym).toBe("stellung");
    expect(b.aff).toBe("F");
  });
  it("Zivile sind unklar, gegnerisch übersteuert «vermutlich»", () => {
    expect(parseMeldung("20 Flüchtlinge Rtg Bern", ctx()).kind).toBe("unklar");
    const d = parseMeldung("vermutlich gn Kpz in C12", ctx());
    expect(d.kind).toBe("feind");
    expect(d.status).toBe("anticipated");
    expect(d.sidc).toBe("SHGAEVATH-MQ---");
  });
});
