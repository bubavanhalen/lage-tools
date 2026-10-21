import { describe, expect, it } from "vitest";
import { demoExercise, type Hint } from "@lage/core";
import { decide, decisionOf, hhmm, newCount, nextLabel } from "../src/hintsData";
import { hintsToCsv } from "../src/hintsExport";

/** fiktive Hinweise zur Beispielübung (Raum Bern) – unabhängig von den Regeln im Kern */
function fixture() {
  const ex = demoExercise();
  const ev = (ex.events ?? []).filter((e) => e.side === "rot");
  const hints: Hint[] = [
    { id: "t-C1-AK9", rule: "C1", level: "hoch", title: "Mögliche Übergabe in AK9", text: "zwei Fz halten kurz", events: [ev[0]!.id, ev[1]!.id], t: ev[1]!.t, cells: ["AK9"] },
    { id: "t-C2-Det1", rule: "C2", level: "mittel", title: "Pendelverkehr Det 1", text: "Takt 40 Min", events: [ev[2]!.id], t: ev[2]!.t, next: "2030-05-15T07:40" },
    { id: "t-A1-NAI2", rule: "A1", level: "info", title: "Normallage NAI 2", text: "~2 Fz/Std", events: [], t: ev[0]!.t, nai: "NAI 2" },
  ];
  return { ex, hints };
}

describe("Hinweise: Entscheide", () => {
  const T = "2030-05-15T07:30";
  it("bestätigen, verwerfen und rückgängig machen; Zahl am Reiter zählt nur offene hoch/mittel", () => {
    const { ex, hints } = fixture();
    expect(newCount(ex, hints, T)).toBe(2);
    decide(ex, hints[0]!, "bestaetigt", new Date(2030, 4, 15, 7, 12));
    expect(decisionOf(ex, hints[0]!)).toBe("bestaetigt");
    expect(ex.hintDecisions?.["t-C1-AK9"]).toMatchObject({ at: "2030-05-15T07:12", rule: "C1", events: hints[0]!.events });
    expect(newCount(ex, hints, T)).toBe(1);
    decide(ex, hints[1]!, "verworfen");
    expect(newCount(ex, hints, T)).toBe(0);
    decide(ex, hints[1]!, null);
    expect(decisionOf(ex, hints[1]!)).toBe("neu");
    expect(newCount(ex, hints, T)).toBe(1);
  });
  it("beendete Hinweise zählen nicht als offen", () => {
    const { ex, hints } = fixture();
    hints[1]!.until = "2030-05-15T07:20";
    expect(newCount(ex, hints, T)).toBe(1);
    expect(newCount(ex, hints, "2030-05-15T07:15")).toBe(2);
  });
  it("Entscheid haftet nach Nachtrag (neue ID, gleiche Regel und Auslöser) und lässt sich dort rückgängig machen", () => {
    const { ex, hints } = fixture();
    decide(ex, hints[0]!, "verworfen");
    const moved: Hint = { ...hints[0]!, id: "t-C1-AK9-neu", events: [...hints[0]!.events, "nachtrag"] };
    expect(decisionOf(ex, moved)).toBe("verworfen");
    expect(newCount(ex, [moved, hints[1]!], T)).toBe(1);
    decide(ex, moved, null);
    expect(ex.hintDecisions).toEqual({});
  });
  it("Prognose nur aus `next`: nächste bzw. überfällig, beendet ohne", () => {
    const { ex, hints } = fixture();
    expect(nextLabel(hints[1]!, "2030-05-15T07:30", ex.days)).toEqual({ text: "nächste ca. 07:40", late: false });
    expect(nextLabel(hints[1]!, "2030-05-15T07:55", ex.days)).toEqual({ text: "seit 07:40 überfällig", late: true });
    expect(nextLabel(hints[0]!, T, ex.days)).toBeNull();
    expect(nextLabel({ ...hints[1]!, until: "2030-05-15T07:50" }, "2030-05-15T07:55", ex.days)).toBeNull();
  });
  it("Zeit mit Tag nur, wenn der Tag nicht der Lagezeit entspricht", () => {
    const days = ["2030-05-14", "2030-05-15"];
    expect(hhmm("2030-05-15T07:05", days, "2030-05-15T07:10")).toBe("07:05");
    expect(hhmm("2030-05-14T23:30", days, "2030-05-15T07:10")).toBe("T1 23:30");
  });
});

describe("Hinweise: CSV", () => {
  it("enthält Stufe, Regel, Auslöser, Prognose und Entscheid", () => {
    const { ex, hints } = fixture();
    decide(ex, hints[0]!, "bestaetigt", new Date(2030, 4, 15, 7, 12));
    const csv = hintsToCsv(ex, hints);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toContain("Stufe;Regel;Gruppe;Hinweis");
    expect(lines).toHaveLength(4);
    const c1 = lines.find((l) => l.includes("Mögliche Übergabe"))!;
    expect(c1).toContain(";Hoch;C1;");
    expect(c1).toContain("bestätigt;T2 07:12");
    expect(lines.find((l) => l.includes("Pendelverkehr"))).toContain("T2 07:40");
    expect(lines.find((l) => l.includes("Normallage"))).toContain("offen");
  });
});
