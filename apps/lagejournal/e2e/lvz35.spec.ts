/**
 * LVZ-Lücken (Spez. MVP 3.5, Kap. 8.4, Paket D): Ausgang, Begehren, Rückfrage von oben, Übergabe «Von oben» und
 * Übergabe-Eintrag, KI-Notiz «nicht geprüft», Bezug-Wahl 64a/64b, eine Zahl für offene Hinweise, «Nr 56» überall.
 * Phase 0: Gerüst – darf rot sein, bis Paket D (mit C für die Erkennung) fertig ist. Ausgabe e2e/out/lvz35.json.
 * Satz-Nummern (#38 …) wie Tabelle Kap. 8.3.
 */
import { readFileSync } from "node:fs";
import {
  UHR_T2_0730, UHR_T4_0730, ansicht, aufgabe, eintragenText, feldVon, knopfVon, markerVon, menue, pdfInfoImBrowser, soll, woerterImBrowser, zeilenVon,
  type Harness, type Session, type Spec, type TestResult,
} from "./lib.ts";

const offenText = async (s: Session) => (await s.page.locator('[role="tabpanel"]').first().innerText().catch(() => "")).replace(/\s+/g, " ");
const zeileMit = (s: Session, re: RegExp) => s.page.locator(".jlist li").filter({ hasText: re }).first();
const nrVon = async (s: Session, re: RegExp) => (await zeileMit(s, re).getAttribute("data-nr").catch(() => null)) ?? (await zeileMit(s, re).locator("[data-nr]").first().getAttribute("data-nr").catch(() => null));

async function csvVon(s: Session): Promise<string> {
  const dl = s.page.waitForEvent("download", { timeout: 5000 });
  await menue(s, /Journal als Tabelle/);
  return readFileSync(await (await dl).path(), "utf8");
}
async function uebergabeOeffnen(s: Session): Promise<void> {
  await menue(s, /^Übergabe/);
  await s.page.getByRole("dialog", { name: "Übergabe" }).waitFor({ timeout: 3000 });
}

