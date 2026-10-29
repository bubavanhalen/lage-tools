/**
 * Drucken (Spez. MVP 3, Kap. 8.4): Lagekarte A4/A3 quer (auch offline), aufgehobene Sperre, Journal-PDF pro Schicht
 * ≤ 5 Seiten (`?beispiel=lang`). Geprüft über `window.__ltPdfInfo` (Seiten, Format, Zeilen). Laptop, Ersatzkacheln.
 * Ausgabe e2e/out/druck.json. Phase 0: Gerüst – rot, bis Paket D fertig ist.
 * Wochentage werden berechnet (`wochentag`): 15.05.2030 ist ein Mittwoch, 18.05.2030 ein Samstag (die Spez. nannte
 * Donnerstag/Sonntag).
 */
import { UHR_T2_0730, UHR_T4_0730, aufgabe, eintragenText, knopfVon, menue, pdfInfoImBrowser, soll, wochentag, type Harness, type Session, type Spec, type TestResult } from "./lib.ts";

async function pdf(s: Session, max = 10000): Promise<{ info: { seiten: number; format: string; quer?: boolean; zeilen: string[] } | null; ms: number }> {
  await s.page.evaluate(() => { (window as unknown as { __ltPdfInfo?: unknown }).__ltPdfInfo = undefined; });
  const t0 = Date.now();
  await knopfVon(s, "PDF erstellen").click();
  let info = null;
  while (Date.now() - t0 < max && !(info = await s.page.evaluate(pdfInfoImBrowser))) await s.page.waitForTimeout(100);
  return { info, ms: Date.now() - t0 };
}

const spec: Spec = {
  name: "druck",
  async run(h: Harness) {
    const out: TestResult[] = [];
    const lagekarte = (name: string, papier: "A4 quer" | "A3 quer", maxMs: number) => aufgabe(name, "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
      try {
        await menue(s, /Lagekarte drucken/);
        await s.page.getByRole("radio", { name: papier }).check();
        const r = await pdf(s, maxMs + 2000);
        const z = (r.info?.zeilen ?? []).join("\n");
        Object.assign(w, { ms: r.ms, seiten: r.info?.seiten, format: r.info?.format });
        soll(r.info, "kein PDF");
        soll(r.info!.format === (papier.startsWith("A4") ? "a4" : "a3") && r.info!.quer !== false && r.info!.seiten === 1, `Format ${r.info!.format}, ${r.info!.seiten} Seiten`);
        for (const t of ["Stand T2 15.05.2030 07:30", "Legende", "INTERN", "Karte © swisstopo"]) soll(z.includes(t), `ohne «${t}»`);
        soll(r.ms <= maxMs, `${r.ms} ms > ${maxMs}`);
      } finally { await s.close(); }
    });
    out.push(await lagekarte("1 Lagekarte A4 quer ≤ 5 s", "A4 quer", 5000));
    out.push(await lagekarte("2 Lagekarte A3 quer ≤ 8 s", "A3 quer", 8000));

    out.push(await aufgabe("3 Offline: ohne Cache «⚠ … % fehlen», PDF mit Hinweis statt Fehler", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
      try {
        await s.page.context().setOffline(true);
        await menue(s, /Lagekarte drucken/);
        w.dialog = (await s.page.getByText(/offline vorhanden|% fehlen/).first().innerText().catch(() => "")).trim();
        soll(/offline vorhanden|% fehlen/.test(String(w.dialog)), "Dialog ohne Abdeckung");
        const r = await pdf(s);
        const z = (r.info?.zeilen ?? []).join("\n");
        soll(r.info, "kein PDF");
        soll(/✓ offline vorhanden/.test(String(w.dialog)) || /ohne Kartenhintergrund|% der Karte fehlen/.test(z), "PDF ohne Hinweis auf fehlende Karte");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("4 Aufgehobene Sperre fehlt auf dem Blatt, Rückblick 07:10 enthält sie", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
      try {
        await eintragenText(s, "H04 Sperre AG13 aufgehoben");
        await menue(s, /Lagekarte drucken/);
        const jetzt = await pdf(s);
        await s.page.keyboard.press("Escape");
        await knopfVon(s, /Zurückblicken/).click();
        const lageUm = s.page.getByRole("textbox", { name: /Lage um/ }).first();
        await lageUm.fill("0710");
        await lageUm.press("Enter");
        await menue(s, /Lagekarte drucken/);
        const frueher = await pdf(s);
        w.legende = { jetzt: (jetzt.info?.zeilen ?? []).filter((l) => /Sperre/.test(l)), frueher: (frueher.info?.zeilen ?? []).filter((l) => /Sperre/.test(l)) };
        soll(frueher.info?.zeilen.some((l) => /Sperre/.test(l)), "Rückblick-Druck ohne Sperre");
        soll(!(jetzt.info?.zeilen ?? []).some((l) => /AG13/.test(l)), "aufgehobene Sperre AG13 noch auf dem Blatt");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("5/6 Journal-PDF ?beispiel=lang: Schicht ≤ 5 Seiten (≤ 3 s), Tag berichten, Seite n von m, Tageszeile, Visum", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel=lang", uhr: UHR_T4_0730 });
      try {
        await s.page.waitForTimeout(1500);
        await menue(s, /Journal drucken/);
        await s.page.getByRole("radio", { name: /Diese Schicht/ }).check();
        const sch = await pdf(s);
        const z = sch.info?.zeilen ?? [];
        Object.assign(w, { schicht_seiten: sch.info?.seiten, schicht_ms: sch.ms });
        soll(sch.info && sch.info.seiten <= 5, `Schicht ${sch.info?.seiten} Seiten`);
        soll(sch.ms <= 3000, `${sch.ms} ms`);
        soll(z.some((l) => new RegExp(`Seite 1 von ${sch.info!.seiten}`).test(l)), "«Seite n von m» fehlt");
        soll(z.some((l) => l.includes(`T4 · ${wochentag("2030-05-18")} 18.05.2030`)), `Tageszeile «T4 · ${wochentag("2030-05-18")} 18.05.2030» fehlt`);
        soll(z.some((l) => /Visum/.test(l)), "Visum fehlt");
        soll(z.some((l) => /gestrichen/.test(l)) || z.some((l) => /Nachtrag/.test(l)), "weder gestrichen noch Nachtrag im Zeitraum");
        await menue(s, /Journal drucken/);
        await s.page.getByRole("radio", { name: /^Tag T4/ }).check();
        const tag = await pdf(s);
        w.tag_seiten = tag.info?.seiten;
      } finally { await s.close(); }
    }));
    return out;
  },
};
export default spec;
