/**
 * Klartext für die Grundansicht (Spez. MVP 1, Kap. 4.2/4.3): Titel ohne Codes, Reglementsziffern oder Abkürzungen
 * (ausser Fz, Pers, PQ-/NAI- und Trupp-Namen). Codes stehen nur noch unter «Woher kommt das?».
 *
 * `coa.ts` und `hints.ts` setzen `headline` (und bei Hinweisen `todo`) direkt; die Funktionen hier nehmen diese Felder
 * und leiten sonst (ältere gespeicherte Daten, Tests) aus `title` ab. Signaturen sind Vertrag.
 */
import type { CoaIndicator, RedCoa } from "./coa";
import { hintRule, type Hint } from "./hints";

/** Regel-Codes in Klammern: «(D1)», «(C5, 2×)» (Zusatz bleibt: « (2×)»), «(still)» am Ende */
const CODE_PAREN = /\s*\(([A-E][1-6])(?:,\s*([^)]*))?\)/g;
const TRAILING_WORD = /\s*\([a-z]+\)\s*$/;

/** Klartext-Titel einer möglichen Aktion Rot, z. B. «Rot könnte Stao H05 überfallen (AQ11)». */
export function coaHeadline(c: RedCoa): string {
  if (c.headline) return c.headline;
  const t = c.title;
  let m: RegExpExecArray | null;
  switch (c.kind) {
    case "ueberfall":
      if ((m = /Stao\s+(\S+)\s*\(([^)]+)\)/.exec(t))) return `Rot könnte Stao ${m[1]} überfallen (${m[2]})`;
      break;
    case "hinterhalt":
      if ((m = /an (?:Engnis|Strasse)\s+(.+?)\s+auf eigene/.exec(t))) return `Rot könnte bei ${m[1]} einen Hinterhalt legen – eigene Verschiebung dort meiden`;
      break;
    case "sperren":
      if ((m = /im Raum\s+(.+)$/.exec(t))) return `Rot könnte den Raum ${m[1]} sperren und uns umleiten`;
      break;
    case "versorgung":
      if ((m = /Pendel\s+(.+?)\s+↔\s+(.+?)(?:\s+\(|$)/.exec(t))) return `Rot versorgt sich vermutlich zwischen ${m[1]} und ${m[2]}`;
      break;
    case "aufklaerung":
      if ((m = /^Aufklärung\s+(.+?)\s+zur Vorbereitung/.exec(t))) return `Rot klärt ${m[1]} auf – eine Aktion dort ist möglich`;
      break;
    case "infiltration":
      if ((m = /durch\s+(.+)$/.exec(t))) return `Rot könnte unbemerkt durch ${m[1]} durchsickern`;
      break;
    case "absetzen":
      return (m = /Rtg\s+(.+)$/.exec(t)) ? `Rot zieht sich vermutlich Rtg ${m[1]} zurück` : "Rot zieht sich vermutlich zurück";
  }
  return t;
}

/**
 * Anzeichen-Text ohne Regel-Code («Drohne über H05 02:50 (D1)» → «Drohne über H05 02:50»,
 * «Sperre NAI 3 07:05 (C5, 2×)» → «Sperre NAI 3 07:05 (2×)»).
 */
export function indicatorText(i: Pick<CoaIndicator, "text">): string {
  return i.text.replace(CODE_PAREN, (_m, _code: string, extra?: string) => (extra ? ` (${extra})` : "")).replace(TRAILING_WORD, "").trim();
}

/** Klartext-Titel eines Hinweises (Kap. 4.2); ohne `headline` (ältere Daten) der Titel mit «⚠» bei Stufe hoch. */
export function hintHeadline(h: Pick<Hint, "headline" | "title" | "level">): string {
  return h.headline ?? `${h.level === "hoch" ? "⚠ " : ""}${h.title}`;
}

/** «Woher kommt das?»: Code, Kurzname, Regel in eigenen Worten und Quelle (Reglement-Nr. + Ziffer) – nur dort Codes. */
export function hintOrigin(h: Pick<Hint, "rule">): { code: string; name: string; rule: string; source?: string } {
  const r = hintRule(h.rule);
  return { code: h.rule, name: r?.name ?? "", rule: r?.rule ?? "", source: r?.source };
}

/** «4 Anzeichen dafür · 1 offen · 1 spricht dagegen» (Teile mit 0 entfallen, ausser «Anzeichen dafür»). */
export function indicatorSummary(c: Pick<RedCoa, "indicators">): string {
  const pro = c.indicators.filter((i) => !i.against && i.met).length;
  const open = c.indicators.filter((i) => !i.against && !i.met).length;
  const contra = c.indicators.filter((i) => i.against && i.met).length;
  return [`${pro} Anzeichen dafür`, open ? `${open} offen` : "", contra ? `${contra} spricht dagegen` : ""].filter(Boolean).join(" · ");
}

/** Zeitraum in Klartext: «jetzt!», «ca. 07:45–08:35», «Zeitraum vorbei – nichts gemeldet», «Zeit unklar». */
export function windowText(c: Pick<RedCoa, "window" | "windowState">): string {
  const hm = (iso: string) => iso.slice(11, 16);
  switch (c.windowState) {
    case "jetzt": return "jetzt!";
    case "ueberfaellig": return "Zeitraum vorbei – nichts gemeldet";
    case "erwartet": return c.window ? `ca. ${hm(c.window.from)}–${hm(c.window.to)}` : "Zeit unklar";
    default: return "Zeit unklar";
  }
}
