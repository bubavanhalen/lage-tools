/**
 * LVZ-Felder und Journal-Integrität (Spez. MVP 3, Kap. 8.2): Nummer, zwei Fenster, zwei Geräte, Eingang, Kürzel,
 * Vermerke, Zusammenführen Vermerk + Korrektur, Gestrichene, Aufheben. Laptop. Ausgabe e2e/out/lvz.json.
 * Phase 0: Gerüst – rot, bis Pakete A–D fertig sind.
 *
 * Nummern nach Entscheid 1 (eine gemeinsame Folge, kein Gerätebuchstabe): parallel offline vergebene gleiche Nummern
 * bleiben und heissen in der Anzeige «12a/12b»; Bericht «2 Nummern doppelt – als 12a/12b gekennzeichnet».
 */
import { readFileSync } from "node:fs";
import { UHR_T2_0730, aufgabe, antwortzeit, eintragenText, feldVon, knopfVon, markerVon, menue, soll, zeilenVon, ansicht, type Harness, type Session, type Spec, type TestResult } from "./lib.ts";

const nrs = async (s: Session): Promise<string[]> => (await s.page.locator(".jlist li [data-nr], .jlist li[data-nr]").evaluateAll((l: Element[]) => l.map((e) => e.getAttribute("data-nr") ?? ""))).filter(Boolean);
const offenZahl = async (s: Session): Promise<number> => {
  const t = await s.page.getByRole("tab", { name: /^Offen/ }).first().innerText().catch(() => "");
  return +(/(\d+)/.exec(t)?.[1] ?? "0");
};

/** Datei «für anderes Gerät» speichern und im anderen Kontext «öffnen (zusammenführen)»; gibt die Rückmeldung zurück */
async function dateiTauschen(von: Session, nach: Session): Promise<string> {
  const dl = von.page.waitForEvent("download", { timeout: 5000 });
  await menue(von, /Datei für anderes Gerät/);
  const pfad = await (await dl).path();
  const fc = nach.page.waitForEvent("filechooser", { timeout: 5000 });
  await menue(nach, /Datei öffnen \(zusammenführen\)/);
  await (await fc).setFiles({ name: "uebung.lage.json", mimeType: "application/json", buffer: readFileSync(pfad) });
  await nach.page.waitForTimeout(800);
  return (await nach.page.getByText(/neu ·|aktualisiert|Konflikt|doppelt/).first().innerText().catch(() => "")).replace(/\s+/g, " ");
}

