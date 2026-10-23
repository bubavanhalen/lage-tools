import { describe, expect, it } from "vitest";
import { demoExercise, findCells, type Attachment, type Exercise } from "@lage/core";
import { binarize, boxBlur, clampRect, findPaper, flattenBackground, homography, otsu, photoQuality, quadSize, removeLines, rotateGray, stretch, textAxis, toGray, warpQuad, type Gray, type Quad } from "../src/photo";
import { OcrAbort, abortable, cleanOcrText, dropVisum, filterLine, fixOcrTokens, formToMeldung, linesFromBlocks, ocrToMeldungen, recognizeOriented, type OcrResult } from "../src/ocr";
import { PRUNE_AFTER_MS, pruneAttachments } from "../src/attachmentPrune";
import { addEvents, commitTexts } from "../src/commit";
import { exerciseFile, exerciseFromAny, isZip } from "../src/exportZip";

// Alle Daten fiktiv (Beispielübung Raum Bern)

const gray = (w: number, h: number, f: (x: number, y: number) => number): Gray => {
  const d = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = f(x, y);
  return { w, h, d };
};

describe("Bildaufbereitung", () => {
  it("Graustufen nach Luma", () => {
    const g = toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]), 4, 1);
    expect([...g.d]).toEqual([76, 149, 28, 255]);
  });
  it("Weichzeichnen erhält den Mittelwert einer Fläche", () => {
    const g = gray(20, 20, () => 100);
    expect(boxBlur(g, 3).d.every((v) => v === 100)).toBe(true);
  });
  it("Kontrast strecken: dunkelster → 0, hellster → 255", () => {
    const g = gray(100, 1, (x) => 100 + x);
    const s = stretch(g, 0.01, 0.01);
    expect(s.d[0]).toBe(0);
    expect(s.d[99]).toBe(255);
  });
  it("ungleiches Licht: Papier wird gleichmässig hell, Schrift bleibt dunkel", () => {
    // Papier links 230, rechts 120 (Schatten), Schrift 40 % dunkler
    const g = gray(200, 100, (x, y) => { const p = 230 - x * 0.55; return (y % 20 < 3 && x % 7 < 3) ? p * 0.4 : p; });
    const f = flattenBackground(g);
    const paperL = f.d[50 * 200 + 10]!, paperR = f.d[50 * 200 + 190]!;
    expect(Math.abs(paperL - paperR)).toBeLessThan(25);
    expect(f.d[1 * 200 + 190]!).toBeLessThan(paperR - 60);
  });
  it("Otsu trennt zwei Helligkeiten", () => {
    const t = otsu(gray(100, 10, (x) => (x < 50 ? 40 : 210)));
    expect(t).toBeGreaterThanOrEqual(40);
    expect(t).toBeLessThan(210);
  });
  it("Tabellenlinien weg, Schrift bleibt", () => {
    // weisses Blatt 400×300, waagrechte Linie y=100, senkrechte x=200, «Buchstabe» 12×20 bei (50,40)
    const g = gray(400, 300, (x, y) => (y === 100 || y === 101 || x === 200 || x === 201 || (x >= 50 && x < 62 && y >= 40 && y < 60 && (x - 50) % 4 < 2) ? 0 : 255));
    const r = removeLines(g);
    expect(r.d[100 * 400 + 300]).toBe(255);
    expect(r.d[250 * 400 + 200]).toBe(255);
    expect(r.d[45 * 400 + 50]).toBe(0);
  });
  it("Schwarz/weiss mit örtlicher Schwelle", () => {
    const g = gray(60, 60, (x, y) => (x > 20 && x < 24 ? 60 : 200 - y));
    const b = binarize(g, 8);
    expect(b.d[30 * 60 + 22]).toBe(0);
    expect(b.d[30 * 60 + 40]).toBe(255);
  });
  it("Ausschnitt begrenzen, zu kleine verwerfen, umgekehrt gezogen", () => {
    expect(clampRect({ x: 50, y: 50, w: -30, h: -30 }, 100, 100)).toEqual({ x: 20, y: 20, w: 30, h: 30 });
    expect(clampRect({ x: 90, y: 90, w: 50, h: 50 }, 100, 100)).toBeNull();
    expect(clampRect({ x: -10, y: 0, w: 60, h: 40 }, 100, 100)).toEqual({ x: 0, y: 0, w: 50, h: 40 });
  });
  it("Projektive Abbildung trifft die vier Ecken", () => {
    const src: Quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
    const dst: Quad = [{ x: 10, y: 5 }, { x: 120, y: 12 }, { x: 115, y: 70 }, { x: 4, y: 60 }];
    const H = homography(src, dst);
    for (let i = 0; i < 4; i++) {
      const { x, y } = src[i]!;
      const z = H[6]! * x + H[7]! * y + H[8]!;
      expect((H[0]! * x + H[1]! * y + H[2]!) / z).toBeCloseTo(dst[i]!.x, 6);
      expect((H[3]! * x + H[4]! * y + H[5]!) / z).toBeCloseTo(dst[i]!.y, 6);
    }
  });
  it("Papier auf dunklem Tisch finden und gerade ziehen", () => {
    // schräges helles Viereck auf dunklem Grund
    const q: Quad = [{ x: 120, y: 80 }, { x: 620, y: 110 }, { x: 600, y: 520 }, { x: 90, y: 480 }];
    const inside = (x: number, y: number) => {
      let c = false;
      for (let i = 0, j = 3; i < 4; j = i++) { const a = q[i]!, b = q[j]!; if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c; }
      return c;
    };
    const g = gray(720, 600, (x, y) => (inside(x, y) ? 225 : 60));
    const f = findPaper(g)!;
    expect(f).not.toBeNull();
    for (let i = 0; i < 4; i++) { expect(Math.abs(f[i]!.x - q[i]!.x)).toBeLessThan(14); expect(Math.abs(f[i]!.y - q[i]!.y)).toBeLessThan(14); }
    const s = quadSize(f);
    const w = warpQuad(g, f, s.w, s.h);
    // gerade gezogen: fast nur Papier
    const bright = w.d.filter((v) => v > 150).length / w.d.length;
    expect(bright).toBeGreaterThan(0.95);
  });
  it("kein Papierrand im Bild → nichts zuschneiden", () => {
    expect(findPaper(gray(300, 200, () => 230))).toBeNull();
  });
});

