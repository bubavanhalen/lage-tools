/**
 * Einsatz-Szenario des Prüfers (Spez. MVP 3, Kap. 8.1): Auftrag, Rückfrage, Orientierung, AEIOU … erzeugen keine
 * falschen Zeichen und verschieben keine Trupps. `?beispiel`, Uhr T2 07:30, Kürzel BSP; Laptop und Tablet.
 * Je Fall: tippen → Zustand → Enter (gelb: zweimal) → Zeile (`data-art`) und Zeichen prüfen. Ausgabe e2e/out/arten.json.
 * Phase 0: Gerüst – rot, bis Pakete A/B/C fertig sind.
 *
 * Abweichung zur Tabelle in der Spez.: Zeiten 07:20 statt 10:20 (10:20 läge um 07:30 in der Zukunft und wäre «geht
 * nicht»); Fall 2 nach Entscheid 2 (AEIOU-E = Gesehenes) mit Melder vor «A:», dazu Fall 2b ohne Melder; die Nummer
 * der Rückfrage für Fall 14 wird gelesen (nicht 57).
 */
import { STANDORTE_T2_0730, UHR_T2_0730, ansicht, aufgabe, eintragenText, markerVon, soll, standortVon, zeilenVon, type Geraet, type Harness, type Session, type Spec, type TestResult } from "./lib.ts";

interface Fall {
  nr: string;
  text: string | ((m: Record<string, string>) => string);
  art: string;
  zustand: string[];
  /** erwartete Änderung der Markerzahl: 0, 1 (≥ +0 wegen Stapeln), −1; null = nur berichten */
  zeichen: 0 | 1 | -1 | null;
  /** Textstelle, an der die neue Zeile erkannt wird */
  zeile: string | RegExp;
  /** Trupps, deren Standort gleich bleiben muss */
  bleibt?: string[];
  /** Text in der Vorschau vor dem Eintragen */
  vorschau?: RegExp;
  weiter?: (s: Session, w: Record<string, unknown>, m: Record<string, string>) => Promise<void>;
}

async function offenEnthaelt(s: Session, text: string | RegExp, soll_: boolean): Promise<void> {
  await ansicht(s, "Offen");
  const da = await s.page.locator(".jlist li, [role=listitem]").filter({ hasText: text }).count().catch(() => 0);
  await ansicht(s, "Journal");
  soll(soll_ ? da > 0 : da === 0, `Offen ${soll_ ? "ohne" : "mit"} «${String(text)}»`);
}

const FAELLE: Fall[] = [
  { nr: "1", text: "Wann: 0720 Wer: H03 Was: 3 Pers bewaffnet Wo: AF8", art: "meldung", zustand: ["bereit"], zeichen: 1, zeile: /3 Pers bewaffnet/, vorschau: /gelesen als Meldezettel/ },
  { nr: "2", text: "H03 A: 0721 E: 3 Pers bewaffnet I: Rtg W O: AF8 C U: beobachten weiter", art: "meldung", zustand: ["bereit"], zeichen: 1, zeile: /beobachten weiter/, bleibt: ["H03"], vorschau: /gelesen als AEIOU/ },
  { nr: "2b", text: "A: 0722 E: H03 I: 3 Pers bewaffnet Rtg W O: AF8 C U: beobachten weiter", art: "meldung", zustand: ["pruefen"], zeichen: null, zeile: /E: H03/ },
  { nr: "3", text: "H03 meldet: um 0723 3 Pers bewaffnet in AF8", art: "meldung", zustand: ["bereit"], zeichen: 1, zeile: /um 0723/ },
  { nr: "4", text: "Kontakt! H02, Feuer aus AK9, 2 Schützen, wir halten", art: "meldung", zustand: ["bereit"], zeichen: 1, zeile: /Feuer aus AK9/, bleibt: ["H02"],
    weiter: async (s) => { soll(await zeilenVon(s).filter({ hasText: /Feuer aus AK9/ }).filter({ hasText: /dringend/ }).count() > 0, "Zeile ohne «dringend»"); } },
  { nr: "5", text: "H04 Rückfrage: Standort Det 2?", art: "rueckfrage", zustand: ["bereit"], zeichen: 0, zeile: /Standort Det 2\?/,
    weiter: async (s, _w, m) => {
      m.rueckfrage = (await zeilenVon(s).filter({ hasText: /Standort Det 2\?/ }).first().getAttribute("data-nr").catch(() => null)) ?? (await zeilenVon(s).filter({ hasText: /Standort Det 2\?/ }).first().locator("[data-nr]").first().getAttribute("data-nr").catch(() => "")) ?? "";
      await offenEnthaelt(s, /von H04/, true);
    } },
  { nr: "6", text: "Auftrag an H01: Beo NAI 1 bis 1200", art: "auftrag", zustand: ["bereit"], zeichen: 0, zeile: /Beo NAI 1/, bleibt: ["H01"],
    weiter: async (s) => { soll(await zeilenVon(s).filter({ hasText: /Beo NAI 1/ }).filter({ hasText: /bis 12:00/ }).count() > 0, "«bis 12:00» fehlt"); await offenEnthaelt(s, /an H01/, true); } },
  { nr: "7", text: "H05 hat Stellungswechsel nach AQ12 befohlen erhalten", art: "auftrag", zustand: ["pruefen"], zeichen: 0, zeile: /befohlen erhalten/, bleibt: ["H05"] },
  { nr: "8", text: "Quittung H02 Auftrag erhalten", art: "notiz", zustand: ["bereit"], zeichen: 0, zeile: /Quittung H02/ },
  { nr: "9", text: "Bat: Feind Kp-Stärke erwartet aus Rtg Belp ab 2200", art: "orientierung", zustand: ["bereit"], zeichen: 0, zeile: /Kp-Stärke/,
    weiter: async (s) => { soll(await s.page.getByText(/Bataillon/).count() === 0, "«Bataillon» als Zeichen gelesen"); } },
  { nr: "10", text: "H05 1 Verwundeter, Sanität angefordert", art: "meldung", zustand: ["bereit"], zeichen: null, zeile: /Verwundeter/,
    weiter: async (s) => { const z = await zeilenVon(s).filter({ hasText: /Verwundeter/ }).first().innerText(); soll(!/Feind|Unklar/.test(z), `als Feind/Unklar: ${z.slice(0, 60)}`); soll(/dringend/.test(z), "nicht dringend"); } },
  { nr: "11", text: "H03 wir weichen aus nach AG9", art: "meldung", zustand: ["bereit", "pruefen"], zeichen: null, zeile: /weichen aus/,
    weiter: async (s) => { const z = await zeilenVon(s).filter({ hasText: /weichen aus/ }).first().innerText(); soll(!/Feind/.test(z), "Feind-Zeichen in AG9"); } },
  { nr: "12", text: "H02 Vbk i.O.", art: "vbk", zustand: ["bereit"], zeichen: 0, zeile: /Vbk i\.O\./, bleibt: ["H02"],
    weiter: async (s) => { soll(await zeilenVon(s).filter({ hasText: /Verbindung H02 gut/ }).count() > 0, "«Verbindung H02 gut» fehlt"); } },
  { nr: "13", text: "H03 keine Verbindung", art: "vbk", zustand: ["bereit"], zeichen: 0, zeile: /keine Verbindung/,
    weiter: async (s) => { await offenEnthaelt(s, /H03: keine Verbindung/, true); } },
  { nr: "14", text: (m) => `Antwort zu ${m.rueckfrage || "57"}: Det 2 in AJ8`, art: "meldung", zustand: ["bereit"], zeichen: 1, zeile: /Det 2 in AJ8/,
    weiter: async (s) => { await offenEnthaelt(s, /von H04/, false); soll(await zeilenVon(s).filter({ hasText: /beantwortet/ }).count() > 0, "Rückfrage ohne «beantwortet»"); } },
  { nr: "15", text: "H04 Sperre AG13 aufgehoben", art: "meldung", zustand: ["bereit"], zeichen: -1, zeile: /AG13 aufgehoben/,
    weiter: async (s) => { soll(await zeilenVon(s).filter({ hasText: /hebt Nr \S+ auf/ }).count() > 0, "Zeile «hebt Nr … auf» fehlt"); } },
];

