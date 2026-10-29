/**
 * Erstbenutzer-Testskript (Spez. MVP 1, Kap. 7.1): 8 Aufgaben, Laptop (Maus/Tastatur) und Tablet (Touch, keine
 * Tastenkürzel). Aktionen nur über sichtbaren Klartext. Pro Aufgabe: Aktionen, KLM-Schätzung, UI-Antwortzeit.
 * Ausgabe: e2e/out/erstbenutzer.json. Darf bis zum Ende von MVP 1 rot sein.
 *
 * Uhr: T2 07:30 des Beispiels Bern (Tage 2030-05-14/15, siehe demoExercise) – die Spezifikation nennt 2026-05-15,
 * das Beispiel liegt aber im Jahr 2030.
 */
import { Klm, UHR_T2_0730, antippen, antwortzeit, aufgabe, menue, soll, type Geraet, type Harness, type Session, type Spec, type TestResult } from "./lib.ts";

const feld = (s: Session) => s.page.getByPlaceholder("Was wurde gemeldet?");
const zeilen = (s: Session) => s.page.locator(".jlist li");
const zustand = (s: Session) => s.page.locator("[data-zustand]").first();
const lagezeit = (s: Session) => s.page.locator(".app").first().getAttribute("data-lagezeit");
const knopf = (s: Session, name: string | RegExp) => s.page.getByRole("button", { name, exact: typeof name === "string" });

/** Enter (Laptop) bzw. «Eintragen» antippen (Tablet) */
async function eintragen(s: Session, k: Klm): Promise<void> {
  if (s.geraet === "tablet") { await antippen(s, knopf(s, /^(Eintragen|Trotzdem eintragen|Korrektur speichern)/)); k.zeigen(); }
  else { await feld(s).press("Enter"); k.taste(); }
}
async function tippen(s: Session, k: Klm, text: string): Promise<void> {
  if (s.geraet === "tablet") await feld(s).tap();
  await feld(s).fill(text);
  k.tippen(text);
}
const anzahl = (s: Session) => zeilen(s).count();
const markerZahl = (s: Session) => s.page.locator(".leaflet-marker-pane > *").count();

