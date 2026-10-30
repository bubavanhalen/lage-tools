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
 * Auswahlliste, Datei-Schritt) sind seit Phase 2 (Paket E) hier (vorher `inventar35.spec.ts`): während «Alles für offline
 * laden» (echt ≤ 13), Vorschau mit Wahl (≤ 16/17), Bezug-Wahl 64a/64b (≤ 17/18, zwei Geräte über eine Datei), Offline-
 * Popover (Ziel ≤ 6, berichten), Auswahlliste (Zeilen 48 px, berichten), Übergabe-Schritt «Datei sichern» (Ziel ≤ 4,
 * berichten); `--hit: 48px` auch in Popover und Kürzel-Zeile.
 * Der einmalige Schutzhinweis (A, S7; geprüft in betrieb.spec 10) gilt in den «echt»-Messungen als schon gesehen –
 * das Budget «echt» = «bereit» + 1 (Kopf-Knopf) misst die Grundansicht, nicht den einmaligen Hinweis.
 */
import { readFileSync } from "node:fs";
import { UHR_T2_0730, UHR_T4_0730, ansicht, aufgabe, eintragenText, feldVon, inventarImBrowser, knopfVon, menue, modusVon, offlineKnopfVon, offlinePopoverVon, soll, ueberlaufImBrowser, zeilenVon, type Geraet, type Harness, type Session, type Spec, type TestResult } from "./lib.ts";

/** Schutzhinweis der Beispiel-Übungen als gesehen (nur «echt»; der Hinweis selbst: betrieb.spec 10) */
const SCHUTZ_GESEHEN: Record<string, string> = Object.fromEntries(["ex-beispiel-bern", "ex-beispiel-bern-leer", "ex-beispiel-bern-lang"].map((id) => [`lage-tools.schutzhinweis.${id}`, "2030-05-15T05:00:00.000Z"]));
const mitSchutz = (o: Parameters<Harness["open"]>[0]): Parameters<Harness["open"]>[0] => (o?.offline === "echt" ? { ...o, lokal: { ...SCHUTZ_GESEHEN, ...(o.lokal ?? {}) } } : o);

const zaehlen = (s: Session) => s.page.evaluate(inventarImBrowser);

