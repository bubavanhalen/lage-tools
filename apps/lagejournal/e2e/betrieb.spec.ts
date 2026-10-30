/**
 * Betrieb und Sicherheit (Spez. MVP 3.5, Kap. 8.1, Paket A): nichts geht ungefragt ans Netz (K2), Service Worker mit
 * Timeout, Bildschirm bleibt an, Offline-Popover, Ampel «Karte», Schutz/Installation, Datei sichern, Raster «Feld».
 * Phase 0: Gerüst – darf rot sein, bis Paket A fertig ist. Ausgabe e2e/out/betrieb.json.
 * Fall 5 (SW-Timeout) nur mit `npm run e2e -- --sw-netz` und einer e2e-Kopie mit sw.js (Paket A: run.mjs-Build wie
 * assemble-site); sonst rot mit Grund.
 */
import { readFileSync } from "node:fs";
import {
  UA_IOS, UHR_T2_0730, UHR_T2_0731, aufgabe, eintragenText, feldVon, inventarImBrowser, knopfVon, menue, modusVon, offlineKnopfVon, offlinePopoverVon,
  onlineDienstAnfragen, perfImBrowser, soll, type Harness, type Session, type Spec, type TestResult,
} from "./lib.ts";

const SAETZE = [
  "H01 1 Pers beim Gasthof Bären", "H04 neue Sperre AH13", "H02 2 Fz AK7 Rtg N", "H03 1 Pers AN6", "H05 2 Pers AQ10", "H02 1 Fz AK8", "H04 3 Pers AF11",
  "H01 2 Fz AD7", "H03 Drohne über NAI 2", "H05 1 Pw AR11", "H02 4 Pers AL10", "H04 1 Fz AG12", "H01 2 Pers AC7", "H03 1 Fz AO5", "H05 3 Pers AP11",
  "H02 1 Pers AK9", "H04 2 Fz AF10", "H01 1 Fz AE8", "H03 2 Pers AN7", "H05 1 Fz AQ12",
];

/** Suche bedienen (Journal-Suche), kurz warten (früher: automatische Online-Abfrage nach 600 ms) */
async function suchen(s: Session, q: string): Promise<void> {
  const f = s.page.getByPlaceholder(/^Suchen/).first();
  await f.fill(q);
  await s.page.waitForTimeout(1200);
}

/** «Online-Dienste (diese Übung)» in Vorbereiten → Übung; gibt die Kästchen zurück */
async function onlineKaestchen(s: Session): Promise<{ ortssuche: boolean; strassen: boolean }> {
  await menue(s, /Vorbereiten/);
  const schritt = s.page.getByRole("button", { name: /1\s*Übung/ }).first();
  if (await schritt.getAttribute("aria-expanded").catch(() => null) !== "true") await schritt.click().catch(() => {});
  const grp = s.page.getByRole("group", { name: /Online-Dienste/ });
  const boxes = grp.getByRole("checkbox");
  soll(await boxes.count() >= 2, "Kästchen «Online-Dienste» fehlen in Vorbereiten → Übung");
  return { ortssuche: await boxes.nth(0).isChecked(), strassen: await boxes.nth(1).isChecked() };
}

