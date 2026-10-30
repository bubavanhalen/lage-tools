/**
 * Lange Beispielübung (fiktiv, Raum Bern) für Leistung, Übergabe und Druck (Spez. MVP 3, Kap. 2.10, 8.5, 8.6):
 * 800 Einträge über 4 Tage (T1 15.05.2030 06:00 – T4 18.05.2030 07:30), alle Eintragsarten, 1 Schichtbeginn und
 * 12 Übergaben (alle 6 h, Kürzel BSP/MU/ZZ, zuletzt BSP ab T4 06:00), dazu dringende, weitergemeldete, erledigte,
 * korrigierte, gestrichene und aufgehobene Einträge. **Deterministisch** (gleicher `seed` → gleiche Übung, auch IDs und
 * Zeitstempel; Zeitzone fest +02:00) und **nur fiktive Daten**: Raster BERN, NAI 1–3 und Trupps aus `demoExercise`.
 *
 * Testzugang in der App: `?beispiel=lang` (packages/ui/src/beispiel.ts).
 */
import { artOf } from "./arten";
import { demoExercise } from "./demo";
import { eventFromDraft, lastPosition, parseMeldung } from "./journal";
import { zeitBis, zeitCmp } from "./clock";
import type { EntryArt, EventRevision, Exercise, LageEvent, SchichtWechsel } from "./model";

export const DEMO_LANG_ID = "ex-beispiel-bern-lang";
export const DEMO_LANG_DAYS = ["2030-05-15", "2030-05-16", "2030-05-17", "2030-05-18"];
/** feste Zeitzone der Beispielübung (Sommerzeit) – macht Zeitstempel unabhängig vom Gerät */
const OFF = "+02:00";
/** Gerät, das die Beispielübung «erfasst» hat */
export const DEMO_LANG_DEVICE = "dev-beispiel";
/** Kürzel der Schichten (fiktiv), die letzte Schicht (ab T4 06:00) führt BSP */
export const DEMO_LANG_KUERZEL = ["BSP", "MU", "ZZ"] as const;