async function geraetLauf(h: Harness, geraet: Geraet): Promise<TestResult[]> {
  const out: TestResult[] = [];

  // ---------- 1–3: leere Vorbereitung ----------
  let s = await h.open({ query: "?beispiel=leer", geraet, uhr: UHR_T2_0730 });
  // MVP 3 (Kap. 2.3/3.6): Schichtbeginn mit Kürzel gehört nicht zu den Aufgaben – vorher über Menü «Kürzel ändern …»
  // setzen (sonst fragt das erste Enter «Wer erfasst?»; geprüft in lvz.spec.ts Nr. 5 und inventar.spec.ts)
  await menue(s, /^Kürzel ändern/);
  await s.page.getByRole("textbox", { name: "Kürzel", exact: true }).fill("ZZ");
  await antippen(s, s.page.getByRole("button", { name: /^Neue Schicht beginnen/ }));
  await s.page.waitForTimeout(200);
  out.push(await aufgabe("1 Erste Meldung", geraet, async (w) => {
    const k = new Klm();
    const vorher = await markerZahl(s);
    await antippen(s, knopf(s, "H04")); k.zeigen();
    await tippen(s, k, "2 Fz in AK7 Rtg N");
    k.entscheid();
    soll(await zustand(s).getAttribute("data-zustand") === "bereit", "Zustand vor Enter nicht «bereit»");
    soll(await s.page.getByText(/Bereit/).first().isVisible(), "Text «Bereit» fehlt");
    const n0 = await anzahl(s);
    const t0 = Date.now();
    await eintragen(s, k);
    const ms = await antwortzeit(async () => (await anzahl(s)) > n0);
    w.antwort_ms = ms;
    const top = await zeilen(s).first().innerText();
    soll(/H04/.test(top) && /AK7/.test(top), `oberste Zeile «${top.slice(0, 60)}» ohne H04/AK7`);
    soll((await markerZahl(s)) > vorher, "kein neues Zeichen auf der Karte");
    soll(await s.page.getByText(/gespeichert 07:3\d/).first().isVisible(), "Kopf «✓ gespeichert 07:3x» fehlt");
    Object.assign(w, k.werte(), { gesamt_ms: Date.now() - t0 });
    soll(k.aktionen <= 3 && k.sekunden <= 20 && ms <= 300, `Budget: ${k.aktionen} Aktionen, KLM ${k.sekunden.toFixed(1)} s, ${ms} ms`);
  }));
  out.push(await aufgabe("2 Meldung ohne Trupp", geraet, async (w) => {
    const k = new Klm();
    await tippen(s, k, "3 Pers bei AJ7");
    const n0 = await anzahl(s);
    await eintragen(s, k);
    await s.page.waitForTimeout(300);
    soll((await anzahl(s)) === n0, "1. Enter hat ohne Trupp eingetragen");
    soll(await s.page.getByText(/Nochmals Enter/).first().isVisible(), "Text «Nochmals Enter» fehlt");
    k.entscheid();
    await antippen(s, knopf(s, "H02")); k.zeigen();
    soll(await zustand(s).getAttribute("data-zustand") === "bereit", "nach Chip nicht «bereit»");
    await eintragen(s, k);
    w.antwort_ms = await antwortzeit(async () => (await anzahl(s)) > n0);
    const top = await zeilen(s).first().innerText();
    soll(/H02/.test(top) && /AJ7/.test(top), `oberste Zeile «${top.slice(0, 60)}» ohne H02/AJ7`);
    Object.assign(w, k.werte());
    soll(k.aktionen <= 4, `Budget: ${k.aktionen} Aktionen`);
  }));
  out.push(await aufgabe("3 Unmögliches PQ", geraet, async (w) => {
    const k = new Klm();
    await tippen(s, k, "H04 2 Fz in AK77");
    soll(await zustand(s).getAttribute("data-zustand") === "geht-nicht", "Zustand nicht «geht nicht»");
    soll(await s.page.getByText(/AK77/).first().isVisible(), "«AK77» nicht genannt");
    const n0 = await anzahl(s);
    await eintragen(s, k).catch(() => { /* gesperrter Knopf ist richtig */ });
    await s.page.waitForTimeout(300);
    soll((await anzahl(s)) === n0, "Enter hat trotz «geht nicht» eingetragen");
    k.entscheid();
    await tippen(s, k, "H04 2 Fz in AK7");
    await eintragen(s, k);
    w.antwort_ms = await antwortzeit(async () => (await anzahl(s)) > n0);
    soll(/AK7\b/.test(await zeilen(s).first().innerText()), "keine Zeile mit AK7");
    Object.assign(w, k.werte());
    soll(k.aktionen <= 4, `Budget: ${k.aktionen} Aktionen`);
  }));
  w0(out, s);
  await s.close();

  // ---------- 4–8: Beispiel Bern ----------
  s = await h.open({ query: "?beispiel", geraet, uhr: UHR_T2_0730 });
  const zeile0720 = () => zeilen(s).filter({ hasText: "07:20" }).filter({ hasText: /NAI 2|AK9/ }).first();
  out.push(await aufgabe("4 Falsche Meldung korrigieren", geraet, async (w) => {
    const k = new Klm();
    await antippen(s, zeile0720()); k.zeigen();
    await antippen(s, knopf(s, "Korrigieren")); k.zeigen();
    soll(await s.page.getByText(/Korrektur von T2 07:20/).first().isVisible(), "«Korrektur von T2 07:20» fehlt");
    await tippen(s, k, "H03 1 Fz in AK9 Rtg N");
    soll(await s.page.getByText(/\(vorher NAI 2\)/).first().isVisible(), "«(vorher NAI 2)» fehlt");
    k.entscheid();
    await eintragen(s, k);
    await s.page.waitForTimeout(300);
    const z = await zeile0720().innerText();
    soll(/AK9/.test(z) && /korrigiert/.test(z) && /07:20/.test(z), `Zeile «${z.slice(0, 80)}» ohne AK9/korrigiert/07:20`);
    // zweiter Durchgang: Korrigieren → Esc
    const vorher = await zeile0720().innerText();
    await antippen(s, zeile0720());
    await antippen(s, knopf(s, "Korrigieren"));
    if (geraet === "tablet") await antippen(s, knopf(s, /Abbrechen/)); else await feld(s).press("Escape");
    soll((await zeile0720().innerText()) === vorher, "Esc hat die Zeile verändert");
    soll((await feld(s).inputValue()) === "", "Feld nach Esc nicht leer");
    soll(s.downloads.length === 0, `Datei-Download beim Korrigieren: ${s.downloads.join(", ")}`);
    Object.assign(w, k.werte());
    soll(k.aktionen <= 5 && k.sekunden <= 45, `Budget: ${k.aktionen} Aktionen, KLM ${k.sekunden.toFixed(1)} s`);
  }));
  out.push(await aufgabe("5 Streichen und zurückholen", geraet, async (w) => {
    const k = new Klm();
    const z = zeilen(s).first();
    const text = await z.innerText();
    const n0 = await anzahl(s);
    await antippen(s, z); k.zeigen();
    await antippen(s, knopf(s, "Streichen")); k.zeigen();
    soll((await anzahl(s)) === n0 - 1, "Zeile nicht weg");
    await antippen(s, knopf(s, "Rückgängig")); k.zeigen();
    await s.page.waitForTimeout(200);
    soll((await anzahl(s)) === n0 && (await zeilen(s).first().innerText()) === text, "Zeile nicht gleich zurück");
    Object.assign(w, k.werte());
    soll(k.aktionen <= 3, `Budget: ${k.aktionen} Aktionen`);
  }));
  out.push(await aufgabe("6 Wo war H03 zuletzt?", geraet, async (w) => {
    const k = new Klm();
    if (geraet === "tablet") { await antippen(s, s.page.getByRole("searchbox").or(s.page.getByPlaceholder(/Suchen/)).first()); k.zeigen(); }
    else { await s.page.keyboard.press("Control+k"); k.taste(); }
    await s.page.keyboard.type("H03"); k.tippen("H03");
    const vorschlag = s.page.getByRole("option").filter({ hasText: /H03 – zuletzt \d\d:\d\d/ }).first();
    soll(await vorschlag.isVisible(), "Vorschlag «H03 – zuletzt hh:mm» fehlt");
    k.entscheid();
    await antippen(s, vorschlag); k.zeigen();
    soll((await lagezeit(s)) === "live", "Lage nicht mehr LIVE");
    Object.assign(w, k.werte());
    soll(k.aktionen <= 3 && k.sekunden <= 10, `Budget: ${k.aktionen} Aktionen, KLM ${k.sekunden.toFixed(1)} s`);
  }));
  out.push(await aufgabe("7 Lage vor 2 h, dann weiter", geraet, async (w) => {
    const k = new Klm();
    const m0 = await markerZahl(s);
    await antippen(s, knopf(s, /Zurückblicken/)); k.zeigen();
    const band = s.page.getByText(/RÜCKBLICK · Lage um/).first();
    w.band_ms = await antwortzeit(() => band.isVisible(), 1000);
    soll((w.band_ms as number) <= 300, `Band erst nach ${w.band_ms} ms`);
    // jetzt − 1 h (06:30) → −1 h = 05:30 (die Spez. nennt «zweimal»; ab «jetzt − 1 h» genügt einmal)
    await antippen(s, knopf(s, "−1 h")); k.zeigen();
    soll(/T2 05:30/.test(await band.innerText()), "Band zeigt nicht T2 05:30");
    k.entscheid();
    const masse = await band.evaluate((e: HTMLElement) => {
      let b: HTMLElement = e; while (b.parentElement && b.getBoundingClientRect().height < 44 && b.parentElement.getBoundingClientRect().height < 80) b = b.parentElement;
      const cs = getComputedStyle(e); const r = b.getBoundingClientRect();
      return { h: r.height, top: r.top, fs: parseFloat(cs.fontSize) };
    });
    w.band = masse;
    soll(masse.h >= 44 && masse.fs >= 20, `Band ${masse.h} px hoch, Schrift ${masse.fs} px`);
    soll((await lagezeit(s)) === "rueckblick", "data-lagezeit nicht «rueckblick»");
    soll((await markerZahl(s)) < m0, "Karte zeigt nicht weniger Zeichen");
    await s.page.clock.runFor(120_000);
    await s.page.waitForTimeout(300);
    soll((await lagezeit(s)) === "live", "nach 120 s nicht LIVE");
    soll(await s.page.getByText(/Zurück auf LIVE/).first().isVisible(), "Meldung «Zurück auf LIVE» fehlt");
    // Eintragen im Rückblick → sofort LIVE
    await antippen(s, knopf(s, /Zurückblicken/));
    await tippen(s, new Klm(), "H01 Beo Stao bezogen AD7");
    await eintragen(s, new Klm());
    await s.page.waitForTimeout(200);
    soll((await lagezeit(s)) === "live", "Eintragen im Rückblick: nicht LIVE");
    // Neuladen im Rückblick → LIVE
    await antippen(s, knopf(s, /Zurückblicken/));
    await s.page.reload(); await s.page.waitForTimeout(1500);
    soll((await lagezeit(s)) === "live", "Neuladen im Rückblick: nicht LIVE");
    Object.assign(w, k.werte());
    soll(k.aktionen <= 4, `Budget: ${k.aktionen} Aktionen`);
  }));
  out.push(await aufgabe("8 Was Rot?", geraet, async (w) => {
    const k = new Klm();
    const umschalter = s.page.getByRole("tab", { name: /Was Rot vorhaben könnte/ }).or(knopf(s, /Was Rot vorhaben könnte/)).first();
    const zahl = async () => +((/(\d+)/.exec(await umschalter.innerText()) ?? [])[1] ?? NaN);
    await antippen(s, umschalter); k.zeigen();
    soll(await s.page.getByText(/Am wahrscheinlichsten/i).first().isVisible(), "Karte «Am wahrscheinlichsten» fehlt");
    k.entscheid();
    const panel = s.page.getByRole("tabpanel").first();
    const text = await panel.evaluate((e: HTMLElement) => {
      const c = e.cloneNode(true) as HTMLElement;
      c.querySelectorAll("details:not([open])").forEach((d) => d.remove());
      return c.innerText;
    });
    const codes = /\b[A-E][1-6]\b|Ziff|TF 17|GS 17|53\.005|Indikator|COA/.exec(text);
    soll(!codes, `Code im Panel: «${codes?.[0]}»`);
    const n0 = await zahl();
    await antippen(s, panel.getByRole("button", { name: /⚠|•/ }).first()); k.zeigen();
    await antippen(s, knopf(s, "Trifft nicht zu")); k.zeigen();
    soll((await zahl()) === n0 - 1, "Zahl am Umschalter nicht −1");
    await antippen(s, knopf(s, "Rückgängig")); k.zeigen();
    soll((await zahl()) === n0, "Rückgängig stellt nicht her");
    Object.assign(w, k.werte());
    soll(k.aktionen <= 4, `Budget: ${k.aktionen} Aktionen`);
  }));
  w0(out, s);
  await s.close();
  return out;
}

/** Konsolenfehler als eigenes Ergebnis */
function w0(out: TestResult[], s: Session): void {
  out.push({ name: "keine Konsolenfehler", geraet: s.geraet, ok: s.fehler.length === 0, fehler: s.fehler.slice(0, 5).join(" | ") || undefined });
  s.fehler.length = 0;
}

const spec: Spec = {
  name: "erstbenutzer",
  async run(h) {
    const res: TestResult[] = [];
    for (const g of ["laptop", "tablet"] as const) {
      const r = await geraetLauf(h, g);
      const klm = r.reduce((a, x) => a + (typeof x.werte?.klm_s === "number" ? x.werte.klm_s : 0), 0);
      res.push(...r, { name: "Gesamt: alle Aufgaben ohne Fehlversuch, KLM ≤ 3 min", geraet: g, ok: r.every((x) => x.ok) && klm <= 180, werte: { klm_summe_s: Math.round(klm) } });
    }
    return res;
  },
};
export default spec;