/** Datei «für anderes Gerät» speichern → JSON */
async function dateiVon(s: Session): Promise<Record<string, any>> {
  const dl = s.page.waitForEvent("download", { timeout: 5000 });
  await menue(s, /Datei für anderes Gerät/);
  return JSON.parse(readFileSync(await (await dl).path(), "utf8"));
}
/** Datei öffnen (zusammenführen) */
async function dateiOeffnen(s: Session, json: unknown): Promise<void> {
  const fc = s.page.waitForEvent("filechooser", { timeout: 5000 });
  await menue(s, /Datei öffnen \(zusammenführen\)/);
  await (await fc).setFiles({ name: "uebung.lage.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(json)) });
  await s.page.waitForTimeout(800);
}

const spec: Spec = {
  name: "betrieb",
  async run(h: Harness) {
    const out: TestResult[] = [];

    out.push(await aufgabe("1 Nichts geht ans Netz (Erststart, 20 Meldungen, Suchen)", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0731 });
      try {
        await feldVon(s).fill(SAETZE[0]!);
        await s.page.waitForTimeout(1200);
        w.vorschau = (await s.page.locator("[data-zustand]").first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
        soll(/Ortsnamen sind aus/.test(String(w.vorschau)), "Vorschau nennt «Ortsnamen sind aus» nicht");
        for (const t of SAETZE) await eintragenText(s, t);
        await suchen(s, "Verwundeter H05");
        await suchen(s, "Gasthof Bären");
        w.anfragen = onlineDienstAnfragen(s);
        soll(!(w.anfragen as string[]).length, `${(w.anfragen as string[]).length} Anfragen an api3.geo.admin.ch`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("2 MVP-3-Datei ohne onlineDienste: 0 Anfragen, Kästchen leer, rev unverändert", "laptop", async (w) => {
      const a = await h.open({ query: "?beispiel", uhr: UHR_T2_0731 });
      const b = await h.open({ uhr: UHR_T2_0731 });
      try {
        const f = await dateiVon(a);
        delete f.exercise.onlineDienste;
        for (const e of f.exercise.events) delete e.tOffset;
        await dateiOeffnen(b, f);
        for (const t of SAETZE.slice(0, 5)) await eintragenText(b, t);
        w.anfragen = onlineDienstAnfragen(b);
        soll(!(w.anfragen as string[]).length, "Anfragen an Online-Dienste");
        const g = await dateiVon(b);
        const revs = new Map<string, number>(f.exercise.events.map((e: { id: string; rev: number }) => [e.id, e.rev]));
        const geaendert = g.exercise.events.filter((e: { id: string; rev: number; tOffset?: string }) => revs.has(e.id) && (revs.get(e.id) !== e.rev || e.tOffset));
        w.geaendert = geaendert.length;
        soll(!geaendert.length, `${geaendert.length} alte Meldungen beim Öffnen geschrieben`);
        const k = await onlineKaestchen(b);
        w.kaestchen = k;
        soll(!k.ortssuche && !k.strassen, "Kästchen nicht leer");
      } finally { await a.close(); await b.close(); }
    }));

    out.push(await aufgabe("3 Ortssuche eingeschaltet: Feld fragt nach, Journal-Suche nie, Vorschlag erst auf Klick", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0731 });
      try {
        await onlineKaestchen(s);
        await s.page.getByRole("group", { name: /Online-Dienste/ }).getByRole("checkbox").first().check();
        await menue(s, /Lage führen/);
        soll(await s.page.getByText("Online an", { exact: true }).first().isVisible().catch(() => false), "Kopf zeigt «Online an» nicht");
        const n0 = onlineDienstAnfragen(s).length;
        await feldVon(s).fill("H01 1 Pers beim Gasthof Bären");
        await s.page.waitForTimeout(1500);
        w.feld = onlineDienstAnfragen(s).length - n0;
        soll(w.feld === 1, `Meldungsfeld: ${w.feld} Anfragen statt 1`);
        await feldVon(s).fill("");
        const n1 = onlineDienstAnfragen(s).length;
        await suchen(s, "Verwundeter H05");
        soll(onlineDienstAnfragen(s).length === n1, "Journal-Suche fragt online");
        await suchen(s, "Gasthof Bären");
        soll(onlineDienstAnfragen(s).length === n1, "Suche fragt ohne Klick online");
        const vorschlag = s.page.getByRole("option", { name: /Gasthof Bären.*bei swisstopo suchen/ });
        soll(await vorschlag.isVisible().catch(() => false), "Vorschlag «‹Gasthof Bären› bei swisstopo suchen» fehlt");
        await vorschlag.click();
        await s.page.waitForTimeout(1200);
        w.klick = onlineDienstAnfragen(s).length - n1;
        soll(w.klick === 1, `nach Klick ${w.klick} Anfragen statt 1`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("4 Datei mit ortssuche: true in bestehende Übung (aus) → bleibt aus", "laptop", async (w) => {
      const a = await h.open({ query: "?beispiel", uhr: UHR_T2_0731 });
      const b = await h.open({ query: "?beispiel", uhr: UHR_T2_0731 });
      try {
        const f = await dateiVon(a);
        f.exercise.onlineDienste = { ortssuche: true, strassen: true, at: "2030-05-15T05:00:00.000Z" };
        await dateiOeffnen(b, f);
        const k = await onlineKaestchen(b);
        w.kaestchen = k;
        soll(!k.ortssuche && !k.strassen, "Datei hat Online-Dienste eingeschaltet");
        soll(!(await b.page.getByText("Online an", { exact: true }).count()), "Kopf zeigt «Online an»");
      } finally { await a.close(); await b.close(); }
    }));

    out.push(await aufgabe("5 SW-Timeout: hängendes Netz → lt:bereit ≤ 4000 ms", "laptop", async (w) => {
      soll(h.swNetz, "nur mit «npm run e2e -- --sw-netz» (Service Worker nötig)");
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0731, sw: true });
      try {
        const aktiv = await s.page.evaluate(async () => { const r = await navigator.serviceWorker?.ready.catch(() => null); return !!r?.active; });
        soll(aktiv, "kein Service Worker in der e2e-Kopie (sw.js fehlt – Paket A: run.mjs-Build wie assemble-site)");
        await s.page.reload();
        await s.page.waitForTimeout(1500);
        await s.page.context().route(/\/lagejournal\/(\?.*)?$/, () => { /* hängt: nie antworten */ });
        const t0 = Date.now();
        await s.page.reload({ waitUntil: "commit", timeout: 10000 }).catch(() => {});
        await s.page.waitForFunction(() => performance.getEntriesByName("lt:bereit").length > 0, null, { timeout: 8000 });
        w.ms = Date.now() - t0;
        w.perf = await s.page.evaluate(perfImBrowser);
        soll((w.ms as number) <= 4000, `lt:bereit nach ${w.ms} ms`);
        soll(await feldVon(s).isEditable(), "Feld nicht bedienbar");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("6 Wake Lock: anfordern, neu bei Sichtbarkeit, Menü aus → frei, Vorbereiten → frei", "laptop", async (w) => {
      const attrappe = async (p: any) => p.addInitScript(() => {
        const st = { requests: 0, releases: 0 };
        (window as unknown as { __wl: typeof st }).__wl = st;
        Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => { st.requests++; const s = { released: false, release: async () => { if (!s.released) { s.released = true; st.releases++; } }, addEventListener() {}, removeEventListener() {} }; return s; } } });
      });
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0731, vorLaden: attrappe });
      try {
        const wl = () => s.page.evaluate(() => (window as unknown as { __wl: { requests: number; releases: number } }).__wl);
        await s.page.waitForTimeout(500);
        const a = await wl();
        soll(a.requests >= 1, "keine Anforderung in «Lage führen»");
        await s.page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange"));
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange"));
        });
        await s.page.waitForTimeout(300);
        const b = await wl();
        soll(b.requests > a.requests, "nach verborgen → sichtbar nicht neu angefordert");
        await menue(s, /Bildschirm bleibt an/);
        await s.page.waitForTimeout(300);
        const c = await wl();
        soll(c.releases > b.releases, "Menü aus gibt nicht frei");
        w.zaehler = c;
      } finally { await s.close(); }
      const ohne = await h.open({ query: "?beispiel", uhr: UHR_T2_0731, vorLaden: async (p: any) => p.addInitScript(() => { try { delete (Navigator.prototype as unknown as Record<string, unknown>).wakeLock; } catch { /* egal */ } }) });
      try {
        await ohne.page.getByRole("button", { name: "Menü" }).click();
        soll(await ohne.page.getByText(/geht in diesem Browser nicht/).first().isVisible().catch(() => false), "Menü ohne Hinweis «geht in diesem Browser nicht»");
      } finally { await ohne.close(); }
    }));

    out.push(await aufgabe("7 Popover: kein Moduswechsel, 6 Zeilen, «Alles für offline laden» → «Lädt …», Journal bleibt", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0731, offline: "echt" });
      try {
        const k = offlineKnopfVon(s);
        w.kopf = (await k.innerText()).replace(/\s+/g, " ").trim();
        soll(/Offline fehlt/.test(String(w.kopf)), `Kopf «${w.kopf}» statt «⚠ Offline fehlt»`);
        await k.click();
        soll(await modusVon(s) === "lage", "Moduswechsel");
        const pop = offlinePopoverVon(s);
        soll(await pop.isVisible(), "Popover fehlt");
        w.zeilen = await pop.getByRole("listitem").count();
        soll(w.zeilen === 6, `${w.zeilen} Zeilen statt 6 (App, Karte, Ortsnamen, Speicher, Installiert, Datei)`);
        w.bedienelemente = (await s.page.evaluate(inventarImBrowser)).filter((e: { name: string }) => !/Menü/.test(e.name)).length;
        await pop.getByRole("button", { name: /Alles für offline laden/ }).click();
        soll(await s.page.getByText(/Lädt \d+ %/).first().isVisible({ timeout: 3000 }).catch(() => false), "Kopf zeigt «Lädt …» nicht");
        soll(await s.page.locator(".jlist li").first().isVisible(), "Journal nicht mehr sichtbar");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("8 Ampel Karte: 96 % (fehlende Teile) → nicht bereit; nachgeladen → ✓; 404 zählt als vorhanden", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0731, offline: "echt" });
      try {
        let n = 0;
        // jede 25. Kachel schlägt beim ersten Laden fehl (Netz), drei liefern 404 (gibt es bei swisstopo nicht)
        await s.page.route(/wmts.*\.geo\.admin\.ch/, (r: any) => { n++; if (n % 25 === 0) return r.abort(); if (n % 331 === 0) return r.fulfill({ status: 404, body: "" }); return r.fallback(); });
        await offlineKnopfVon(s).click();
        await offlinePopoverVon(s).getByRole("button", { name: /Alles für offline laden/ }).click();
        await s.page.waitForFunction(() => !/Lädt/.test(document.querySelector(".hd")?.textContent ?? ""), null, { timeout: 60000 });
        const t1 = (await offlinePopoverVon(s).innerText().catch(() => "")).replace(/\s+/g, " ");
        w.erst = /Karte[^A-Z]*/.exec(t1)?.[0];
        soll(/\d+ % \(\d+ von \d+ Teilen\)/.test(t1), `Popover zeigt keine Teilzahl: ${w.erst}`);
        await s.page.unroute(/wmts.*\.geo\.admin\.ch/);
        await offlinePopoverVon(s).getByRole("button", { name: /Alles für offline laden/ }).click();
        await s.page.waitForFunction(() => !/Lädt/.test(document.querySelector(".hd")?.textContent ?? ""), null, { timeout: 60000 });
        const t2 = (await offlinePopoverVon(s).innerText()).replace(/\s+/g, " ");
        soll(/Raster-Gebiet vollständig/.test(t2), "nach Nachladen nicht vollständig");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("9 Handy 390 px: «⚠ Offline fehlt» ganz sichtbar, nie «×»", "handy-touch", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0731, offline: "echt", geraet: "handy-touch" });
      try {
        const k = offlineKnopfVon(s);
        const r = await k.evaluate((e: HTMLElement) => ({ text: e.innerText.replace(/\s+/g, " ").trim(), sw: e.scrollWidth, cw: e.clientWidth, rechts: e.getBoundingClientRect().right }));
        w.kopf = r;
        soll(/Offline fehlt/.test(r.text) && !/[×✗]/.test(r.text), `Kopf «${r.text}»`);
        soll(r.sw <= r.cw + 1 && r.rechts <= 390, "Text abgeschnitten");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("10 Schutz: iOS-Anleitung, «App installieren» ruft prompt(), Schutzhinweis einmal", "laptop", async (w) => {
      const ios = await h.open({ query: "?beispiel", uhr: UHR_T2_0731, offline: "echt", userAgent: UA_IOS });
      try {
        await offlineKnopfVon(ios).click();
        await offlinePopoverVon(ios).getByRole("button", { name: /So geht/ }).click();
        soll(await offlinePopoverVon(ios).getByText(/Zum Home-Bildschirm/).isVisible(), "iOS: Anleitung «Zum Home-Bildschirm» fehlt");
      } finally { await ios.close(); }
      const prompt = async (p: any) => p.addInitScript(() => {
        window.addEventListener("DOMContentLoaded", () => setTimeout(() => {
          const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
          e.prompt = async () => { (window as unknown as { __prompted: boolean }).__prompted = true; };
          e.userChoice = Promise.resolve({ outcome: "accepted" });
          window.dispatchEvent(e);
        }, 50));
      });
      const c = await h.open({ query: "?beispiel", uhr: UHR_T2_0731, offline: "echt", vorLaden: prompt });
      try {
        await offlineKnopfVon(c).click();
        await offlinePopoverVon(c).getByRole("button", { name: /So geht/ }).click().catch(() => {});
        await offlinePopoverVon(c).getByRole("button", { name: "App installieren" }).click();
        soll(await c.page.evaluate(() => !!(window as unknown as { __prompted?: boolean }).__prompted), "prompt() nicht aufgerufen");
        await c.page.keyboard.press("Escape");
        const hinweis = c.page.getByText("Dieses Gerät schützt die Daten nicht dauerhaft.");
        soll(await hinweis.isVisible().catch(() => false), "Schutzhinweis fehlt");
        await knopfVon(c, "OK").click();
        await c.page.reload();
        await c.page.waitForTimeout(1200);
        w.nachNeuladen = await hinweis.count();
        soll(w.nachNeuladen === 0, "Schutzhinweis nach «OK» wieder da");
      } finally { await c.close(); }
    }));

    out.push(await aufgabe("11 Datei sichern nach der Übergabe (nie gesichert); 10 min später kein Schritt", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
      try {
        await menue(s, /^Übergabe/);
        await s.page.getByLabel(/übernommen von/).fill("MU");
        await knopfVon(s, "Übergabe abschliessen").click();
        const sichern = knopfVon(s, /^Datei sichern/);
        soll(await sichern.isVisible({ timeout: 2000 }).catch(() => false), "Schritt «Datei sichern …» fehlt");
        const dl = s.page.waitForEvent("download", { timeout: 5000 });
        await sichern.click();
        w.datei = (await dl).suggestedFilename();
        await s.page.getByRole("button", { name: "Menü" }).click();
        w.menue = (await s.page.getByRole("menuitem", { name: /Datei für anderes Gerät/ }).innerText()).replace(/\s+/g, " ");
        soll(/zuletzt 07:3\d/.test(String(w.menue)), `Menü «${w.menue}»`);
        await s.page.keyboard.press("Escape");
        await s.page.clock.fastForward(10 * 60000);
        await menue(s, /^Übergabe/);
        await s.page.getByLabel(/übernommen von/).fill("ZZ");
        await knopfVon(s, "Übergabe abschliessen").click();
        await s.page.waitForTimeout(500);
        soll(!(await knopfVon(s, /^Datei sichern/).count()), "zweite Übergabe nach 10 min bietet «Datei sichern» an");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("12 Raster «Feld» beim Einpassen zu gross → Warnung mit Feldgrössen, Massstab sichtbar", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel=leer", uhr: UHR_T2_0731, arbeitsweise: { modus: "vorbereiten", experte: false } });
      try {
        for (let i = 0; i < 4; i++) { await s.page.locator(".leaflet-control-zoom-out").click(); await s.page.waitForTimeout(300); }
        await s.page.getByRole("button", { name: /Führungsraster/ }).first().click().catch(() => {});
        const vorher = await s.page.locator(".lt-raster, .leaflet-overlay-pane path").count();
        await knopfVon(s, "Einfaches Raster (Feld)").click();
        await s.page.waitForTimeout(500);
        const warn = s.page.getByText(/Die Felder wären \d+ m gross/);
        soll(await warn.isVisible().catch(() => false), "Warnung «Die Felder wären … m gross» fehlt");
        for (const g of ["250 m", "500 m", "1000 m"]) soll(await knopfVon(s, g).isVisible().catch(() => false), `Knopf «${g}» fehlt`);
        w.rasterVorher = vorher;
        soll(await s.page.locator(".leaflet-control-scale").isVisible().catch(() => false), "Massstab fehlt");
      } finally { await s.close(); }
    }));

    return out;
  },
};
export default spec;
