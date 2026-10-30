/**
 * Inventar-Zustände, die es erst mit MVP 3.5 gibt (Spez. MVP 3.5, Kap. 1.3) – je «bereit» und «echt» wie
 * inventar.spec.ts: während «Alles für offline laden» (echt ≤ 13), Vorschau mit Wahl (≤ 16/17), Bezug-Wahl 64a/64b
 * (≤ 17/18), Offline-Popover (Ziel ≤ 6, berichten), Auswahlliste (Zeilen 48 px, berichten), Übergabe-Schritt «Datei
 * sichern» (Ziel ≤ 4, berichten); `--hit: 48px` auch in Popover, Kürzel-Zeile, Auswahlliste.
 * Phase 0: Gerüst – darf rot sein. **Phase 2 (Paket E):** in inventar.spec.ts übernehmen, diese Datei löschen.
 */
import { UHR_T2_0730, aufgabe, feldVon, inventarImBrowser, knopfVon, offlineKnopfVon, offlinePopoverVon, soll, ueberlaufImBrowser, type Geraet, type Harness, type Session, type Spec, type TestResult } from "./lib.ts";

async function zaehle(h: Harness, name: string, g: Geraet, grenze: number | null, o: Parameters<Harness["open"]>[0], vorher: (s: Session) => Promise<void>, css?: string): Promise<TestResult> {
  return aufgabe(name, g, async (w) => {
    const s = await h.open({ uhr: UHR_T2_0730, geraet: g, ...o, ...(css ? { css } : {}) });
    try {
      await vorher(s);
      await s.page.waitForTimeout(300);
      const l = await s.page.evaluate(inventarImBrowser);
      Object.assign(w, { anzahl: l.length, grenze, elemente: l });
      await h.shot(s.page, `inventar/mvp35_${name.replace(/[^\wäöü]+/gi, "_")}_${g}`);
      if (css) {
        const ueber = await s.page.evaluate(ueberlaufImBrowser);
        const klein = l.filter((e: { w: number; h: number }) => e.w < 48 || e.h < 48);
        Object.assign(w, { ueberlauf: ueber, unter48: klein });
        soll(!ueber.length && !klein.length, `Überlauf ${ueber.length}, unter 48 px ${klein.length}`);
      }
      if (grenze !== null) soll(l.length <= grenze, `${l.length} Bedienelemente > ${grenze}`);
    } finally { await s.close(); }
  });
}
const beide = async (h: Harness, name: string, g: Geraet, b: number | null, e: number | null, o: Parameters<Harness["open"]>[0], vorher: (s: Session) => Promise<void>) => [
  await zaehle(h, name, g, b, { ...o, offline: "bereit" }, vorher),
  await zaehle(h, `${name} · echt`, g, e, { ...o, offline: "echt" }, vorher),
];

const popover = async (s: Session) => { await offlineKnopfVon(s).click(); soll(await offlinePopoverVon(s).isVisible(), "Popover fehlt"); };

const spec: Spec = {
  name: "inventar35",
  async run(h: Harness) {
    const out: TestResult[] = [];
    for (const g of ["laptop", "tablet"] as Geraet[]) {
      out.push(await zaehle(h, "Während «Alles für offline laden» · echt", g, 13, { query: "?beispiel", offline: "echt" }, async (s) => {
        await popover(s);
        await offlinePopoverVon(s).getByRole("button", { name: /Alles für offline laden/ }).click();
        await s.page.keyboard.press("Escape");
        soll(await s.page.getByText(/Lädt \d+ %/).first().isVisible().catch(() => false), "Kopf «Lädt …» fehlt");
      }));
      out.push(...await beide(h, "Vorschau mit Wahl («Personen» übernehmen)", g, 16, 17, { query: "?beispiel" }, async (s) => {
        await feldVon(s).fill("H03 3 Persohnen in AN6");
        soll(await knopfVon(s, /«Personen» übernehmen/).isVisible().catch(() => false), "Knopf «Personen» übernehmen fehlt");
      }));
      out.push(...await beide(h, "Vorschau Bezug-Wahl (64a/64b)", g, 17, 18, { query: "?beispiel" }, async () => {
        throw new Error("Zustand braucht zwei Geräte mit gleicher Nummer (lvz35.spec 7) – Paket D/E richtet ihn hier ein");
      }));
      out.push(await zaehle(h, "Offline-Popover offen (nur Bericht, Ziel ≤ 6 im Popover)", g, null, { query: "?beispiel", offline: "echt" }, popover));
      out.push(await zaehle(h, "Auswahlliste auf der Karte (nur Bericht)", g, null, { query: "?beispiel" }, async (s) => {
        soll(await s.page.getByRole("listbox", { name: /Welches Zeichen/ }).count(), "Auswahlliste nicht geöffnet (Paket B: Tipp auf zwei nahe Zeichen)");
      }));
      out.push(await zaehle(h, "Übergabe-Schritt «Datei sichern» (nur Bericht, Ziel ≤ 4)", g, null, { query: "?beispiel" }, async (s) => {
        await s.page.getByRole("button", { name: "Menü" }).click();
        await s.page.getByRole("menuitem", { name: /^Übergabe/ }).click();
        await s.page.getByLabel(/übernommen von/).fill("MU");
        await knopfVon(s, "Übergabe abschliessen").click();
        soll(await knopfVon(s, /^Datei sichern/).isVisible().catch(() => false), "Schritt «Datei sichern» fehlt");
      }));
      out.push(await zaehle(h, "--hit 48px: Offline-Popover", g, null, { query: "?beispiel", offline: "echt" }, popover, ":root{--hit:48px !important}"));
      out.push(await zaehle(h, "--hit 48px: Kürzel-Zeile", g, null, { query: "?beispiel=leer" }, async (s) => {
        soll(await s.page.getByLabel("Dein Kürzel").isVisible().catch(() => false), "Kürzel-Zeile fehlt");
      }, ":root{--hit:48px !important}"));
    }
    return out;
  },
};
export default spec;
