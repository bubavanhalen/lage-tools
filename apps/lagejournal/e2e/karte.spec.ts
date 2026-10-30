/**
 * Karte lesbar (Spez. MVP 3.5, Kap. 8.2, Paket B): Zeichen V4 (K3) – Grösse je Massstab, Stufe S/M/L, Präsentation,
 * ältere Zeichen, Ruhe, Neuaufbau, Tageskarte, Flächen, Lineal, Treffer/Auswahlliste, Etiketten, Strichelung, Massstab.
 * Phase 0: Gerüst – darf rot sein, bis Paket B fertig ist. Ausgabe e2e/out/karte.json.
 *
 * Testhaken, die Paket B liefert (Absprache Notizdatei): `.lt-ev[data-groesse]` = Grundmass in px (ohne «gewählt»),
 * `.lt-ev.old` ältere Zeichen, `.lt-stk` Stapelmarke, `.lt-tl` Zeitfähnchen, `.lt-ud` Zusatz, Pane `.leaflet-lt-lineal-pane`
 * (Lineal), `.leaflet-control-scale` (Massstab), Muster `#lt-schraffur-unklar`, Auswahlliste `role=listbox` «Welches Zeichen?»,
 * Messpunkte `lt:zeichen:start|ende`.
 * Punkt 14 (Kurztest mit Ungeschulten, Beamer) ist manuell und steht nur im Bericht.
 */
import { TAGESKARTE_FILTER } from "../../../packages/core/src/entscheide.ts";
import { UHR_T2_0730, aufgabe, cdpTippen, istGrob, soll, type Harness, type Session, type Spec, type TestResult } from "./lib.ts";

/** Grundmass aller sichtbaren Zeichen (Testhaken `data-groesse`), Median */
async function grundmass(s: Session): Promise<{ median: number; n: number; fehlt: number }> {
  return s.page.evaluate(() => {
    const ev = [...document.querySelectorAll<HTMLElement>(".leaflet-marker-pane .lt-ev")].filter((e) => e.getBoundingClientRect().width > 0);
    const g = ev.map((e) => Number(e.dataset.groesse)).filter((x) => x > 0).sort((a, b) => a - b);
    return { median: g.length ? g[Math.floor(g.length / 2)]! : 0, n: g.length, fehlt: ev.length - g.length };
  });
}
/** Leaflet-Zoomstufe über die Knöpfe ändern (+n hinein, −n hinaus) */
async function zoomen(s: Session, n: number): Promise<void> {
  const k = s.page.locator(n > 0 ? ".leaflet-control-zoom-in" : ".leaflet-control-zoom-out");
  for (let i = 0; i < Math.abs(n); i++) { await k.click(); await s.page.waitForTimeout(350); }
  await s.page.waitForTimeout(400);
}
/** Anzeige ▾ → Zeichengrösse wählen */
async function stufe(s: Session, x: "S" | "M" | "L"): Promise<void> {
  await s.page.getByRole("button", { name: /Anzeige/ }).first().click();
  await s.page.locator('[data-zaehl="zeichengroesse"]').getByRole("button", { name: x, exact: true }).or(s.page.getByRole("radio", { name: x, exact: true })).first().click();
  await s.page.keyboard.press("Escape");
  await s.page.waitForTimeout(400);
}

