/**
 * Rückwärtskompatibilität MVP 3 (Spez. MVP 3, Kap. 5.5): alte Übungsdateien (vor MVP 3) öffnen und zusammenführen,
 * MVP-3-Dateien in der Sicht der MVP-1-App (nur alte Felder) ohne falsche Zeichen. Nur fiktive Daten (Beispiel Bern).
 */
import { describe, expect, it } from "vitest";
import {
  FILE_VERSION, artOf, demoExercise, demoLang, eventFromDraft, exerciseFromFile, exerciseToFile, isLage, kindLabel, lageBlau, lastPosition,
  mergeEvents, mergeExercise, nrLabel, offenePunkte, parseMeldung, rapportZahlen, setVermerk, situationAt, vermerkeOf, lvzIndex, type Exercise, type LageEvent,
} from "../src";

/** Übung, wie sie MVP 1 gespeichert hat: Beispiel Bern + eine Notiz «Rückfrage» (nur `notiz: true`, keine neuen Felder) */
function mvp1Datei(): string {
  const ex = demoExercise();
  const now = new Date("2030-05-15T05:31:00Z");
  const d = parseMeldung("H04 Rückfrage: Standort Det 2?", {
    sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now, lastPos: (u, s) => lastPosition(ex.events!, s, u),
  });
  expect(d.kindHint).toBe("notiz");
  const e = eventFromDraft(d, "dev-alt", now);
  // MVP 1 kannte `art` nicht: so wie damals gespeichert
  const { art: _a, ...alt } = e;
  ex.events = [...ex.events!, alt as LageEvent];
  const json = exerciseToFile(ex);
  for (const k of ["\"art\"", "\"nr\"", "\"lvz\"", "\"schichten\"", "\"erfasstVon\""]) expect(json.includes(k), k).toBe(false);
  return json;
}

const NEUE_FELDER = ["art", "nr", "von", "erfasstVon", "geaendertVon", "an", "quelle", "frist", "vbk", "bezug", "bezugArt", "hebtAuf", "orte", "felder", "lvz"] as const;

describe("MVP-1-Datei öffnen (Kap. 5.5)", () => {
  it("Datei-Version bleibt 1", () => {
    expect(FILE_VERSION).toBe(1);
  });
  it("öffnet, leitet Art und Nummer ab, schreibt nichts", () => {
    const ex = exerciseFromFile(mvp1Datei());
    const vorher = JSON.stringify(ex);
    const notiz = ex.events!.find((e) => e.notiz)!;
    expect(artOf(notiz)).toBe("notiz");
    expect(ex.events!.filter((e) => !e.notiz).every((e) => artOf(e) === "meldung")).toBe(true);
    const labels = ex.events!.map((e) => nrLabel(e, ex));
    expect(new Set(labels).size).toBe(ex.events!.length);
    expect(labels.every((l) => /^\d+$/.test(l))).toBe(true);
    // abgeleitete Auswertungen ändern die Übung nicht
    offenePunkte(ex, "2030-05-15T07:30");
    lageBlau(ex, "2030-05-15T07:30");
    rapportZahlen(ex, null, "2030-05-15T07:30");
    vermerkeOf(notiz, lvzIndex(ex.events!));
    expect(JSON.stringify(ex)).toBe(vorher);
    for (const e of ex.events!) for (const k of NEUE_FELDER) if (k !== "art") expect(e[k], `${k} bei ${e.text}`).toBeUndefined();
  });
  it("alte Notiz zeichnet nicht und zählt nicht als Lage", () => {
    const ex = exerciseFromFile(mvp1Datei());
    const notiz = ex.events!.find((e) => e.notiz)!;
    expect(isLage(notiz)).toBe(false);
    const s = situationAt(ex.events!, "2030-05-15T07:30");
    expect(s.loose.some((e) => e.id === notiz.id) || s.units.some((u) => u.event.id === notiz.id)).toBe(false);
  });
});

