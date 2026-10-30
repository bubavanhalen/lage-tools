/**
 * Inventar-Messung (Spez. MVP 1, Kap. 7.2): sichtbare Bedienelemente zählen (Zählregel siehe lib.ts
 * `inventarImBrowser`). Grenzen: Grundansicht ≤ 12, mit Vorschau ≤ 15, gewählte Zeile ≤ 15 (MVP 3: + «Mehr …»),
 * Rückblick ≤ 18; MVP 3 (Spez. MVP 3, Kap. 1.3): Grundansicht `?beispiel=lang` ≤ 13 (+ Chip «zeigt nur letzte 6 h»),
 * Vorschau Nicht-Meldung ≤ 14. Experte und Vorbereiten nur berichten; mit `--hit: 48px` kein Überlauf und kein
 * Element unter 48 px. Zustände, die es erst mit MVP 3 gibt (Spez. MVP 3, Kap. 1.3; vorher inventar3.spec.ts): Kürzel-
 * Abfrage ≤ 16, Ansicht Offen ≤ 13, Offen mit gewähltem Punkt ≤ 15, Gestrichene gezeigt ≤ 13; «Mehr …» offen,
 * Übergabe-Seite (Ziel ≤ 8) und Druck-Dialoge nur berichten; mit `--hit: 48px` kein Überlauf und nichts unter 48 px in
 * Offen und «Mehr …».
 * Ausgabe: e2e/out/inventar.json (Liste je Zustand mit Name und Grösse, vergleichbar mit einfachheit/d_inventar.json).
 *
 * MVP 3.5 (Spez. MVP 3.5, Kap. 1.3): jede Grenz-Messung zweimal – «bereit» (Testhaken `__ltOfflineBereit`, wie bisher)
 * und «echt» (frisches Gerät, kein Haken: Kopf-Knopf «Offline …» sichtbar, Budget +1). Neue Budgets: `?beispiel=leer`
 * mit Kürzel ≤ 12/13, ohne Kürzel ≤ 14/15 (Kürzel-Zeile +2), Erststart ≤ 15/16. Der Kopf-Knopf öffnet das Offline-Popover
 * (kein Moduswechsel, S6). Zustände, die erst mit den Paketen entstehen (Laden, Vorschau mit Wahl, Bezug-Wahl, Popover,
 * Auswahlliste, Datei-Schritt): `inventar35.spec.ts` (darf bis Phase 2 rot sein; danach übernimmt E sie hierher).
 */
import { UHR_T2_0730, UHR_T4_0730, ansicht, aufgabe, eintragenText, feldVon, inventarImBrowser, knopfVon, menue, modusVon, offlinePopoverVon, soll, ueberlaufImBrowser, zeilenVon, type Geraet, type Harness, type Session, type Spec, type TestResult } from "./lib.ts";

const zaehlen = (s: Session) => s.page.evaluate(inventarImBrowser);

async function messen1(h: Harness, name: string, geraet: Geraet, grenze: number | null, o: Parameters<Harness["open"]>[0], vorher?: (s: Session) => Promise<void>): Promise<TestResult> {
  return aufgabe(name, geraet, async (w) => {
    const s = await h.open({ uhr: UHR_T2_0730, geraet, ...o });
    try {
      if (vorher) await vorher(s);
      await s.page.waitForTimeout(300);
      const liste = await zaehlen(s);
      w.anzahl = liste.length;
      w.grenze = grenze;
      w.elemente = liste;
      await h.shot(s.page, `inventar/${name.replace(/[^\wäöü]+/gi, "_")}_${geraet}`);
      if (grenze !== null) soll(liste.length <= grenze, `${liste.length} Bedienelemente > ${grenze}`);
    } finally { await s.close(); }
  });
}

/**
 * MVP 3.5: Messung «bereit» (Name wie bisher) und «echt» (Name + « · echt», Grenze +1 bzw. `echt`); `grenze` null = nur berichten
 */
async function messen(h: Harness, name: string, geraet: Geraet, grenze: number | null, o: Parameters<Harness["open"]>[0], vorher?: (s: Session) => Promise<void>, echt?: number | null): Promise<TestResult[]> {
  return [
    await messen1(h, name, geraet, grenze, { ...o, offline: "bereit" }, vorher),
    await messen1(h, `${name} · echt`, geraet, echt !== undefined ? echt : grenze === null ? null : grenze + 1, { ...o, offline: "echt" }, vorher),
  ];
}

