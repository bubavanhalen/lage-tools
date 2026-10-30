import { describe, expect, it } from "vitest";
import { ENTRY_ARTEN, artOf, cellBounds, demoExercise, demoLang, DEMO_LANG_DAYS, findCells, isLage, nrDoppelte, nrLabel, situationAt, zaehleMeldungen } from "../src";

const ex = demoLang();

describe("demoLang – lange Beispielübung (Phase 0, Kap. 2.10/8.5)", () => {
  it("800 Einträge über 4 Tage, letzte T4 07:30", () => {
    expect(ex.events).toHaveLength(800);
    expect(ex.days).toEqual(DEMO_LANG_DAYS);
    const ts = ex.events!.map((e) => e.t).sort();
    expect(ts[0]!.slice(0, 10)).toBe("2030-05-15");
    expect(ts[ts.length - 1]).toBe("2030-05-18T07:30");
    expect(new Set(ts.map((t) => t.slice(0, 10))).size).toBe(4);
  });
  it("MVP 3.5: Ausgänge über alle Tage – Antwort an Bat (beantwortet «Bat fragt»), Weitergabe, auch in der letzten Schicht", () => {
    const aus = ex.events!.filter((e) => artOf(e) === "ausgang" && !e.deleted);
    expect(new Set(aus.map((e) => e.t.slice(0, 10))).size).toBe(4);
    const antwort = aus.filter((e) => e.bezugArt === "antwort" && /^Antwort an Bat:/.test(e.text));
    const weiter = aus.filter((e) => e.bezugArt === "weiter" && /^Weitergemeldet an Bat: Nr \d+$/.test(e.text));
    expect(antwort.length).toBeGreaterThanOrEqual(1);
    expect(weiter.length).toBeGreaterThanOrEqual(1);
    for (const a of antwort) expect(ex.events!.find((e) => e.id === a.bezug)).toMatchObject({ art: "rueckfrage", quelle: "Bat" });
    for (const w of weiter) {
      const z = ex.events!.find((e) => e.id === w.bezug)!;
      expect(w.text).toBe(`Weitergemeldet an Bat: Nr ${nrLabel(z, ex)}`);
      expect(z).toMatchObject({ side: "rot" });
    }
    // letzte Schicht (ab T4 06:00): Antwort und Weitergabe
    const letzte = aus.filter((e) => e.t >= "2030-05-18T06:00"); // zeit-ok: Test, gleicher Offset
    expect(letzte.some((e) => e.bezugArt === "antwort")).toBe(true);
    expect(letzte.some((e) => e.bezugArt === "weiter")).toBe(true);
    for (const e of aus) expect(e).toMatchObject({ notiz: true, unit: "" });
  });
  it("alle Eintragsarten, gestrichene, korrigierte, dringende, aufgehobene, Bezüge", () => {
    const arten = new Set(ex.events!.map(artOf));
    for (const a of ENTRY_ARTEN) expect(arten.has(a), a).toBe(true);
    expect(ex.events!.some((e) => e.deleted)).toBe(true);
    expect(ex.events!.some((e) => e.history?.length && !e.deleted)).toBe(true);
    expect(ex.events!.some((e) => e.lvz?.dringend?.v)).toBe(true);
    expect(ex.events!.some((e) => e.lvz?.weiter?.v)).toBe(true);
    expect(ex.events!.some((e) => e.hebtAuf)).toBe(true);
    expect(ex.events!.some((e) => e.bezugArt === "antwort")).toBe(true);
    expect(ex.events!.some((e) => e.bezugArt === "quittung")).toBe(true);
    expect(ex.events!.some((e) => e.tReported && Date.parse(e.tReported) - Date.parse(e.t) >= 5 * 60000)).toBe(true);
    expect(zaehleMeldungen(ex)).toBeGreaterThanOrEqual(200);
  });
  it("Nicht-Meldungen und Aufhebungen zeichnen nie (Invariante E3)", () => {
    for (const e of ex.events!) {
      if (isLage(e) || e.deleted) continue;
      expect(e.pos, e.text).toBeUndefined();
      expect(e.cells, e.text).toBeUndefined();
      expect(e.nai, e.text).toBeUndefined();
      expect(e.unit, e.text).toBe("");
      if (artOf(e) !== "meldung") expect(e.notiz, e.text).toBe(true);
    }
    const sit = situationAt(ex.events!, "2030-05-18T07:30");
    expect(sit.loose.every((e) => isLage(e))).toBe(true);
  });
  it("1 Schichtbeginn + 12 Übergaben, letzte Schicht BSP ab T4 06:00", () => {
    const s = ex.schichten!;
    expect(s.filter((x) => x.art === "beginn")).toHaveLength(1);
    expect(s.filter((x) => x.art === "uebergabe")).toHaveLength(12);
    const last = s[s.length - 1]!;
    expect(last.an).toBe("BSP");
    expect(last.t).toBe("2030-05-18T06:00");
    for (const x of s.slice(1)) expect(x.von).toBeTruthy();
  });
  it("Nummern 1–800, steigend mit dem Eingang, keine doppelten, «erfasst von» gesetzt", () => {
    const byCreated = [...ex.events!].sort((a, b) => (a.createdAt! < b.createdAt! ? -1 : 1));
    expect(byCreated.map((e) => e.nr)).toEqual(Array.from({ length: 800 }, (_, i) => i + 1));
    expect(nrDoppelte(ex)).toEqual([]);
    expect(nrLabel(byCreated[41]!, ex)).toBe("42");
    expect(ex.events!.every((e) => e.erfasstVon && ["BSP", "MU", "ZZ"].includes(e.erfasstVon))).toBe(true);
  });
  it("nur Raum Bern: Orte im Raster BERN, Hülle wie Beispiel Bern", () => {
    const d = demoExercise();
    expect(ex.sheets.map((s) => s.name)).toEqual(["BERN"]);
    expect(ex.areas.map((a) => a.name)).toEqual(d.areas.map((a) => a.name));
    expect(ex.units).toEqual(d.units);
    const s = ex.sheets[0]!;
    const minE = s.origin.e, maxN = s.origin.n, maxE = minE + s.cellW * s.colLabels.length, minN = maxN - s.cellH * s.rowLabels.length;
    for (const e of ex.events!) {
      if (!e.pos) continue;
      expect(e.pos.e >= minE - 2000 && e.pos.e <= maxE + 2000 && e.pos.n >= minN - 2000 && e.pos.n <= maxN + 2000, e.text).toBe(true);
    }
    for (const e of ex.events!) for (const c of e.cells ?? []) expect(findCells(c, ex.sheets).length, c).toBeGreaterThan(0);
    expect(typeof cellBounds).toBe("function");
  });
  it("deterministisch (gleicher Seed → gleiche Übung)", () => {
    expect(JSON.stringify(demoLang())).toBe(JSON.stringify(ex));
    expect(JSON.stringify(demoLang({ seed: 7 }))).not.toBe(JSON.stringify(ex));
    expect(demoLang({ meldungen: 50, tage: 2 }).events).toHaveLength(50);
  });
});