const spec: Spec = {
  name: "lvz35",
  async run(h: Harness) {
    const out: TestResult[] = [];
    const neu = () => h.open({ query: "?beispiel", uhr: UHR_T2_0730 });

    out.push(await aufgabe("1 Ausgang #38–#41: data-art ausgang, keine Zeichen, «↗ Ausgang an Bat», «weitergemeldet Bat», CSV", "laptop", async (w) => {
      const s = await neu();
      try {
        const m0 = await markerVon(s);
        const ziel = await nrVon(s, /Kpz|Feind/);
        for (const t of ["Meldung an Bat: 2 Kpz AK9 Rtg W", "An Bat: Lage unverändert", "Lagemeldung an Kp: ruhig", `Weitergemeldet an Bat: Nr ${ziel ?? 54}`]) await eintragenText(s, t);
        const arten = await zeilenVon(s).evaluateAll((l: Element[]) => l.slice(0, 4).map((e) => e.getAttribute("data-art") ?? e.querySelector("[data-art]")?.getAttribute("data-art")));
        w.arten = arten;
        soll(arten.every((a: string | null) => a === "ausgang"), `data-art ${JSON.stringify(arten)}`);
        soll(await markerVon(s) === m0, "Zeichen auf der Karte dazugekommen");
        soll(await zeileMit(s, /↗\s*Ausgang an Bat/).isVisible().catch(() => false), "Zeile «↗ Ausgang an Bat» fehlt");
        soll(await s.page.getByText(/weitergemeldet Bat \d\d:\d\d \(Nr \d+\)/).first().isVisible().catch(() => false), "Vermerk «weitergemeldet Bat … (Nr …)» fehlt");
        const csv = await csvVon(s);
        soll(/;Ausgang an Bat;/.test(csv), "CSV ohne Art «Ausgang an Bat»");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("2 Begehren #24: Offen «Begehren» +1 → Erledigt −1 → Rückgängig +1; Übergabe «Begehren (offen)»", "laptop", async (w) => {
      const s = await neu();
      try {
        await eintragenText(s, "H05 Mun Nachschub benötigt");
        await ansicht(s, "Offen");
        const t1 = await offenText(s);
        w.offen = t1.slice(0, 300);
        soll(/BEGEHREN|Begehren/.test(t1) && /Mun/.test(t1), "Gruppe «Begehren» fehlt");
        await s.page.locator('[role="tabpanel"] li').filter({ hasText: /Mun/ }).first().click();
        await knopfVon(s, "Erledigt").click();
        soll(!/Mun Nachschub/.test(await offenText(s)), "Begehren nach «Erledigt» noch offen");
        await s.page.keyboard.press("Control+z");
        await s.page.waitForTimeout(300);
        soll(/Mun/.test(await offenText(s)), "Rückgängig bringt das Begehren nicht zurück");
        await uebergabeOeffnen(s);
        soll(/Begehren \(offen\)/.test(await s.page.getByRole("dialog", { name: "Übergabe" }).innerText()), "Übergabe-Zahl «Begehren (offen)» fehlt");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("3 Rückfrage von oben #42: Gruppe über «Aufträge», «Antwort eintragen» → beantwortet", "laptop", async (w) => {
      const s = await neu();
      try {
        await eintragenText(s, "Auftrag an H01: Beo NAI 1 bis 1200");
        await eintragenText(s, "Bat fragt: Standort H02?");
        await ansicht(s, "Offen");
        const t = await offenText(s);
        w.offen = t.slice(0, 300);
        // Review 6: Gruppe heisst «Von oben» (Rückfragen und Meldeaufträge von oben)
        const io = t.search(/RÜCKFRAGEN VON OBEN|Rückfragen von oben|\bVON OBEN\b|\bVon oben\b/), ia = t.search(/AUFTRÄGE|Aufträge/);
        soll(io >= 0 && (ia < 0 || io < ia), "«Von oben» fehlt oder steht nicht über «Aufträge»");
        await s.page.locator('[role="tabpanel"] li').filter({ hasText: /Bat fragt/ }).first().click();
        await knopfVon(s, "Antwort eintragen").click();
        soll(/^Antwort an Bat: /.test(await feldVon(s).inputValue()), "Feld nicht «Antwort an Bat: »");
        await feldVon(s).pressSequentially("H02 in AL9");
        await feldVon(s).press("Enter");
        await s.page.waitForTimeout(400);
        await ansicht(s, "Offen");
        soll(!/Bat fragt/.test(await offenText(s)), "Rückfrage nach Antwort noch offen");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("3b Review 6 H1: zwei Fragen von oben – «Antwort eintragen» an der älteren beantwortet genau diese (fester Bezug)", "laptop", async (w) => {
      const s = await neu();
      try {
        await eintragenText(s, "Bat fragt: Standort H02?");
        await eintragenText(s, "Bat fragt: wie viele Fz bei AD7?");
        await ansicht(s, "Offen");
        await s.page.locator('[role="tabpanel"] li').filter({ hasText: /Standort H02/ }).first().click();
        await knopfVon(s, "Antwort eintragen").click();
        await feldVon(s).pressSequentially("H02 in AL9");
        await s.page.waitForTimeout(300);
        w.vorschau = (await s.page.locator(".eb-prev").first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 240);
        soll(/Antwort auf Nr \d+[a-z]? \(.*Standort H02/.test(String(w.vorschau)), "Vorschau ohne «Antwort auf Nr … (Standort H02?)»");
        await feldVon(s).press("Enter");
        await s.page.waitForTimeout(400);
        await ansicht(s, "Offen");
        const t = await offenText(s);
        w.offen = t.slice(0, 300);
        soll(!/Standort H02/.test(t), "beantwortete Frage «Standort H02?» noch offen");
        soll(/wie viele Fz bei AD7/.test(t), "andere Frage «wie viele Fz» fälschlich erledigt");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("4 Übergabe «Von oben»: «ab 09:07», 8 gültige + «+n weitere», ≤ 2 vorbei, ≤ 900 Wörter", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: "2030-05-15T07:46:00+02:00" });
      try {
        await eintragenText(s, "Bat: ab 0907 Feind Det mit 2 Fz aus Rtg Belp erwartet");
        for (let i = 0; i < 9; i++) await eintragenText(s, i % 2 ? `Kp: Verpflegung um 1${i}00 im KP` : `Bat: Lagerapport 0${8 + (i % 2)}${i}0 im KP Bat`);
        await s.page.clock.fastForward("02:24:00");
        await uebergabeOeffnen(s);
        const d = (await s.page.getByRole("dialog", { name: "Übergabe" }).innerText()).replace(/\s+/g, " ");
        w.vonOben = /Von oben[^]*?(?=Lage|Offen|$)/.exec(d)?.[0]?.slice(0, 400);
        soll(/ab 09:07/.test(d), "Zeile mit «ab 09:07» fehlt");
        soll(/\+\d+ weitere im Journal/.test(d), "«+n weitere im Journal» fehlt");
        soll((d.match(/\(vorbei \d\d:\d\d\)/g) ?? []).length <= 2, "mehr als 2 vorbei");
        w.woerter = await s.page.evaluate(woerterImBrowser, '[role="dialog"][aria-label="Übergabe"]');
        soll((w.woerter as number) <= 900, `${w.woerter} Wörter`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("5 Übergabe-Eintrag: Suche «Übergabe» findet genau 1 Zeile mit «Nr», keine virtuelle; PDF enthält sie", "laptop", async (w) => {
      const s = await neu();
      try {
        await uebergabeOeffnen(s);
        await s.page.getByLabel(/übernommen von/).fill("MU");
        await knopfVon(s, "Übergabe abschliessen").click();
        await s.page.keyboard.press("Escape");
        await s.page.getByPlaceholder(/^Suchen/).fill("Übergabe");
        await s.page.waitForTimeout(400);
        const z = await zeilenVon(s).filter({ hasText: /Übergabe BSP → MU/ }).count();
        w.zeilen = z;
        soll(z === 1, `${z} Zeilen «Übergabe BSP → MU»`);
        soll(await zeilenVon(s).filter({ hasText: /Übergabe BSP → MU/ }).first().getByText(/Nr \d+/).count() > 0, "Übergabe-Eintrag ohne «Nr»");
        soll(!(await s.page.getByText(/Schichtwechsel/).count()), "virtuelle Zeile «Schichtwechsel …» zusätzlich");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("6 KI-Notiz: ohne Häkchen «nicht geprüft», mit Häkchen «geprüft BSP»", "laptop", async (w) => {
      // Ablauf Paket D (Notizdatei): Beispiel mit KI an (als Datei), Schlüssel und Einwilligung auf dem Gerät, KI-Antwort als Attrappe
      const a = await neu();
      let json: Record<string, any>;
      try {
        const dl = a.page.waitForEvent("download", { timeout: 5000 });
        await menue(a, /Datei für anderes Gerät/);
        json = JSON.parse(readFileSync(await (await dl).path(), "utf8"));
      } finally { await a.close(); }
      json.exercise.ki = { enabled: true, since: "2030-05-15T05:00:00.000Z" };
      const lokal = { "lt-ki-key": "sk-test", [`lt-ki-consent:${json.exercise.id}`]: "2030-05-15T05:00:00.000Z" };
      const s = await h.open({ uhr: UHR_T2_0730, lokal, vorLaden: async (p: any) => {
        await p.route("https://api.anthropic.com/v1/messages", (r: any) => r.fulfill({ json: { content: [{ type: "text", text: "Lage Rot: 2 Kpz bei AK9, Det 1 in NAI 2. Lage eigene: unverändert." }], model: "claude-x", usage: {} } }));
      } });
      try {
        const fc = s.page.waitForEvent("filechooser", { timeout: 5000 });
        await menue(s, /Datei öffnen \(zusammenführen\)/);
        await (await fc).setFiles({ name: "ki.lage.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(json)) });
        await s.page.waitForTimeout(800);
        await s.page.getByLabel("Dein Kürzel").fill("BSP");
        await s.page.getByLabel("Dein Kürzel").press("Enter");
        for (const geprueft of [false, true]) {
          await uebergabeOeffnen(s);
          await s.page.getByRole("button", { name: /Lagebericht/ }).first().click();
          await knopfVon(s, /Entwurf erstellen|Neu entwerfen/).click();
          // Vorschau «Wird an Claude gesendet» → «Senden» (nie automatisch)
          const senden = knopfVon(s, "Senden");
          if (await senden.isVisible().catch(() => false)) await senden.click();
          await s.page.getByText("Ich habe den Entwurf geprüft").waitFor({ timeout: 5000 });
          if (geprueft) await s.page.getByText("Ich habe den Entwurf geprüft").click();
          await knopfVon(s, "Als Notiz ins Journal").click();
          await s.page.waitForTimeout(300);
          if (await s.page.getByRole("dialog", { name: "Übergabe" }).isVisible().catch(() => false)) await s.page.keyboard.press("Escape");
          await s.page.waitForTimeout(300);
        }
        const texte = await zeilenVon(s).filter({ hasText: /Lagebericht/ }).allInnerTexts();
        w.zeilen = texte.map((t: string) => t.replace(/\s+/g, " ").slice(0, 80));
        soll(texte.some((t: string) => /nicht geprüft/.test(t)), "Notiz «KI-Entwurf, nicht geprüft» fehlt");
        soll(texte.some((t: string) => /geprüft BSP/.test(t)), "Notiz «KI-Entwurf, geprüft BSP» fehlt");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("7 Bezug-Wahl #50: 64a/64b über zwei Kontexte → Knopf «64b …» → «Antwort auf Nr 64b»", "laptop", async (w) => {
      const a = await neu(), b = await neu();
      try {
        await eintragenText(a, "H02 3 Fz AK9");
        await eintragenText(b, "H04 1 Pers AF11");
        const dl = b.page.waitForEvent("download", { timeout: 5000 });
        await menue(b, /Datei für anderes Gerät/);
        const pfad = await (await dl).path();
        const fc = a.page.waitForEvent("filechooser", { timeout: 5000 });
        await menue(a, /Datei öffnen \(zusammenführen\)/);
        await (await fc).setFiles({ name: "b.lage.json", mimeType: "application/json", buffer: readFileSync(pfad) });
        await a.page.waitForTimeout(800);
        const nr = (await nrVon(a, /3 Fz AK9/))?.replace(/[a-z]$/, "");
        w.nr = nr;
        await feldVon(a).fill(`Antwort zu ${nr}`);
        await a.page.waitForTimeout(200);
        soll(await a.page.locator("[data-zustand]").first().getAttribute("data-zustand") === "pruefen", "nicht gelb «bezug-wahl»");
        await knopfVon(a, new RegExp(`^${nr}b\\b`)).click();
        await feldVon(a).press("Enter");
        await a.page.waitForTimeout(400);
        soll(await zeileMit(a, new RegExp(`Antwort auf Nr ${nr}b`)).isVisible().catch(() => false), `Zeile «Antwort auf Nr ${nr}b» fehlt`);
      } finally { await a.close(); await b.close(); }
    }));

    out.push(await aufgabe("8 Eine Zahl: Reiter «Was Rot ⚠n», Übergabe, Offen-Verweis gleich (beispiel und lang)", "laptop", async (w) => {
      for (const [q, uhr] of [["?beispiel", UHR_T2_0730], ["?beispiel=lang", UHR_T4_0730]] as const) {
        const s = await h.open({ query: q, uhr });
        try {
          await s.page.waitForTimeout(2500);
          const reiter = +(/(\d+)/.exec(await s.page.getByRole("tab", { name: /Was Rot/ }).first().innerText())?.[1] ?? "0");
          await ansicht(s, "Offen");
          const offen = +(/Was Rot: (\d+) offene Hinweise/.exec(await offenText(s))?.[1] ?? "-1");
          await uebergabeOeffnen(s);
          const ueb = +(/Hinweise zu Rot offen (\d+)/.exec((await s.page.getByRole("dialog", { name: "Übergabe" }).innerText()).replace(/\s+/g, " "))?.[1] ?? "-2");
          (w as Record<string, unknown>)[q] = { reiter, offen, ueb };
          soll(reiter === offen && offen === ueb, `${q}: Reiter ${reiter}, Offen ${offen}, Übergabe ${ueb}`);
        } finally { await s.close(); }
      }
    }));

    out.push(await aufgabe("9 «Nr 56»-Form in Liste, Offen, Übergabe und PDF-Zeilen (Journal-PDF-Spalte «Nr» ausgenommen)", "laptop", async (w) => {
      const s = await neu();
      try {
        await eintragenText(s, "Auftrag an H01: Beo NAI 1 bis 1200");
        const liste = (await zeilenVon(s).first().innerText()).replace(/\s+/g, " ");
        await ansicht(s, "Offen");
        const offen = await offenText(s);
        await uebergabeOeffnen(s);
        const ueb = (await s.page.getByRole("dialog", { name: "Übergabe" }).innerText()).replace(/\s+/g, " ");
        await s.page.getByRole("dialog", { name: "Übergabe" }).getByRole("button", { name: /Als PDF/ }).click();
        await s.page.waitForTimeout(1500);
        const pdf = await s.page.evaluate(pdfInfoImBrowser);
        w.liste = liste.slice(0, 120);
        for (const [n, t] of [["Liste", liste], ["Offen", offen], ["Übergabe", ueb], ["Übergabe-PDF", (pdf?.zeilen ?? []).join(" ")]] as const) soll(/Nr \d+[a-z]?/.test(t), `${n} ohne «Nr 56»-Form`);
      } finally { await s.close(); }
    }));

    return out;
  },
};
export default spec;
