import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoExercise, KI_PURPOSE_LABEL, type Attachment, type Exercise } from "@lage/core";
import { commitTexts } from "../src/commit";
import { addKiLog, kiBase, kiConsented, kiPdfNote, setKiConsent } from "../src/ki/settings";
import { initialRows, pqDoubt } from "../src/batchRows";

// KI in der Oberfläche: Einwilligung pro Gerät, Basis-URL, Herkunft «KI», Vermerk im PDF – nur fiktive Daten (Raum Bern)

/** einfacher Ersatz für localStorage (Node) */
function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}
const g = globalThis as { localStorage?: unknown };
let saved: unknown;
beforeEach(() => { saved = g.localStorage; g.localStorage = fakeStorage(); });
afterEach(() => { g.localStorage = saved; });

describe("Einwilligung pro Gerät und Übung", () => {
  it("Freigabe in der Übungsdatei gilt ohne eigene Einwilligung nicht", () => {
    const ex = demoExercise();
    ex.ki = { enabled: true, since: "2030-05-14T18:00:00.000Z" };
    expect(kiConsented(ex.id)).toBe(false);
    setKiConsent(ex.id, true);
    expect(kiConsented(ex.id)).toBe(true);
    expect(kiConsented("andere-uebung")).toBe(false);
    setKiConsent(ex.id, false);
    expect(kiConsented(ex.id)).toBe(false);
  });
  it("Einwilligung steht nie in der Übung", () => {
    const ex = demoExercise();
    setKiConsent(ex.id, true);
    expect(JSON.stringify(ex)).not.toContain("consent");
  });
});

describe("Basis-URL", () => {
  it("Standard ist api.anthropic.com", () => {
    expect(kiBase()).toBe("https://api.anthropic.com");
  });
  it("localhost wird übernommen, ein fremder Server ignoriert", () => {
    localStorage.setItem("lt-ki-base", "http://localhost:8964/");
    expect(kiBase()).toBe("http://localhost:8964");
    // fremder Server: nur im Entwicklungsmodus (vitest läuft als solcher); im Build ignoriert (siehe kiBaseAllowed im Kern)
    localStorage.setItem("lt-ki-base", "https://boese.example.com");
    expect(kiBase()).toBe(import.meta.env.DEV ? "https://boese.example.com" : "https://api.anthropic.com");
    localStorage.setItem("lt-ki-base", "javascript:alert(1)");
    expect(kiBase()).toBe("https://api.anthropic.com");
  });
});

describe("Herkunft KI", () => {
  const foto = (engine: string): Attachment => ({ id: "att-1", kind: "foto", name: "zettel.jpg", mime: "image/jpeg", size: 1000, t: "2030-05-15T07:20", engine } as Attachment);
  it("Meldungen aus einem von der KI gelesenen Foto sind markiert, aus der Offline-Erkennung nicht", () => {
    let ex: Exercise = demoExercise();
    const up = (f: (x: Exercise) => Exercise) => { ex = f(structuredClone(ex)); };
    const a = commitTexts(["0715 H04 2 Fz AG13"], { ex, device: "d", update: up, day: ex.days[1], attachment: foto("ki") });
    const b = commitTexts(["0716 H04 1 Fz AG13"], { ex, device: "d", update: up, day: ex.days[1], attachment: { ...foto("ocr-offline"), id: "att-2" } });
    expect(a[0]!.via).toBe("ki");
    expect(b[0]!.via).toBeUndefined();
  });
  it("PDF-Vermerk aus den Meldungen (gilt auf jedem Gerät), ehrlich formuliert", () => {
    const ex = demoExercise();
    expect(kiPdfNote(ex, KI_PURPOSE_LABEL)).toBeNull();
    ex.events![0]!.via = "ki";
    ex.events![1]!.via = "ki";
    const n = kiPdfNote(ex, KI_PURPOSE_LABEL)!;
    expect(n).toContain("2 Meldungen aus einem KI-Vorschlag übernommen");
    expect(n).toContain("KI-Ergebnisse sind Vorschläge; Übernahme durch Benutzer.");
    expect(n).not.toMatch(/geprüft/);
    // gelöschte zählen nicht; Protokoll dieses Geräts ergänzt
    ex.events![1]!.deleted = true;
    addKiLog(ex.id, { at: "2030-05-15T07:30:00Z", purpose: "lagebericht", model: "claude-sonnet-5-5", chars: 100, ms: 900, ok: true });
    const m = kiPdfNote(ex, KI_PURPOSE_LABEL)!;
    expect(m).toContain("1 Meldung aus einem KI-Vorschlag");
    expect(m).toContain("auf diesem Gerät verwendet für: Lagebericht entwerfen (1×)");
  });
});

describe("Prüfung mehrerer Meldungen: unsichere KI-Zeilen", () => {
  it("nicht vorab angehakt, Gründe sichtbar; sichere und Offline-Zeilen angehakt", () => {
    const rows = initialRows([
      { text: "0715 H02: 3 Pers AK9", ki: true, unsicher: [] },
      { text: "0720 H0?: 2 Fz", ki: true, unsicher: ["Melder", "Zeit"] },
      { text: "0725 H04 1 Fz AG13", unsicher: ["egal"] },
    ]);
    expect(rows.map((r) => r.on)).toEqual([true, false, true]);
    expect(rows[1]!.doubt).toEqual(["Melder", "Zeit"]);
    expect(rows[0]!.doubt).toBeUndefined();
  });
  it("vermuteter PQ wird erkannt (Ort-Chip gelb statt grün)", () => {
    expect(pqDoubt(["PQ AK9 steht nicht in der Meldung – prüfen"])).toBeTruthy();
    expect(pqDoubt(["PQ «AZ99» nicht im Raster"])).toBeTruthy();
    expect(pqDoubt(["Zeit fehlt", "Melder fehlt"])).toBeUndefined();
    expect(pqDoubt(undefined)).toBeUndefined();
  });
});