describe("Erkannter Text → Meldungen", () => {
  const ex = demoExercise();
  const isCell = (c: string) => findCells(c, ex.sheets).length > 0;
  it("typische Lesefehler", () => {
    const cases: Array<[string, string]> = [
      ["0715 HO4 2FzZAG13RIgN", "0715 H04 2 Fz AG13 Rtg N"],
      ["0722 Ho2 Det 23PersAK9B", "0722 H02 Det 23 Pers AK9 B"],
      ["0802 HO4 1 9n Hz Inf AH12 RIg W", "0802 H04 1 gn Hz Inf AH12 Rtg W"],
      ["0755 HO1 Beo Stao AES C bezogen", "0755 H01 Beo Stao AE5 C bezogen"],
      ["o730 HOS Sperre in NAI 3", "0730 H05 Sperre in NAI 3"],
      ["0810 H02 4 Pers AKLO RIGN", "0810 H02 4 Pers AK10 Rtg N"],
      ["0741 H03 1 2iv Fz", "0741 H03 1 ziv Fz"],
      ["HOo1 rollt ab", "H01 rollt ab"],
    ];
    for (const [a, b] of cases) expect(fixOcrTokens(a, isCell)).toBe(b);
  });
  it("Planquadrat nur korrigieren, wenn es im Raster liegt", () => {
    expect(fixOcrTokens("ZZS", isCell)).toBe("ZZS");
    expect(fixOcrTokens("AZS", isCell)).toBe("AZS");
  });
  it("Journalseite: Kopfzeilen weg, Visum weg, je Zeile eine Meldung", () => {
    const raw = ["LAGEJOURNAL LVZ", "Übung BEISPIEL BERN (fiktiv) - Blatt 3", "Zeit Melder Meldung Visum", "| 0715 | HO4 | 2 Fz AG13 Rtg N | ts", "0722 H02 Det 2 3 Pers AK9 B \\s", "Folgezeile zur Meldung", "0730 H05 Sperre in NAI 3, Strasse blockiert mb"].join("\n");
    expect(ocrToMeldungen(raw, isCell, ex.days)).toEqual([
      "0715 H04 2 Fz AG13 Rtg N",
      "0722 H02 Det 2 3 Pers AK9 B Folgezeile zur Meldung",
      "0730 H05 Sperre in NAI 3, Strasse blockiert",
    ]);
  });
  it("«fährt ab» am Ende bleibt (kein Visum)", () => {
    expect(ocrToMeldungen("0715 H04 Det 2 fährt ab\n0720 H05 2 Fz AG13", isCell)[0]).toBe("0715 H04 Det 2 fährt ab");
  });
  it("Meldezettel (Formular) → eine Meldung mit Tag", () => {
    const raw = "MELDEZETTEL\nDatum 15.05.2030\nZeit 0645\nAbsender H05\nEmpfänger LVZ\nMeldung 3 Fz in Kolonne AP10 Rtg W, fahren ohne\nLicht\nUnterschrift";
    expect(formToMeldung(raw, ex.days)).toBe("T2 0645 H05 3 Fz in Kolonne AP10 Rtg W, fahren ohne Licht");
    expect(ocrToMeldungen(raw, isCell, ex.days)).toEqual(["T2 0645 H05 3 Fz in Kolonne AP10 Rtg W, fahren ohne Licht"]);
    expect(formToMeldung("0715 H04 2 Fz AG13\n0720 H05 Sperre")).toBeNull();
  });
  it("Trennstriche und Störzeichen am Zeilenanfang", () => {
    expect(cleanOcrText("[0755 H01 Beo Stao\n| 0802 H04")).toBe("0755 H01 Beo Stao\n0802 H04");
  });
  it("unsichere Störwörter weg, Zeit/Element bleiben", () => {
    expect(filterLine([{ text: "|o722", confidence: 30 }, { text: "Det", confidence: 80 }, { text: "§%", confidence: 5 }, { text: "AK9", confidence: 70 }])?.text).toBe("|o722 Det AK9");
    expect(filterLine([{ text: "~~", confidence: 10 }, { text: "x", confidence: 4 }])).toBeNull();
  });
});

