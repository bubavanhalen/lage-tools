import { describe, expect, it, vi } from "vitest";
import { analyzeJournal, analyzeRedCoas, compareStrength, demoExercise, estimateRedForce, parseStrength } from "@lage/core";

/** alle Texte, die beim Erzeugen eines PDFs an die Standardschrift gehen (nach safePdf) */
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

const { isWinAnsi, winAnsi } = await import("../src/pdfSafe");
const { journalPdf } = await import("../src/journalpdf");

const bad = (s: string) => [...s].filter((c) => !isWinAnsi(c));

describe("PDF-Texte nur WinAnsi (Standardschrift)", () => {
  it("Pfeile und Zeichen als Klartext", () => {
    expect(winAnsi("Richtungen N↔S")).toBe("Richtungen N–S");
    expect(winAnsi("Annäherung AK7 → AL9 07:20")).toBe("Annäherung AK7 nach AL9 07:20");
    expect(winAnsi("Pendel AK7 ↔ AL9")).toBe("Pendel AK7 – AL9");
    expect(winAnsi("Fz ↑ fährt")).toBe("Fz Rtg N fährt");
    // MVP 3.5 (D8): am Zeilenanfang zeichnet safePdf ein Vektorzeichen; in winAnsi allein Klartext statt «+ »
    expect(winAnsi("✓ 4 von 5 ≥ 2 · ≈ 3 km · 15′")).toBe("ja 4 von 5 mind. 2 · ca. 3 km · 15 min");
    expect(winAnsi("Grüsse «Bern» – € …")).toBe("Grüsse «Bern» – € …");
    expect(bad(winAnsi("◆ Feind ⚠ ⛔ ✎ 📍 ı Ł ẞ   x"))).toEqual([]);
  });
  it("Journal-PDF mit Anhängen Lage Rot und Hinweise (Beispiel Bern)", () => {
    const ex = demoExercise();
    const t = [...(ex.events ?? [])].map((e) => e.t).sort().at(-1)!.slice(0, 16);
    // fiktive Meldungen mit Zeichen, die die Standardschrift nicht kann
    ex.events = [...(ex.events ?? []), { ...ex.events![0]!, id: "x-pfeil", text: "2 Fz AK7 → AL9 ↔ Rtg ↑ ≈ 3 ≥ 2 ✓ ◆" }];
    const hints = analyzeJournal(ex, { t }).hints;
    expect(hints.length).toBeGreaterThan(0);
    const force = estimateRedForce(ex, t);
    const spec = parseStrength("2 Det, 14 Pers, 5 Fz");
    const r = analyzeRedCoas(ex, { t, hints, decisions: ex.hintDecisions });
    seen.length = 0;
    journalPdf(ex, "INTERN", hints, { lage: { coas: r.picked, more: [], force, spec, compare: compareStrength(force, spec), from: null, hints }, t });
    expect(seen.length).toBeGreaterThan(50);
    const all = seen.join("\n");
    expect(all).toContain("Anhang: Hinweise zu Rot");
    expect(all).toContain("AK7 nach AL9");
    const off = [...new Set(seen.flatMap(bad))];
    expect(off, `Zeichen ausserhalb WinAnsi: ${off.join(" ")}`).toEqual([]);
  });
});
