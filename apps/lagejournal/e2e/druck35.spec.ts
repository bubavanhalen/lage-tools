/**
 * Druck (Spez. MVP 3.5, Kap. 8.7, Pakete D und B): keine Überlappung im Anhang «Lage Rot», Vektorzeichen statt «+ »/«o »,
 * Farbe nur in der Spalte «Art», «Erf.» immer gefüllt, Ort nie doppelt, Visum nie allein, Zeitfähnchen der Lagekarte
 * ≥ 8 pt, Seitenbudgets aus MVP 3. Geprüft über `window.__ltPdfInfo` mit `boxes`, `fills`, `glyphen` (Kap. 5.7,
 * Paket D meldet sie in `safePdf`). Phase 0: Gerüst – darf rot sein. Ausgabe e2e/out/druck35.json.
 */
import { UHR_T2_0730, UHR_T4_0730, aufgabe, knopfVon, menue, soll, type Harness, type Session, type Spec, type TestResult } from "./lib.ts";

interface Box { seite: number; x: number; y: number; w: number; h: number; pt: number; text: string }
interface Info { seiten: number; format: string; quer?: boolean; zeilen: string[]; boxes?: Box[]; fills?: Array<{ seite: number; x: number; y: number; w: number; h: number; farbe: string }>; glyphen?: { punkt: number; haken: number; warn: number; kreuz: number } }

async function pdf(s: Session, max = 12000): Promise<Info | null> {
  await s.page.evaluate(() => { (window as unknown as { __ltPdfInfo?: unknown }).__ltPdfInfo = undefined; });
  const t0 = Date.now();
  await knopfVon(s, "PDF erstellen").click();
  let info: Info | null = null;
  while (Date.now() - t0 < max && !(info = await s.page.evaluate(() => (window as unknown as { __ltPdfInfo?: Info }).__ltPdfInfo ?? null))) await s.page.waitForTimeout(100);
  return info;
}
/** Paare von Textboxen derselben Seite, die sich überlappen (Toleranz 0.2 mm) */
function ueberlappungen(b: Box[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
    const p = b[i]!, q = b[j]!;
    if (p.seite !== q.seite) continue;
    if (p.x + 0.2 < q.x + q.w && q.x + 0.2 < p.x + p.w && p.y + 0.2 < q.y + q.h && q.y + 0.2 < p.y + p.h) out.push(`S${p.seite}: «${p.text.slice(0, 20)}» / «${q.text.slice(0, 20)}»`);
  }
  return out;
}
const ERSATZ = /^(\+|o|!|-) /;