/** `?beispiel=leer` mit Kürzel (über Menü «Kürzel ändern …», wie ein Benutzer) */
const kuerzelSetzen = async (s: Session) => {
  await menue(s, /Kürzel ändern/);
  const f = s.page.getByRole("dialog").getByRole("textbox").first();
  await f.fill("MU");
  await f.press("Enter");
  await s.page.waitForTimeout(300);
  soll(await s.page.getByText(/Schicht MU/).first().isVisible().catch(() => false), "Kürzel MU nicht gesetzt");
};

// ---------- MVP 3 (aus inventar3.spec.ts übernommen) ----------
async function messen3(h: Harness, name: string, geraet: Geraet, grenze: number | null, o: Parameters<Harness["open"]>[0], vorher: (s: Session) => Promise<void>, css?: string): Promise<TestResult> {
  return aufgabe(name, geraet, async (w) => {
    const s = await h.open({ uhr: UHR_T2_0730, geraet, ...o, ...(css ? { css } : {}) });
    try {
      await vorher(s);
      await s.page.waitForTimeout(300);
      const liste = await s.page.evaluate(inventarImBrowser);
      Object.assign(w, { anzahl: liste.length, grenze, elemente: liste });
      await h.shot(s.page, `inventar/mvp3_${name.replace(/[^\wäöü]+/gi, "_")}_${geraet}`);
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
  name: "inventar",
  async run(h) {
    const out: TestResult[] = [];
    for (const g of ["laptop", "tablet"] as const) {
      out.push(...await messen(h, "Grundansicht Beispiel", g, 12, { query: "?beispiel" }));
      // MVP 3.5 (Kap. 1.3): leer ohne Kürzel +2 (Kürzel-Zeile, Paket E), mit Kürzel wie Beispiel; Erststart +3
      out.push(...await messen(h, "Grundansicht leer", g, 14, { query: "?beispiel=leer" }));
      out.push(...await messen(h, "Grundansicht leer, Kürzel gesetzt", g, 12, { query: "?beispiel=leer" }, kuerzelSetzen));
      out.push(...await messen(h, "Erststart (ohne Parameter)", g, 15, {}));
      out.push(...await messen(h, "Mit Vorschau", g, 15, { query: "?beispiel" }, async (s) => {
        await s.page.getByPlaceholder("Was wurde gemeldet?").fill("H04 2 Fz in AK7 Rtg N");
      }));
      out.push(...await messen(h, "Vorschau Nicht-Meldung", g, 14, { query: "?beispiel" }, async (s) => {
        await s.page.getByPlaceholder("Was wurde gemeldet?").fill("Auftrag an H01: Beo NAI 1 bis 1200");
      }));
      out.push(...await messen(h, "Grundansicht lang", g, 13, { query: "?beispiel=lang", uhr: UHR_T4_0730 }, async (s) => { await s.page.waitForTimeout(1500); }));
      out.push(...await messen(h, "Gewählte Zeile", g, 15, { query: "?beispiel" }, async (s) => {
        await s.page.locator(".jlist li").first().click();
      }));
      out.push(...await messen(h, "Rückblick", g, 18, { query: "?beispiel" }, async (s) => {
        await s.page.getByRole("button", { name: /Zurückblicken/ }).click();
      }));
      out.push(await messen1(h, "Experte (nur Bericht)", g, null, { query: "?beispiel", arbeitsweise: { modus: "lage", experte: true } }));
      out.push(await messen1(h, "Vorbereiten (nur Bericht)", g, null, { query: "?beispiel", arbeitsweise: { modus: "vorbereiten", experte: false } }));
      // Offline nicht bereit (ohne Testhaken: kein Service Worker, kein Kartenpaket) → Knopf im Kopf. MVP 3.5 (S6): öffnet
      // das Popover «Offline auf diesem Gerät», kein Moduswechsel (Text des Knopfs «⚠ Offline fehlt» kommt mit Paket A)
      out.push(await aufgabe("Offline nicht bereit – Knopf öffnet «Offline auf diesem Gerät»", g, async (w) => {
        const s = await h.open({ query: "?beispiel", geraet: g, uhr: UHR_T2_0730, offline: "echt" });
        try {
          const b = s.page.locator(".hd button.hd-off").first();
          await b.waitFor({ timeout: 5000 });
          w.knopf = (await b.innerText()).replace(/\s+/g, " ").trim();
          await b.click();
          await s.page.waitForTimeout(300);
          w.modus = await modusVon(s);
          soll(w.modus === "lage", `Modus wechselte zu «${w.modus}»`);
          const pop = offlinePopoverVon(s);
          soll(await pop.isVisible().catch(() => false), "Popover «Offline auf diesem Gerät» fehlt");
          w.popover = (await pop.innerText()).replace(/\s+/g, " ").slice(0, 300);
          soll(/App|Karte/.test(String(w.popover)) && /✗/.test(String(w.popover)), "Grund (✗) fehlt im Popover");
          await s.page.keyboard.press("Escape");
          soll(!(await pop.isVisible().catch(() => false)), "Esc schliesst das Popover nicht");
        } finally { await s.close(); }
      }));
      // Feldgerät-Vorbereitung: --hit 48 px
      out.push(await aufgabe("Mit --hit: 48px kein Überlauf, nichts unter 48 px", g, async (w) => {
        const s = await h.open({ query: "?beispiel", geraet: g, uhr: UHR_T2_0730, css: ":root{--hit:48px !important}" });
        try {
          const ueber = await s.page.evaluate(ueberlaufImBrowser);
          const klein = (await zaehlen(s)).filter((e) => e.w < 48 || e.h < 48);
          w.ueberlauf = ueber;
          w.unter48 = klein;
          soll(!ueber.length, `Überlauf: ${ueber.slice(0, 3).join("; ")}`);
          soll(!klein.length, `${klein.length} Elemente unter 48 px, z. B. ${klein.slice(0, 3).map((e) => `${e.name} ${e.w}×${e.h}`).join(", ")}`);
        } finally { await s.close(); }
      }));
      // MVP 3
      out.push(await messen3(h, "Vorschau mit Kürzel-Abfrage", g, 16, { query: "?beispiel=leer" }, async (s) => {
        await feldVon(s).fill("H04 2 Fz in AK7 Rtg N");
        if (g === "tablet") await knopfVon(s, /^Eintragen/).first().tap(); else await feldVon(s).press("Enter");
        soll(await s.page.getByText("Wer erfasst?").first().isVisible().catch(() => false), "keine Kürzel-Abfrage");
      }));
      out.push(await messen3(h, "Ansicht Offen", g, 13, { query: "?beispiel" }, offen));
      out.push(await messen3(h, "Offen, Punkt gewählt", g, 15, { query: "?beispiel" }, offenGewaehlt));
      out.push(await messen3(h, "Gestrichene gezeigt", g, 13, { query: "?beispiel" }, async (s) => {
        await zeilenVon(s).first().click();
        await knopfVon(s, "Streichen").click();
        await s.page.waitForTimeout(9000);
        await s.page.getByRole("button", { name: /Gestrichene zeigen/ }).or(s.page.getByRole("link", { name: /Gestrichene zeigen/ })).first().click();
      }));
      out.push(await messen3(h, "«Mehr …» offen (nur Bericht)", g, null, { query: "?beispiel" }, mehr));
      out.push(await messen3(h, "Übergabe-Seite (nur Bericht, Ziel ≤ 8)", g, null, { query: "?beispiel" }, async (s) => { await offen(s); await knopfVon(s, /^Übergabe/).first().click(); }));
      out.push(await messen3(h, "Dialog Journal drucken (nur Bericht)", g, null, { query: "?beispiel" }, async (s) => { await menue(s, /Journal drucken/); }));
      out.push(await messen3(h, "Dialog Lagekarte drucken (nur Bericht)", g, null, { query: "?beispiel" }, async (s) => { await menue(s, /Lagekarte drucken/); }));
      out.push(await messen3(h, "--hit 48px: Ansicht Offen", g, null, { query: "?beispiel" }, offen, ":root{--hit:48px !important}"));
      out.push(await messen3(h, "--hit 48px: «Mehr …»", g, null, { query: "?beispiel" }, mehr, ":root{--hit:48px !important}"));
    }
    return out;
  },
};
export default spec;
