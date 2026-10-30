/**
 * Sommerzeit (Spez. MVP 3.5, Kap. 8.6, Pakete C und E): doppelte Stunde bei der Rückstellung am 27.10.2030, fehlende
 * Stunde beim Vorstellen am 31.03.2030 – Reihenfolge, Lage bei LIVE, Lesart «02:55 MESZ», Rückblick mit zwei Knöpfen,
 * «geht nicht» mit Vorschlag, Journal-PDF mit MESZ/MEZ. Alle Kontexte `timezoneId: "Europe/Zurich"` (run.mjs).
 * Übung: Beispiel Bern ohne Meldungen mit den Tagen der Umstellung (als Datei geöffnet, Kürzel ZZ – fiktiv).
 * Phase 0: Gerüst – darf rot sein. Ausgabe e2e/out/sommerzeit.json. Kern: packages/core/test/zeit35.test.ts.
 */
import { readFileSync } from "node:fs";
import {
  UHR_RUECKSTELLUNG_0210_MEZ, UHR_RUECKSTELLUNG_0245_MESZ, UHR_VORSTELLEN_0340, aufgabe, eintragenText, feldVon, knopfVon, markerVon, menue,
  pdfInfoImBrowser, soll, zeilenVon, zustandVon, type Harness, type Session, type Spec, type TestResult,
} from "./lib.ts";