describe("Eintrage-Weg (commit.ts)", () => {
  const att: Attachment = { id: "att-test1", kind: "foto", mime: "image/jpeg", createdAt: "2030-05-15T07:20:00.000Z", size: 1000, text: "…", engine: "ocr-offline" };
  const run = (texts: string[], a?: Attachment) => {
    let ex: Exercise = demoExercise();
    const before = ex.events!.length;
    const evs = commitTexts(texts, { ex, device: "dev-test", update: (f) => { ex = f(structuredClone(ex)); }, day: ex.days[1], attachment: a });
    return { ex, evs, before };
  };
  it("mehrere Meldungen wie getippt: Zeit, Melder, Zeichen, Ort", () => {
    const { ex, evs, before } = run(["0715 H04 2 Fz AG13 Rtg N", "0722 H02 Det 2 3 Pers AK9 B", "0730 H05 Sperre in NAI 3"], att);
    expect(evs).toHaveLength(3);
    expect(ex.events!.length).toBe(before + 3);
    expect(evs[0]!.t).toBe("2030-05-15T07:15");
    expect(evs[0]!.melder).toBe("H04");
    expect(evs[0]!.cells).toEqual(["AG13"]);
    expect(evs[0]!.side).toBe("rot");
    expect(evs[1]!.unit).toBe("Det 2");
    expect(evs[2]!.nai).toBe("NAI 3");
    // Foto an jeder Meldung, Metadaten in der Übung, Herkunft «image»
    expect(evs.every((e) => e.attachments?.[0] === "att-test1" && e.source?.kind === "image")).toBe(true);
    expect(ex.attachments?.filter((a) => a.id === "att-test1")).toHaveLength(1);
    // Reihenfolge eindeutig (gleiche Zeit → IDs steigen)
    expect(new Set(evs.map((e) => e.id)).size).toBe(3);
  });
  it("neue Elemente werden gemerkt, spätere Meldung sieht frühere", () => {
    const { ex } = run(["0700 H09 Beo Stao AE5 C", "0710 H09 2 Fz AG13"]);
    expect(ex.units.blau).toContain("H09");
  });
  it("leere Texte werden übersprungen, Anhang mehrfach → einmal", () => {
    let ex = demoExercise();
    const up = (f: (x: Exercise) => Exercise) => { ex = f(structuredClone(ex)); };
    commitTexts(["", "  "], { ex, device: "d", update: up, attachment: att });
    commitTexts(["0715 H04 2 Fz AG13"], { ex, device: "d", update: up, attachment: att });
    expect(ex.attachments?.filter((a) => a.id === att.id)).toHaveLength(1);
  });
  it("Anhang nur an Planquadrat (ohne Meldung)", () => {
    const ex = addEvents(demoExercise(), [], { attachments: [{ ...att, cell: "AG13" }] });
    expect(ex.attachments?.[0]?.cell).toBe("AG13");
  });
});

