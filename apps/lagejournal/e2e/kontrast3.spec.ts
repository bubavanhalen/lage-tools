/**
 * Kontrast und Schrift der neuen Zustände (Spez. MVP 3, Kap. 8.7): Offen, Übergabe, «Mehr …», Kürzel-Abfrage – hell
 * und dunkel, Laptop. Regeln wie kontrast.spec.ts (Text ≥ 4.5, gross ≥ 3; Rahmen ≥ 3; Schrift ≥ 12 px aus der Skala).
 * Ausgabe e2e/out/kontrast3.json. Phase 0: Gerüst – rot, bis Pakete B/C fertig sind.
 */
import { UHR_T2_0730, ansicht, aufgabe, feldVon, knopfVon, kontrastImBrowser, soll, zeilenVon, type Harness, type Session, type Spec, type TestResult } from "./lib.ts";

const ZUSTAENDE: Array<[string, string, (s: Session) => Promise<void>]> = [
  ["Offen", "?beispiel", async (s) => { await ansicht(s, "Offen"); }],
  ["Übergabe", "?beispiel", async (s) => { await ansicht(s, "Offen"); await knopfVon(s, /^Übergabe/).first().click(); }],
  ["Mehr", "?beispiel", async (s) => { await zeilenVon(s).first().click(); await knopfVon(s, /^Mehr/).click(); }],
  ["Kürzel-Abfrage", "?beispiel=leer", async (s) => { await feldVon(s).fill("H04 2 Fz in AK7 Rtg N"); await feldVon(s).press("Enter"); soll(await s.page.getByText("Wer erfasst?").count(), "keine Abfrage"); }],
];

const spec: Spec = {
  name: "kontrast3",
  async run(h: Harness) {
    const out: TestResult[] = [];
    for (const dunkel of [false, true]) {
      for (const [z, q, f] of ZUSTAENDE) {
        const name = `${z} ${dunkel ? "dunkel" : "hell"}`;
        out.push(await aufgabe(name, "laptop", async (w) => {
          const s = await h.open({ query: q, uhr: UHR_T2_0730, dunkel });
          try {
            await f(s);
            await s.page.waitForTimeout(300);
            const r = await s.page.evaluate(kontrastImBrowser);
            Object.assign(w, r);
            await h.shot(s.page, `kontrast3/${name.replace(/\s+/g, "_")}`);
            const n = r.text.length + r.rahmen.length + r.klein.length + r.skala.length;
            soll(n === 0, `${r.text.length} Text < 4.5 · ${r.rahmen.length} Rahmen < 3 · ${r.klein.length} Schrift < 12 px · ${r.skala.length} ausserhalb Skala`);
          } finally { await s.close(); }
        }));
      }
    }
    return out;
  },
};
export default spec;
