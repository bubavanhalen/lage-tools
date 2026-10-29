/**
 * Journal-PDF (Spez. MVP 3, Kap. 3.9, Abnahme 8.4 Punkt 5): Umfang, Zeilen, Tageszeile mit Wochentag, Visum,
 * «Seite n von m», Seitenbudget Schicht ≤ 5 bei der langen Übung (fiktiv, Raum Bern).
 */
import { describe, expect, it, vi } from "vitest";
import { analyzeJournal, demoExercise, demoLang, journalDruckVorwahl, type Exercise } from "@lage/core";

/** alle Texte, die an das PDF gehen (nach safePdf) */
const seen: string[] = [];
vi.mock("jspdf", async (orig) => {
  const m = await orig<typeof import("jspdf")>();
  class Rec extends m.jsPDF {
    constructor(...a: ConstructorParameters<typeof m.jsPDF>) {
      super(...a);
      const text = this.text.bind(this);
      const collect = (v: unknown): void => { if (typeof v === "string") seen.push(v); else if (Array.isArray(v)) v.forEach(collect); };
      (this as { text: unknown }).text = (t: unknown, ...r: unknown[]) => { collect(t); return (text as (...x: unknown[]) => unknown)(t, ...r); };
    }
  }
  return { ...m, jsPDF: Rec, default: Rec };
});

const { journalPdf, journalPdfRows, journalPdfSeiten, visumZeilen } = await import("../src/journalpdf");
const { parseTagZeit, tagZeile, umfangText, wochentagOf } = await import("../src/print/umfang");
const { isWinAnsi } = await import("../src/pdfSafe");

const T4 = "2030-05-18T07:30";
const opts = (ex: Exercise, art: "schicht" | "tag" | "alles", from: string | null, to = T4) => ({
  umfang: { art, from, to }, anhang: { lageRot: false, hinweise: true, ohneGestrichene: false }, klassifizierung: ex.klassifizierung ?? "INTERN", kuerzel: "BSP",
});

describe("Journal-PDF", () => {
  const lang = demoLang();
  const hints = analyzeJournal(lang, { t: T4 }).hints;

  it("Wochentage und Tageszeile «T4 · Samstag 18.05.2030»", () => {
    expect(wochentagOf("2030-05-15")).toBe("Mittwoch");
    expect(wochentagOf("2030-05-18")).toBe("Samstag");
    expect(tagZeile("2030-05-18", lang.days)).toBe("T4 · Samstag 18.05.2030");
    expect(parseTagZeit("T2 0731", lang.days, T4)).toBe("2030-05-16T07:31");
    expect(parseTagZeit("07:05", lang.days, T4)).toBe("2030-05-18T07:05");
    expect(parseTagZeit("T9 0700", lang.days, T4)).toBeNull();
    expect(parseTagZeit("2561", lang.days, T4)).toBeNull();
  });

  it("Schicht der langen Übung: ≤ 5 Seiten, Kopf, Tageszeile, Seite n von m, Visum, Klassifizierung", () => {
    const s = lang.schichten!.filter((x) => x.t <= T4).sort((a, b) => a.t.localeCompare(b.t)).at(-1)!;
    const o = opts(lang, "schicht", s.t);
    seen.length = 0;
    const blob = journalPdf(lang, o, { hints, lageRot: undefined });
    expect(blob.size).toBeGreaterThan(1000);
    const n = journalPdfSeiten(lang, o, { hints });
    expect(n).toBeLessThanOrEqual(5);
    const all = seen.join("\n");
    expect(all).toContain(`Lagejournal – ${lang.name} · ${umfangText(lang, o.umfang)}`.slice(0, 40));
    expect(all).toContain("T4 · Samstag 18.05.2030");
    expect(all).toContain(`Seite 1 von ${n}`);
    expect(all).toMatch(/Geführt von: BSP/);
    expect(all).toContain("Visum");
    expect(all).toContain("INTERN");
    expect(seen.flatMap((x) => [...x]).filter((c) => !isWinAnsi(c))).toEqual([]);
  });

  it("Tag T3 berichten (Ziel ≤ 12), Zeilen haben Nummer, Zeit, Eingang, Art", () => {
    const o = opts(lang, "tag", "2030-05-17T00:00", "2030-05-17T23:59");
    const rows = journalPdfRows(lang, o.umfang);
    expect(rows[0]).toEqual({ kind: "tag", text: "T3 · Freitag 17.05.2030" });
    const e = rows.find((r) => r.kind === "eintrag");
    expect(e && e.kind === "eintrag" && e.cells[0]).toMatch(/^\d+[a-z]?$/);
    const n = journalPdfSeiten(lang, o, { hints });
    expect(n).toBeLessThanOrEqual(12);
  });

  it("gestrichen und Nachtrag in den Zeilen", () => {
    const ex = demoExercise();
    const [a, b] = ex.events!;
    ex.events = [
      { ...a!, deleted: true, geaendertVon: "BSP", updatedAt: "2030-05-15T05:22:00.000Z" },
      { ...b!, history: [{ rev: 1, at: "2030-05-15T05:00:00.000Z", device: "x", t: b!.t, text: "1 Fz in NAI 2 Rtg N", nai: "NAI 2", side: b!.side, unit: b!.unit, sym: b!.sym, aff: b!.aff } as never], correctedAt: "2030-05-15T05:34:00.000Z", geaendertVon: "MU" },
      ...ex.events!.slice(2),
    ];
    const rows = journalPdfRows(ex, { from: null, to: "2030-05-15T23:59" });
    const ra = rows.find((r) => r.kind === "eintrag" && r.id === a!.id);
    const rb = rows.find((r) => r.kind === "eintrag" && r.id === b!.id);
    expect(ra?.kind === "eintrag" && ra.gestrichen && ra.vermerke[0]).toMatch(/^gestrichen \d\d:\d\d von BSP$/);
    expect(rb?.kind === "eintrag" && rb.vermerke.join(" ")).toMatch(/^Nachtrag \d\d:\d\d MU: vorher «1 Fz in NAI 2 Rtg N» \(NAI 2\)$/);
    expect(journalPdfRows(ex, { from: null, to: "2030-05-15T23:59" }, { ohneGestrichene: true }).some((r) => r.kind === "eintrag" && r.id === a!.id)).toBe(false);
  });

  it("Visum aus den Schichten im Zeitraum", () => {
    const ex: Exercise = { ...demoExercise(), schichten: [
      { id: "s1", art: "beginn", at: "2030-05-15T04:00:00.000Z", t: "2030-05-15T06:00", an: "BSP", device: "d" },
      { id: "s2", art: "uebergabe", at: "2030-05-15T05:31:00.000Z", t: "2030-05-15T07:31", von: "BSP", an: "MU", device: "d" },
    ] };
    expect(visumZeilen(ex, "2030-05-15T06:00", "2030-05-15T08:00")).toEqual([
      "Geführt von: BSP (T2 06:00–07:31) · übergeben an: MU",
      "Geführt von: MU (T2 07:31–08:00)",
    ]);
    expect(visumZeilen({ ...ex, schichten: [] }, "2030-05-15T06:00", "2030-05-15T08:00")).toEqual(["Geführt von: ________ (T2 06:00–08:00)"]);
  });

  it("Vorwahl Entscheid 4: Schicht, sonst Tag", () => {
    expect(journalDruckVorwahl(true)).toBe("schicht");
    expect(journalDruckVorwahl(false)).toBe("tag");
  });
});
