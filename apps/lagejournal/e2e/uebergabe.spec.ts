/**
 * Übergabe-Test (Spez. MVP 3, Kap. 8.3): `?beispiel`, Uhr T2 07:30, Kürzel BSP; vorher vier Einträge aus 8.1
 * (Rückfrage, Auftrag, Vbk, Kontakt). Fünf Lagefragen müssen als sichtbarer Text auf der Seite stehen (ohne Klick),
 * Lesezeit ≤ 900 Wörter (auch `?beispiel=lang`), Visum, PDF ≤ 2 Seiten. Laptop. Ausgabe e2e/out/uebergabe.json.
 * Phase 0: Gerüst – rot, bis Paket C fertig ist. Punkt 6 (zweite Person liest 5 min) ist manuell.
 */
import { UHR_T2_0730, UHR_T4_0730, ansicht, antwortzeit, aufgabe, eintragenText, knopfVon, pdfInfoImBrowser, soll, woerterImBrowser, zeilenVon, type Harness, type Session, type Spec, type TestResult } from "./lib.ts";

/** Übergabe-Seite: Dialog mit `aria-label="Übergabe"` (Vertrag für Paket C, siehe shell/README.md) */
const SEITE = '[role=dialog][aria-label="Übergabe"]';

async function oeffnen(s: Session): Promise<number> {
  await ansicht(s, "Offen");
  const t0 = Date.now();
  await knopfVon(s, /^Übergabe/).first().click();
  const ms = await antwortzeit(async () => s.page.locator(SEITE).first().isVisible(), 3000);
  return ms === Infinity ? ms : Date.now() - t0;
}

const spec: Spec = {
  name: "uebergabe",
  async run(h: Harness) {
    const out: TestResult[] = [];
    const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
    try {
      out.push(await aufgabe("0 Vorbereitung: vier Einträge (Rückfrage, Auftrag, Vbk, Kontakt)", "laptop", async (w) => {
        for (const t of ["H04 Rückfrage: Standort Det 2?", "Auftrag an H01: Beo NAI 1 bis 1200", "H02 Vbk i.O.", "Kontakt! H02, Feuer aus AK9, 2 Schützen, wir halten"]) await eintragenText(s, t);
        w.zeilen = await zeilenVon(s).count();
      }));
      out.push(await aufgabe("1 «Offen» → «Übergabe …» ≤ 500 ms, Stand T2 15.05.2030 07:30", "laptop", async (w) => {
        w.ms = await oeffnen(s);
        soll(w.ms !== Infinity && (w.ms as number) <= 500, `Übergabe nach ${w.ms} ms`);
        soll(await s.page.getByText(/Stand T2 15\.05\.2030 07:30/).first().isVisible(), "Stand fehlt");
      }));
      const seite = () => s.page.locator(SEITE).first();
      const frage = (name: string, re: RegExp | (() => Promise<RegExp>)) => aufgabe(name, "laptop", async (w) => {
        const r = typeof re === "function" ? await re() : re;
        const txt = (await seite().innerText().catch(() => "")).replace(/\s+/g, " ");
        w.gesucht = String(r);
        soll(r.test(txt), `nicht auf der Seite: ${r}`);
      });
      out.push(await frage("F1 Wo steht H03 und seit wann? → AP4 D, T1 18:45", /H03[^]*?AP4 D[^]*?T1 18:45/));
      out.push(await frage("F2 Letzte Vbk mit H02 und wie? → 07:30 gut", /H02[^]*?07:3\d gut/));
      out.push(await frage("F3 Welche Aufträge sind offen? → an H01: Beo NAI 1 – bis 12:00", /an H01: Beo NAI 1 – bis 12:00/));
      out.push(await frage("F4 Wie viel Rot wurde gesehen? → Rot gesehen: mind. … Pers, … Fz", /Rot gesehen: mind\. \d+ Pers, \d+ Fz/));
      out.push(await frage("F5 Wahrscheinlichste Absicht Rot", /Am wahrscheinlichsten: Rot könnte/));
      out.push(await aufgabe("3 Lesezeit ≤ 900 Wörter (?beispiel)", "laptop", async (w) => {
        w.woerter = await s.page.evaluate(woerterImBrowser, SEITE);
        soll((w.woerter as number) > 0 && (w.woerter as number) <= 900, `${w.woerter} Wörter`);
      }));
      out.push(await aufgabe("5 «Als PDF» → ≤ 2 Seiten, Visum, Klassifizierung", "laptop", async (w) => {
        await knopfVon(s, "Als PDF").click();
        await s.page.waitForTimeout(1500);
        const info = await s.page.evaluate(pdfInfoImBrowser);
        w.pdf = info ? { seiten: info.seiten, format: info.format } : null;
        soll(info && info.seiten <= 2, `PDF ${info ? info.seiten + " Seiten" : "fehlt"}`);
        const z = (info?.zeilen ?? []).join("\n");
        soll(/übergeben von BSP/.test(z) && /übernommen von/.test(z) && /INTERN/.test(z), "Visum oder Klassifizierung fehlt");
      }));
      out.push(await aufgabe("4 «Übergabe abschliessen» gesperrt ohne Kürzel; mit MU gespeichert, Kopf, Trenner", "laptop", async (w) => {
        const ab = knopfVon(s, "Übergabe abschliessen");
        soll(await ab.isDisabled(), "Knopf nicht gesperrt");
        soll(await s.page.getByText("Kürzel der übernehmenden Person fehlt").first().isVisible(), "Hinweis fehlt");
        await s.page.getByLabel(/übernommen von/).fill("MU");
        await ab.click();
        soll(await s.page.getByText(/Übergabe 07:30 BSP → MU gespeichert/).first().isVisible(), "Rückmeldung fehlt");
        soll(await s.page.getByText(/Schicht MU seit 07:30/).first().isVisible(), "Kopf ohne «Schicht MU seit 07:30»");
        await ansicht(s, "Journal");
        await eintragenText(s, "H03 1 Fz in NAI 2 Rtg N");
        const items = await s.page.locator(".jlist li, .jl-trenner").evaluateAll((l: Element[]) => l.slice(0, 3).map((e) => (e as HTMLElement).innerText.slice(0, 40)));
        w.oben = items;
        soll(/1 Fz in NAI 2/.test(items[0] ?? "") && /Neu in deiner Schicht/.test(items.join(" ")), `Trenner nicht unter dem neuen Eintrag: ${items.join(" | ")}`);
      }));
    } finally { await s.close(); }

    out.push(await aufgabe("3 Lesezeit ≤ 900 Wörter (?beispiel=lang)", "laptop", async (w) => {
      const l = await h.open({ query: "?beispiel=lang", uhr: UHR_T4_0730 });
      try {
        await l.page.waitForTimeout(1500);
        w.ms = await oeffnen(l);
        w.woerter = await l.page.evaluate(woerterImBrowser, SEITE);
        soll((w.woerter as number) > 0 && (w.woerter as number) <= 900, `${w.woerter} Wörter`);
      } finally { await l.close(); }
    }));
    return out;
  },
};
export default spec;
