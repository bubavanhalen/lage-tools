/**
 * Lange Übung (Spez. MVP 3, Kap. 8.5): `?beispiel=lang` (800 Einträge, 4 Tage), Uhr T4 07:30, Laptop und Tablet.
 * Standard «Zeige letzte 6 h» ab 200 Meldungen mit sichtbarem Chip, gebündelte Hinweise «· n×», Inventar ≤ 13.
 * Ausgabe e2e/out/lang.json. Phase 0: Gerüst – Laden grün, Rest rot, bis Paket C/D fertig ist.
 */
import { UHR_T4_0730, ansicht, aufgabe, inventarImBrowser, soll, zeilenVon, type Geraet, type Harness, type Spec, type TestResult } from "./lib.ts";

const spec: Spec = {
  name: "lang",
  async run(h: Harness) {
    const out: TestResult[] = [];
    for (const g of ["laptop", "tablet"] as Geraet[]) {
      const s = await h.open({ query: "?beispiel=lang", geraet: g, uhr: UHR_T4_0730 });
      try {
        await s.page.waitForTimeout(1500);
        out.push(await aufgabe("0 lädt die lange Übung (fiktiv, Raum Bern), keine Konsolenfehler", g, async (w) => {
          w.zeilen = await zeilenVon(s).count();
          soll(await s.page.getByText(/Beispiel Bern lang \(fiktiv/).first().isVisible().catch(() => false), "Titel «Beispiel Bern lang (fiktiv …)» fehlt");
          soll((w.zeilen as number) > 0, "Liste leer");
          w.fehler = s.fehler;
          soll(!s.fehler.length, s.fehler.slice(0, 2).join(" | "));
        }));
        out.push(await aufgabe("3 Inventar Grundansicht ≤ 13 (mit Chip)", g, async (w) => {
          const liste = await s.page.evaluate(inventarImBrowser);
          w.anzahl = liste.length;
          w.elemente = liste;
          soll(liste.length <= 13, `${liste.length} Bedienelemente > 13`);
        }));
        out.push(await aufgabe("1 Chip «zeigt nur letzte 6 h ✕», Liste ≤ 6 h, ✕ zeigt alles", g, async (w) => {
          const chip = s.page.getByRole("button", { name: /zeigt nur letzte 6 h/ }).first();
          soll(await chip.isVisible().catch(() => false), "Chip fehlt");
          const zeiten = await s.page.locator(".jlist li").evaluateAll((l: Element[]) => l.slice(-3).map((e) => (e as HTMLElement).innerText.slice(0, 5)));
          w.letzte = zeiten;
          soll(zeiten.every((z) => z >= "01:30"), `Einträge älter als 6 h: ${zeiten.join(", ")}`);
          await chip.click();
          await s.page.waitForTimeout(300);
          soll(!(await chip.isVisible().catch(() => false)), "Chip bleibt nach ✕");
        }));
        out.push(await aufgabe("2 Was Rot: gebündelte Hinweise «· n×», keine doppelten Titel", g, async (w) => {
          await ansicht(s, "Was Rot");
          await s.page.waitForTimeout(500);
          const titel = await s.page.locator(".sh-redpanel li, [role=tabpanel] li").evaluateAll((l: Element[]) => l.map((e) => (e as HTMLElement).innerText.split("\n")[0]!.trim()));
          w.titel = titel.slice(0, 12);
          const ohne = titel.map((t) => t.replace(/\s*·\s*\d+×\s*$/, ""));
          soll(titel.some((t) => /·\s*\d+×/.test(t)), "kein gebündelter Hinweis «· n×»");
          soll(new Set(ohne).size === ohne.length, "doppelte Titel");
          await ansicht(s, "Journal");
        }));
        await h.shot(s.page, `lang/grundansicht_${g}`);
      } finally { await s.close(); }
    }
    return out;
  },
};
export default spec;
