/**
 * DOM-Audit Kontrast und Schrift (Spez. MVP 1, Kap. 7.3.2), hell und dunkel, Laptop:
 * Grundansicht, Vorschau gelb, Vorschau rot, Rückblick, «Was Rot vorhaben könnte».
 * Text ≥ 4.5 (gross ≥ 3) gegen den wirksamen Hintergrund, Rahmen von Bedienelementen ≥ 3, Schrift ≥ 12 px und aus
 * {12, 14, 16, 20, 28}; Fokusring sichtbar beim Durchtabben (Screenshot je Fokus in out/kontrast/).
 * Karten-Panes sind ausgenommen (Beschriftung mit Halo, nicht prüfbar gegen einen Hintergrund).
 */
import { UHR_T2_0730, aufgabe, fokusImBrowser, kontrastImBrowser, soll, type Harness, type Session, type Spec, type TestResult } from "./lib.ts";

const ZUSTAENDE: Array<[string, (s: Session) => Promise<void>]> = [
  ["Grundansicht", async () => {}],
  ["Vorschau gelb", async (s) => { await s.page.getByPlaceholder("Was wurde gemeldet?").fill("3 Pers bei AJ7"); }],
  ["Vorschau rot", async (s) => { await s.page.getByPlaceholder("Was wurde gemeldet?").fill("H04 2 Fz in AK77"); }],
  ["Rückblick", async (s) => { await s.page.getByRole("button", { name: /Zurückblicken/ }).click(); }],
  ["Was Rot", async (s) => { await s.page.getByRole("tab", { name: /Was Rot vorhaben könnte/ }).or(s.page.getByRole("button", { name: /Was Rot vorhaben könnte/ })).first().click(); }],
];

async function audit(h: Harness, zustand: string, dunkel: boolean, vorher: (s: Session) => Promise<void>): Promise<TestResult> {
  const name = `${zustand} ${dunkel ? "dunkel" : "hell"}`;
  return aufgabe(name, "laptop", async (w) => {
    const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730, dunkel });
    try {
      await vorher(s);
      await s.page.waitForTimeout(300);
      const r = await s.page.evaluate(kontrastImBrowser);
      Object.assign(w, r);
      await h.shot(s.page, `kontrast/${name.replace(/\s+/g, "_")}`);
      const n = r.text.length + r.rahmen.length + r.klein.length + r.skala.length;
      soll(n === 0, `${r.text.length} Text < 4.5 · ${r.rahmen.length} Rahmen < 3 · ${r.klein.length} Schrift < 12 px · ${r.skala.length} ausserhalb Skala`);
    } finally { await s.close(); }
  });
}

async function fokus(h: Harness, dunkel: boolean): Promise<TestResult> {
  return aufgabe(`Fokusring sichtbar ${dunkel ? "dunkel" : "hell"}`, "laptop", async (w) => {
    const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730, dunkel });
    try {
      await s.page.locator("body").click({ position: { x: 1, y: 1 } }).catch(() => {});
      const liste: Array<{ name: string; sichtbar: boolean }> = [];
      for (let i = 0; i < 14; i++) {
        await s.page.keyboard.press("Tab");
        const f = await s.page.evaluate(fokusImBrowser);
        if (!f) continue;
        liste.push(f);
        await h.shot(s.page, `kontrast/fokus_${dunkel ? "dunkel" : "hell"}_${String(i + 1).padStart(2, "0")}`);
      }
      w.fokus = liste;
      const ohne = liste.filter((f) => !f.sichtbar);
      soll(!ohne.length, `ohne sichtbaren Fokus: ${ohne.map((f) => f.name).join(", ")}`);
    } finally { await s.close(); }
  });
}

const spec: Spec = {
  name: "kontrast",
  async run(h) {
    const out: TestResult[] = [];
    for (const dunkel of [false, true]) {
      for (const [z, f] of ZUSTAENDE) out.push(await audit(h, z, dunkel, f));
      out.push(await fokus(h, dunkel));
    }
    return out;
  },
};
export default spec;