describe("alte und neue Fassung zusammenführen", () => {
  /** dieselbe Übung auf einem MVP-3-Gerät weitergeführt: Vermerk, Nummer, Schicht, neue Art */
  function mvp3Weiter(alt: Exercise): Exercise {
    const ex: Exercise = JSON.parse(JSON.stringify(alt));
    const now = new Date("2030-05-15T05:35:00Z");
    const i = ex.events!.findIndex((e) => e.text.includes("2 Kpz AJ9"));
    ex.events![i] = setVermerk(ex.events![i]!, "dringend", true, { device: "dev-neu", kuerzel: "BSP", now });
    const d = parseMeldung("Auftrag an H01: Beo NAI 1 bis 1200", {
      sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now, art: "auftrag",
    });
    ex.events!.push(eventFromDraft({ ...d, an: "H01", frist: "2030-05-15T12:00" }, "dev-neu", now, { nr: ex.events!.length + 1, kuerzel: "BSP" }));
    ex.schichten = [{ id: "s1", art: "beginn", at: "2030-05-15T04:00:00.000Z", t: "2030-05-15T06:00", an: "BSP", device: "dev-neu" }];
    ex.klassifizierung = "INTERN";
    return ex;
  }
  it("in beide Richtungen: nichts geht verloren, kein Konflikt", () => {
    const alt = exerciseFromFile(mvp1Datei());
    const neu = mvp3Weiter(alt);
    for (const [ours, theirs] of [[alt, neu], [neu, alt]] as const) {
      const { ex, report } = mergeExercise(ours, theirs);
      expect(report.conflicts).toBe(0);
      expect(report.doppelt).toBeUndefined();
      expect(ex.events).toHaveLength(neu.events!.length);
      const kpz = ex.events!.find((e) => e.text.includes("2 Kpz AJ9"))!;
      expect(kpz.lvz?.dringend?.v).toBe(true);
      expect(kpz.history).toBeUndefined();
      const auftrag = ex.events!.find((e) => e.art === "auftrag")!;
      expect(auftrag).toMatchObject({ nr: neu.events!.length, von: "dev-neu", erfasstVon: "BSP", an: "H01", notiz: true, unit: "" });
      expect(auftrag.pos).toBeUndefined();
      expect(ex.schichten?.map((s) => s.id)).toEqual(["s1"]);
      expect(nrLabel(auftrag, ex)).toBe(String(neu.events!.length));
    }
  });
  it("mergeEvents gemischt: Fassung ohne lvz + mit lvz → lvz bleibt; nr nur auf einer Seite → bleibt", () => {
    const e = demoExercise().events![0]!;
    const mitLvz = setVermerk(e, "massnahme", "Zfhr orientiert", { device: "b", now: new Date("2030-05-15T06:00:00Z") });
    const mitNr = { ...e, nr: 1, von: "a" };
    expect(mergeEvents([e], [mitLvz])[0]!.lvz?.massnahme?.v).toBe("Zfhr orientiert");
    expect(mergeEvents([mitLvz], [e])[0]!.lvz?.massnahme?.v).toBe("Zfhr orientiert");
    expect(mergeEvents([e], [{ ...mitNr, rev: 2 }])[0]!.nr).toBe(1);
  });
  it("unbekannte Felder (z. B. aus einer neueren App) gehen beim Zusammenführen nicht verloren", () => {
    const e = demoExercise().events![0]!;
    const neuer = { ...e, rev: 2, zukunft: { x: 1 } } as LageEvent & { zukunft: unknown };
    const m = mergeEvents([e], [neuer])[0] as LageEvent & { zukunft?: unknown };
    expect(m.zukunft).toEqual({ x: 1 });
  });
});

describe("MVP-3-Datei in der Sicht der MVP-1-App", () => {
  /** wie MVP 1 liest: neue Felder fehlen (die App kennt sie nicht) */
  const alsMvp1 = (e: LageEvent): LageEvent => {
    const c: Record<string, unknown> = { ...e };
    for (const k of NEUE_FELDER) delete c[k];
    return c as unknown as LageEvent;
  };
  it("Nicht-Meldungen erscheinen als «Notiz», kein Zeichen; Aufhebungen ohne Zeichen", () => {
    const ex = exerciseFromFile(exerciseToFile(demoLang({ meldungen: 300, tage: 2 })));
    const alt = ex.events!.map(alsMvp1);
    for (const [i, e] of ex.events!.entries()) {
      if (artOf(e) !== "meldung") {
        expect(kindLabel(alt[i]!), e.text).toBe("Notiz");
        expect(alt[i]!.pos, e.text).toBeUndefined();
        expect(alt[i]!.unit, e.text).toBe("");
      }
      if (e.hebtAuf) {
        expect(alt[i]!.pos, e.text).toBeUndefined();
        expect(alt[i]!.sym).toBe("einheit");
      }
    }
    const t = ex.events!.map((e) => e.t).sort().pop()!;
    const s = situationAt(alt, t);
    const nichtLage = new Set(ex.events!.filter((e) => !isLage(e)).map((e) => e.id));
    expect(s.loose.filter((e) => nichtLage.has(e.id) && !e.deleted)).toEqual([]);
    expect(s.units.filter((u) => nichtLage.has(u.event.id))).toEqual([]);
  });
});
