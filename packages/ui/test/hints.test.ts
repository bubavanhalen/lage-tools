import { describe, expect, it } from "vitest";
import { demoExercise, type Hint } from "@lage/core";
import { decide, decisionOf, hhmm, newCount } from "../src/hintsData";
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
  it("bestätigen, verwerfen und rückgängig machen; Zahl am Reiter zählt nur neue hoch/mittel", () => {
    const { ex, hints } = fixture();
    expect(newCount(ex, hints)).toBe(2);
    decide(ex, "t-C1-AK9", "bestaetigt", new Date(2030, 4, 15, 7, 12));
    expect(decisionOf(ex, hints[0]!)).toBe("bestaetigt");
    expect(ex.hintDecisions?.["t-C1-AK9"]?.at).toBe("2030-05-15T07:12");
    expect(newCount(ex, hints)).toBe(1);
    decide(ex, "t-C2-Det1", "verworfen");
    expect(newCount(ex, hints)).toBe(0);
    decide(ex, "t-C2-Det1", null);
    expect(decisionOf(ex, hints[1]!)).toBe("neu");
    expect(newCount(ex, hints)).toBe(1);
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
    decide(ex, "t-C1-AK9", "bestaetigt", new Date(2030, 4, 15, 7, 12));
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