describe("Übung mit Anhängen speichern/öffnen", () => {
  it("ohne Anhänge: JSON", async () => {
    const ex = demoExercise();
    const r = await exerciseFile(ex, "Beispiel", async () => null);
    expect(r.name).toBe("Beispiel.lage.json");
    expect(await isZip(r.blob)).toBe(false);
    const back = await exerciseFromAny(r.blob, async () => { throw new Error("kein Anhang erwartet"); });
    expect(back.ex.id).toBe(ex.id);
  });
  it("mit Anhängen: ZIP hin und zurück", async () => {
    const ex = demoExercise();
    ex.attachments = [
      { id: "att-a", kind: "foto", mime: "image/jpeg", createdAt: "2030-05-15T07:20:00Z", cell: "AG13" },
      { id: "att-b", kind: "audio", mime: "audio/webm;codecs=opus", createdAt: "2030-05-15T07:21:00Z" },
      { id: "att-fehlt", kind: "foto", mime: "image/jpeg", createdAt: "2030-05-15T07:22:00Z" },
    ];
    const blobs: Record<string, Blob> = { "att-a": new Blob([new Uint8Array([0xff, 0xd8, 1, 2, 3])], { type: "image/jpeg" }), "att-b": new Blob([new Uint8Array([9, 8, 7])], { type: "audio/webm" }) };
    const r = await exerciseFile(ex, "Beispiel", async (id) => blobs[id] ?? null);
    expect(r.name).toBe("Beispiel.lage.zip");
    expect(r.files).toBe(2);
    expect(r.missing).toBe(1);
    expect(await isZip(r.blob)).toBe(true);
    const got: Record<string, Uint8Array> = {};
    const back = await exerciseFromAny(r.blob, async (id, b) => { got[id] = new Uint8Array(await b.arrayBuffer()); });
    expect(back.files).toBe(2);
    expect(back.ex.attachments).toHaveLength(3);
    expect([...got["att-a"]!]).toEqual([0xff, 0xd8, 1, 2, 3]);
    expect([...got["att-b"]!]).toEqual([9, 8, 7]);
  });
});

// ---------------------------------------------------------------- Etappe 4b (Nachbesserung)

/** fiktive «Schrift»: Blöcke in Zeilen (Buchstabe 10×14 px, Abstand 6 px, Zeilenabstand 34 px) */
const textPage = (w = 600, h = 400) => gray(w, h, (x, y) => {
  const inLine = y % 34 >= 8 && y % 34 < 22;
  const inChar = x % 16 < 10 && x > 30 && x < w - 30 && y > 20 && y < h - 20;
  return inLine && inChar ? 30 : 235;
});