/** Beispiel ohne Meldungen mit eigenen Übungstagen in einem neuen Kontext zur Uhr `uhr`, Kürzel ZZ */
async function uebungAm(h: Harness, tage: string[], uhr: string): Promise<Session> {
  const a = await h.open({ query: "?beispiel=leer", uhr: "2030-05-15T07:30:00+02:00" });
  let json: Record<string, any>;
  try {
    const dl = a.page.waitForEvent("download", { timeout: 5000 });
    await menue(a, /Datei für anderes Gerät/);
    json = JSON.parse(readFileSync(await (await dl).path(), "utf8"));
  } finally { await a.close(); }
  json.exercise.id = `ex-sommerzeit-${tage[1]}`;
  json.exercise.name = "Sommerzeit (fiktiv, Raum Bern)";
  json.exercise.days = tage;
  const s = await h.open({ uhr });
  const fc = s.page.waitForEvent("filechooser", { timeout: 5000 });
  await menue(s, /Datei öffnen \(zusammenführen\)/);
  await (await fc).setFiles({ name: "sommerzeit.lage.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(json)) });
  await s.page.waitForTimeout(800);
  await menue(s, /Kürzel ändern/);
  const k = s.page.getByRole("dialog").getByRole("textbox").first();
  await k.fill("ZZ");
  await k.press("Enter");
  await s.page.waitForTimeout(300);
  return s;
}
const reihenfolge = async (s: Session) => (await zeilenVon(s).allInnerTexts()).map((t: string) => /H0\d/.exec(t)?.[0] ?? "?");

const spec: Spec = {
  name: "sommerzeit",
  async run(h: Harness) {
    const out: TestResult[] = [];
    const TAGE_OKT = ["2030-10-26", "2030-10-27"];

    out.push(await aufgabe("1+2 Rückstellung: H01 02:45 MESZ, H02 02:10 MEZ, «0255» = 02:55 MESZ (vor 75 min) dazwischen", "laptop", async (w) => {
      const s = await uebungAm(h, TAGE_OKT, UHR_RUECKSTELLUNG_0245_MESZ);
      try {
        await eintragenText(s, "H01 1 Pers AC7");
        await s.page.clock.fastForward(25 * 60000); // = 02:10 MEZ
        await eintragenText(s, "H02 1 Fz AK9");
        w.reihe1 = await reihenfolge(s);
        soll(JSON.stringify((w.reihe1 as string[]).slice(0, 2)) === JSON.stringify(["H02", "H01"]), `Liste ${JSON.stringify(w.reihe1)} (H02 oben)`);
        soll(await markerVon(s) >= 2, "nicht beide Zeichen bei LIVE");
        soll(!(await s.page.getByText(/nach LIVE|liegt in der Zukunft/).count()), "«nach LIVE» bzw. Zukunft angezeigt");
        await feldVon(s).fill("0255 H03 1 Pers AE5");
        await s.page.waitForTimeout(200);
        w.zustand = await zustandVon(s);
        w.vorschau = (await s.page.locator("[data-zustand]").first().innerText()).replace(/\s+/g, " ").slice(0, 160);
        soll(w.zustand === "bereit", `Zustand ${w.zustand}`);
        soll(/02:55 MESZ \(vor 75 min\)/.test(String(w.vorschau)), "Vorschau ohne «02:55 MESZ (vor 75 min)»");
        await feldVon(s).press("Enter");
        await s.page.waitForTimeout(400);
        w.reihe2 = await reihenfolge(s);
        soll(JSON.stringify((w.reihe2 as string[]).slice(0, 3)) === JSON.stringify(["H02", "H03", "H01"]), `Liste ${JSON.stringify(w.reihe2)}`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("3 Rückblick «0230» in der doppelten Stunde: zwei Knöpfe MESZ/MEZ; MESZ ohne H01, MEZ mit H01", "laptop", async (w) => {
      const s = await uebungAm(h, TAGE_OKT, UHR_RUECKSTELLUNG_0245_MESZ);
      try {
        await eintragenText(s, "H01 1 Pers AC7");
        await s.page.clock.fastForward(25 * 60000);
        await s.page.getByRole("button", { name: /Zurückblicken/ }).click();
        const f = s.page.getByRole("textbox", { name: /Lage um/ }).first();
        await f.fill("0230");
        await f.press("Enter");
        const mesz = knopfVon(s, "02:30 MESZ"), mez = knopfVon(s, "02:30 MEZ");
        soll(await mesz.isVisible().catch(() => false) && await mez.isVisible().catch(() => false), "Knöpfe «02:30 MESZ» / «02:30 MEZ» fehlen");
        await mesz.click();
        w.mesz = await zeilenVon(s).filter({ hasText: "H01" }).count();
        await f.fill("0230"); await f.press("Enter");
        await mez.click();
        w.mez = await zeilenVon(s).filter({ hasText: "H01" }).count();
        soll(w.mesz === 0 && (w.mez as number) > 0, `MESZ ${w.mesz}, MEZ ${w.mez}`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("4 Vorstellen 31.03.: «0230 H01 1 Pers AC7» → rot, Knopf «03:30 einsetzen»", "laptop", async (w) => {
      const s = await uebungAm(h, ["2030-03-30", "2030-03-31"], UHR_VORSTELLEN_0340);
      try {
        await feldVon(s).fill("0230 H01 1 Pers AC7");
        await s.page.waitForTimeout(200);
        w.zustand = await zustandVon(s);
        soll(w.zustand === "geht-nicht", `Zustand ${w.zustand}`);
        soll(await s.page.getByText(/02:30 gibt es heute nicht/).first().isVisible().catch(() => false), "Text «02:30 gibt es heute nicht …» fehlt");
        soll(await knopfVon(s, "03:30 einsetzen").isVisible().catch(() => false), "Knopf «03:30 einsetzen» fehlt");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("5 Journal-PDF am 27.10.: Zeiten der doppelten Stunde mit MESZ/MEZ", "laptop", async (w) => {
      const s = await uebungAm(h, TAGE_OKT, UHR_RUECKSTELLUNG_0245_MESZ);
      try {
        await eintragenText(s, "H01 1 Pers AC7");
        await s.page.clock.fastForward(25 * 60000);
        await eintragenText(s, "H02 1 Fz AK9");
        await menue(s, /Journal drucken/);
        await knopfVon(s, "PDF erstellen").click();
        await s.page.waitForTimeout(2000);
        const z = ((await s.page.evaluate(pdfInfoImBrowser))?.zeilen ?? []).join(" ");
        w.pdf = z.slice(0, 300);
        soll(/02:45 MESZ/.test(z) && /02:10 MEZ/.test(z), "PDF ohne «02:45 MESZ» / «02:10 MEZ»");
      } finally { await s.close(); }
    }));

    return out;
  },
};
export default spec;
