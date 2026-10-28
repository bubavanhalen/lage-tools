import { describe, expect, it } from "vitest";
import {
  KI_LIMITS, KI_MAX_TOKENS, KI_MODELS, analyzeJournal, analyzeRedCoas, buildCoaExplainRequest, buildHandwritingRequest,
  buildHintExplainRequest, buildLageberichtRequest, buildMeldungRequest, compactNames, demoExercise, demoFeldSheet,
  estimateKiCost, estimateKiInputUnits, eventLine, kiApiBody, kiEnabled, kiPreviewText, lastPosition, maskCoordinates,
  parseExplainResponse, parseHandwritingResponse, parseLageberichtResponse, parseMeldung, parseMeldungResponse,
  parseTextResponse, rasterDescription, readKiResponse, type Exercise, type Hint, type KiContext, type KiRequest, type LageEvent,
} from "../src";

// KI (Claude): Anfragen bauen und Antworten prüfen – nur fiktive Daten (Beispiel Bern, Raster BERN AA–AU × 1–15 à 500 m).

const T = "2030-05-15T07:25";
const PHOTO = { base64: "QUJDREVGRw==", mime: "image/jpeg", bytes: 430000 };

function demo(): Exercise {
  const ex = demoExercise();
  ex.places = [{ name: "Kirche Wabern", pos: { e: 2600700, n: 1197800 } }];
  return ex;
}
const ctxOf = (ex: Exercise, t = T): KiContext => ({ ex, t });
const textOf = (r: KiRequest) => r.messages.flatMap((m) => m.content).map((c) => (c.type === "text" ? c.text : "")).join("\n");
const jctx = (ex: Exercise) => ({
  sheets: ex.sheets, areas: ex.areas, units: ex.units, places: ex.places, days: ex.days, day: ex.days[1]!, now: new Date(2030, 4, 15, 7, 30),
  lastPos: (u: string, s: LageEvent["side"]) => lastPosition(ex.events ?? [], s, u),
});

