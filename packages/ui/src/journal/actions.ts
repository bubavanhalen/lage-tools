/**
 * Aktionen an Journal-Zeilen (Spez. MVP 1, Kap. 3.4; MVP 3, Kap. 2.4, 2.5, 3.3–3.5): Löschen (= Streichen) und
 * Zurückholen, LVZ-Vermerke (dringend, offen/erledigt, Massnahme, weitergemeldet) und «Aufgehoben (jetzt)» – jede
 * Änderung mit Rückgängig-Leiste. Löschen ist eine Revision mit `deleted` (geht beim Zusammenführen mit), nie rot.
 * Vermerke ändern `rev` nicht (`setVermerk`, Kern) und zählen nie als Konflikt.
 *
 * Die reinen Teile (`aufhebEvent`, `aufhebText`, `vermerkText`, `mapEvent`) sind ohne Browser testbar.
 */
import {
  buildSidc, catalogEntry, clockDay, compareEvents, localIso, newEventId, nrLabel, offsetFor, parseLocalIso, reviseEvent, setVermerk,
  type Exercise, type LageEvent, type LvzVermerke,
} from "@lage/core";
import { offerUndo } from "./journalUndo";

type Update = (f: (x: Exercise) => Exercise) => void;

/** Ereignis «Meldung in diesem Fenster gelöscht» – eine laufende Korrektur dieser Meldung bricht ab (EntryBox) */
export const DELETED_EVENT = "lage:meldung-geloescht";

/**
 * Schnellweg (P3): genau einen Eintrag ersetzen – neues Array, alle anderen Einträge bleiben dieselben Objekte.
 * `f` bekommt den aktuellen Eintrag (aus der Kopie in `update`) und gibt den neuen zurück.
 */
export function mapEvent(x: Exercise, id: string, f: (e: LageEvent) => LageEvent): Exercise {
  x.events = (x.events ?? []).map((y) => (y.id === id ? f(y) : y));
  return x;
}

/** «Meldung 07:20 H03 gelöscht» */
export function deletedLabel(e: Pick<LageEvent, "t" | "melder" | "unit">): string {
  const who = e.melder || e.unit;
  return `Meldung ${e.t.slice(11, 16)}${who ? ` ${who}` : ""} gelöscht`;
}

/** Meldung löschen (streichen), Leiste «Meldung 07:20 H03 gelöscht · Rückgängig» (8 s, Ctrl+Z); `kuerzel` → «gestrichen … von BSP» */
export function deleteEvent(update: Update, ex: Exercise, id: string, device: string, kuerzel?: string | null): void {
  const e = (ex.events ?? []).find((x) => x.id === id);
  if (!e || e.deleted) return;
  const set = (deleted: boolean) => update((x) => mapEvent(x, id, (y) => reviseEvent(y, { deleted, ...(kuerzel ? { geaendertVon: kuerzel } : {}) }, device)));
  set(true);
  try { window.dispatchEvent(new CustomEvent(DELETED_EVENT, { detail: id })); } catch { /* egal */ }
  offerUndo(deletedLabel(e), () => set(false));
}

/** Gestrichenen Eintrag zurückholen (`reviseEvent(e, { deleted: false })`), Leiste «Nr 31 zurückgeholt · Rückgängig» */
export function restoreEvent(update: Update, ex: Exercise, id: string, device: string, kuerzel?: string | null): void {
  const e = (ex.events ?? []).find((x) => x.id === id);
  if (!e || !e.deleted) return;
  const set = (deleted: boolean) => update((x) => mapEvent(x, id, (y) => reviseEvent(y, { deleted, ...(kuerzel ? { geaendertVon: kuerzel } : {}) }, device)));
  set(false);
  const nr = nrLabel(e, ex);
  offerUndo(`${nr ? `Nr ${nr}` : "Eintrag"} zurückgeholt`, () => set(true));
}

// ---------- Vermerke

export type VermerkKey = keyof LvzVermerke;
type VermerkWert<K extends VermerkKey> = NonNullable<LvzVermerke[K]>["v"];

/** Text der Rückgängig-Leiste: «Dringend gesetzt», «Nr 55 erledigt», «Massnahme gespeichert», «Weitergemeldet an Bat 07:15» */
export function vermerkText<K extends VermerkKey>(key: K, v: VermerkWert<K>, nr: string): string {
  const n = nr ? `Nr ${nr}` : "Eintrag";
  switch (key) {
    case "dringend": return v ? "Dringend gesetzt" : "Dringend entfernt";
    case "status": return v === "erledigt" ? `${n} erledigt` : `${n} offen`;
    case "massnahme": return v ? "Massnahme gespeichert" : "Massnahme entfernt";
    case "weiter": {
      const w = v as VermerkWert<"weiter">;
      return w ? `Weitergemeldet an ${w.an}${w.um ? ` ${w.um.slice(11, 16)}` : ""}` : "Weitermeldung entfernt";
    }
    default: return "Vermerk gespeichert";
  }
}