async function messen1(h: Harness, name: string, geraet: Geraet, grenze: number | null, o: Parameters<Harness["open"]>[0], vorher?: (s: Session) => Promise<void>): Promise<TestResult> {
  return aufgabe(name, geraet, async (w) => {
    const s = await h.open(mitSchutz({ uhr: UHR_T2_0730, geraet, ...o }));
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
    const s = await h.open(mitSchutz({ uhr: UHR_T2_0730, geraet, ...o, ...(css ? { css } : {}) }));
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

// ---------- MVP 3.5 (vorher inventar35.spec.ts) ----------
const popover = async (s: Session) => { await offlineKnopfVon(s).click(); soll(await offlinePopoverVon(s).isVisible(), "Popover fehlt"); };
/** Bezug-Wahl 64a/64b: zweites Gerät trägt mit derselben Nummer ein, Datei hier zusammenführen (wie lvz35.spec 7) */
const bezugWahl = (h: Harness, g: Geraet) => async (s: Session) => {
  const b = await h.open({ query: "?beispiel", uhr: UHR_T2_0730, geraet: g });
  try {
    await eintragenText(s, "H02 3 Fz AK9");
    await eintragenText(b, "H04 1 Pers AF11");
    const dl = b.page.waitForEvent("download", { timeout: 5000 });
    await menue(b, /Datei für anderes Gerät/);
    const pfad = await (await dl).path();
    const fc = s.page.waitForEvent("filechooser", { timeout: 5000 });
    await menue(s, /Datei öffnen \(zusammenführen\)/);
    await (await fc).setFiles({ name: "b.lage.json", mimeType: "application/json", buffer: readFileSync(pfad) });
    await s.page.waitForTimeout(800);
  } finally { await b.close(); }
  const nr = (await zeilenVon(s).filter({ hasText: "3 Fz AK9" }).first().getAttribute("data-nr"))?.replace(/[a-z]$/, "");
  await feldVon(s).fill(`Antwort zu ${nr}`);
  await s.page.waitForTimeout(200);
  soll(await knopfVon(s, new RegExp(`^${nr}b\\b`)).isVisible().catch(() => false), `Knopf «${nr}b …» fehlt`);
};
/** zwei Zeichen ≤ 10 px auseinander antippen → Auswahlliste «Welches Zeichen?» */
const auswahlliste = async (s: Session) => {
  await s.page.waitForTimeout(1500);
  const p = await s.page.evaluate(() => {
    const ev = [...document.querySelectorAll<HTMLElement>(".leaflet-marker-pane .lt-ev")].map((e) => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }).filter((q) => q.x > 450 && q.y > 100 && q.y < innerHeight - 120);
    return ev.flatMap((a) => ev.filter((q) => q !== a && Math.hypot(q.x - a.x, q.y - a.y) <= 10).map((q) => ({ x: (a.x + q.x) / 2, y: (a.y + q.y) / 2 })))[0] ?? null;
  });
  soll(p, "keine zwei Zeichen ≤ 10 px auseinander");
  await s.page.mouse.click(p!.x, p!.y);
  await s.page.waitForTimeout(300);
  soll(await s.page.getByRole("listbox", { name: /Welches Zeichen/ }).isVisible().catch(() => false), "Auswahlliste nicht geöffnet");
};
const dateiSchritt = async (s: Session) => {
  await menue(s, /^Übergabe/);
  await s.page.getByLabel(/übernommen von/).fill("MU");
  await knopfVon(s, "Übergabe abschliessen").click();
  soll(await knopfVon(s, /^Datei sichern/).isVisible().catch(() => false), "Schritt «Datei sichern» fehlt");
};

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
      // MVP 3.5 (Kap. 1.3, vorher inventar35.spec.ts)
      out.push(await messen1(h, "Während «Alles für offline laden» · echt", g, 13, { query: "?beispiel", offline: "echt" }, async (s) => {
        await popover(s);
        await offlinePopoverVon(s).getByRole("button", { name: /Alles für offline laden/ }).click();
        await s.page.keyboard.press("Escape");
        soll(await s.page.getByText(/Lädt \d+ %/).first().isVisible().catch(() => false), "Kopf «Lädt …» fehlt");
      }));
      out.push(...await messen(h, "Vorschau mit Wahl («Personen» übernehmen)", g, 16, { query: "?beispiel" }, async (s) => {
        await feldVon(s).fill("H03 3 Persohnen in AN6");
        soll(await knopfVon(s, /«Personen» übernehmen/).isVisible().catch(() => false), "Knopf «Personen» übernehmen fehlt");
      }));
      out.push(...await messen(h, "Vorschau Bezug-Wahl (64a/64b)", g, 17, { query: "?beispiel" }, bezugWahl(h, g)));
      out.push(await messen1(h, "Offline-Popover offen (nur Bericht, Ziel ≤ 6 im Popover)", g, null, { query: "?beispiel", offline: "echt" }, popover));
      out.push(await messen1(h, "Auswahlliste auf der Karte (nur Bericht)", g, null, { query: "?beispiel" }, auswahlliste));
      out.push(await messen1(h, "Übergabe-Schritt «Datei sichern» (nur Bericht, Ziel ≤ 4)", g, null, { query: "?beispiel" }, dateiSchritt));
      out.push(await messen3(h, "--hit 48px: Offline-Popover", g, null, { query: "?beispiel", offline: "echt" }, popover, ":root{--hit:48px !important}"));
      // Entscheid Koordinator: der einmalige Schutzhinweis ist im «echt»-Inventar vorbelegt – hier eigens geprüft
      out.push(await aufgabe("Schutzhinweis einmal (echt, nicht vorbelegt): erscheint, nach «OK» und Neuladen weg", g, async (w) => {
        const s = await h.open({ query: "?beispiel", geraet: g, uhr: UHR_T2_0730, offline: "echt" });
        try {
          const hinweis = s.page.getByText("Dieses Gerät schützt die Daten nicht dauerhaft.");
          w.vorher = await hinweis.isVisible().catch(() => false);
          soll(w.vorher, "Schutzhinweis fehlt");
          await knopfVon(s, "OK").click();
          soll(!(await hinweis.isVisible().catch(() => false)), "Hinweis nach «OK» noch da");
          await s.page.reload();
          await s.page.waitForTimeout(1200);
          w.nachNeuladen = await hinweis.count();
          soll(w.nachNeuladen === 0, "Hinweis nach Neuladen wieder da");
        } finally { await s.close(); }
      }));
      out.push(await messen3(h, "--hit 48px: Kürzel-Zeile", g, null, { query: "?beispiel=leer" }, async (s) => {
        soll(await s.page.getByLabel("Dein Kürzel").isVisible().catch(() => false), "Kürzel-Zeile fehlt");
      }, ":root{--hit:48px !important}"));
    }
    return out;
  },
};
export default spec;
