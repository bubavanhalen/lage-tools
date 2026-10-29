/**
 * Korrektur: geänderten Meldungstext neu lesen (ohne Browser testbar) – siehe editReparse.tsx für die Anzeige.
 */
import { lastPosition, parseMeldung, type Draft, type Exercise, type JournalContext, type Kind, type LageEvent } from "@lage/core";

/** Zeichenwahl (wie SymbolChoice in SymbolPicker.tsx) */
interface Choice { key: string; sidc: string; aff: Draft["aff"]; echelon?: Draft["echelon"]; status?: Draft["status"] }

/** Text der Korrektur neu lesen (Tag und «jetzt» = Zeit des Eintrags; «bei H04» = Lage des Melders vor dem Eintrag) */
export function reparseEdit(e: LageEvent, text: string, ex: Exercise, kind?: Kind): Draft | null {
  if (!text.trim()) return null;
  const day = e.t.slice(0, 10);
  const others = (ex.events ?? []).filter((x) => x.id !== e.id);
  const ctx: JournalContext = {
    sheets: ex.sheets, areas: ex.areas, units: ex.units, places: ex.places ?? [], kind,
    days: ex.days.includes(day) ? ex.days : [...ex.days, day].sort(), day,
    now: new Date(`${e.t}:00`),
    lastPos: (u, s) => lastPosition(others, s, u, e.t),
  };
  return parseMeldung(text, ctx);
}

/** Hat der neu gelesene Text einen eigenen Ort (nicht nur «bei Melder»/«zuletzt»)? */
export const placeFromText = (d: Draft | null | undefined): boolean =>
  !!d?.pos && !!d.where && d.where.kind !== "zuletzt" && d.where.kind !== "melder";

/**
 * Zusätzliche Felder aus dem neu gelesenen Text beim Speichern (Richtung, Herkunft, Strassenart, NAI; erkannten SIDC
 * und ausgeschriebenen Sinn, solange das Zeichen nicht von Hand geändert wurde).
 */
export function reparseExtras(d: Draft, c: Choice, count: number | undefined, placeTaken: boolean): Partial<LageEvent> {
  const same = c.key === d.sym && c.aff === d.aff && c.echelon === d.echelon && (c.status ?? "present") === (d.status ?? "present") && count === d.count;
  return {
    dir: d.dir, from: d.from, fromLabel: d.fromLabel, roadHint: d.roadHint,
    ...(same ? { sidc: d.sidc, desc: d.desc } : {}),
    ...(placeTaken ? { nai: d.nai } : {}),
  };
}