/**
 * Vermerk setzen mit Rückgängig (stellt den vorherigen Stempel genau wieder her, auch «nicht gesetzt»).
 * `label` ersetzt den Standardtext der Leiste.
 */
export function setVermerkUndo<K extends VermerkKey>(update: Update, ex: Exercise, id: string, key: K, v: VermerkWert<K>,
  o: { device: string; kuerzel?: string | null; label?: string }): void {
  const e = (ex.events ?? []).find((x) => x.id === id);
  if (!e) return;
  const prev = e.lvz?.[key];
  update((x) => mapEvent(x, id, (y) => setVermerk(y, key, v, { device: o.device, ...(o.kuerzel ? { kuerzel: o.kuerzel } : {}) })));
  offerUndo(o.label ?? vermerkText(key, v, nrLabel(e, ex)), () => update((x) => mapEvent(x, id, (y) => {
    const lvz: LvzVermerke = { ...(y.lvz ?? {}) };
    if (prev) (lvz as Record<string, unknown>)[key] = prev; else delete lvz[key];
    const out: LageEvent = { ...y, updatedAt: new Date().toISOString() };
    if (Object.keys(lvz).length) out.lvz = lvz; else delete out.lvz;
    return out;
  })));
}

// ---------- Aufheben (Kap. 3.5)

/** Ort einer Meldung in Kurzform («AG13», «NAI 3», Ortsname) */
const ortKurz = (e: Pick<LageEvent, "cells" | "nai" | "where">) => e.cells?.[0] ?? e.nai ?? e.where ?? "";

/** «Sperre AG13 aufgehoben» – Text der aufhebenden Meldung */
export function aufhebText(e: Pick<LageEvent, "sym" | "desc" | "cells" | "nai" | "where">): string {
  const name = catalogEntry(e.sym)?.name ?? e.desc ?? "Sperre";
  return [name, ortKurz(e), "aufgehoben"].filter(Boolean).join(" ");
}

/**
 * Lagezeit «jetzt» für einen Eintrag ohne Text (Aufheben): LIVE = Geräteuhr, wenn heute ein Tag der Übung ist; sonst
 * (Beispiel mit echter Uhr) letzte Meldung + 1 min – nie ein erfundener Tag (E17). Nie vor `min`.
 */
export function jetztT(ex: Pick<Exercise, "days" | "events">, now = new Date(), min?: string): string {
  let t = clockDay(ex.days, now).follow ? localIso(now) : "";
  if (!t) {
    const last = [...(ex.events ?? [])].filter((e) => !e.deleted).sort(compareEvents).pop();
    t = last ? localIso(new Date(parseLocalIso(last.t).getTime() + 60000)) : localIso(now);
  }
  return min && t < min ? min : t;
}

/**
 * Aufhebende Meldung für «Aufgehoben (jetzt)» (Kap. 3.5): Art Meldung, ohne Ort/Element (zeichnet nie, auch nicht in
 * MVP 1), `sym: einheit`, `desc` «Sperre aufgehoben», Ort nur in `orte`, Melder leer, `hebtAuf` = Ziel.
 */
export function aufhebEvent(target: LageEvent, ex: Pick<Exercise, "days" | "events">, o: { device: string; kuerzel?: string | null; nr?: number; now?: Date }): LageEvent {
  const now = o.now ?? new Date();
  const t = jetztT(ex, now, target.t);
  const ce = catalogEntry("einheit")!;
  const name = catalogEntry(target.sym)?.name ?? target.desc ?? "Sperre";
  const ort = ortKurz(target);
  return {
    id: newEventId(now.getTime()), rev: 1, device: o.device, updatedAt: now.toISOString(), createdAt: now.toISOString(),
    tReported: localIso(now), t, tOffset: offsetFor(t, now),
    side: "blau", unit: "", text: aufhebText(target), sym: "einheit", aff: "F", sidc: buildSidc(ce, "F"),
    desc: `${name} aufgehoben`, source: { kind: "text" }, confirmed: true,
    art: "meldung", hebtAuf: target.id, ...(ort ? { orte: [ort] } : {}),
    ...(o.nr !== undefined ? { nr: o.nr, von: o.device } : {}), ...(o.kuerzel ? { erfasstVon: o.kuerzel } : {}),
  };
}

/** «Aufgehoben (jetzt)»: aufhebende Meldung eintragen, Leiste «Sperre AG13 aufgehoben · Rückgängig» (= streichen) */
export function aufhebenJetzt(update: Update, ex: Exercise, id: string, o: { device: string; kuerzel?: string | null; nr?: number }): LageEvent | null {
  const target = (ex.events ?? []).find((x) => x.id === id);
  if (!target || target.deleted) return null;
  const ev = aufhebEvent(target, ex, o);
  update((x) => { x.events = [...(x.events ?? []), ev]; return x; });
  offerUndo(ev.text, () => update((x) => mapEvent(x, ev.id, (y) => reviseEvent(y, { deleted: true, ...(o.kuerzel ? { geaendertVon: o.kuerzel } : {}) }, o.device))));
  return ev;
}
