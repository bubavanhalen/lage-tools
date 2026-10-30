/**
 * Konsistenz und Eingabe (Spez. MVP 3.5, Kap. 8.5, Paket E): Spaltenkopf fest, Tippen springt ins Feld, Alt+L/Alt+U,
 * «Eintragen» springt nicht, Reiter gleich breit, ein Suchtext, Kürzel beim Öffnen, ↑ = zuletzt eingetragen,
 * Rückblick-Zeitfeld ersetzt, LIVE = Uhr, Entwurf über Neustart, Phantomtrupp, Trupp-Knopf, «Andere ▾» mit Ausgang.
 * Phase 0: Gerüst – darf rot sein, bis Paket E fertig ist. Ausgabe e2e/out/konsistenz.json.
 */
import {
  UHR_T2_0730, UHR_T2_0731, UHR_T4_0730, aufgabe, eintragenText, feldVon, knopfVon, markerVon, menue, soll, zeilenVon,
  type Geraet, type Harness, type Session, type Spec, type TestResult,
} from "./lib.ts";

const rect = (s: Session, sel: string) => s.page.locator(sel).first().evaluate((e: Element) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
const zoomVon = (s: Session) => s.page.evaluate(() => document.querySelector(".leaflet-proxy")?.getAttribute("style") ?? document.querySelector(".leaflet-map-pane")?.getAttribute("style") ?? "");
const SUCHTEXT = "Suchen: Trupp, Planquadrat, NAI, Ort";

const spec: Spec = {
  name: "konsistenz",
  async run(h: Harness) {
    const out: TestResult[] = [];

    for (const [g, vp] of [["laptop", undefined], ["tablet", undefined]] as Array<[Geraet, { width: number; height: number } | undefined]>) {
      out.push(await aufgabe("1 Feld fix: Liste ans Ende scrollen, Feld/Trupp-Knöpfe/Reiter bleiben", g, async (w) => {
        const s = await h.open({ query: "?beispiel=lang", uhr: UHR_T4_0730, geraet: g, viewport: vp });
        try {
          await s.page.waitForTimeout(1500);
          const vor = { feld: await rect(s, "textarea, input[placeholder='Was wurde gemeldet?']"), reiter: await rect(s, '[role="tab"]') };
          await s.page.locator(".lc-list").evaluate((e: HTMLElement) => { e.scrollTop = e.scrollHeight; }).catch(() => { throw new Error("Scroll-Behälter .lc-list fehlt"); });
          await s.page.waitForTimeout(400);
          const nach = { feld: await rect(s, "textarea, input[placeholder='Was wurde gemeldet?']"), reiter: await rect(s, '[role="tab"]') };
          w.vor = vor; w.nach = nach;
          soll(JSON.stringify(vor) === JSON.stringify(nach), "Kopf der Spalte hat sich beim Scrollen bewegt");
        } finally { await s.close(); }
      }));
    }
    out.push(await aufgabe("1b Tablet hoch: Eingabeblock haftet oben beim Scrollen", "tablet", async (w) => {
      const s = await h.open({ query: "?beispiel=lang", uhr: UHR_T4_0730, geraet: "tablet", viewport: { width: 768, height: 1024 } });
      try {
        await s.page.mouse.wheel(0, 4000);
        await s.page.waitForTimeout(500);
        const f = await rect(s, "textarea, input[placeholder='Was wurde gemeldet?']");
        w.feld = f;
        soll(f.y >= 0 && f.y < 300, `Feld bei y = ${f.y}`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("2 Tippen springt ins Feld (Zeile/Karte fokussiert), Karte zoomt nicht; Leerschlag auf «Mehr …» bleibt", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
      try {
        await zeilenVon(s).first().click();
        const z0 = await zoomVon(s);
        await s.page.keyboard.type("H02 1 Fz AK9");
        w.feld = await feldVon(s).inputValue();
        soll(w.feld === "H02 1 Fz AK9", `Feld «${w.feld}»`);
        soll(await zoomVon(s) === z0, "Karte hat gezoomt");
        await feldVon(s).fill("");
        await s.page.locator(".leaflet-container").focus();
        await s.page.keyboard.type("H03 2 Pers");
        soll(await feldVon(s).inputValue() === "H03 2 Pers", "Fokus auf der Karte: Zeichen nicht im Feld");
        await feldVon(s).fill("");
        await zeilenVon(s).first().click();
        await knopfVon(s, /^Mehr/).focus();
        await s.page.keyboard.press(" ");
        soll(await s.page.getByRole("menu").or(s.page.getByRole("dialog")).first().isVisible().catch(() => false), "Leerschlag auf «Mehr …» öffnet nichts mehr");
        await s.page.keyboard.type("x");
        soll(await feldVon(s).inputValue() === "", "Tippen im offenen Popover landet im Feld");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("3 «L» im Rückblick = Text, Rückblick bleibt; Alt+L → LIVE; Alt+U → Übergabe", "laptop", async () => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
      try {
        await s.page.getByRole("button", { name: /Zurückblicken/ }).click();
        await s.page.locator("body").click({ position: { x: 5, y: 300 } }).catch(() => {});
        await s.page.keyboard.press("l");
        soll(await feldVon(s).inputValue() === "l" || await feldVon(s).inputValue() === "L", "«L» nicht im Feld");
        soll(await s.page.locator(".app").getAttribute("data-lagezeit") === "rueckblick", "Rückblick verlassen");
        await feldVon(s).fill("");
        await s.page.locator("body").click({ position: { x: 5, y: 300 } }).catch(() => {});
        await s.page.keyboard.press("Alt+KeyL");
        soll(await s.page.locator(".app").getAttribute("data-lagezeit") === "live", "Alt+L führt nicht zu LIVE");
        await s.page.keyboard.press("Alt+KeyU");
        soll(await s.page.getByRole("dialog", { name: "Übergabe" }).isVisible().catch(() => false), "Alt+U öffnet die Übergabe nicht");
      } finally { await s.close(); }
    }));

    for (const g of ["laptop", "tablet"] as const) {
      out.push(await aufgabe("4 «Eintragen» springt beim ersten Zeichen nicht (± 1 px), Reiter bleiben", g, async (w) => {
        const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730, geraet: g });
        try {
          const vor = { btn: await rect(s, ".ebox button:has-text('Eintragen')"), tab: await rect(s, '[role="tab"]') };
          await feldVon(s).pressSequentially("H");
          await s.page.waitForTimeout(250);
          const nach = { btn: await rect(s, ".ebox button:has-text('Eintragen')"), tab: await rect(s, '[role="tab"]') };
          w.vor = vor; w.nach = nach;
          soll(Math.abs(vor.btn.y - nach.btn.y) <= 1, `«Eintragen» ${vor.btn.y} → ${nach.btn.y}`);
        } finally { await s.close(); }
      }));
    }

    for (const [g, vp] of [["laptop", undefined], ["tablet", { width: 768, height: 1024 }]] as Array<[Geraet, { width: number; height: number } | undefined]>) {
      out.push(await aufgabe("5 Reiter gleich breit (± 1 px)", g, async (w) => {
        const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730, geraet: g, viewport: vp });
        try {
          const b = await s.page.getByRole("tab").evaluateAll((l: Element[]) => l.slice(0, 3).map((e) => e.getBoundingClientRect().width));
          w.breiten = b;
          soll(b.length === 3 && Math.max(...b) - Math.min(...b) <= 1, `Breiten ${b.map((x: number) => x.toFixed(0)).join("/")}`);
        } finally { await s.close(); }
      }));
    }

    out.push(await aufgabe("6 Suchfeld: gleicher Platzhalter leer und Beispiel", "laptop", async (w) => {
      for (const q of ["?beispiel=leer", "?beispiel"]) {
        const s = await h.open({ query: q, uhr: UHR_T2_0730 });
        try {
          const p = await s.page.locator(`input[placeholder^="Suchen"], input[placeholder*="suchen"]`).first().getAttribute("placeholder").catch(() => null);
          (w as Record<string, unknown>)[q] = p;
          soll(p === SUCHTEXT, `${q}: «${p}»`);
        } finally { await s.close(); }
      }
    }));

    out.push(await aufgabe("7 Kürzel-Zeile beim Öffnen: «Wm M» → WMM, Fokus ins Feld, Meldung in 2 Schritten; Visum «Wm Keller» Hinweis", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel=leer", uhr: UHR_T2_0730 });
      try {
        const k = s.page.getByLabel("Dein Kürzel");
        soll(await k.isVisible().catch(() => false), "Kürzel-Zeile «Wer führt das Journal?» fehlt");
        soll(await k.evaluate((e: Element) => e === document.activeElement), "Fokus nicht im Kürzel-Feld");
        await k.fill("Wm M");
        soll(await s.page.getByText("wird zu WMM").isVisible().catch(() => false), "Anzeige «wird zu WMM» fehlt");
        await k.press("Enter");
        soll(await s.page.getByText(/Schicht WMM seit 07:30/).first().isVisible().catch(() => false), "Kopf «Schicht WMM seit 07:30» fehlt");
        soll(await feldVon(s).evaluate((e: Element) => e === document.activeElement), "Fokus nicht im Meldungsfeld");
        const n0 = await zeilenVon(s).count();
        await feldVon(s).pressSequentially("H02 2 Fz AK7");
        await feldVon(s).press("Enter");
        await s.page.waitForTimeout(400);
        w.schritte = 2;
        soll(await zeilenVon(s).count() === n0 + 1, "Meldung nicht in 2 Schritten eingetragen (Abfrage?)");
        await menue(s, /^Übergabe/);
        await s.page.getByLabel(/übernommen von/).fill("Wm Keller");
        soll(await s.page.getByText("2–6 Zeichen: Buchstaben A–Z und Ziffern").first().isVisible().catch(() => false), "Visum ohne sichtbaren Hinweis");
        await s.page.getByLabel(/übernommen von/).fill("Wm K");
        soll(await knopfVon(s, "Übergabe abschliessen").isEnabled(), "«Wm K» → WMK nicht übernommen");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("8 ↑ holt die zuletzt **eingetragene** Meldung (nicht die zuletzt korrigierte)", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
      try {
        await eintragenText(s, "H02 1 Fz AK7");
        await eintragenText(s, "H04 2 Pers AF11");
        await zeilenVon(s).filter({ hasText: "1 Fz AK7" }).first().click();
        await knopfVon(s, "Korrigieren").click();
        await feldVon(s).fill("H02 1 Fz AK8");
        await feldVon(s).press("Enter");
        await s.page.waitForTimeout(400);
        await feldVon(s).fill("");
        await feldVon(s).press("ArrowUp");
        w.feld = await feldVon(s).inputValue();
        soll(/2 Pers AF11/.test(String(w.feld)), `↑ holt «${w.feld}»`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("9 Rückblick-Zeitfeld: nach Enter markiert, Eingabe ersetzt («T1 2000»)", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
      try {
        await s.page.getByRole("button", { name: /Zurückblicken/ }).click();
        const f = s.page.getByRole("textbox", { name: /Lage um/ }).first();
        await f.fill("0200");
        await f.press("Enter");
        await s.page.waitForTimeout(300);
        const sel = await f.evaluate((e: HTMLInputElement) => (e.selectionEnd ?? 0) - (e.selectionStart ?? 0) === e.value.length && e.value.length > 0);
        soll(sel, "Inhalt nach Enter nicht markiert");
        await s.page.keyboard.type("T1 2000");
        w.wert = await f.inputValue();
        soll(w.wert === "T1 2000", `Wert «${w.wert}»`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("10 LIVE = Uhr: «0735» um 07:31 → Band 07:31, Zeichen da, «4 min nach jetzt»; um 07:36 weg", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0731 });
      try {
        const m0 = await markerVon(s);
        await eintragenText(s, "0735 H02 1 Fz AK9");
        w.band = (await s.page.locator(".tb, [class*=timeband], .band").first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 80);
        soll(/LIVE[^0-9]*T2 07:31/.test(String(w.band)), `Band «${w.band}»`);
        soll(await markerVon(s) > m0, "Zeichen fehlt auf der Karte");
        soll(await zeilenVon(s).first().getByText("4 min nach jetzt").isVisible().catch(() => false), "Zusatz «4 min nach jetzt» fehlt");
        await s.page.clock.fastForward(5 * 60000);
        await s.page.waitForTimeout(500);
        soll(!(await zeilenVon(s).first().getByText(/min nach jetzt/).count()), "Zusatz um 07:36 noch da");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("11 Entwurf über Neustart: übernommen und gemeldet, «Verwerfen» leert; zwei Fenster übernehmen nichts", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
      let speicher: Array<{ name: string; value: string }> = [];
      try {
        await feldVon(s).fill("H03 2 Pers");
        await s.page.waitForTimeout(800);
        speicher = (await s.page.context().storageState()).origins.flatMap((o: { localStorage: Array<{ name: string; value: string }> }) => o.localStorage);
      } finally { await s.close(); }
      const lokal = Object.fromEntries(speicher.map((x) => [x.name, x.value]));
      // neuer Kontext mit gleichem Gerätespeicher (localStorage; die Übung kommt wieder aus «?beispiel», gleiche ID)
      const t = await h.open({ query: "?beispiel", uhr: "2030-05-15T07:31:00+02:00", lokal });
      try {
        await t.page.waitForTimeout(800);
        w.feld = await feldVon(t).inputValue();
        soll(w.feld === "H03 2 Pers", `Feld «${w.feld}»`);
        soll(await t.page.getByText(/Entwurf von 07:30 wiederhergestellt/).isVisible().catch(() => false), "Hinweis «Entwurf von 07:30 wiederhergestellt» fehlt");
        await knopfVon(t, "Verwerfen").click();
        soll(await feldVon(t).inputValue() === "", "«Verwerfen» leert das Feld nicht");
      } finally { await t.close(); }
    }));

    out.push(await aufgabe("12 Phantomtrupp #27: zweimal Enter → kein Knopf «H06»; «H06 als Trupp aufnehmen» → Knopf da", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
      try {
        await eintragenText(s, "H06 2 Pers AK5", { zweimal: true });
        soll(!(await s.page.locator(".eb-trupps").getByRole("button", { name: "H06", exact: true }).count()), "Knopf H06 still angelegt");
        await feldVon(s).fill("H06 1 Fz AK6");
        await knopfVon(s, "H06 als Trupp aufnehmen").click();
        w.knopf = await s.page.locator(".eb-trupps").getByRole("button", { name: "H06", exact: true }).count();
        soll(w.knopf === 1, "Knopf H06 nach «aufnehmen» fehlt");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("13 Trupp-Knöpfe: Rahmen durchgezogen, «zuletzt gemeldet» unterstrichen", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
      try {
        const r = await s.page.locator(".eb-trupps button").evaluateAll((l: Element[]) => l.map((e) => { const c = getComputedStyle(e); const a = getComputedStyle(e, "::after"); return { stil: c.borderStyle, unter: c.textDecorationLine.includes("underline") || c.boxShadow.includes("inset") || a.content !== "none" && a.height !== "auto", title: e.getAttribute("title") ?? "" }; }));
        w.knoepfe = r;
        soll(r.every((x: { stil: string }) => x.stil === "solid"), "nicht alle Rahmen solid");
        soll(r.some((x: { unter: boolean; title: string }) => x.unter && /zuletzt/.test(x.title)), "Unterstrich «zuletzt gemeldet» fehlt");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("14 «Was ist es?» → «Andere ▾» enthält «Ausgang»", "laptop", async () => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
      try {
        await feldVon(s).fill("Text");
        await knopfVon(s, /Andere/).click();
        soll(await s.page.getByRole("menuitem", { name: /Ausgang/ }).or(s.page.getByRole("button", { name: /Ausgang/ })).first().isVisible().catch(() => false), "«Ausgang» fehlt in «Andere ▾»");
      } finally { await s.close(); }
    }));

    return out;
  },
};
export default spec;