const spec: Spec = {
  name: "druck35",
  async run(h: Harness) {
    const out: TestResult[] = [];
    let journal: Info | null = null;

    out.push(await aufgabe("1 Journal-PDF Tag mit Anhang Lage Rot: 0 Überlappungen, «Wahrscheinlichste»", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
      try {
        await s.page.waitForTimeout(2000);
        await menue(s, /Journal drucken/);
        await s.page.getByRole("radio", { name: /^Tag/ }).first().check().catch(() => {});
        await s.page.getByRole("checkbox", { name: /Lage Rot/ }).check().catch(() => {});
        journal = await pdf(s);
        soll(journal, "kein PDF");
        soll(journal!.boxes?.length, "__ltPdfInfo.boxes fehlt (Paket D, safePdf)");
        const u = ueberlappungen(journal!.boxes!);
        w.ueberlappungen = u.slice(0, 5);
        soll(!u.length, `${u.length} Überlappungen`);
        soll(journal!.zeilen.some((l) => /Am wahrscheinlichsten|Wahrscheinlichste/.test(l)), "«Wahrscheinlichste» fehlt");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("2 Keine Aufzählung «+ »/«o »/«! »/«- »; Vektorzeichen vorhanden (Anhang)", "laptop", async (w) => {
      soll(journal, "kein Journal-PDF aus Fall 1");
      const z = journal!.zeilen.filter((l) => ERSATZ.test(l.trim()));
      w.ersatz = z.slice(0, 5);
      soll(!z.length, `${z.length} Zeilen mit Ersatzzeichen`);
      const g = journal!.glyphen;
      w.glyphen = g;
      soll(g && g.punkt + g.haken + g.warn > 0, "keine Vektorzeichen (glyphen)");
    }));

    out.push(await aufgabe("3 Farbe nur in der Spalte «Art»", "laptop", async (w) => {
      soll(journal?.fills, "__ltPdfInfo.fills fehlt");
      const art = journal!.boxes!.find((b) => /^Art$/.test(b.text.trim()));
      soll(art, "Spaltenkopf «Art» nicht gefunden");
      const fremd = journal!.fills!.filter((f) => f.x + 0.5 < art!.x || f.x + f.w > art!.x + art!.w + 25);
      w.fremd = fremd.slice(0, 5);
      soll(!fremd.length, `${fremd.length} Füllflächen ausserhalb der Spalte «Art»`);
    }));

    out.push(await aufgabe("4 «Erf.» immer gefüllt, Ort nie doppelt", "laptop", async (w) => {
      soll(journal, "kein Journal-PDF aus Fall 1");
      const zeilen = journal!.zeilen.filter((l) => /^\d+\s+\d\d:\d\d/.test(l.trim()));
      const doppelt = zeilen.filter((l) => { const pq = l.match(/\b[A-Z]{2}\d{1,2}\b/g) ?? []; return new Set(pq).size < pq.length; });
      w.doppelt = doppelt.slice(0, 3);
      soll(!doppelt.length, `${doppelt.length} Zeilen mit doppeltem Ort`);
      soll(journal!.boxes?.some((b) => /^Erf\.$/.test(b.text.trim())), "Spalte «Erf.» fehlt");
    }));

    out.push(await aufgabe("5 «lang», ganze Übung: letzte Seite hat ≥ 1 Tabellenzeile vor «Geführt von»", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel=lang", uhr: UHR_T4_0730 });
      try {
        await s.page.waitForTimeout(1500);
        await menue(s, /Journal drucken/);
        await s.page.getByRole("radio", { name: /Ganze Übung|Alles/ }).first().check().catch(() => {});
        const r = await pdf(s, 30000);
        soll(r?.boxes, "__ltPdfInfo.boxes fehlt");
        const letzte = r!.boxes!.filter((b) => b.seite === r!.seiten);
        const visum = letzte.find((b) => /Geführt von/.test(b.text));
        const tabelle = letzte.filter((b) => /^\d+$/.test(b.text.trim()) && (!visum || b.y < visum.y));
        w.letzteSeite = { zeilen: tabelle.length, visum: !!visum };
        soll(visum && tabelle.length >= 1, "Visum allein auf der letzten Seite");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("6 Lagekarte A4 und A3: Zeitfähnchen ≥ 8 pt", "laptop", async (w) => {
      for (const papier of ["A4 quer", "A3 quer"]) {
        const s = await h.open({ query: "?beispiel", uhr: UHR_T2_0730 });
        try {
          await menue(s, /Lagekarte drucken/);
          await s.page.getByRole("radio", { name: papier }).check();
          const r = await pdf(s);
          const zeit = (r?.boxes ?? []).filter((b) => /^\d\d:\d\d$/.test(b.text.trim()));
          (w as Record<string, unknown>)[papier] = { n: zeit.length, minPt: Math.min(99, ...zeit.map((b) => b.pt)) };
          soll(zeit.length && zeit.every((b) => b.pt >= 8), `${papier}: Zeitfähnchen ${JSON.stringify((w as Record<string, unknown>)[papier])}`);
        } finally { await s.close(); }
      }
    }));

    out.push(await aufgabe("7 Seitenbudgets: Schicht «lang» ≤ 5 Seiten, Übergabe ≤ 2", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel=lang", uhr: UHR_T4_0730 });
      try {
        await s.page.waitForTimeout(1500);
        await menue(s, /Journal drucken/);
        await s.page.getByRole("radio", { name: /Diese Schicht/ }).check();
        const r = await pdf(s);
        w.schicht = r?.seiten;
        soll(r && r.seiten <= 5, `Schicht ${r?.seiten} Seiten`);
        await s.page.keyboard.press("Escape");
        await menue(s, /^Übergabe/);
        await s.page.evaluate(() => { (window as unknown as { __ltPdfInfo?: unknown }).__ltPdfInfo = undefined; });
        await s.page.getByRole("dialog", { name: "Übergabe" }).getByRole("button", { name: /Als PDF/ }).click();
        await s.page.waitForTimeout(2500);
        const u = await s.page.evaluate(() => (window as unknown as { __ltPdfInfo?: Info }).__ltPdfInfo ?? null);
        w.uebergabe = u?.seiten;
        soll(u && u.seiten <= 2, `Übergabe ${u?.seiten} Seiten`);
      } finally { await s.close(); }
    }));

    return out;
  },
};
export default spec;
