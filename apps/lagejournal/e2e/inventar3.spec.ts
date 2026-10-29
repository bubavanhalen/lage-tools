/**
 * Inventar der Zustände, die es erst mit MVP 3 gibt (Spez. MVP 3, Kap. 1.3): Kürzel-Abfrage ≤ 16, Ansicht Offen ≤ 13,
 * Offen mit gewähltem Punkt ≤ 15, Gestrichene gezeigt ≤ 13; «Mehr …» offen, Übergabe-Seite (Ziel ≤ 8) und
 * Druck-Dialoge nur berichten; mit `--hit: 48px` kein Überlauf und nichts unter 48 px in Offen und «Mehr …».
 * Laptop und Tablet. Ausgabe e2e/out/inventar3.json. Phase 0: Gerüst – rot, bis Pakete B–D fertig sind; danach
 * kann Paket C die Fälle nach inventar.spec.ts übernehmen.
 */
import { UHR_T2_0730, ansicht, aufgabe, eintragenText, feldVon, inventarImBrowser, knopfVon, menue, soll, ueberlaufImBrowser, zeilenVon, type Geraet, type Harness, type Session, type Spec, type TestResult } from "./lib.ts";

async function messen(h: Harness, name: string, geraet: Geraet, grenze: number | null, o: Parameters<Harness["open"]>[0], vorher: (s: Session) => Promise<void>, css?: string): Promise<TestResult> {
  return aufgabe(name, geraet, async (w) => {
    const s = await h.open({ uhr: UHR_T2_0730, geraet, ...o, ...(css ? { css } : {}) });
    try {
      await vorher(s);
      await s.page.waitForTimeout(300);
      const liste = await s.page.evaluate(inventarImBrowser);
      Object.assign(w, { anzahl: liste.length, grenze, elemente: liste });
      await h.shot(s.page, `inventar3/${name.replace(/[^\wäöü]+/gi, "_")}_${geraet}`);
      if (css) {
        const ueber = await s.page.evaluate(ueberlaufImBrowser);
        const klein = liste.filter((e) => e.w < 48 || e.h < 48);
        Object.assign(w, { ueberlauf: ueber, unter48: klein });
        soll(!ueber.length && !klein.length, `Überlauf ${ueber.length}, unter 48 px ${klein.length}`);
      }
      if (grenze !== null) soll(liste.length <= grenze, `${liste.length} Bedienelemente > ${grenze}`);
    } finally { await s.close(); }
  });
}

const offen = async (s: Session) => { await ansicht(s, "Offen"); };
const offenGewaehlt = async (s: Session) => {
  await eintragenText(s, "Auftrag an H01: Beo NAI 1 bis 1200");
  await ansicht(s, "Offen");
  await s.page.locator(".jlist li").first().click();
};
const mehr = async (s: Session) => { await zeilenVon(s).first().click(); await knopfVon(s, /^Mehr/).click(); };

const spec: Spec = {
  name: "inventar3",
  async run(h) {
    const out: TestResult[] = [];
    for (const g of ["laptop", "tablet"] as Geraet[]) {
      out.push(await messen(h, "Vorschau mit Kürzel-Abfrage", g, 16, { query: "?beispiel=leer" }, async (s) => {
        await feldVon(s).fill("H04 2 Fz in AK7 Rtg N");
        if (g === "tablet") await knopfVon(s, /^Eintragen/).first().tap(); else await feldVon(s).press("Enter");
        soll(await s.page.getByText("Wer erfasst?").first().isVisible().catch(() => false), "keine Kürzel-Abfrage");
      }));
      out.push(await messen(h, "Ansicht Offen", g, 13, { query: "?beispiel" }, offen));
      out.push(await messen(h, "Offen, Punkt gewählt", g, 15, { query: "?beispiel" }, offenGewaehlt));
      out.push(await messen(h, "Gestrichene gezeigt", g, 13, { query: "?beispiel" }, async (s) => {
        await zeilenVon(s).first().click();
        await knopfVon(s, "Löschen").click();
        await s.page.waitForTimeout(9000);
        await s.page.getByRole("button", { name: /Gestrichene zeigen/ }).or(s.page.getByRole("link", { name: /Gestrichene zeigen/ })).first().click();
      }));
      out.push(await messen(h, "«Mehr …» offen (nur Bericht)", g, null, { query: "?beispiel" }, mehr));
      out.push(await messen(h, "Übergabe-Seite (nur Bericht, Ziel ≤ 8)", g, null, { query: "?beispiel" }, async (s) => { await offen(s); await knopfVon(s, /^Übergabe/).first().click(); }));
      out.push(await messen(h, "Dialog Journal drucken (nur Bericht)", g, null, { query: "?beispiel" }, async (s) => { await menue(s, /Journal drucken/); }));
      out.push(await messen(h, "Dialog Lagekarte drucken (nur Bericht)", g, null, { query: "?beispiel" }, async (s) => { await menue(s, /Lagekarte drucken/); }));
      out.push(await messen(h, "--hit 48px: Ansicht Offen", g, null, { query: "?beispiel" }, offen, ":root{--hit:48px !important}"));
      out.push(await messen(h, "--hit 48px: «Mehr …»", g, null, { query: "?beispiel" }, mehr, ":root{--hit:48px !important}"));
    }
    return out;
  },
};
export default spec;
