/**
 * Leistungsbudgets (Spez. MVP 3, Kap. 8.6) bei 800 Einträgen / 4 Tagen (`?beispiel=lang`, Uhr T4 07:30): Chromium
 * headless, Laptop 1440×900, ohne Drosselung; je Messung Median aus 5, Maximum berichtet. CPU 4× nur Bericht.
 * Messpunkte über `window.__ltPerf()` (P1, Paket D: `lt:enter`, `lt:zeile`, `lt:bereit`); fehlt der Haken, wird von
 * aussen gemessen (berichtet, aber rot). Ausgabe e2e/out/leistung.json. Phase 0: Gerüst – rot, bis Paket D fertig ist.
 */
import { UHR_T4_0730, ansicht, antwortzeit, aufgabe, feldVon, knopfVon, perfImBrowser, soll, zeilenVon, type Harness, type Session, type Spec, type TestResult } from "./lib.ts";

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)]! : Infinity; };
const max = (a: number[]) => (a.length ? Math.max(...a) : Infinity);

async function langOeffnen(h: Harness): Promise<Session> {
  const s = await h.open({ query: "?beispiel=lang", uhr: UHR_T4_0730 });
  await s.page.waitForTimeout(2000);
  return s;
}

async function enterMessen(s: Session, n: number, prefix: string): Promise<{ innen: number[]; aussen: number[] }> {
  const innen: number[] = [], aussen: number[] = [];
  for (let i = 0; i < n; i++) {
    const n0 = await zeilenVon(s).count();
    await feldVon(s).fill(`${prefix} ${i + 1} Pers AK7`);
    const t0 = Date.now();
    await feldVon(s).press("Enter");
    const ms = await antwortzeit(async () => (await zeilenVon(s).count()) !== n0 || (await feldVon(s).inputValue()) === "", 3000);
    aussen.push(ms === Infinity ? ms : Date.now() - t0);
    const p = await s.page.evaluate(perfImBrowser) as { enterZeile?: number } | null;
    if (p?.enterZeile !== undefined) innen.push(p.enterZeile);
    await s.page.waitForTimeout(300);
  }
  return { innen, aussen };
}

