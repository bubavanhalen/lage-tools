/**
 * Touch mit echtem `pointer: coarse` (Spez. MVP 3.5, Kap. 8.8; Methode review5/feldgeraet/bericht.md): eigener Chromium
 * mit `--blink-settings=primaryPointerType=2,…` (run.mjs), Gesten über CDP (`Input.dispatchTouchEvent`, lib.ts
 * `cdpTippen`). Geräte «tablet-touch» (1024×768) und «handy-touch» (390×844). Vorbedingung jeder Messung:
 * `matchMedia("(pointer: coarse)").matches`. Tastaturzeile ausgeblendet, Grundansicht 0 Bedienelemente < 44 px (Bericht:
 * Anzahl < 48 px für MVP 2), Trefferradius 24 px auf der Karte (karte.spec 10), Zeichenwahl ohne Autofokus.
 * Phase 0: Gerüst – darf rot sein (Pakete B, E). Ausgabe e2e/out/touch.json.
 */
import { UHR_T2_0730, aufgabe, cdpTippen, cdpTippenAuf, feldVon, inventarImBrowser, istGrob, soll, type Geraet, type Harness, type Spec, type TestResult } from "./lib.ts";

const spec: Spec = {
  name: "touch",
  async run(h: Harness) {
    const out: TestResult[] = [];
    for (const g of ["tablet-touch", "handy-touch"] as Geraet[]) {
      out.push(await aufgabe("0 Vorbedingung: echtes (pointer: coarse) und (hover: none)", g, async (w) => {
        const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730, geraet: g });
        try {
          w.grob = await istGrob(s);
          soll(w.grob, "pointer: coarse nicht gesetzt – Touch-Messungen ungültig");
        } finally { await s.close(); }
      }));

      out.push(await aufgabe("1 Tastaturzeile ausgeblendet (auch bei Fokus im Feld)", g, async (w) => {
        const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730, geraet: g });
        try {
          await cdpTippenAuf(s, feldVon(s));
          w.zeile = await s.page.getByText(/Enter eintragen/).first().isVisible().catch(() => false);
          soll(!w.zeile, "Tastaturzeile «Enter eintragen · …» sichtbar unter pointer: coarse");
        } finally { await s.close(); }
      }));

      out.push(await aufgabe("2 Grundansicht: 0 Bedienelemente < 44 px (Bericht: < 48 px)", g, async (w) => {
        const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730, geraet: g });
        try {
          const l = await s.page.evaluate(inventarImBrowser);
          const u44 = l.filter((e: { w: number; h: number }) => e.w < 44 || e.h < 44);
          w.unter44 = u44.map((e: { name: string; w: number; h: number }) => `${e.name} ${e.w}×${e.h}`);
          w.unter48 = l.filter((e: { w: number; h: number }) => e.w < 48 || e.h < 48).length;
          soll(!u44.length, `${u44.length} Elemente < 44 px`);
        } finally { await s.close(); }
      }));

      out.push(await aufgabe("3 Zeichenwahl ohne Autofokus auf Touch (keine Bildschirmtastatur)", g, async (w) => {
        const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730, geraet: g });
        try {
          await cdpTippenAuf(s, feldVon(s));
          await feldVon(s).fill("H04 2 Fz AK7");
          await s.page.waitForTimeout(300);
          const wahl = s.page.locator("[data-zustand]").getByRole("button").filter({ hasText: /▾/ }).first();
          await cdpTippenAuf(s, wahl);
          w.fokus = await s.page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a ? `${a.tagName} ${a.getAttribute("type") ?? ""} ${a.getAttribute("placeholder") ?? ""}`.trim() : ""; });
          soll(!/^INPUT (search|text)?/i.test(String(w.fokus)), `Fokus im Suchfeld der Zeichenwahl: ${w.fokus}`);
        } finally { await s.close(); }
      }));

      out.push(await aufgabe("4 Karte: Tipp 20 px neben ein Zeichen trifft (Trefferradius 24 px)", g, async (w) => {
        const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730, geraet: g });
        try {
          // Entscheid Koordinator: im Handy-Ausschnitt (20 m/px) liegen alle Zeichen dicht – vorher Zoom +2 (Abstand bleibt 70 px)
          if (g === "handy-touch") {
            for (let i = 0; i < 2; i++) { await s.page.locator(".leaflet-control-zoom-in").click(); await s.page.waitForTimeout(400); }
            await s.page.waitForTimeout(600);
          }
          const p = await s.page.evaluate(() => {
            const ev = [...document.querySelectorAll<HTMLElement>(".leaflet-marker-pane .lt-ev")].map((e) => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, r: Math.max(b.width, b.height) / 2 }; }).filter((q) => q.x > 40 && q.x < innerWidth - 40 && q.y > 80 && q.y < innerHeight - 80);
            return ev.find((q) => ev.every((o) => o === q || Math.hypot(o.x - q.x, o.y - q.y) > 70)) ?? null;
          });
          soll(p, "kein einzelnes Zeichen im Bild");
          await cdpTippen(s, p!.x + 20, p!.y);
          w.gewaehlt = await s.page.locator(".lt-ev.sel, .jlist li[aria-selected=true]").count();
          soll((w.gewaehlt as number) > 0, "Tipp 20 px daneben wählt nichts");
        } finally { await s.close(); }
      }));
    }
    return out;
  },
};
export default spec;
