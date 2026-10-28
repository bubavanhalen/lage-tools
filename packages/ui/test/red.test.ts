/**
 * «Was Rot vorhaben könnte» (Paket D): Texte, Zahl am Umschalter und Grundansicht ohne Codes (Spez. MVP 1, Kap. 7.1
 * Aufgabe 8). Fiktiv: Beispiel Bern, Lagezeit T2 07:25.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { analyzeJournal, demoExercise, type Hint, type LageEvent } from "@lage/core";
import { decide, redBadge } from "../src/hintsData";
import { type LageRotState } from "../src/lageRot";
import { analyzeRedCoas, compareStrength, estimateRedForce, parseStrength } from "@lage/core";
import { RedPanel, RedTabLabel } from "../src/red/RedPanel";
import { coaWhen, decidedText, eventLine, forceLine, hintLine, hintMeta, indicatorGroups, indicatorLine, sideMark } from "../src/red/redText";
import type { RedPanelProps } from "../src/shell/contracts";

const T = "2030-05-15T07:25";
const CODE_RE = /\b[A-E][1-6]\b|Ziff|TF 17|GS 17|53\.005|Indikator|COA/;

function setup() {
  const ex = demoExercise();
  const hints = analyzeJournal(ex, { t: T }).hints;
  const force = estimateRedForce(ex, T, {});
  const spec = ex.feindannahme ? parseStrength(ex.feindannahme) : null;
  const r = analyzeRedCoas(ex, { t: T, hints });
  const ids = new Set(r.picked.map((c) => c.id));
  const lage: LageRotState = { coas: r.picked, more: r.all.filter((c) => !ids.has(c.id)), force, spec, compare: compareStrength(force, spec), from: null, hints };
  return { ex, hints, lage };
}

const noop = () => {};
function props(x: ReturnType<typeof setup>, o: Partial<RedPanelProps> = {}): RedPanelProps {
  return {
    ex: x.ex, t: T, from: null, hints: x.hints, lage: x.lage, variant: "basis", selHint: null, selCoa: null,
    onSelectHint: noop, onSelectCoa: noop, onMapHint: noop, onMapCoa: noop, onEvent: noop, update: noop, ...o,
  };
}
/** sichtbarer Text des HTML (ohne Tags) */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ");