async function lauf(h: Harness, geraet: Geraet): Promise<TestResult[]> {
  const out: TestResult[] = [];
  const s = await h.open({ query: "?beispiel", geraet, uhr: UHR_T2_0730 });
  const merk: Record<string, string> = {};
  try {
    for (const f of FAELLE) {
      out.push(await aufgabe(`${f.nr} ${typeof f.text === "string" ? f.text : "Antwort zu …"}`, geraet, async (w) => {
        // Fehler sammeln statt abbrechen: der Fall wird trotzdem eingetragen (spätere Fälle bauen darauf auf)
        const fehl: string[] = [];
        const pruef = (c: unknown, t: string) => { if (!c) fehl.push(t); };
        const text = typeof f.text === "string" ? f.text : f.text(merk);
        const m0 = await markerVon(s);
        if (f.vorschau) {
          await s.page.getByPlaceholder("Was wurde gemeldet?").fill(text);
          await s.page.waitForTimeout(150);
          w.vorschau = await s.page.getByText(f.vorschau).count();
          pruef(w.vorschau, `Vorschau ohne ${f.vorschau}`);
        }
        const r = await eintragenText(s, text);
        await s.page.waitForTimeout(250);
        const m1 = await markerVon(s);
        const zeile = zeilenVon(s).filter({ hasText: f.zeile }).first();
        const art = await zeile.getAttribute("data-art").catch(() => null) ?? await zeile.locator("[data-art]").first().getAttribute("data-art").catch(() => null);
        Object.assign(w, { zustand: r.zustand, art, marker: [m0, m1] });
        pruef(f.zustand.includes(r.zustand ?? ""), `Zustand «${r.zustand}» statt ${f.zustand.join("/")}`);
        pruef(await zeile.count() > 0, "neue Zeile nicht gefunden");
        pruef(art === f.art, `data-art «${art}» statt «${f.art}»`);
        if (f.zeichen === 0) pruef(m1 === m0, `Zeichen ${m0} → ${m1} (soll gleich)`);
        if (f.zeichen === 1) pruef(m1 >= m0, `Zeichen ${m0} → ${m1} (soll +1)`);
        if (f.zeichen === -1) pruef(m1 < m0, `Zeichen ${m0} → ${m1} (soll −1)`);
        for (const t of f.bleibt ?? []) {
          const nachher = await standortVon(s, t);
          w[`standort_${t}`] = nachher;
          pruef(nachher.includes(STANDORTE_T2_0730[t]!), `${t} verschoben: «${nachher}» (soll ${STANDORTE_T2_0730[t]})`);
        }
        if (f.weiter) await f.weiter(s, w, merk).catch((e: Error) => fehl.push(e.message));
        soll(!fehl.length, fehl.join("; "));
      }));
    }
    out.push(await aufgabe("keine Konsolenfehler", geraet, async (w) => { w.fehler = s.fehler; soll(!s.fehler.length, s.fehler.slice(0, 2).join(" | ")); }));
    await h.shot(s.page, `arten/ende_${geraet}`);
  } finally { await s.close(); }
  return out;
}

const spec: Spec = {
  name: "arten",
  async run(h) {
    return [...await lauf(h, "laptop"), ...await lauf(h, "tablet")];
  },
};
export default spec;