function allRequests(ex = demo()) {
  const ctx = ctxOf(ex);
  const { hints } = analyzeJournal(ex, { t: T });
  const coas = analyzeRedCoas(ex, { t: T, hints }).picked;
  return {
    ex, hints, coas,
    reqs: [
      buildHandwritingRequest(PHOTO, ctx),
      buildMeldungRequest("H02 sieht 3 Pers bei der Kirche Wabern, eventuell bewaffnet, laufen Richtung Bahnhof", ctx),
      ...hints.map((h) => buildHintExplainRequest(h, ex.events!, ctx)),
      ...coas.map((c) => buildCoaExplainRequest(c, ex.events!, ctx)),
      buildLageberichtRequest(ctx, { hints, coas }),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
describe("Datensparsamkeit (alle Anfragen)", () => {
  const { ex, hints, coas, reqs } = allRequests();
  const json = reqs.map((r) => JSON.stringify(r));

  it("alle Zwecke vertreten, max_tokens je Zweck", () => {
    expect(new Set(reqs.map((r) => r.purpose))).toEqual(new Set(["handschrift", "meldung", "hinweis", "lagerot", "lagebericht"]));
    for (const r of reqs) expect(r.max_tokens).toBe(KI_MAX_TOKENS[r.purpose]);
  });
  it("keine Meldungs-, Hinweis- oder Möglichkeits-IDs", () => {
    const ids = [...ex.events!.map((e) => e.id), ...hints.map((h) => h.id), ...coas.map((c) => c.id)];
    for (const j of json) for (const id of ids) expect(j.includes(id), id).toBe(false);
  });
  it("keine Gerätekennung, Übungs-ID, Übungsname, Kalenderdaten, Schlüssel", () => {
    for (const j of json) {
      expect(j).not.toMatch(/dev-/);
      expect(j).not.toContain("ex-beispiel-bern");
      expect(j).not.toContain("Beispiel Bern");
      expect(j).not.toMatch(/2030-0\d-\d\d/);
      expect(j).not.toMatch(/sk-ant|x-api-key/i);
    }
  });
  it("keine Koordinaten (nur Planquadrate)", () => {
    for (const j of json) {
      expect(j).not.toMatch(/(?<!\d)[12]\d{6}(?!\d)/);
      expect(j).not.toMatch(/2'6\d\d'\d{3}/);
    }
  });
  it("Foto nur bei Handschrift, sonst nur Text", () => {
    for (const r of reqs) {
      const images = r.messages.flatMap((m) => m.content).filter((c) => c.type === "image");
      expect(images.length).toBe(r.purpose === "handschrift" ? 1 : 0);
      expect(r.disclosure.imageBytes !== undefined).toBe(r.purpose === "handschrift");
    }
  });
  it("Offenlegung: Zusammenfassung, Einträge und Zeichenzahl", () => {
    for (const r of reqs) {
      expect(r.disclosure.summary.length).toBeGreaterThan(10);
      expect(r.disclosure.items.length).toBeGreaterThan(0);
      expect(r.disclosure.chars).toBe(r.system.length + r.messages[0]!.content.reduce((n, c) => n + (c.type === "text" ? c.text.length : 0), 0));
    }
  });
  it("Anweisungen: Schweizer Schreibweise und Grundsätze", () => {
    for (const r of reqs) {
      expect(r.system).not.toMatch(/ß/);
      expect(r.system).toContain("keine Fakten");
      expect(r.system).toContain("Der Zfhr entscheidet");
      expect(r.system).toContain("Erfinde nichts");
      expect(r.system).toMatch(/T2 0640 H05: 6 Pers AP10/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe("buildHandwritingRequest", () => {
  const ex = demo();
  const r = buildHandwritingRequest(PHOTO, ctxOf(ex));

  it("Struktur: Foto zuerst, dann Hilfen; Werkzeug meldungen_erkannt", () => {
    const c = r.messages[0]!.content;
    expect(r.messages).toHaveLength(1);
    expect(c[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJDREVGRw==" } });
    expect(c[1]!.type).toBe("text");
    expect(r.tool?.name).toBe("meldungen_erkannt");
    expect((r.tool!.input_schema as { required: string[] }).required).toEqual(["zeilen"]);
  });
  it("Kontext: Melder, Elemente Rot, Raster-Muster, NAI-Namen, Übungstage", () => {
    const t = textOf(r);
    expect(t).toContain("H01, H02, H03, H04, H05");
    expect(t).toContain("Det 1, Det 2");
    expect(t).toContain("PQ AA–AU × 1–15");
    expect(t).toContain("NAI 1, NAI 2, NAI 3");
    expect(t).toContain("T1, T2");
  });
  it("keine Meldungsinhalte, keine Orte", () => {
    const t = textOf(r);
    for (const w of ["Kofferraum", "Lieferwagen", "Drohne", "Kirche Wabern", "Seftigenstrasse"]) expect(t).not.toContain(w);
  });
  it("Offenlegung: Foto mit Grösse, Namen, Raster, NAI", () => {
    expect(r.disclosure.items).toEqual([
      "Foto (420 kB)", "Namen der eigenen Elemente H01–H05", "Namen der Elemente Rot Det 1, Det 2",
      "Raster-Bezeichnungen (Muster, ohne Koordinaten)", "NAI-Namen (3)",
    ]);
    expect(r.disclosure.imageBytes).toBe(430000);
  });
  it("Data-URL wird zu reinem Base64, Grösse ohne Angabe aus Base64", () => {
    const r2 = buildHandwritingRequest({ base64: "data:image/png;base64,QUJD\nREVG", mime: "IMAGE/PNG", bytes: 0 }, ctxOf(ex));
    const img = r2.messages[0]!.content[0]!;
    expect(img.type === "image" && img.source.data).toBe("QUJDREVG");
    expect(img.type === "image" && img.source.media_type).toBe("image/png");
    expect(r2.disclosure.imageBytes).toBe(6);
  });
  it("ungeeignetes Bild → Fehler in Klartext", () => {
    expect(() => buildHandwritingRequest({ ...PHOTO, mime: "application/pdf" }, ctxOf(ex))).toThrow(/Format/);
    expect(() => buildHandwritingRequest({ ...PHOTO, base64: "" }, ctxOf(ex))).toThrow(/leer/);
    expect(() => buildHandwritingRequest({ ...PHOTO, base64: "A".repeat(KI_LIMITS.IMAGE_MAX_B64 + 4) }, ctxOf(ex))).toThrow(/zu gross/);
  });
  it("Feld-Raster wird in Worten beschrieben", () => {
    const d = rasterDescription([demoFeldSheet()])[0]!;
    expect(d).toContain("Zeile (Buchstaben) + Spalte (Zahl)");
    expect(d).toMatch(/PQ A–X × 1–30/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("buildMeldungRequest", () => {
  const ex = demo();
  const text = "H02 sieht 3 Pers bei der Kirche Wabern, eventuell bewaffnet, laufen Richtung Bahnhof";
  const r = buildMeldungRequest(text, ctxOf(ex));
  const t = textOf(r);

  it("Text wörtlich, Werkzeug meldung", () => {
    expect(t).toContain(`«${text}»`);
    expect(r.tool?.name).toBe("meldung");
    expect((r.tool!.input_schema as { required: string[] }).required).toEqual(["kurz", "begruendung", "unsicher"]);
  });
  it("Kontext: letzter Standort des Melders als PQ, NAI mit PQ-Bereich, Orte mit PQ", () => {
    expect(t).toContain("Letzter Standort von H02: PQ AL9 A (gemeldet T2 05:40)");
    expect(t).toContain("NAI 3 (PQ AK11–AM13, Engnis, überwacht durch H05)");
    expect(t).toContain("Kirche Wabern (PQ AL10 C)");
    expect(t).toContain("Lagezeit: T2 07:25");
  });
  it("Offenlegung nennt jede Datenart", () => {
    expect(r.disclosure.items).toContain(`Meldungstext (${text.length} Zeichen)`);
    expect(r.disclosure.items).toContain("Letzter Standort von H02 (als PQ)");
    expect(r.disclosure.items).toContain("Bekannte Orte mit PQ (1)");
    expect(r.disclosure.items).toContain("NAI-Namen mit PQ-Bereich (3)");
  });
  it("keine anderen Meldungen aus dem Journal", () => {
    for (const w of ["Kofferraum", "Lieferwagen", "Seftigenstrasse", "Baumstämmen"]) expect(t).not.toContain(w);
  });
  it("ohne erkennbaren Melder kein Standort", () => {
    const r2 = buildMeldungRequest("jemand sieht Rauch beim Wald", ctxOf(ex));
    expect(textOf(r2)).not.toContain("Letzter Standort");
    expect(r2.disclosure.items.some((i) => i.startsWith("Letzter Standort"))).toBe(false);
  });
  it("Koordinaten im Text werden zum PQ, langer Text gekürzt", () => {
    const r2 = buildMeldungRequest("H04: 2 Pers bei 2'600'100 / 1'199'100 " + "x".repeat(2000), ctxOf(ex));
    const t2 = textOf(r2);
    expect(t2).not.toContain("2'600'100");
    expect(t2).toMatch(/2 Pers bei PQ A\w\d+/);
    const quoted = /«([^»]*)»/.exec(t2)![1]!;
    expect(quoted.length).toBeLessThanOrEqual(KI_LIMITS.INPUT_TEXT_MAX);
  });
});

// ---------------------------------------------------------------------------------------------
describe("buildHintExplainRequest / buildCoaExplainRequest", () => {
  const { ex, hints, coas } = allRequests();
  const c1 = hints.find((h) => h.rule === "C1")!;

  it("Hinweis: Titel, Begründung, Regel mit Quelle, Auslöser gekürzt, kein Werkzeug", () => {
    const r = buildHintExplainRequest(c1, ex.events!, ctxOf(ex));
    const t = textOf(r);
    expect(r.tool).toBeUndefined();
    expect(t).toContain(`Titel: ${c1.title}`);
    expect(t).toContain("Regel C1 «Übergabe / Zusammenschluss»");
    expect(t).toContain("Quelle: TF 17 Ziff 7101");
    expect(t).toContain("T2 0345 [Feind] H02: 2 Pers AN10 laden Kisten in Kofferraum");
    expect(t).toContain("Entscheid: offen");
    expect(r.disclosure.items).toEqual(["Hinweis (Titel, Begründung, Regel und Quelle)", "1 auslösende Meldung T2 03:45 (gekürzt)", "Lagezeit"]);
  });
  it("Hinweis: nur die Auslöser, keine anderen Meldungen", () => {
    const t = textOf(buildHintExplainRequest(c1, ex.events!, ctxOf(ex)));
    expect(t).not.toContain("Lieferwagen");
    expect(t).not.toContain("Seftigenstrasse");
  });
  it("Hinweis: Entscheid des Zfhr wird genannt", () => {
    const ex2 = { ...ex, hintDecisions: { [c1.id]: { state: "bestaetigt" as const, at: T } } };
    expect(textOf(buildHintExplainRequest(c1, ex.events!, ctxOf(ex2)))).toContain("vom Zfhr bestätigt");
  });
  it("Hinweis mit vielen Auslösern: höchstens 12, neueste, Rest gezählt", () => {
    const many: Hint = { ...c1, events: ex.events!.map((e) => e.id) };
    const r = buildHintExplainRequest(many, ex.events!, ctxOf(ex));
    const t = textOf(r);
    const lines = t.split("\n").filter((l) => /^- T\d \d{4} \[/.test(l));
    expect(lines).toHaveLength(KI_LIMITS.EXPLAIN_EVENTS);
    expect(t).toMatch(/ältere weggelassen/);
    expect(lines[lines.length - 1]).toContain("4 Pers in Linie AP11");
  });
  it("Hinweis: Meldungen nach der Lagezeit werden nicht gesendet", () => {
    const many: Hint = { ...c1, events: ex.events!.map((e) => e.id) };
    const t = textOf(buildHintExplainRequest(many, ex.events!, ctxOf(ex, "2030-05-15T06:00")));
    expect(t).not.toContain("4 Pers in Linie");
  });
  it("Mögliche Aktion Rot: Indikatoren, Ziel, Zeitraum, Auslöser", () => {
    const coa = coas.find((c) => c.label === "wahrscheinlichste")!;
    const r = buildCoaExplainRequest(coa, ex.events!, ctxOf(ex));
    const t = textOf(r);
    expect(r.purpose).toBe("lagerot");
    expect(t).toContain(coa.title);
    expect(t).toMatch(/✓ erfüllt: /);
    expect(t).toMatch(/Zeitraum: ca\. T2 \d\d:\d\d–T2 \d\d:\d\d/);
    expect(t).toContain("T2 0725 [Feind] H05: 4 Pers in Linie AP11");
    expect(r.disclosure.items[0]).toBe("Mögliche Aktion Rot (Titel, Ziel, Zeitraum, Indikatoren)");
    expect(r.disclosure.items[1]).toMatch(/^\d+ auslösende Meldungen T1 \d\d:\d\d–T2 07:25 \(gekürzt\)$/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("buildLageberichtRequest", () => {
  const { ex, hints, coas } = allRequests();
  const r = buildLageberichtRequest(ctxOf(ex), { hints, coas });
  const t = textOf(r);

  it("Gliederung wie Rapport in der Anweisung, Grenze 250 Wörter", () => {
    for (const s of ["Lage Rot:", "Lage eigene:", "Absicht Rot:", "Offene Punkte / Rückfragen:", "höchstens 250 Wörter"]) expect(r.system).toContain(s);
    expect(r.tool).toBeUndefined();
  });
  it("Daten: Lagezeit, Feindannahme, Kräfte Rot, Möglichkeiten, eigene Elemente", () => {
    expect(t).toContain("Lagezeit: T2 07:25");
    expect(t).toContain("Feindannahme: 2 Det, 14 Pers, 5 Fz, 1 Drohne");
    expect(t).toMatch(/Personen: \d+–\d+, erwartet 14/);
    expect(t).toMatch(/Det \d nicht mehr gemeldet seit T2/);
    expect(t).toContain("wahrscheinlichste Möglichkeit:");
    expect(t).toContain("- H05: PQ AQ11 C (seit T2 03:30), letzte Meldung T2 07:25");
  });
  it("Meldungen seit 60 Min, neueste zuerst", () => {
    expect(t).toContain("Meldungen seit T2 06:25");
    const lines = t.split("\n").filter((l) => /^- T\d \d{4} \[/.test(l));
    expect(lines[0]).toContain("4 Pers in Linie AP11");
    expect(lines.some((l) => l.includes("Kofferraum"))).toBe(false);
    expect(r.disclosure.items).toContain(`${lines.length} Meldungen T2 06:30–T2 07:25 (gekürzt)`);
  });
  it("«seit» wählbar; höchstens 80 Meldungen, Texte gekürzt", () => {
    const ex2 = demo();
    const base = ex2.events![ex2.events!.length - 1]!;
    for (let i = 0; i < 120; i++) {
      ex2.events!.push({ ...base, id: `x${i}`, t: `2030-05-15T0${i < 60 ? 5 : 6}:${String(i % 60).padStart(2, "0")}`, text: `H03: 1 Fz in NAI 2 Rtg N ${"lang ".repeat(60)}` });
    }
    const r2 = buildLageberichtRequest(ctxOf(ex2), { hints: [], coas: [], since: "2030-05-14T18:00" });
    const lines = textOf(r2).split("\n").filter((l) => /^- T\d \d{4} \[/.test(l));
    expect(lines).toHaveLength(KI_LIMITS.LAGEBERICHT_EVENTS);
    expect(lines[0]).toContain("4 Pers in Linie AP11");
    for (const l of lines) expect(l.length).toBeLessThan(KI_LIMITS.EVENT_TEXT_MAX + 40);
  });
  it("Hinweise: verworfene nicht, bestätigte zuerst", () => {
    const [a, b] = hints.filter((h) => h.level === "hoch" && !h.until);
    const ex2 = { ...ex, hintDecisions: { [a!.id]: { state: "verworfen" as const, at: T }, [b!.id]: { state: "bestaetigt" as const, at: T } } };
    const t2 = textOf(buildLageberichtRequest(ctxOf(ex2), { hints, coas }));
    expect(t2).not.toContain(a!.title);
    const first = t2.split("\n").find((l) => l.startsWith("- [")) ?? "";
    expect(first).toContain(`[bestätigt] ${b!.title}`);
  });
  it("leeres Journal: trotzdem gültige Anfrage", () => {
    const ex2 = demo();
    ex2.events = [];
    const r2 = buildLageberichtRequest(ctxOf(ex2), { hints: [], coas: [] });
    expect(textOf(r2)).toContain("- keine");
  });
});

// ---------------------------------------------------------------------------------------------
describe("Hilfen: eventLine, maskCoordinates, compactNames", () => {
  const ex = demo();
  const ev = (patch: Partial<LageEvent>): LageEvent => ({ ...ex.events![0]!, ...patch });

  it("Melder wird ergänzt, wenn er im Text fehlt; Art in Klammern", () => {
    expect(eventLine(ev({ text: "2 Fz AK9", melder: "H02", side: "rot", aff: "H", t: "2030-05-15T06:00" }), ex)).toBe("T2 0600 [Feind] H02: 2 Fz AK9");
    expect(eventLine(ev({ text: "H02: 2 Fz AK9", melder: "H02", side: "rot", aff: "H", t: "2030-05-15T06:00" }), ex)).toBe("T2 0600 [Feind] H02: 2 Fz AK9");
  });
  it("Ort ohne PQ im Text: PQ angehängt, bei geschätztem Ort so markiert", () => {
    const l = eventLine(ev({ text: "H05: Rauch", melder: "H05", cells: undefined, nai: undefined, pos: { e: 2602800, n: 1198300 }, where: "bei H05" }), ex);
    expect(l).toMatch(/\[PQ A\w\d+ [ABCD], geschätzt\]$/);
  });
  it("Koordinaten werden zum PQ bzw. «[Koordinate]» ausserhalb des Rasters", () => {
    expect(maskCoordinates("Halt bei 2600100/1199100", ex.sheets)).toMatch(/^Halt bei PQ A\w\d+ [ABCD]$/);
    expect(maskCoordinates("Halt bei 2700000/1250000", ex.sheets)).toBe("Halt bei [Koordinate]");
  });
  it("compactNames", () => {
    expect(compactNames(["H01", "H02", "H03", "H04", "H05"])).toBe("H01–H05");
    expect(compactNames(["H01", "H03", "H04"])).toBe("H01, H03, H04");
    expect(compactNames(["Det 1", "Det 2"])).toBe("Det 1, Det 2");
  });
});

// ---------------------------------------------------------------------------------------------
describe("parseHandwritingResponse", () => {
  const ex = demo();
  const ctx = ctxOf(ex);

  it("Zeit, Melder und Text zu Kurzschrift-Zeilen", () => {
    const r = parseHandwritingResponse({
      zeilen: [
        { text: "3 Pers AK9 Rtg N", zeit: "T2 07:15", melder: "H02" },
        { text: "Beo Stao AP4 D", zeit: "0720", melder: "H03" },
        { text: "H05: Drohne über NAI 3", zeit: "0730" },
      ],
    }, ctx);
    expect(r.lines).toEqual(["T2 0715 H02: 3 Pers AK9 Rtg N", "0720 H03 Beo Stao AP4 D", "0730 H05: Drohne über NAI 3"]);
    expect(r.rows[0]!.unsicher).toEqual([]);
    expect(r.notes).toBeUndefined();
  });
  it("Zeit im Text wird nicht verdoppelt, Melder im Text nicht wiederholt", () => {
    const r = parseHandwritingResponse({ zeilen: [{ text: "0715 H02: 3 Pers AK9", zeit: "0715", melder: "H02" }, { text: "T2 07.40 - H04 Kontakt", melder: "H 04" }] });
    expect(r.lines).toEqual(["0715 H02: 3 Pers AK9", "T2 0740 H04 Kontakt"]);
  });
  it("ungültige Zeit → unsicher, ohne Zeit", () => {
    const r = parseHandwritingResponse({ zeilen: [{ text: "2 Fz AN6", zeit: "2575", melder: "H03" }, { text: "1 Fz", zeit: "um sieben", melder: "H03" }] });
    expect(r.lines).toEqual(["H03: 2 Fz AN6", "H03: 1 Fz"]);
    expect(r.rows[0]!.unsicher[0]).toMatch(/Zeit «2575» ungültig/);
    expect(r.rows[1]!.unsicher[0]).toMatch(/nicht lesbar/);
  });
  it("leere Zeilen und Duplikate fallen weg", () => {
    const r = parseHandwritingResponse({ zeilen: [{ text: "" }, { text: "  ???  " }, { text: "0715 H02 3 Pers AK9" }, { text: "0715  h02 3 pers ak9" }, { foo: 1 }, 42, null] });
    expect(r.lines).toEqual(["0715 H02 3 Pers AK9"]);
  });
  it("Zeilen über 300 Zeichen gekürzt und markiert", () => {
    const r = parseHandwritingResponse({ zeilen: [{ text: "H03: " + "sehr lange Meldung ".repeat(30) }] });
    expect(r.lines[0]!.length).toBeLessThanOrEqual(KI_LIMITS.LINE_MAX);
    expect(r.lines[0]!.endsWith("…")).toBe(true);
    expect(r.rows[0]!.unsicher).toContain("Zeile gekürzt");
  });
  it("Halluzinationsschutz: Melder, Element, PQ, NAI nicht in der Übung → unsicher", () => {
    const r = parseHandwritingResponse({ zeilen: [{ text: "2 Fz AZ19 in NAI 7 Rtg Det 5", melder: "H09", unsicher: ["Anzahl"] }] }, ctx);
    const u = r.rows[0]!.unsicher;
    expect(u).toContain("Anzahl");
    expect(u.some((x) => /Melder «H09» nicht in der Liste/.test(x) || /Element «H09»/.test(x))).toBe(true);
    expect(u).toContain("PQ «AZ19» nicht im Raster");
    expect(u).toContain("«NAI 7» nicht bekannt");
    expect(u).toContain("Element «Det 5» nicht in der Liste");
    // gültige Angaben bleiben unauffällig
    expect(parseHandwritingResponse({ zeilen: [{ text: "H03: 2 Fz AN6 in NAI 2, Det 1" }] }, ctx).rows[0]!.unsicher).toEqual([]);
  });
  it("robust: fehlende Felder, JSON als Text, Liste von Texten, Unsinn", () => {
    expect(parseHandwritingResponse(undefined)).toEqual({ lines: [], rows: [], notes: "Antwort ohne erkennbare Zeilen" });
    expect(parseHandwritingResponse({ hinweis: "Foto unscharf" })).toEqual({ lines: [], rows: [], notes: "Foto unscharf" });
    expect(parseHandwritingResponse({ zeilen: [] }).notes).toBe("Keine Meldungen erkannt");
    expect(parseHandwritingResponse('{"zeilen":[{"text":"H01 Beo Stao AE5 C"}]}').lines).toEqual(["H01 Beo Stao AE5 C"]);
    expect(parseHandwritingResponse(["H01 Beo Stao AE5 C", "H02: 1 Fz AK9"]).lines).toHaveLength(2);
    expect(parseHandwritingResponse({ zeilen: [{ text: "H01 x", unsicher: "Zeit" }] }).rows[0]!.unsicher).toEqual(["Zeit"]);
  });
  it("Schweizer Schreibweise, höchstens 60 Zeilen", () => {
    expect(parseHandwritingResponse({ zeilen: [{ text: "H02: 1 Fz an der Strasse, grosse Hast" }, { text: "H02: Straße gesperrt" }] }).lines[1]).toBe("H02: Strasse gesperrt");
    const many = parseHandwritingResponse({ zeilen: Array.from({ length: 90 }, (_, i) => ({ text: `H03: ${i + 1} Fz AN6` })) });
    expect(many.lines).toHaveLength(KI_LIMITS.HANDWRITING_LINES);
  });
});

// ---------------------------------------------------------------------------------------------
describe("parseMeldungResponse", () => {
  const ex = demo();
  const ctx = ctxOf(ex);
  const orig = "H02 sieht 3 Pers bei der Kirche Wabern, eventuell bewaffnet, laufen Richtung Bahnhof";

  it("gültige Antwort ohne Prüfung", () => {
    expect(parseMeldungResponse({ kurz: "H02: 3 Pers AL10 C Rtg Bahnhof, evtl bewaffnet", begruendung: "Kirche Wabern liegt in AL10 C.", unsicher: [] }))
      .toEqual({ kurz: "H02: 3 Pers AL10 C Rtg Bahnhof, evtl bewaffnet", begruendung: "Kirche Wabern liegt in AL10 C." });
  });
  it("fehlende/ungültige Felder", () => {
    expect(parseMeldungResponse(null)).toEqual({ kurz: "", unsicher: ["Keine Deutung erhalten"] });
    expect(parseMeldungResponse(17)).toEqual({ kurz: "", unsicher: ["Keine Deutung erhalten"] });
    expect(parseMeldungResponse({ begruendung: "x" })).toEqual({ kurz: "", begruendung: "x", unsicher: ["Keine Deutung erhalten"] });
    expect(parseMeldungResponse({ kurz: "H02: 1 Fz AK9", unsicher: "Zeit fehlt" }).unsicher).toEqual(["Zeit fehlt"]);
    expect(parseMeldungResponse('{"kurz":"H02: 1 Fz AK9"}').kurz).toBe("H02: 1 Fz AK9");
  });
  it("bereinigt: eine Zeile, ohne Anführungszeichen, gekürzt, ss", () => {
    expect(parseMeldungResponse({ kurz: "«H02: 1 Fz\nAK9 Straße»" }).kurz).toBe("H02: 1 Fz AK9 Strasse");
    const long = parseMeldungResponse({ kurz: "H02: " + "Wort ".repeat(100) });
    expect(long.kurz.length).toBeLessThanOrEqual(KI_LIMITS.LINE_MAX);
    expect(long.unsicher).toContain("Vorschlag gekürzt");
  });
  it("Prüfung: PQ aus den bekannten Orten ist erlaubt", () => {
    const r = parseMeldungResponse({ kurz: "H02: 3 Pers AL10 C Rtg Bahnhof, evtl bewaffnet", begruendung: "", unsicher: [] }, { ctx, text: orig });
    expect(r.unsicher).toBeUndefined();
  });
  it("Halluzinationsschutz: PQ, Zeit, Anzahl nicht aus der Meldung; Melder unbekannt", () => {
    const r = parseMeldungResponse({ kurz: "0715 H09: 5 Pers AK9 Rtg Bahnhof", unsicher: [] }, { ctx, text: orig });
    expect(r.unsicher).toEqual(expect.arrayContaining([
      "Element «H09» nicht in der Liste",
      "PQ AK9 steht nicht in der Meldung – prüfen",
      "Zeit 0715 steht nicht in der Meldung – prüfen",
      "Anzahl 5 steht nicht in der Meldung – prüfen",
    ]));
  });
  it("Zahlwort und vage Anzahl", () => {
    const ok = parseMeldungResponse({ kurz: "H04: 2 Fz AG13 Rtg N" }, { ctx, text: "H04 meldet zwei Fahrzeuge in AG13, fahren nach Norden" });
    expect(ok.unsicher).toBeUndefined();
    const vague = parseMeldungResponse({ kurz: "H04: 4 Pers AG13" }, { ctx, text: "H04 sieht mehrere Personen in AG13" });
    expect(vague.unsicher).toEqual(["Anzahl 4 geschätzt"]);
  });
  it("für das Lagejournal nicht lesbar: Melder bzw. Ort fehlt", () => {
    const r = parseMeldungResponse({ kurz: "3 Pers laufen herum" }, { ctx, text: "3 Personen laufen herum" });
    expect(r.unsicher).toEqual(expect.arrayContaining(["Melder fehlt"]));
    const r2 = parseMeldungResponse({ kurz: "Rauch sichtbar" }, { ctx: ctxOf({ ...ex, events: [] }), text: "Rauch sichtbar" });
    expect(r2.unsicher).toEqual(expect.arrayContaining(["Melder fehlt", "Ort fehlt"]));
  });
});

// ---------------------------------------------------------------------------------------------
describe("Rundlauf: Beispielantworten → parseMeldung", () => {
  const ex = demo();
  const cases: Array<{ orig: string; kurz: string; expect: Record<string, unknown> }> = [
    { orig: "H02 sieht 3 Pers bei der Kirche Wabern, eventuell bewaffnet, laufen Richtung Bahnhof", kurz: "H02: 3 Pers AL10 C Rtg Bahnhof, evtl bewaffnet",
      expect: { melder: "H02", count: 3, cells: ["AL10 C"], dirLabel: "Rtg Bahnhof", side: "rot" } },
    { orig: "Um 07:40 hat H04 zwei Autos gesehen, die in NAI 3 Richtung Osten gefahren sind", kurz: "0740 H04: 2 Fz in NAI 3 Rtg O",
      expect: { melder: "H04", count: 2, nai: "NAI 3", dir: 90, kind: "feind", minutes: 7 * 60 + 40 } },
    { orig: "H01 ist jetzt in AC6 Quadrant B und beobachtet von dort", kurz: "H01 Beo Stao AC6 B",
      expect: { melder: "H01", unit: "H01", kind: "eigen", cells: ["AC6 B"] } },
    { orig: "H03: ein weisser Lieferwagen fährt in AN6 Richtung Norden, Insassen nicht erkennbar", kurz: "H03: 1 ziv Fz (weisser Lieferwagen) AN6 Rtg N, Insassen nicht erkennbar",
      expect: { melder: "H03", count: 1, cells: ["AN6"], dir: 0, kind: "unklar" } },
    { orig: "H05 meldet: Strasse in AG13 mit Baumstämmen blockiert", kurz: "H05: Sperre aus Baumstämmen AG13, Strasse blockiert",
      expect: { melder: "H05", sym: "sperre", cells: ["AG13"], kind: "feind" } },
  ];
  for (const c of cases) {
    it(c.kurz, () => {
      const r = parseMeldungResponse({ kurz: c.kurz, begruendung: "Beispiel", unsicher: [] }, { ctx: ctxOf(ex), text: c.orig });
      expect(r.kurz).toBe(c.kurz);
      expect(r.unsicher).toBeUndefined();
      const d = parseMeldung(r.kurz, jctx(ex));
      expect(d).toMatchObject(c.expect);
    });
  }
});

// ---------------------------------------------------------------------------------------------
describe("Freitext-Antworten", () => {
  it("parseTextResponse: Markdown weg, Aufzählung einheitlich, ss, Leerzeilen", () => {
    const raw = "## Einschätzung\n**Mögliche** Übergabe an der Straße.\n\n\n\n* Punkt eins\n• Punkt zwei\n1. Punkt drei\n```\n";
    expect(parseTextResponse(raw)).toBe("Einschätzung\nMögliche Übergabe an der Strasse.\n\n- Punkt eins\n- Punkt zwei\n- Punkt drei");
    expect(parseTextResponse(undefined as unknown as string)).toBe("");
  });
  it("parseTextResponse: Wort- und Zeichengrenze", () => {
    expect(parseTextResponse("eins zwei drei vier fünf", { maxWords: 3 })).toBe("eins zwei drei …");
    expect(parseTextResponse("a ".repeat(5000)).length).toBeLessThanOrEqual(KI_LIMITS.TEXT_MAX_CHARS + 2);
  });
  it("parseExplainResponse: Einschätzung und höchstens drei Prüfpunkte", () => {
    const r = parseExplainResponse("Einschätzung: Zwei Pers laden um 03:45 Kisten in AN10. Das deutet auf eine Übergabe.\n\nWas prüfen:\n- Wer hat das Fz gesehen?\n- Gibt es eine zweite Quelle?\n- Fz-Kennzeichen?\n- Vierter Punkt");
    expect(r.einschaetzung).toBe("Zwei Pers laden um 03:45 Kisten in AN10. Das deutet auf eine Übergabe.");
    expect(r.pruefen).toEqual(["Wer hat das Fz gesehen?", "Gibt es eine zweite Quelle?", "Fz-Kennzeichen?"]);
    expect(parseExplainResponse("Nur ein Satz ohne Gliederung.")).toEqual({ einschaetzung: "Nur ein Satz ohne Gliederung.", pruefen: [] });
    expect(parseExplainResponse("**Einschätzung:** Text.\n**Was prüfen:**\n* A").pruefen).toEqual(["A"]);
  });
  it("parseLageberichtResponse: Gliederung bleibt, höchstens 300 Wörter", () => {
    const raw = "Lage Rot: Det 2 in AM9.\nLage eigene: H05 in AQ11 C.\nAbsicht Rot: Überfall möglich.\nOffene Punkte / Rückfragen:\n- Det 1?\n" + "Wort ".repeat(400);
    const s = parseLageberichtResponse(raw);
    expect(s.startsWith("Lage Rot: Det 2 in AM9.\nLage eigene:")).toBe(true);
    expect(s.split(/\s+/).length).toBeLessThanOrEqual(KI_LIMITS.LAGEBERICHT_MAX_WORDS + 1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("API-Hilfen", () => {
  const ex = demo();
  const meld = buildMeldungRequest("H02 sieht 1 Fz", ctxOf(ex));
  const lb = buildLageberichtRequest(ctxOf(ex), { hints: [], coas: [] });

  it("kiApiBody: Werkzeug erzwungen bzw. ohne Werkzeug", () => {
    const b = kiApiBody(meld, "claude-sonnet-5-5");
    expect(b).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: KI_MAX_TOKENS.meldung, system: meld.system, tool_choice: { type: "tool", name: "meldung" } });
    expect((b.tools as unknown[]).length).toBe(1);
    const b2 = kiApiBody(lb, "claude-haiku-5-5");
    expect(b2.tools).toBeUndefined();
    expect(b2.tool_choice).toBeUndefined();
    expect(Object.keys(b2).sort()).toEqual(["max_tokens", "messages", "model", "system"]);
  });
  it("readKiResponse: Werkzeug-Eingabe, Text, abgeschnitten, Verbrauch", () => {
    const r = readKiResponse({
      content: [{ type: "text", text: "Vorrede" }, { type: "tool_use", name: "meldung", input: { kurz: "H02: 1 Fz AK9" } }],
      stop_reason: "tool_use", usage: { input_tokens: 1200, output_tokens: 80 },
    }, meld);
    expect(r).toEqual({ toolInput: { kurz: "H02: 1 Fz AK9" }, text: "Vorrede", stopReason: "tool_use", truncated: false, usage: { input_tokens: 1200, output_tokens: 80 } });
    expect(readKiResponse({ content: [{ type: "text", text: "Lage Rot: …" }], stop_reason: "max_tokens" }).truncated).toBe(true);
    expect(readKiResponse({ content: [{ type: "tool_use", name: "anderes", input: {} }] }, meld).toolInput).toBeUndefined();
    expect(readKiResponse("Unsinn")).toEqual({ toolInput: undefined, text: "", stopReason: undefined, truncated: false, usage: undefined });
  });
  it("kiPreviewText: Rohinhalt mit Foto als Platzhalter (ohne Bilddaten)", () => {
    const hw = buildHandwritingRequest(PHOTO, ctxOf(ex));
    const p = kiPreviewText(hw);
    expect(p).toContain("[Foto 420 kB, image/jpeg]");
    expect(p).not.toContain(PHOTO.base64);
    expect(p).toContain("Antwortformular «meldungen_erkannt»");
    expect(p.startsWith("Anweisung an die KI:")).toBe(true);
  });
  it("Modelle, Kosten, Umfang, Schalter", () => {
    expect(KI_MODELS.map((m) => m.id)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]);
    expect(estimateKiCost("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(2);
    expect(estimateKiCost("unbekannt", undefined)).toBe(0);
    expect(estimateKiInputUnits(buildHandwritingRequest(PHOTO, ctxOf(ex)))).toBeGreaterThan(1600);
    expect(kiEnabled({ ki: { enabled: true } })).toBe(true);
    expect(kiEnabled({})).toBe(false);
    expect(kiEnabled(undefined)).toBe(false);
  });
});

describe("Handschrift: unbekannter Melder", () => {
  it("schreibt einen unbekannten Melder nicht in die Zeile (sonst «99 Drohnen»)", async () => {
    const { demoExercise, parseHandwritingResponse, parseMeldung } = await import("../src");
    const ex = demoExercise();
    const t = (ex.events ?? []).reduce((m, e) => (e.t > m ? e.t : m), "");
    const r = parseHandwritingResponse({ zeilen: [{ text: "0731 X99 Drohne über AL10", melder: "X99" }] }, { ex, t });
    expect(r.lines[0]).toBe("0731 Drohne über AL10");
    expect(r.rows[0]!.unsicher.join(" ")).toContain("X99");
    const d = parseMeldung(r.lines[0]!, { sheets: ex.sheets, areas: ex.areas, units: ex.units, places: ex.places ?? [], days: ex.days, day: ex.days.at(-1)!, now: new Date() } as never);
    expect(d?.count ?? 1).toBe(1);
  });
});