const spec: Spec = {
  name: "leistung",
  async run(h: Harness) {
    const out: TestResult[] = [];

    out.push(await aufgabe("Laden bis lt:bereit (2. Aufruf, Übung in IndexedDB) ≤ 1500 ms", "laptop", async (w) => {
      const s = await langOeffnen(h);
      try {
        const werte: number[] = [], aussen: number[] = [];
        for (let i = 0; i < 5; i++) {
          const t0 = Date.now();
          await s.page.goto(h.base);
          await s.page.waitForSelector(".jlist li", { timeout: 15000 }).catch(() => {});
          aussen.push(Date.now() - t0);
          const p = await s.page.evaluate(perfImBrowser) as { bereit?: number } | null;
          if (p?.bereit !== undefined) werte.push(p.bereit);
        }
        Object.assign(w, { median: median(werte), max: max(werte), aussen_median: median(aussen), haken: werte.length > 0 });
        soll(werte.length, "window.__ltPerf().bereit fehlt");
        soll(median(werte) <= 1500, `Median ${median(werte)} ms`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("Enter → neue Zeile (lt:enter → lt:zeile) ≤ 200 ms, Max ≤ 400", "laptop", async (w) => {
      const s = await langOeffnen(h);
      try {
        const r = await enterMessen(s, 5, "H02");
        Object.assign(w, { median: median(r.innen), max: max(r.innen), aussen: r.aussen });
        soll(r.innen.length, "window.__ltPerf().enterZeile fehlt");
        soll(median(r.innen) <= 200 && max(r.innen) <= 400, `Median ${median(r.innen)} ms, Max ${max(r.innen)} ms`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("Tippen: längste Long Task ≤ 50 ms (Median), keine > 150 ms", "laptop", async (w) => {
      const s = await langOeffnen(h);
      try {
        await s.page.evaluate(() => {
          const g = window as unknown as { __lt_lt: number[] };
          g.__lt_lt = [];
          new PerformanceObserver((l) => { for (const e of l.getEntries()) g.__lt_lt.push(e.duration); }).observe({ type: "longtask", buffered: false });
        });
        const laengste: number[] = [];
        for (let i = 0; i < 5; i++) {
          await feldVon(s).fill("");
          await s.page.evaluate(() => { (window as unknown as { __lt_lt: number[] }).__lt_lt.length = 0; });
          await feldVon(s).pressSequentially("H03 2 Fz in AK7 Rtg N", { delay: 30 });
          await s.page.waitForTimeout(200);
          laengste.push(await s.page.evaluate(() => Math.max(0, ...(window as unknown as { __lt_lt: number[] }).__lt_lt)));
        }
        Object.assign(w, { median: median(laengste), max: max(laengste) });
        soll(median(laengste) <= 50 && max(laengste) <= 150, `Long Task Median ${median(laengste)} ms, Max ${max(laengste)} ms`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("«zeigt nur letzte 6 h ✕» → alles ≤ 500 ms", "laptop", async (w) => {
      const s = await langOeffnen(h);
      try {
        const chip = s.page.getByRole("button", { name: /zeigt nur letzte 6 h/ }).first();
        soll(await chip.isVisible().catch(() => false), "Chip «zeigt nur letzte 6 h ✕» fehlt");
        const n0 = await zeilenVon(s).count();
        const t0 = Date.now();
        await chip.click();
        // ab 120 Einträgen ist die Liste virtualisiert (VIRT_AB): dann sind weniger Zeilen gezeichnet als vorher – «alles»
        // gilt, sobald der Chip weg ist und die Liste (gezeichnet bzw. virtualisiert) steht
        const ms = await antwortzeit(async () => !(await chip.isVisible().catch(() => false))
          && ((await zeilenVon(s).count()) >= n0 || (await s.page.locator(".jl-v > div[aria-hidden=true]").count()) > 0), 3000);
        w.ms = ms === Infinity ? ms : Date.now() - t0;
        soll((w.ms as number) <= 500, `${w.ms} ms`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("Umschalten Journal → Offen → Was Rot ≤ 300 ms je", "laptop", async (w) => {
      const s = await langOeffnen(h);
      try {
        const zeiten: Record<string, number> = {};
        for (const v of ["Offen", "Was Rot", "Journal"] as const) {
          const t0 = Date.now();
          await ansicht(s, v);
          const re = v === "Was Rot" ? /Was Rot/ : new RegExp(`^${v}`);
          const ms = await antwortzeit(async () => (await s.page.getByRole("tab", { name: re }).first().getAttribute("aria-selected")) === "true", 3000);
          zeiten[v] = ms === Infinity ? ms : Date.now() - t0;
        }
        w.ms = zeiten;
        soll(Object.values(zeiten).every((x) => x <= 300), `Umschalten ${JSON.stringify(zeiten)}`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("Hinweise nach Enter aktualisiert («wird berechnet» weg) ≤ 2000 ms", "laptop", async (w) => {
      const s = await langOeffnen(h);
      try {
        await feldVon(s).fill("H05: Drohne über NAI 3");
        const t0 = Date.now();
        await feldVon(s).press("Enter");
        await s.page.waitForTimeout(50);
        const ms = await antwortzeit(async () => (await s.page.getByText(/wird berechnet/).count()) === 0, 5000);
        w.ms = ms === Infinity ? ms : Date.now() - t0;
        // ohne Worker/Messpunkte (P1/P2) gibt es «wird berechnet» nicht – dann ist die Messung leer
        soll(await s.page.evaluate(perfImBrowser), "window.__ltPerf fehlt (Worker/Messpunkte noch nicht gebaut)");
        soll((w.ms as number) <= 2000, `${w.ms} ms`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("Übergabe öffnen ≤ 500 ms", "laptop", async (w) => {
      const s = await langOeffnen(h);
      try {
        await ansicht(s, "Offen");
        const t0 = Date.now();
        await knopfVon(s, /^Übergabe/).first().click();
        const ms = await antwortzeit(async () => s.page.locator('[role=dialog][aria-label="Übergabe"]').first().isVisible(), 3000);
        w.ms = ms === Infinity ? ms : Date.now() - t0;
        soll((w.ms as number) <= 500, `${w.ms} ms`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("CPU 4× (nur Bericht): Enter → Zeile", "laptop", async (w) => {
      const s = await langOeffnen(h);
      try {
        const cdp = await s.page.context().newCDPSession(s.page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        const r = await enterMessen(s, 3, "H04");
        Object.assign(w, { innen_median: median(r.innen), aussen: r.aussen, ziel_ms: 600 });
      } finally { await s.close(); }
    }));
    return out;
  },
};
export default spec;