describe("Bildqualität und Ausrichtung", () => {
  it("scharf ↔ unscharf ↔ dunkel", () => {
    const sharp = textPage();
    const blurred = boxBlur(boxBlur(sharp, 3), 3);
    const dark = gray(sharp.w, sharp.h, (x, y) => sharp.d[y * sharp.w + x]! * 0.55);
    expect(photoQuality(sharp).verdict).toBe("gut");
    expect(photoQuality(blurred).verdict).toBe("unscharf");
    expect(photoQuality(dark).verdict).toBe("dunkel");
    expect(photoQuality(sharp).sharp).toBeGreaterThan(photoQuality(blurred).sharp);
  });
  it("vergrösserter Ausschnitt gilt nicht als unscharf (Massstab)", () => {
    const soft = boxBlur(textPage(), 1);
    expect(photoQuality(soft, 2).sharp).toBeGreaterThan(photoQuality(soft, 1).sharp);
  });
  it("drehen: 4 × 90° = unverändert, 90° tauscht Breite/Höhe", () => {
    const g = gray(7, 3, (x, y) => x * 10 + y);
    const r = rotateGray(g, 1);
    expect([r.w, r.h]).toEqual([3, 7]);
    expect(r.d[0 * 3 + 2]).toBe(g.d[0]); // oben links → oben rechts
    expect([...rotateGray(rotateGray(r, 1), 2).d]).toEqual([...g.d]);
  });
  it("Zeilen waagrecht bzw. senkrecht (Foto quer)", () => {
    const g = textPage();
    expect(textAxis(g)).toBeGreaterThan(0.6);
    expect(textAxis(rotateGray(g, 1))).toBeLessThan(0.4);
    expect(Number.isNaN(textAxis(gray(200, 200, () => 255)))).toBe(true);
  });
  it("quer fotografiert: dreht zuerst, nimmt das bessere Ergebnis", async () => {
    const paper = rotateGray(textPage(), 1);
    const tried: number[] = [];
    const rec = async (g: Gray, i: number): Promise<OcrResult> => {
      tried.push(i);
      const ok = textAxis(g) > 0.6;
      return { text: ok ? "0715 H04 2 Fz AG13" : "xx", confidence: ok ? 85 : 20, lines: [], ms: 1 };
    };
    const r = await recognizeOriented({ g: paper, paper, quality: photoQuality(paper) }, rec);
    expect(r.rotation === 1 || r.rotation === 3).toBe(true);
    expect(r.confidence).toBe(85);
    expect(tried).toEqual([0]);
  });
  it("Abbrechen beendet das Warten sofort", async () => {
    const ac = new AbortController();
    const never = new Promise<number>(() => { /* hängt */ });
    const p = abortable(never, ac.signal);
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(OcrAbort);
  });
});

const W = (text: string, x0: number, x1: number, confidence = 90, y0 = 100, y1 = 125) => ({ text, confidence, bbox: { x0, y0, x1, y1 } });