describe("Was Rot vorhaben könnte: Grundansicht", () => {
  const x = setup();
  it("Beispiel T2 07:25: 7 offene Hinweise, 3 Möglichkeiten, «Am wahrscheinlichsten» oben", () => {
    const b = redBadge(x.ex, x.hints, T);
    expect(b).toMatchObject({ n: 7, hoch: true, text: "⚠7" });
    expect(x.lage.coas.map((c) => c.label)).toEqual(["wahrscheinlichste", "gefaehrlichste", "weitere"]);
    const html = renderToStaticMarkup(createElement(RedPanel, props(x)));
    expect(html.indexOf("Am wahrscheinlichsten")).toBeLessThan(html.indexOf("Am gefährlichsten"));
    expect(text(html)).toContain("Rot könnte Stao H05 überfallen (AQ11)");
    expect(text(html)).toContain("Hinweise (7 offen)");
    expect((html.match(/class="red-hint /g) ?? []).length).toBe(7);
  });
  it("Liste, Hinweis-Detail und Möglichkeit-Detail ohne Codes (ausser «Woher kommt das?», eingeklappt)", () => {
    const list = text(renderToStaticMarkup(createElement(RedPanel, props(x))));
    expect(list).not.toMatch(CODE_RE);
    for (const h of x.hints.filter((y) => y.level !== "info")) {
      const d = text(renderToStaticMarkup(createElement(RedPanel, props(x, { selHint: h.id }))));
      expect(d, h.title).toContain("Woher kommt das?");
      expect(d.replace(/«[^»]*»/g, ""), h.title).not.toMatch(CODE_RE); // Zitate aus Meldungen sind Text der Truppe
    }
    for (const c of x.lage.coas) {
      const d = text(renderToStaticMarkup(createElement(RedPanel, props(x, { selCoa: c.id }))));
      expect(d, c.title).not.toMatch(CODE_RE);
      expect(d).toContain("Anzeichen dafür");
    }
  });
  it("Experte: Code-Marke an jeder Zeile, Normalbild der NAI", () => {
    const html = renderToStaticMarkup(createElement(RedPanel, props(x, { variant: "experte" })));
    expect(html).toContain('class="red-code"');
    expect(text(html)).toContain("Normalbild der NAI (1)");
  });
  it("Entscheid senkt die Zahl am Umschalter, Rückgängig stellt her", () => {
    const y = setup();
    const h = y.hints.find((z) => z.rule === "C5")!;
    decide(y.ex, h, "verworfen");
    expect(redBadge(y.ex, y.hints, T).n).toBe(6);
    expect(text(renderToStaticMarkup(createElement(RedPanel, props(y))))).toContain("Erledigte zeigen (");
    decide(y.ex, h, null);
    expect(redBadge(y.ex, y.hints, T).n).toBe(7);
  });
  it("Umschalter-Beschriftung: Name, Zahl neutral mit «⚠» und Bildschirmleser-Text", () => {
    const html = renderToStaticMarkup(createElement(RedTabLabel, { badge: redBadge(x.ex, x.hints, T) }));
    expect(text(html)).toContain("Was Rot vorhaben könnte");
    expect(html).toContain("⚠7");
    expect(html).toContain('aria-label="7 offene Hinweise, davon wichtige"');
    expect(renderToStaticMarkup(createElement(RedTabLabel, { badge: redBadge(x.ex, [], T) }))).not.toContain("red-badge");
  });
});

describe("Was Rot vorhaben könnte: Texte", () => {
  const x = setup();
  it("Kräfte-Zeile mit «mind.» und erwartet", () => {
    expect(forceLine(x.lage)).toBe("Rot gesehen: mind. 9 Pers, 4 Fz · erwartet 14 Pers, 5 Fz");
    expect(forceLine({ compare: [] })).toBeNull();
  });
  it("Hinweis-Zeile ohne «⚠», Detail-Zeile mit Engstelle", () => {
    const c5 = x.hints.find((h) => h.rule === "C5")!;
    expect(hintLine(c5)).toBe("Möglicher Hinterhalt bei der Sperre in NAI 3 – Umgehung prüfen");
    expect(hintMeta(c5, x.ex, T)).toMatch(/^Seit T2 \d\d:\d\d · NAI 3 ist eine Engstelle$/);
    expect(decidedText(c5, "verworfen")).toMatch(/» als ‹trifft nicht zu› markiert$/);
  });
  it("Auslöser: Seite als Form, Melder dahinter", () => {
    const e = { side: "rot", aff: "H", text: "0705 H04 Gn Sperre in AG13", melder: "H04" } as LageEvent;
    expect(sideMark(e)).toMatchObject({ mark: "◆", label: "Feind" });
    expect(sideMark({ side: "rot", aff: "U" })).toMatchObject({ mark: "■" });
    expect(sideMark({ side: "blau", aff: "F" })).toMatchObject({ mark: "●" });
    expect(eventLine(e)).toBe("Gn Sperre in AG13 (von H04)");
  });
  it("Anzeichen: offen ohne «nicht gemeldet», doppelt gezählte nur in Experte", () => {
    expect(indicatorLine({ text: "Annäherung auf Achse AP10 → AQ11 noch nicht gemeldet", met: false })).toBe("Annäherung auf Achse AP10 → AQ11");
    expect(indicatorLine({ text: "Formation Linie/Y (Kontakt erwartet) – nicht gemeldet", met: false })).toBe("Formation Linie/Y (Kontakt erwartet)");
    const c = { ...x.lage.coas[0]!, indicators: [{ text: "Drohne 1× – schon gezählt", met: false }, { text: "a (D1)", met: true }] };
    expect(indicatorGroups(c).open).toHaveLength(0);
    expect(indicatorGroups(c, true).open).toHaveLength(1);
  });
  it("Zeitraum: erwartet, jetzt, vorbei; ohne Zustand nichts", () => {
    const c = x.lage.coas[0]!;
    expect(coaWhen(c, x.ex, T)).toEqual({ text: "ca. 07:45–08:35", state: "erwartet" });
    expect(coaWhen({ ...c, windowState: "jetzt" }, x.ex, T)?.text).toBe("jetzt!");
    expect(coaWhen({ ...c, windowState: "ueberfaellig" }, x.ex, T)?.text).toBe("Zeitraum vorbei – nichts gemeldet");
    expect(coaWhen({ ...c, windowState: undefined }, x.ex, T)).toBeNull();
  });
  it("Hinweise ohne headline (ältere Daten) zeigen den Titel", () => {
    const h: Hint = { id: "x", rule: "C1", level: "hoch", title: "Mögliche Übergabe in AK9", text: "", events: [], t: T };
    expect(hintLine(h)).toBe("Mögliche Übergabe in AK9");
  });
});
