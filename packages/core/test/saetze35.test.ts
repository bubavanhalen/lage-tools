/**
 * Regressionstest aller Sätze MVP 3.5 (Spez. MVP 3.5, Kap. 8.3) – Pakete C und D machen ihre Zeilen grün.
 *
 * - **Schnappschuss** (`soll: "schnappschuss"`): Ergebnis muss gleich `fixtures/saetze35.stand.json` sein (Stand Phase 0
 *   = 52d951d mit Online-Standard aus). Bewusste Änderung → Begründung im Paketbericht, Eintrag in `ABWEICHUNG` (nur
 *   Koordinator; bis dahin dort mit Grund eintragen und in der Notizdatei melden).
 * - **Soll** (Tabelle Kap. 8.3): Abweichungen aus `abweichungen()` müssen leer sein. Was in Phase 0 noch nicht erfüllt
 *   ist, steht in `OFFEN` und läuft als `it.fails` (der Lauf bleibt grün). **Wer eine Zeile erfüllt, streicht ihre ID
 *   aus `OFFEN`** – sonst wird `it.fails` rot (gewollt: Fortschritt wird sichtbar).
 * - Geschwindigkeit: `parseMeldung` + `entryState` je Satz Median ≤ 5 ms, Maximum ≤ 30 ms.
 *
 * Schnappschuss neu schreiben (nur Koordinator, Phase 0): `SAETZE35_STAND=schreiben npx vitest run packages/core/test/saetze35.test.ts`
 * Stand aller Fälle ansehen: `SAETZE35_STAND=zeigen …` (schreibt `<S>/…` nicht, gibt die Abweichungen der Soll-Fälle aus).
 */
process.env.TZ = "Europe/Zurich";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { demoExercise, entryState, lastPosition, parseMeldung } from "../src";
import { SAETZE35, type SatzSoll } from "./fixtures/saetze35";
import { abweichungen, alleAuswerten, ZONE, type SatzErgebnis } from "./fixtures/saetze35.lauf";

const STAND_DATEI = fileURLToPath(new URL("./fixtures/saetze35.stand.json", import.meta.url));
const MODUS = process.env.SAETZE35_STAND ?? "";

/** Soll-Fälle, die Phase 0 noch nicht erfüllt (laufen als `it.fails`). Erfüllt → ID streichen. */
const OFFEN = new Set<string>([
]);

/** Schnappschuss-Fälle, deren Ergebnis sich bewusst ändert: ID → Begründung (Paket, Regel) */
const ABWEICHUNG: Record<string, string> = {
  // Paket C (Notizdatei «C – Absprachen»)
  "neu30-15": "C1/Kap. 5.4: Vorschlag bei `was` ist das Ersatzwort («Panzer») statt des Katalogschlüssels («pz»)",
  "s02-61": "C7: eigene Verwundete ohne neues Zeichen, Ort «bei H05», Begehren Sanität (wie #20–#22)",
  "s12-17": "C7: eigene Verwundete ohne neues Zeichen, Ort «bei H05», Begehren Sanität (wie #20–#22)",
};

const ergebnisse = alleAuswerten(SAETZE35);
const stand: Record<string, SatzErgebnis> = MODUS !== "schreiben" && existsSync(STAND_DATEI) ? JSON.parse(readFileSync(STAND_DATEI, "utf8")) : {};

if (MODUS === "schreiben") {
  const out: Record<string, unknown> = {};
  for (const f of SAETZE35) out[f.id] = ergebnisse.get(f.id);
  writeFileSync(STAND_DATEI, JSON.stringify(out, null, 1) + "\n");
}
if (MODUS === "zeigen" || MODUS === "schreiben") {
  const offen: string[] = [];
  for (const f of SAETZE35) {
    if (f.soll === "schnappschuss") continue;
    const e = ergebnisse.get(f.id)!;
    const a = "fehler" in e ? [e.fehler] : abweichungen(e, f.soll);
    if (a.length) { offen.push(f.id); console.log(`${f.id} #${f.nr} (${f.paket}) «${f.satz}»: ${a.join(" · ")}`); }
  }
  console.log(`OFFEN (${offen.length}): ${JSON.stringify(offen)}`);
}

