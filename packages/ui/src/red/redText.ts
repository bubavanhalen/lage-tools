/**
 * Texte für «Was Rot vorhaben könnte» (Spez. MVP 1, Kap. 2.7, 3.6, 4.2–4.5): reine Funktionen, ohne React.
 * Klartext in der Grundansicht – Codes und Reglementsziffern nur unter «Woher kommt das?».
 */
import { coaHeadline, hintHeadline, indicatorText, type CoaIndicator, type Exercise, type Hint, type LageEvent, type RedCoa } from "@lage/core";
import { hhmm, nextLabel } from "../hintsData";
import type { LageRotState } from "../lageRot";
import { dayLabel } from "../Timeline";

/** Einordnung der Karten (Kap. 4.1) */
export const COA_KICKER: Record<RedCoa["label"], string> = {
  wahrscheinlichste: "Am wahrscheinlichsten",
  gefaehrlichste: "Am gefährlichsten",
  weitere: "Auch möglich",
};

/** Leerzustände (Kap. 4.5) */
export const EMPTY_RED = "Noch nichts Auffälliges. Hinweise erscheinen, sobald Meldungen ein Muster ergeben, z. B. wiederholte Fahrten oder eine Sperre an einer Engstelle. Es sind Vermutungen, keine Fakten.";
export const EMPTY_COA = "Für eine Vermutung braucht es mindestens zwei Anzeichen aus verschiedenen Meldungen.";
export const LEAD = "Vermutungen aus den Meldungen – keine Fakten.";

/** Titel einer Hinweis-Zeile ohne führendes «⚠» (die Zeile zeigt die Stufe als Zeichen) */
export const hintLine = (h: Hint): string => hintHeadline(h).replace(/^⚠\s*/, "");

/** «T2 07:05» */
export const dayTime = (t: string, ex: Pick<Exercise, "days">): string => `${dayLabel(t, ex.days)} ${t.slice(11, 16)}`;

/** Zeile unter dem Titel im Detail: «Seit T2 07:05 · zuletzt 07:20 · NAI 3 ist eine Engstelle» bzw. «Vorbei seit …» */
export function hintMeta(h: Hint, ex: Exercise, t: string): string {
  const over = !!h.until && h.until <= t;
  const parts = [over ? `Vorbei seit ${dayTime(h.until!, ex)}` : `Seit ${dayTime(h.t, ex)}`];
  if (!over && h.last && h.last > h.t) parts.push(`zuletzt ${hhmm(h.last, ex.days, t)}`);
  const nx = nextLabel(h, t, ex.days);
  if (nx) parts.push(nx.text);
  const nai = h.nai ? (ex.areas ?? []).find((a) => a.kind === "nai" && a.name === h.nai) : undefined;
  if (nai?.typ === "engnis") parts.push(`${nai.name} ist eine Engstelle`);
  return parts.join(" · ");
}

/** Zeichen der Seite einer Meldung (Kap. 5.1, Regel 5): Feind ◆, Unklar ■, Eigene ●, Neutral ▲ */
export function sideMark(e: Pick<LageEvent, "side" | "aff">): { mark: string; cls: string; label: string } {
  if (e.side === "blau") return { mark: "●", cls: "eigen", label: "Eigene" };
  if (e.aff === "U") return { mark: "■", cls: "unklar", label: "Unklar" };
  if (e.aff === "N") return { mark: "▲", cls: "neutral", label: "Neutral" };
  if (e.side === "rot") return { mark: "◆", cls: "feind", label: "Feind" };
  return { mark: "•", cls: "", label: "" };
}

/** Auslöser-Zeile: «Gn Sperre in AG13 (von H04)» */
export function eventLine(e: LageEvent): string {
  const what = e.desc && e.desc.length < 60 ? e.desc : e.text;
  return `${what.replace(/\s+/g, " ").trim()}${e.melder ? ` (von ${e.melder})` : ""}`;
}

/** Anzeichen ohne Code und ohne «– nicht gemeldet»/«– keine» (offene stehen schon unter «noch offen») */
export function indicatorLine(i: CoaIndicator): string {
  return indicatorText(i).replace(/\s+–\s+(?:nicht gemeldet|keine)$/, "");
}

/** Anzeichen einer Möglichkeit für das Detail: dafür (✓), noch offen (○), spricht dagegen (✗); doppelt gezählte nur in Experte */
export function indicatorGroups(c: RedCoa, experte = false): { pro: CoaIndicator[]; open: CoaIndicator[]; contra: CoaIndicator[] } {
  const dup = (i: CoaIndicator) => / – schon gezählt$/.test(i.text);
  return {
    pro: c.indicators.filter((i) => !i.against && i.met),
    open: c.indicators.filter((i) => !i.against && !i.met && (experte || !dup(i))),
    contra: c.indicators.filter((i) => i.against && i.met),
  };
}

/** Zeitraum für Karte und Detail; `null`, wenn die Möglichkeit keinen Zeitraum kennt (dann steht nichts auf der Karte) */
export function coaWhen(c: RedCoa, ex: Pick<Exercise, "days">, t: string): { text: string; state: NonNullable<RedCoa["windowState"]> } | null {
  const st = c.windowState;
  if (!st) return null;
  const w = c.window;
  switch (st) {
    case "jetzt": return { text: "jetzt!", state: st };
    case "erwartet": return w ? { text: `ca. ${hhmm(w.from, ex.days, t)}–${hhmm(w.to, ex.days, t)}`, state: st } : { text: "Zeit unklar", state: "offen" };
    case "ueberfaellig": return { text: "Zeitraum vorbei – nichts gemeldet", state: st };
    default: return { text: "Zeit unklar", state: "offen" };
  }
}

/** Klartext-Titel einer Möglichkeit (Kern) */
export const coaLine = (c: RedCoa): string => coaHeadline(c);

/**
 * Kräfte-Zeile (Kap. 1.2): «Rot gesehen: mind. 9 Pers, 4 Fz · erwartet 14 Pers, 5 Fz».
 * «mind.», wenn Sichtungen dieselbe Gruppe sein können (Spanne); ohne Feindannahme ohne «erwartet»; null ohne Sichtung.
 */
export function forceLine(lage: Pick<LageRotState, "compare">): string | null {
  const row = (k: string) => lage.compare.find((c) => c.row.key === k);
  const parts: string[] = [], exp: string[] = [];
  let range = false;
  for (const [k, abbr] of [["pers", "Pers"], ["fz", "Fz"]] as const) {
    const c = row(k);
    if (c?.found && c.found.max > 0) {
      parts.push(`${c.found.min || c.found.max} ${abbr}`);
      if (c.found.min < c.found.max && c.found.min > 0) range = true;
    }
    if (c?.expected !== undefined) exp.push(`${c.expected} ${abbr}`);
  }
  if (!parts.length) return null;
  return `Rot gesehen: ${range ? "mind. " : ""}${parts.join(", ")}${exp.length ? ` · erwartet ${exp.join(", ")}` : ""}`;
}

/** Leiste nach einem Entscheid (Kap. 3.6) */
export function decidedText(h: Hint, state: "bestaetigt" | "verworfen"): string {
  const title = hintLine(h);
  return `«${title.length > 60 ? title.slice(0, 58) + "…" : title}» als ‹${state === "bestaetigt" ? "trifft zu" : "trifft nicht zu"}› markiert`;
}