const spec: Spec = {
  name: "karte",
  async run(h: Harness) {
    const out: TestResult[] = [];
    const neu = (o: Parameters<Harness["open"]>[0] = {}) => h.open({ query: "?beispiel", uhr: UHR_T2_0730, ...o });

    out.push(await aufgabe("1 Einpassen: Grundmass ≥ 26 px, Raute Feind ≥ 36 px, Linie ≥ 1.5 px", "laptop", async (w) => {
      const s = await neu();
      try {
        const g = await grundmass(s);
        w.grundmass = g;
        soll(g.n > 0 && !g.fehlt, `Testhaken data-groesse fehlt an ${g.fehlt} Zeichen`);
        soll(g.median >= 26, `Grundmass ${g.median} px`);
        w.raute = await s.page.evaluate(() => Math.max(0, ...[...document.querySelectorAll<HTMLElement>(".leaflet-marker-pane .lt-ev.k-feind svg")].map((e) => e.getBoundingClientRect().height)));
        soll((w.raute as number) >= 36, `Raute Feind ${w.raute} px`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("2 Zoom 5 m/px → ≥ 32 px, hinaus nie < 24 px; Stufe S/L verschiebt, L bleibt nach Neuladen", "laptop", async (w) => {
      const s = await neu();
      try {
        const m0 = (await grundmass(s)).median;
        await zoomen(s, 2);
        w.hinein = (await grundmass(s)).median;
        soll((w.hinein as number) >= 32, `hinein ${w.hinein} px`);
        await zoomen(s, -4);
        w.hinaus = (await grundmass(s)).median;
        soll((w.hinaus as number) >= 24, `hinaus ${w.hinaus} px`);
        await zoomen(s, 2);
        await stufe(s, "L");
        const l = (await grundmass(s)).median;
        await stufe(s, "S");
        const sm = (await grundmass(s)).median;
        w.stufen = { m0, l, s: sm };
        soll(l - m0 === 8 && m0 - sm === 4, `Stufen L ${l}, M ${m0}, S ${sm}`);
        await stufe(s, "L");
        await s.page.reload(); await s.page.waitForTimeout(1500);
        soll((await grundmass(s)).median === l, "Stufe L nach Neuladen nicht behalten");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("3 Präsentation 1920×1080: Grundmass ≥ 40 px, Beschriftung ≥ 16 px", "laptop", async (w) => {
      const s = await neu({ viewport: { width: 1920, height: 1080 }, arbeitsweise: { modus: "lage", experte: true } });
      try {
        await s.page.getByRole("button", { name: "Menü" }).click();
        await s.page.getByRole("menuitem", { name: /Präsentation/ }).click();
        await s.page.waitForTimeout(1200);
        w.grundmass = (await grundmass(s)).median;
        soll((w.grundmass as number) >= 40, `Grundmass ${w.grundmass} px`);
        w.schrift = await s.page.evaluate(() => Math.min(99, ...[...document.querySelectorAll<HTMLElement>(".leaflet-marker-pane .lt-tl, .leaflet-marker-pane .lt-ud")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => parseFloat(getComputedStyle(e).fontSize))));
        soll((w.schrift as number) >= 16, `Beschriftung ${w.schrift} px`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("4 Ältere Zeichen: Deckkraft ≥ 0.7, saturate(0.55), ohne Beschriftung; neue voll", "laptop", async (w) => {
      const s = await neu();
      try {
        const r = await s.page.evaluate(() => {
          const alt = [...document.querySelectorAll<HTMLElement>(".leaflet-marker-pane .lt-ev.old")];
          const neu = [...document.querySelectorAll<HTMLElement>(".leaflet-marker-pane .lt-ev:not(.old)")];
          const op = (e: HTMLElement) => { let o = 1; for (let x: HTMLElement | null = e; x && !x.classList.contains("leaflet-marker-pane"); x = x.parentElement) o *= +getComputedStyle(x).opacity; return o; };
          return { alt: alt.length, minOp: Math.min(1, ...alt.map(op)), filter: alt[0] ? getComputedStyle(alt[0]).filter : "", beschriftet: alt.filter((e) => e.querySelector(".lt-tl, .lt-ud")).length, neuOp: Math.min(1, ...neu.map(op)) };
        });
        w.alt = r;
        soll(r.alt > 0, "keine älteren Zeichen (.lt-ev.old)");
        soll(r.minOp >= 0.7, `Deckkraft ${r.minOp.toFixed(2)}`);
        soll(/saturate\(0?\.55\)/.test(r.filter), `Filter «${r.filter}»`);
        soll(!r.beschriftet && r.neuOp >= 0.99, `beschriftet ${r.beschriftet}, neue Deckkraft ${r.neuOp}`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("5 Ruhe: ≥ 28 sichtbare Einzelzeichen, ≤ 10 Stapel (Beispiel Bern, Einpassen)", "laptop", async (w) => {
      const s = await neu();
      try {
        const r = await s.page.evaluate(() => {
          const sicht = (e: Element) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > 0 && b.left < innerWidth && b.bottom > 0 && b.top < innerHeight; };
          // Entscheid Koordinator (wie symbole/measure.js): alle sichtbaren Zeichen, Stapel-Oberste eingeschlossen
          return { einzel: [...document.querySelectorAll(".leaflet-marker-pane .lt-ev")].filter(sicht).length, stapel: [...document.querySelectorAll(".leaflet-marker-pane .lt-stk")].filter(sicht).length };
        });
        w.ruhe = r;
        soll(r.einzel >= 28 && r.stapel <= 10, `${r.einzel} Einzelzeichen, ${r.stapel} Stapel`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("6 Neuaufbau bei Wechsel der Grössenklasse (lt:zeichen) ≤ 100 ms bei «lang», CPU 4× (Median aus 5)", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel=lang", uhr: "2030-05-18T07:30:00+02:00" });
      try {
        const cdp = await s.page.context().newCDPSession(s.page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        const ms: number[] = [];
        // Entscheid Koordinator: unter der Test-Uhr legt performance.mark nichts ab → `window.__ltZeichen` (ms je Neuaufbau, letzter Wert je Zoom)
        type Z = { __ltZeichen?: number[] | number };
        const letzter = () => s.page.evaluate(() => { const z = (window as unknown as Z).__ltZeichen; return Array.isArray(z) ? z.length : z === undefined ? 0 : 1; });
        for (let i = 0; i < 5; i++) {
          const n0 = await letzter();
          await zoomen(s, i % 2 ? -2 : 2);
          const d = await s.page.evaluate((n: number) => { const z = (window as unknown as Z).__ltZeichen; if (Array.isArray(z)) return z.length > n ? z[z.length - 1]! : -1; return typeof z === "number" ? z : -1; }, n0);
          ms.push(d);
        }
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        w.ms = ms;
        soll(ms.every((x) => x >= 0), "Messwerte window.__ltZeichen fehlen");
        const med = [...ms].sort((a, b) => a - b)[2]!;
        soll(med <= 100, `Median ${med.toFixed(0)} ms`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("7 Tageskarte grau nach V4, Nacht unverändert, Nacht-Rand der Zeichen schwarz", "laptop", async (w) => {
      const s = await neu();
      try {
        w.tag = await s.page.evaluate(() => { const e = document.querySelector(".lt-tiles-grau"); return e ? getComputedStyle(e).filter : ""; });
        const soll1 = TAGESKARTE_FILTER.replace(/(^|[^\d])\.(\d)/g, "$10.$2"); // «.62» → «0.62» wie getComputedStyle
        soll(w.tag === soll1, `Filter Tag «${w.tag}» statt «${soll1}»`);
        await s.page.getByRole("button", { name: "Menü" }).click();
        await s.page.getByRole("menuitemcheckbox", { name: /Nacht/ }).click();
        await s.page.keyboard.press("Escape");
        await s.page.waitForTimeout(800);
        w.nacht = await s.page.evaluate(() => getComputedStyle(document.querySelector(".leaflet-tile-pane")!).filter);
        soll(/brightness\(0?\.45\)/.test(String(w.nacht)), `Filter Nacht «${w.nacht}»`);
        w.rand = await s.page.evaluate(() => { const svg = document.querySelector(".leaflet-marker-pane .lt-ev svg"); return svg ? /stroke="(#000000|#000|black|rgb\(0, ?0, ?0\))"/i.test(svg.outerHTML) : false; });
        soll(w.rand, "Nacht-Rand der Zeichen nicht schwarz");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("8 Flächen: Feind-PQ 0.22/0.4, Unklar schraffiert (keine gelbe Füllung)", "laptop", async (w) => {
      const s = await neu();
      try {
        const r = await s.page.evaluate(() => {
          const p = [...document.querySelectorAll<SVGPathElement>(".leaflet-overlay-pane path")];
          // Entscheid Koordinator: nur neue Planquadrate (ältere tragen zusätzlich die Deckkraft 0.72 der älteren Zeichen)
          const feind = p.filter((e) => e.matches(".lt-pq:not(.old)") && (/c62828/i.test(e.getAttribute("fill") ?? "") || /c62828/i.test(e.getAttribute("stroke") ?? "")));
          return {
            feind: feind.map((e) => [e.getAttribute("fill-opacity"), e.getAttribute("stroke-opacity")]).slice(0, 3),
            schraffur: p.filter((e) => /url\(#lt-schraffur-unklar\)/.test(e.getAttribute("fill") ?? "")).length,
            gelb: p.filter((e) => /f2c200/i.test(e.getAttribute("fill") ?? "")).length,
            muster: !!document.querySelector("pattern#lt-schraffur-unklar"),
          };
        });
        w.flaechen = r;
        soll(r.feind.length > 0 && r.feind.every(([f, st]) => Math.abs(+f! - 0.22) < 0.01 && Math.abs(+st! - 0.4) < 0.01), `Feind-PQ ${JSON.stringify(r.feind)}`);
        soll(r.muster && r.schraffur > 0 && !r.gelb, `Schraffur ${r.schraffur}, gelb ${r.gelb}`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("9 Lineal: Zoom +1 auf AK9 → «AK» oben, «9» links; Blattrand im Bild → kein Lineal", "laptop", async (w) => {
      const s = await neu();
      try {
        // Entscheid Koordinator: «ohne» erst nach Zoom −1 (die Einpassung kann knapp innerhalb der Blattränder liegen)
        await zoomen(s, -1);
        const ohne = await s.page.locator(".leaflet-lt-lineal-pane :is(span,div)").filter({ hasText: /\S/ }).count();
        await s.page.getByPlaceholder(/^Suchen/).fill("AK9");
        await s.page.getByRole("option", { name: /^AK9/ }).first().click();
        await s.page.waitForTimeout(1200);
        await zoomen(s, 1);
        const txt = (await s.page.locator(".leaflet-lt-lineal-pane").innerText().catch(() => "")).replace(/\s+/g, " ");
        w.lineal = txt.slice(0, 200);
        w.ohne = ohne;
        soll(/\bAK\b/.test(txt) && /\b9\b/.test(txt), "Lineal zeigt AK bzw. 9 nicht");
        soll(ohne === 0, "Lineal sichtbar, obwohl der Blattrand im Bild ist");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("10 Treffer (tablet-touch): 20 px daneben trifft; zwei nahe → Auswahlliste 48 px; Esc schliesst", "tablet-touch", async (w) => {
      // Entscheid Koordinator: Tipp-Punkt ausserhalb jedes Zeichens, ≤ 22 px von ≥ 2 Ankern; Zeichengrösse S; Prüfung `__ltPick.was`
      const s = await neu({ geraet: "tablet-touch", lokal: { "lage-tools.zeichengroesse": "S" } });
      try {
        soll(await istGrob(s), "kein echtes pointer: coarse");
        const ziel = await s.page.evaluate(() => {
          // Anker sichtbarer, nicht verdeckter Zeichen (verdeckte Stapel-Mitglieder: Klassen «hid»/«under»)
          const ev = [...document.querySelectorAll<HTMLElement>(".leaflet-marker-pane .lt-ev:not(.hid):not(.under)")].map((e) => {
            const b = e.getBoundingClientRect(), cs = getComputedStyle(e);
            const ml = parseFloat(cs.marginLeft) || 0, mt = parseFloat(cs.marginTop) || 0;
            return { x: b.x - ml, y: b.y - mt, b };
          }).filter((p) => p.b.width > 0 && p.x > 450 && p.y > 100 && p.y < 650);
          const innen = (x: number, y: number) => ev.some((p) => x >= p.b.left && x <= p.b.right && y >= p.b.top && y <= p.b.bottom);
          const einzel = ev.find((p) => ev.every((q) => q === p || Math.hypot(q.x - p.x, q.y - p.y) > 60));
          let paar: { x: number; y: number } | null = null;
          for (const p of ev) {
            for (let dx = -22; dx <= 22 && !paar; dx += 2) for (let dy = -22; dy <= 22 && !paar; dy += 2) {
              const x = p.x + dx, y = p.y + dy;
              if (innen(x, y)) continue;
              if (ev.filter((q) => Math.hypot(q.x - x, q.y - y) <= 20).length >= 2) paar = { x, y };
            }
            if (paar) break;
          }
          return { einzel: einzel ? { x: einzel.b.x + einzel.b.width / 2, y: einzel.b.y + einzel.b.height / 2 } : null, paar };
        });
        w.ziel = ziel;
        // zuerst die Auswahlliste (die Wahl eines Zeichens lässt die Karte danach zur Meldung fliegen)
        const paar = ziel.paar;
        soll(paar, "kein Punkt ≤ 22 px von zwei Zeichen ausserhalb der Zeichen");
        await cdpTippen(s, paar!.x, paar!.y);
        await s.page.waitForTimeout(300);
        w.pick = await s.page.evaluate(() => (window as unknown as { __ltPick?: unknown }).__ltPick ?? null);
        soll((w.pick as { was?: string } | null)?.was === "liste", `__ltPick.was «${(w.pick as { was?: string } | null)?.was}»`);
        const lb = s.page.getByRole("listbox", { name: /Welches Zeichen/ });
        soll(await lb.isVisible().catch(() => false), "Auswahlliste fehlt");
        const hoehen = await lb.getByRole("option").evaluateAll((l: Element[]) => l.map((e) => e.getBoundingClientRect().height));
        w.zeilen = hoehen;
        soll(hoehen.length >= 2 && hoehen.every((x: number) => x >= 48), `Zeilen ${JSON.stringify(hoehen)}`);
        await s.page.keyboard.press("Escape");
        await s.page.waitForTimeout(200); // die Liste wird im nächsten Takt ausgehängt
        soll(!(await lb.isVisible().catch(() => false)), "Esc schliesst die Auswahlliste nicht");
        soll(ziel.einzel, "kein einzelnes Zeichen gefunden");
        await cdpTippen(s, ziel.einzel!.x + 20, ziel.einzel!.y);
        soll(await s.page.locator(".jlist li[aria-selected=true], .jlist li.sel, .lt-ev.sel").count() > 0, "Tipp 20 px daneben wählt nichts");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("11 Etiketten Nacht dunkel (Luminanz < 0.2, Kontrast ≥ 4.5); Tablet hoch ohne Überlappung", "laptop", async (w) => {
      const s = await neu({ dunkel: true });
      try {
        const r = await s.page.evaluate(() => {
          const lum = (c: string) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 1; const [r, g, b] = m[1]!.split(/[ ,/]+/).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
          const lab = [...document.querySelectorAll<HTMLElement>(".leaflet-marker-pane .lt-tl, .lt-nai-lbl, .lt-area-lbl")].filter((e) => e.getBoundingClientRect().width > 0);
          return lab.slice(0, 20).map((e) => { const bg = lum(getComputedStyle(e).backgroundColor), fg = lum(getComputedStyle(e).color); return { bg, k: (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) }; });
        });
        w.etiketten = r.slice(0, 5);
        soll(r.length > 0 && r.every((x: { bg: number; k: number }) => x.bg < 0.2 && x.k >= 4.5), "helle Etiketten nachts bzw. Kontrast < 4.5");
      } finally { await s.close(); }
      const t = await neu({ geraet: "tablet", viewport: { width: 768, height: 1024 } });
      try {
        const ueber = await t.page.evaluate(() => {
          // Entscheid Koordinator: die Beschriftungen selbst (`.lt-raster-lbl` ist die ganze Beschriftungs-SVG)
          const r = [...document.querySelectorAll<Element>(".lt-nai-lbl:not(.lt-lbl-aus), .leaflet-lt-lineal-pane span, .lt-raster-lbl text")].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
          let n = 0;
          for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const a = r[i]!, b = r[j]!; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) n++; }
          return n;
        });
        w.ueberlappungen = ueber;
        soll(ueber === 0, `${ueber} Überlappungen`);
      } finally { await t.close(); }
    }));

    out.push(await aufgabe("12 Strichelung: Wege punktiert «1 6», gestrichelt nur vermutet; «2×», Stapelmarke nur Ziffern", "laptop", async (w) => {
      const s = await neu({ arbeitsweise: { modus: "lage", experte: true } });
      try {
        const r = await s.page.evaluate(() => ({
          wege: [...document.querySelectorAll(".leaflet-overlay-pane path[stroke-dasharray]")].map((e) => e.getAttribute("stroke-dasharray")),
          zusatz: [...document.querySelectorAll<HTMLElement>(".leaflet-marker-pane .lt-ud")].map((e) => e.innerText),
          stapel: [...document.querySelectorAll<HTMLElement>(".leaflet-marker-pane .lt-stk")].map((e) => e.innerText.trim()),
        }));
        w.r = { wege: r.wege.slice(0, 5), zusatz: r.zusatz.slice(0, 5), stapel: r.stapel.slice(0, 5) };
        soll(r.wege.some((d: string | null) => d === "1 6" || d === "1,6"), "keine punktierten Wege");
        soll(r.zusatz.every((z: string) => !/●/.test(z)) && r.zusatz.some((z: string) => /\d×/.test(z)), "Zusatz ohne «2×» bzw. mit «●»");
        soll(r.stapel.every((z: string) => /^\d+$/.test(z)), `Stapelmarke ${JSON.stringify(r.stapel.slice(0, 3))}`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("13 Massstab unten links, metrisch", "laptop", async (w) => {
      const s = await neu();
      try {
        const m = s.page.locator(".leaflet-bottom.leaflet-left .leaflet-control-scale");
        soll(await m.isVisible().catch(() => false), "Massstab fehlt");
        w.text = (await m.innerText()).trim();
        soll(/^\d+ (m|km)$/.test(String(w.text)), `Text «${w.text}»`);
      } finally { await s.close(); }
    }));

    return out;
  },
};
export default spec;