describe("Sätze MVP 3.5: Testdaten (Kap. 5.5, 8.3)", () => {
  it("alle Quellen vollständig, IDs eindeutig, Tabelle 1–55 vorhanden", () => {
    const n = (q: string) => SAETZE35.filter((f) => f.quelle === q).length;
    expect([n("einfachheit-alt58"), n("einfachheit-neu30"), n("einsatz-s02"), n("einsatz-s12"), n("einsatz-s16")]).toEqual([58, 30, 66, 35, 15]);
    expect(n("erstbenutzer")).toBeGreaterThanOrEqual(10);
    expect(new Set(SAETZE35.map((f) => f.id)).size).toBe(SAETZE35.length);
    const nrs = new Set(SAETZE35.map((f) => f.nr).filter((x) => x !== undefined));
    for (let i = 1; i <= 55; i++) expect(nrs.has(i), `Tabelle #${i}`).toBe(true);
  });
  it("Auswertung ohne Fehler", () => {
    const fehler = [...ergebnisse].filter(([, e]) => "fehler" in e).map(([id, e]) => `${id}: ${(e as { fehler: string }).fehler}`);
    expect(fehler).toEqual([]);
  });
});

describe("Schnappschuss (Sätze ohne Tabellenzeile)", () => {
  it.skipIf(MODUS === "schreiben")("Stand-Datei vorhanden", () => expect(Object.keys(stand).length).toBe(SAETZE35.length));
  for (const f of SAETZE35) {
    if (f.soll !== "schnappschuss") continue;
    const grund = ABWEICHUNG[f.id];
    (grund || MODUS === "schreiben" ? it.skip : it)(`${f.id} «${f.satz}»${grund ? ` – Abweichung: ${grund}` : ""}`, () => {
      expect(ergebnisse.get(f.id)).toEqual(stand[f.id]);
    });
  }
});

describe("Soll (Tabelle Kap. 8.3)", () => {
  for (const f of SAETZE35) {
    if (f.soll === "schnappschuss") continue;
    const soll: SatzSoll = f.soll;
    (OFFEN.has(f.id) ? it.fails : it)(`${f.id} #${f.nr} (${f.paket}) «${f.satz}»`, () => {
      const e = ergebnisse.get(f.id)!;
      expect("fehler" in e ? [(e as { fehler: string }).fehler] : abweichungen(e as SatzErgebnis, soll)).toEqual([]);
    });
  }
});

describe("Geschwindigkeit (Kap. 8.3)", () => {
  it("parseMeldung + entryState je Satz: Median ≤ 5 ms, Maximum ≤ 30 ms (Beispiel Bern)", () => {
    const ex = demoExercise();
    const now = new Date("2030-05-15T07:31:00+02:00");
    const ctx = { sheets: ex.sheets, areas: ex.areas, units: ex.units, places: ex.places ?? [], days: ex.days, day: ex.days[1]!, now, dayFromClock: true,
      lastPos: (u: string, s: "rot" | "blau" | "ul") => lastPosition(ex.events!, s, u), events: ex.events, ex, zone: ZONE };
    const opts = { hasRaster: true, online: false, placePending: false, manualPos: false, now, sheets: ex.sheets, areas: ex.areas, knownUnits: ex.units.blau, unitsPrepared: true, days: ex.days };
    const saetze = SAETZE35.map((f) => f.satz);
    for (const s of saetze) entryState(parseMeldung(s, ctx), opts); // aufwärmen
    const ms = saetze.map((s) => { const t0 = performance.now(); entryState(parseMeldung(s, ctx), opts); return performance.now() - t0; }).sort((a, b) => a - b);
    const median = ms[Math.floor(ms.length / 2)]!;
    expect(median).toBeLessThanOrEqual(5);
    expect(ms[ms.length - 1]!).toBeLessThanOrEqual(30);
  });
});