const spec: Spec = {
  name: "lvz",
  async run(h: Harness) {
    const out: TestResult[] = [];
    const neu = () => h.open({ query: "?beispiel", uhr: UHR_T2_0730 });

    out.push(await aufgabe("1 Nummer steigt um 1, sichtbar, suchbar", "laptop", async (w) => {
      const s = await neu();
      try {
        for (const t of ["H02 2 Fz AK7", "H03 1 Fz in NAI 2 Rtg N", "H05 3 Pers AP11"]) await eintragenText(s, t);
        const n = (await nrs(s)).slice(0, 3).map(Number);
        w.nummern = n;
        soll(n.length === 3 && n[0] === n[1]! + 1 && n[1] === n[2]! + 1, `Nummern ${n.join(", ")} nicht fortlaufend`);
        soll(await zeilenVon(s).first().getByText(String(n[0])).count() > 0, "Nummer nicht sichtbar");
        await s.page.getByPlaceholder(/^Suchen: Trupp/).fill(String(n[2]));
        await s.page.waitForTimeout(200);
        soll((await nrs(s))[0] === String(n[2]), `Suche «${n[2]}» findet ${(await nrs(s))[0]}`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("2 Zwei Fenster je 10 Einträge → 20 verschiedene Nummern", "laptop", async (w) => {
      const s = await neu();
      try {
        const p2 = await s.page.context().newPage();
        await p2.goto(h.base);
        await p2.waitForSelector(".app", { timeout: 15000 });
        await p2.waitForTimeout(1200);
        const f1 = feldVon(s), f2 = p2.getByPlaceholder("Was wurde gemeldet?");
        for (let i = 0; i < 10; i++) {
          await f1.fill(`H02 ${i + 1} Pers AK7`); await f1.press("Enter");
          await f2.fill(`H04 ${i + 1} Pers AF12`); await f2.press("Enter");
        }
        await s.page.waitForTimeout(2000);
        const a = await nrs(s);
        const b = (await p2.locator(".jlist li [data-nr], .jlist li[data-nr]").evaluateAll((l: Element[]) => l.map((e) => e.getAttribute("data-nr") ?? ""))).filter(Boolean);
        w.fenster1 = a.slice(0, 20); w.fenster2 = b.slice(0, 20);
        soll(new Set(a.slice(0, 20)).size === 20, "Fenster 1: Nummern doppelt");
        soll(JSON.stringify(a.slice(0, 20).sort()) === JSON.stringify(b.slice(0, 20).sort()), "Fenster zeigen verschiedene Nummern");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("3 Zwei Geräte über Datei: weiter ab höchster Nummer; parallel gleiche Nummer → «a/b»", "laptop", async (w) => {
      const a = await neu(), b = await h.open({ uhr: UHR_T2_0730 });
      try {
        w.b_oeffnet = await dateiTauschen(a, b);
        for (let i = 0; i < 5; i++) await eintragenText(b, `H03 ${i + 1} Fz AN6`);
        const nb = await nrs(b);
        w.b_nummern = nb.slice(0, 5);
        w.a_oeffnet = await dateiTauschen(b, a);
        const na = await nrs(a);
        soll(new Set(na).size === na.length, "doppelte Anzeige-Nummer nach Zusammenführen");
        soll(!/Konflikt/.test(String(w.a_oeffnet)), `Bericht mit Konflikt: ${w.a_oeffnet}`);
        // beide offline je ein Eintrag → gleiche Nummer → Kennzeichnung
        await eintragenText(a, "H01 1 Fz AE5");
        await eintragenText(b, "H05 1 Fz AQ11");
        w.doppelt = await dateiTauschen(b, a);
        soll(/Nummern doppelt – als \d+a\/\d+b gekennzeichnet/.test(String(w.doppelt)), `Rückmeldung «${w.doppelt}»`);
        const na2 = await nrs(a);
        soll(na2.some((n) => /a$/.test(n)) && na2.some((n) => /b$/.test(n)), `keine «a/b»-Nummern: ${na2.slice(0, 4).join(", ")}`);
      } finally { await a.close(); await b.close(); }
    }));

    out.push(await aufgabe("4 Eingang bei ≥ 5 min Abstand", "laptop", async (w) => {
      const s = await neu();
      try {
        await eintragenText(s, "T2 0700 H02 2 Fz AK7");
        const z = await zeilenVon(s).filter({ hasText: /2 Fz AK7/ }).first().innerText();
        w.zeile = z;
        soll(/Eingang 07:30/.test(z), `Zeile ohne «Eingang 07:30»: ${z.slice(0, 80)}`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("5 Kürzel-Abfrage beim ersten Enter (?beispiel=leer)", "laptop", async (w) => {
      const s = await h.open({ query: "?beispiel=leer", uhr: UHR_T2_0730 });
      try {
        await feldVon(s).fill("H04 2 Fz in AK7 Rtg N");
        await feldVon(s).press("Enter");
        soll(await s.page.getByText("Wer erfasst?").first().isVisible().catch(() => false), "keine Abfrage «Wer erfasst?»");
        const k = s.page.getByLabel("Kürzel");
        await k.fill("ZZ");
        await k.press("Enter");
        await antwortzeit(async () => (await zeilenVon(s).count()) > 0, 1500);
        soll(await zeilenVon(s).count() === 1, "nicht eingetragen");
        soll(await s.page.getByText(/Schicht ZZ seit 07:30/).first().isVisible().catch(() => false), "Kopf ohne «Schicht ZZ seit 07:30»");
        await feldVon(s).fill("H02 1 Fz AK9");
        await feldVon(s).press("Enter");
        await s.page.waitForTimeout(300);
        w.zeilen = await zeilenVon(s).count();
        soll(w.zeilen === 2 && !(await s.page.getByText("Wer erfasst?").count()), "zweites Enter fragt nochmals");
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("6 Vermerke: dringend → Offen +1 → Erledigt → −1 → Rückgängig; Massnahme, weitergemeldet", "laptop", async (w) => {
      const s = await neu();
      try {
        const o0 = await offenZahl(s);
        await zeilenVon(s).first().click();
        await knopfVon(s, /^Mehr/).click();
        await s.page.getByRole("checkbox", { name: "Dringend" }).check();
        const o1 = await offenZahl(s);
        await s.page.getByLabel("Massnahme").fill("Zfhr orientiert");
        await s.page.getByLabel("Massnahme").press("Enter");
        await knopfVon(s, "jetzt an Bat").click();
        await s.page.keyboard.press("Escape");
        const z = await zeilenVon(s).first().innerText();
        await ansicht(s, "Offen");
        await s.page.locator(".jlist li").filter({ hasText: /./ }).first().click();
        await knopfVon(s, "Erledigt").click();
        const o2 = await offenZahl(s);
        await knopfVon(s, "Rückgängig").first().click();
        const o3 = await offenZahl(s);
        Object.assign(w, { offen: [o0, o1, o2, o3], zeile: z });
        soll(o1 === o0 + 1 && o2 === o0 && o3 === o0 + 1, `Offen ${o0} → ${o1} → ${o2} → ${o3}`);
        soll(/Massnahme: Zfhr orientiert/.test(z) && /weitergemeldet Bat/.test(z), `Zeile ohne Vermerke: ${z.slice(0, 100)}`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("7 Zusammenführen: A dringend + B korrigiert → 0 Konflikte, beides da", "laptop", async (w) => {
      const a = await neu(), b = await h.open({ uhr: UHR_T2_0730 });
      try {
        await dateiTauschen(a, b);
        await zeilenVon(a).first().click();
        await knopfVon(a, /^Mehr/).click();
        await a.page.getByRole("checkbox", { name: "Dringend" }).check();
        await a.page.keyboard.press("Escape");
        await zeilenVon(b).first().click();
        await knopfVon(b, "Korrigieren").click();
        await feldVon(b).fill("H05: 5 Pers in Linie AP11");
        await feldVon(b).press("Enter");
        w.bericht = await dateiTauschen(b, a);
        const z = await zeilenVon(a).filter({ hasText: /5 Pers in Linie/ }).first().innerText().catch(() => "");
        soll(!/Konflikt/.test(String(w.bericht)), `Konflikt: ${w.bericht}`);
        soll(/dringend/.test(z), `Korrektur ohne «dringend»: ${z.slice(0, 80)}`);
      } finally { await a.close(); await b.close(); }
    }));

    out.push(await aufgabe("8 Gestrichene zeigen und zurückholen (≤ 4 Aktionen)", "laptop", async (w) => {
      const s = await neu();
      try {
        const text = (await zeilenVon(s).first().innerText()).split("\n").find((l) => l.length > 8) ?? "";
        await zeilenVon(s).first().click();
        await knopfVon(s, "Löschen").click();
        await s.page.waitForTimeout(9000);
        let aktionen = 0;
        await s.page.getByRole("button", { name: /Gestrichene zeigen \(1\)/ }).or(s.page.getByRole("link", { name: /Gestrichene zeigen \(1\)/ })).first().click(); aktionen++;
        await zeilenVon(s).filter({ hasText: /gestrichen/ }).first().click(); aktionen++;
        await knopfVon(s, "Zurückholen").click(); aktionen++;
        w.aktionen = aktionen;
        const z = await zeilenVon(s).filter({ hasText: text.slice(0, 20) }).first().innerText().catch(() => "");
        soll(z && !/gestrichen/.test(z), `Zeile nicht zurück: ${z.slice(0, 60)}`);
        soll(aktionen <= 4, `${aktionen} Aktionen`);
      } finally { await s.close(); }
    }));

    out.push(await aufgabe("9 Aufheben über «Mehr …»: Zeichen weg, «hebt Nr … auf», Rückgängig bringt es zurück", "laptop", async (w) => {
      const s = await neu();
      try {
        const m0 = await markerVon(s);
        await zeilenVon(s).filter({ hasText: /Sperre in AG13/ }).first().click();
        await knopfVon(s, /^Mehr/).click();
        await knopfVon(s, /Aufgehoben \(jetzt\)/).click();
        await s.page.waitForTimeout(300);
        const m1 = await markerVon(s);
        const neuZ = await zeilenVon(s).filter({ hasText: /hebt Nr \S+ auf/ }).count();
        await knopfVon(s, "Rückgängig").first().click();
        await s.page.waitForTimeout(300);
        const m2 = await markerVon(s);
        Object.assign(w, { marker: [m0, m1, m2], zeile: neuZ });
        soll(m1 < m0 && m2 === m0 && neuZ > 0, `Marker ${m0} → ${m1} → ${m2}, Zeile «hebt auf» ${neuZ}`);
      } finally { await s.close(); }
    }));
    return out;
  },
};
export default spec;