/** kleiner, deterministischer Zufall (mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO lokal «YYYY-MM-DDTHH:MM» aus Minuten seit T1 00:00 */
function isoAt(min: number, days: string[]): string {
  const d = Math.floor(min / 1440), m = min % 1440;
  return `${days[d]}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
const utcOf = (t: string, plusSec = 0) => new Date(Date.parse(`${t}:00${OFF}`) + plusSec * 1000).toISOString();
const hhmm = (t: string) => t.slice(11, 16).replace(":", "");

/** Zellen im Raster BERN (wie im Beispiel), keine echten Standorte */
const CELLS = ["AE5", "AK9", "AP4", "AF12", "AQ11", "AN6", "AH10", "AJ8", "AB6", "AE8", "AO5", "AT3", "AM9", "AL9", "AP10", "AM5", "AH12", "AF13", "AG13", "AJ9", "AP11", "AD7", "AC6", "AN10", "AR10", "AO7"];
const DIRS = ["N", "S", "O", "W", "NW", "SW"];
const TRUPPS = ["H01", "H02", "H03", "H04", "H05"];
/** Grundstandorte der Trupps (wechseln einmal pro Tag) */
const STAO: Record<string, string[]> = {
  H01: ["AE5 C", "AC6 B"], H02: ["AK9 B", "AL9 A"], H03: ["AP4 D", "AO5 B"], H04: ["AF12 A", "AG13 C"], H05: ["AQ11 C", "AP10 D"],
};

type Plan =
  | { art: "meldung"; text: string; parse?: string }
  | { art: Exclude<EntryArt, "meldung">; text: string; melder?: string; an?: string; quelle?: string; frist?: string; vbk?: LageEvent["vbk"]; orte?: string[] };

export function demoLang(o: { meldungen?: number; tage?: number; seed?: number } = {}): Exercise {
  const total = o.meldungen ?? 800;
  const tage = Math.max(1, Math.min(o.tage ?? 4, DEMO_LANG_DAYS.length));
  const days = DEMO_LANG_DAYS.slice(0, tage);
  const r = rng(o.seed ?? 20300515);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const base = demoExercise();
  const ex: Exercise = {
    ...base,
    id: DEMO_LANG_ID,
    name: `Beispiel Bern lang (fiktiv, ${tage} Tage)`,
    days: [...days],
    tz: { zone: "Europe/Zurich", offset: OFF },
    createdAt: utcOf(`${days[0]}T05:00`),
    events: [],
    attachments: [],
    hintDecisions: {},
    klassifizierung: "INTERN",
    // feste IDs statt Zeit+Zufall (deterministisch)
    sheets: base.sheets.map((x, i) => ({ ...x, id: `blatt-lang-${i}` })),
    areas: base.areas.map((a, i) => ({ ...a, id: `flaeche-lang-${i}` })),
  };
  // Zeitachse: T1 06:00 bis letzter Tag 07:30
  const start = 6 * 60, end = (tage - 1) * 1440 + 7 * 60 + 30;
  const span = end - start;
  const times: number[] = [];
  for (let i = 0; i < total; i++) {
    const ideal = start + Math.round((i * span) / Math.max(1, total - 1));
    const jitter = i === 0 || i === total - 1 ? 0 : Math.round((r() - 0.5) * 4);
    times.push(Math.min(end, Math.max(times[i - 1] ?? start, ideal + jitter)));
  }
  // Schichten: Beginn T1 06:00, Übergabe alle 6 h (12 bei 4 Tagen), zuletzt BSP
  const wechselZeiten: number[] = [];
  for (let m = start; m <= end; m += 360) wechselZeiten.push(m);
  const nWechsel = wechselZeiten.length;
  const kuerzelOf = (k: number) => DEMO_LANG_KUERZEL[(((k - (nWechsel - 1)) % 3) + 3) % 3]!;
  const schichtAt = (min: number) => { let k = 0; for (let i = 0; i < nWechsel; i++) if (wechselZeiten[i]! <= min) k = i; return k; };

  const events: LageEvent[] = [];
  const ctx = (t: string) => ({
    sheets: ex.sheets, areas: ex.areas, units: ex.units, days, day: t.slice(0, 10), now: new Date(Date.parse(`${isoAt(end, days)}:00${OFF}`)),
    lastPos: (u: string, s: LageEvent["side"]) => lastPosition(events, s, u),
  });
  const offeneAuftraege: LageEvent[] = [];
  let letzteGestrichen = false;
  let letzteKorrigiert = false;
  const offeneRueckfragen: LageEvent[] = [];
  const sperren: LageEvent[] = [];
  let tagStao = 0;
  let lastCreated = 0;

  for (let i = 0; i < total; i++) {
    const min = times[i]!;
    const t = isoAt(min, days);
    const tag = `T${Math.floor(min / 1440) + 1}`;
    const kuerzel = kuerzelOf(schichtAt(min));
    const x = r();
    const tr = pick(TRUPPS);
    let plan: Plan;
    const dayIdx = Math.floor(min / 1440);
    if (i < TRUPPS.length) {
      plan = { art: "meldung", text: `${tag} ${hhmm(t)} ${TRUPPS[i]} Beo Stao ${STAO[TRUPPS[i]!]![0]!}` };
    } else if (dayIdx !== tagStao && i < total - 5) {
      // zu Tagesbeginn: Stellungswechsel eines Trupps (eigene Lage)
      tagStao = dayIdx;
      plan = { art: "meldung", text: `${tag} ${hhmm(t)} ${tr} Beo Stao ${STAO[tr]![dayIdx % 2]!}` };
    } else if (x < 0.04) {
      const nai = pick(["NAI 1", "NAI 2", "NAI 3"]);
      const frist = isoAt(min + 60 + Math.floor(r() * 120), days);
      plan = { art: "auftrag", text: `Auftrag an ${tr}: Beo ${nai} bis ${hhmm(frist)}`, an: tr, frist, orte: [nai] };
    } else if (x < 0.065) {
      plan = { art: "rueckfrage", text: `${tr} Rückfrage: Standort ${pick(["Det 1", "Det 2"])}?`, melder: tr };
    } else if (x < 0.095 && offeneRueckfragen.length) {
      const q = offeneRueckfragen.shift()!;
      plan = { art: "meldung", text: `Antwort zu ${q.nr}: ${pick(["Det 1", "Det 2"])} in ${pick(CELLS)}`, parse: `${tag} ${hhmm(t)} ${q.melder ?? tr}: ${pick(["Det 1", "Det 2"])} 2 Pers ${pick(CELLS)}` };
      (plan as { bezug?: LageEvent }).bezug = q;
    } else if (x < 0.11) {
      plan = { art: "orientierung", text: pick(["Bat: Feind Kp-Stärke erwartet aus Rtg Belp ab 2200", "Kp: Ablösung der Trupps um 1400", "Bat: Lagerapport 1800 im KP"]), quelle: "Bat" };
      if (plan.text.startsWith("Kp")) plan.quelle = "Kp";
    } else if (x < 0.15) {
      const v: LageEvent["vbk"] = r() < 0.85 ? "gut" : r() < 0.6 ? "schlecht" : "keine";
      plan = { art: "vbk", text: v === "keine" ? `${tr} keine Verbindung` : `${tr} Vbk ${v === "gut" ? "i.O." : "schlecht"}`, melder: tr, vbk: v };
    } else if (x < 0.165 && offeneAuftraege.length) {
      const a = offeneAuftraege[0]!;
      plan = { art: "notiz", text: `Quittung ${a.an} Auftrag erhalten`, melder: a.an };
      (plan as { bezug?: LageEvent }).bezug = a;
    } else if (x < 0.175) {
      plan = { art: "notiz", text: `Notiz: Funkgerät ${tr} Akku gewechselt` };
    } else if (x < 0.19 && sperren.length) {
      const s = sperren.shift()!;
      const ort = s.nai ?? s.cells?.[0] ?? "";
      plan = { art: "meldung", text: `${s.melder ?? "H05"} Sperre ${ort} aufgehoben` };
      (plan as { hebt?: LageEvent }).hebt = s;
    } else {
      const c = pick(CELLS), d = pick(DIRS);
      const lines = [
        `H03: 1 Fz in NAI 2 Rtg ${pick(["N", "S"])}`,
        `H03: 1 Fz in NAI 2 Rtg ${pick(["N", "S"])}`,
        `${tr}: ${1 + Math.floor(r() * 4)} Pers ${c} Rtg ${d}`,
        `${tr}: ${1 + Math.floor(r() * 3)} Fz ${c} Rtg ${d}`,
        `H03: Det 1 2 Fz ${c} Rtg ${d}`,
        `H02: Det 2 ${2 + Math.floor(r() * 3)} Pers ${c}`,
        `H05: Drohne über NAI 3`,
        `H05: Sperre aus Baumstämmen in NAI 3, Strasse blockiert`,
        `H03: 1 ziv Fz (weisser Lieferwagen) AN6 Rtg ${pick(["N", "S"])}`,
        `${tr} 3 Pers bei ${c}, Zugehörigkeit unklar`,
        `H02: 2 Kpz AK9 Rtg W`,
        `H04: gn Sperre in AG13`,
      ];
      plan = { art: "meldung", text: `${tag} ${hhmm(t)} ${pick(lines)}` };
    }

    const nr = i + 1;
    // Eingang kurz nach dem Ereignis, ab und zu 6 min später («Eingang 07:40»); Nummern steigen mit dem Eingang
    const createdAt = new Date(Math.max(Date.parse(utcOf(t, 20 + Math.floor(r() * 30) + (r() < 0.05 ? 360 : 0))), lastCreated + 1000)).toISOString();
    lastCreated = Date.parse(createdAt);
    let ev: LageEvent;
    if (plan.art === "meldung") {
      const d = parseMeldung(plan.parse ?? plan.text, ctx(t));
      ev = eventFromDraft({ ...d, t, text: plan.parse ? plan.text : d.text }, DEMO_LANG_DEVICE, new Date(createdAt), { nr, kuerzel });
      const bez = (plan as { bezug?: LageEvent }).bezug;
      if (bez) { ev.bezug = bez.id; ev.bezugArt = "antwort"; }
      const hebt = (plan as { hebt?: LageEvent }).hebt;
      if (hebt) {
        // Aufhebung: kein Zeichen, Ort nur als Text (Kap. 3.5)
        const { pos: _p, cells: _c, nai: _n, shape: _s, where: _w, label: _l, count: _k, dir: _d, ...rest } = ev;
        ev = { ...rest, unit: "", sym: "einheit", desc: "Sperre aufgehoben", hebtAuf: hebt.id, orte: [hebt.nai ?? hebt.cells?.[0] ?? ""].filter(Boolean) };
      }
    } else {
      const d = parseMeldung(`${tag} ${hhmm(t)} Notiz`, ctx(t));
      ev = eventFromDraft({
        ...d, t, text: plan.text, art: plan.art, artFrom: "text", melder: plan.melder ?? "", side: "blau", aff: "F", sym: "einheit", desc: undefined, count: undefined,
        an: plan.an, quelle: plan.quelle, frist: plan.frist, vbk: plan.vbk, orte: plan.orte,
      },
        DEMO_LANG_DEVICE, new Date(createdAt), { nr, kuerzel });
      const bez = (plan as { bezug?: LageEvent }).bezug;
      if (bez) { ev.bezug = bez.id; ev.bezugArt = "quittung"; }
    }
    ev.id = `${Date.parse(createdAt).toString(36).padStart(9, "0")}lang${nr.toString(36).padStart(4, "0")}`;
    ev.tReported = isoAt(Math.min(end, min + Math.floor((Date.parse(createdAt) - Date.parse(utcOf(t))) / 60000)), days);
    ev.tOffset = OFF;
    ev.updatedAt = createdAt;

    // Vermerke und Bearbeitungen (fiktiv, gestreut)
    const y = r();
    const stamp = <T>(v: T, plusMin: number) => ({ v, at: utcOf(t, plusMin * 60 + 30), device: DEMO_LANG_DEVICE, von: kuerzel });
    if (artOf(ev) === "meldung" && ev.side === "rot" && y < 0.025) {
      // dringend und weitergemeldet; vor der letzten Schicht erledigt
      ev.lvz = { dringend: stamp(true, 1), weiter: stamp({ an: "Bat", um: isoAt(Math.min(end, min + 3), days) }, 3) };
      if (min < end - 360 || r() < 0.3) ev.lvz.status = stamp("erledigt" as const, 15);
      if (r() < 0.5) ev.lvz.massnahme = stamp("Zfhr orientiert", 2);
    } else if ((y < 0.045 || (min >= end - 90 && !letzteGestrichen)) && i < total - 3) {
      letzteGestrichen ||= min >= end - 90;
      // gestrichen
      ev = { ...ev, deleted: true, rev: 2, updatedAt: utcOf(t, 300), geaendertVon: kuerzel };
    } else if ((y < 0.06 || (min >= end - 90 && !letzteKorrigiert)) && artOf(ev) === "meldung" && !ev.hebtAuf) {
      letzteKorrigiert ||= min >= end - 90;
      // korrigiert: frühere Fassung in der Historie
      const vorher: EventRevision = { rev: 1, at: createdAt, device: DEMO_LANG_DEVICE, text: ev.text.replace(/\d+ (Pers|Fz)/, (m) => `${+m.split(" ")[0]! + 1} ${m.split(" ")[1]}`), t: ev.t, unit: ev.unit, side: ev.side, aff: ev.aff, sym: ev.sym, von: kuerzel };
      const at = utcOf(t, 240);
      ev = { ...ev, rev: 2, updatedAt: at, correctedAt: at, history: [vorher], geaendertVon: kuerzel };
    }
    // höchstens 2 offene Aufträge / Rückfragen: ältere werden mit «Erledigt» abgeschlossen (Knopf, Vermerk)
    if (ev.art === "auftrag" && !ev.deleted) {
      offeneAuftraege.push(ev);
      if (offeneAuftraege.length > 2) { const a = offeneAuftraege.shift()!; a.lvz = { ...(a.lvz ?? {}), status: stamp("erledigt" as const, 30) }; }
    }
    if (ev.art === "rueckfrage" && !ev.deleted) {
      offeneRueckfragen.push(ev);
      if (offeneRueckfragen.length > 2) { const q = offeneRueckfragen.shift()!; q.lvz = { ...(q.lvz ?? {}), status: stamp("erledigt" as const, 20) }; }
    }
    if (!ev.deleted && !ev.hebtAuf && ev.sym === "sperre" && (ev.nai || ev.cells?.length)) sperren.push(ev);
    events.push(ev);
  }
  ex.events = events;

  const schichten: SchichtWechsel[] = wechselZeiten.map((m, k) => {
    const t = isoAt(m, days);
    const ab = isoAt(wechselZeiten[k - 1] ?? start, days);
    const neu = events.filter((e) => zeitBis(ab, e) && zeitCmp(e, t) < 0).length;
    return {
      id: `schicht-lang-${k}`, art: k === 0 ? "beginn" : "uebergabe", at: utcOf(t), t, an: kuerzelOf(k), device: DEMO_LANG_DEVICE,
      ...(k > 0 ? { von: kuerzelOf(k - 1), stand: { offen: 1 + Math.floor(r() * 4), neu } } : {}),
    };
  });
  ex.schichten = schichten;
  return ex;
}
