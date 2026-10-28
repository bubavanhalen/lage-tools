/**
 * Korrektur (Bearbeiten-Zeile im Journal): geänderter Meldungstext wird neu gelesen – Ort, Zeichen, Zeit, Anzahl,
 * Richtung, Melder – wie beim Eintragen. Die Felder der Zeile folgen dem Text (danach von Hand änderbar), darüber
 * eine Vorschau mit Chips. Ohne Zeit im Text bleibt die Zeit des Eintrags; ohne Ort im Text bleibt der Ort.
 */
import {
  lastPosition,
  parseMeldung,
  symbolDef,
  type Draft,
  type Exercise,
  type JournalContext,
  type LageEvent,
} from "@lage/core";
import { dayLabel } from "./Timeline";
import { pickerEntry, type SymbolChoice } from "./SymbolPicker";
import { ProblemChips, openProblems } from "./DraftProblems";
import "./journalfix.css";

/** Text der Korrektur neu lesen (Tag und «jetzt» = Zeit des Eintrags; «bei H04» = Lage des Melders vor dem Eintrag) */
export function reparseEdit(e: LageEvent, text: string, ex: Exercise): Draft | null {
  if (!text.trim()) return null;
  const day = e.t.slice(0, 10);
  const others = (ex.events ?? []).filter((x) => x.id !== e.id);
  const ctx: JournalContext = {
    sheets: ex.sheets, areas: ex.areas, units: ex.units, places: ex.places ?? [],
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
export function reparseExtras(d: Draft, c: SymbolChoice, count: number | undefined, placeTaken: boolean): Partial<LageEvent> {
  const same = c.key === d.sym && c.aff === d.aff && c.echelon === d.echelon && (c.status ?? "present") === (d.status ?? "present") && count === d.count;
  return {
    dir: d.dir, from: d.from, fromLabel: d.fromLabel, roadHint: d.roadHint,
    ...(same ? { sidc: d.sidc, desc: d.desc } : {}),
    ...(placeTaken ? { nai: d.nai } : {}),
  };
}

const KIND_WORD = { eigen: "Eigene Lage", feind: "Feind", unklar: "Unklar" } as const;
const COMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];

/** Vorschau «Text neu gelesen» über den Feldern der Korrektur */
export function EditPreview({ d, ex, manualPos, oldWhere }: { d: Draft; ex: Exercise; manualPos: boolean; oldWhere?: string }) {
  const probs = openProblems(d, { manualPos });
  const name = d.desc ?? pickerEntry(d.sym)?.name ?? symbolDef(d.sym).name;
  return (
    <div className="preview editpreview" aria-label="Text neu gelesen">
      <span className="help">Neu gelesen:</span>
      {d.timeFromText && <span className="chip">{dayLabel(d.t, ex.days)} {d.t.slice(11, 16)}</span>}
      {d.melder && <span className="chip">Melder <b>{d.melder}</b></span>}
      <span className={`chip kind-${d.kind}`}>{KIND_WORD[d.kind]}</span>
      {d.kind !== "eigen" && d.unit && d.unit !== d.melder && <span className="chip"><b>{d.unit}</b></span>}
      <span className="chip">{name}{!d.desc && d.count && d.count > 1 ? ` ×${d.count}` : ""}</span>
      {(d.dir !== undefined || d.dirLabel) && <span className="chip">{d.dirLabel ?? `Rtg ${COMPASS[Math.round(d.dir! / 45) % 8]}`}</span>}
      {probs.length ? <ProblemChips problems={probs} />
        : manualPos ? <span className="chip where">📍 Karte</span>
        : placeFromText(d) ? <span className="chip where">📍 {d.where!.label}</span>
        : <span className="chip soft" title="Im Text steht kein Ort – der bisherige Ort bleibt">Ort bleibt{oldWhere ? `: ${oldWhere}` : ""}</span>}
    </div>
  );
}

/**
 * Korrektur-Zeile sichtbar machen: nicht unter dem (klebenden) Meldungsfeld verstecken. Scrollt die Seitenleiste
 * bzw. die Seite nur so weit wie nötig.
 */
export function revealEditRow(li: HTMLElement | null): void {
  if (!li) return;
  const entry = document.querySelector<HTMLElement>(".journal .entry");
  const sticky = !!entry && getComputedStyle(entry).position === "sticky";
  const limit = sticky ? entry!.getBoundingClientRect().bottom + 8 : 8;
  const r = li.getBoundingClientRect();
  if (r.top >= limit) return;
  const side = li.closest<HTMLElement>(".side");
  if (side && side.scrollHeight > side.clientHeight) side.scrollBy({ top: r.top - limit });
  else window.scrollBy({ top: r.top - limit });
}