describe("Visum und Zeilenende", () => {
  it("Visum weit rechts weg, auch hinter Tabellenstrich", () => {
    expect(dropVisum([W("0618", 59, 121), W("H05", 206, 257), W("Det", 411, 458), W("C", 742, 764), W("ab", 1590, 1637), W("|", 1863, 1866)]).map((w) => w.text))
      .toEqual(["0618", "H05", "Det", "C"]);
  });
  it("Einheit direkt dahinter bleibt, Formularfeld bleibt", () => {
    expect(dropVisum([W("Höhe", 706, 787), W("ca", 798, 835), W("100", 848, 905), W("m", 917, 945)]).length).toBe(4);
    expect(dropVisum([W("Absender", 200, 425), W("HO5", 674, 768)]).length).toBe(2);
    expect(dropVisum([W("0715", 50, 110), W("H04", 200, 250), W("AK7", 700, 760)]).length).toBe(3);
  });
  it("Zeile nur mit Visum (eigene Zeile) fällt weg; unsichere Richtung nach «Rtg» bleibt", () => {
    const r = linesFromBlocks({ confidence: 80, blocks: [{ paragraphs: [{ lines: [
      { words: [W("0647", 59, 121), W("H06", 207, 259), W("2", 413, 428), W("Kpz", 440, 492), W("Rtg", 631, 681, 52), W("S", 693, 714, 40), W("cd", 1602, 1647)], bbox: { x0: 59, y0: 100, x1: 1647, y1: 125 } },
      { words: [W("ef", 1591, 1645)], bbox: { x0: 1591, y0: 140, x1: 1645, y1: 165 } },
    ] }] }] });
    expect(r.text).toBe("0647 H06 2 Kpz Rtg S");
  });
  it("Einheiten am Ende werden nicht abgeschnitten", () => {
    const isCell = (c: string) => findCells(c, demoExercise().sheets).length > 0;
    expect(ocrToMeldungen("0640 H04 Drohne über AG13, Höhe ca 100 m\n0641 H05 Rtg S, 2 km\n0642 H02 wartet 5 min", isCell)).toEqual([
      "0640 H04 Drohne über AG13, Höhe ca 100 m", "0641 H05 Rtg S, 2 km", "0642 H02 wartet 5 min",
    ]);
  });
  it("Lesefehler aus Prüfer-Fotos: «Rtg ©», «NA13», «3RtgS», «!'H05», «Pwziv»", () => {
    const ex = demoExercise();
    const isCell = (c: string) => findCells(c, ex.sheets).length > 0;
    const nai = ex.areas.filter((a) => a.kind === "nai").map((a) => a.name);
    expect(ocrToMeldungen("0612 H03 2 Pwziv AN6 Rtg ©\n0618 !'H05 Det 1 Checkpoint AK7 ©\n0625 ) H01 verschiebt\n0647 H06 2 Kpz in NA13 S\n0648 H06 2 Kpz in NAI 3RtgS", isCell, ex.days, nai)).toEqual([
      "0612 H03 2 Pw ziv AN6 Rtg O", "0618 H05 Det 1 Checkpoint AK7 C", "0625 H01 verschiebt", "0647 H06 2 Kpz in NAI 3 S", "0648 H06 2 Kpz in NAI 3 Rtg S",
    ]);
  });
});

describe("Speicher freigeben (Anhänge)", () => {
  const now = Date.parse("2030-05-15T08:00:00Z");
  const att = (id: string, kind: Attachment["kind"] = "foto", cell?: string): Attachment => ({ id, kind, mime: kind === "foto" ? "image/jpeg" : "audio/webm", createdAt: "2030-05-15T07:00:00Z", ...(cell ? { cell } : {}) });
  const ev = (id: string, atts: string[], deleted = false, updatedAt = "2030-05-15T07:00:00Z") => ({ id, attachments: atts, deleted, updatedAt }) as unknown as NonNullable<Exercise["events"]>[number];
  it("Foto nur an gelöschter Meldung → nach Wartezeit frei; vorher nicht (Rückgängig)", () => {
    const ex = { attachments: [att("a")], events: [ev("e1", ["a"], true, new Date(now - PRUNE_AFTER_MS - 1).toISOString())] };
    expect(pruneAttachments(ex, now)).toEqual(["a"]);
    const fresh = { attachments: [att("a")], events: [ev("e1", ["a"], true, new Date(now - 1000).toISOString())] };
    expect(pruneAttachments(fresh, now)).toEqual([]);
  });
  it("noch von einer anderen Meldung gebraucht, an Planquadrat, Memo im Memo-Fach → bleibt", () => {
    const ex = {
      attachments: [att("a"), att("b", "foto", "AG13"), att("m", "audio"), att("x")],
      events: [ev("e1", ["a"], true), ev("e2", ["a"]), ev("e3", ["b"], true)],
    };
    expect(pruneAttachments(ex, now)).toEqual(["x"]);
  });
  it("Memo an gelöschter Meldung → frei", () => {
    expect(pruneAttachments({ attachments: [att("m", "audio")], events: [ev("e1", ["m"], true)] }, now)).toEqual(["m"]);
  });
});
