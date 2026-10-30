/**
 * «Wer meldet?» ohne Browser (Spez. MVP 1, Kap. 3.2): Trupp als Text an den Anfang, Reihenfolge der Chips.
 */
import { zeitCmp, type Exercise } from "@lage/core";

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");

/** Trupp als Text an den Anfang setzen (ersetzt einen erkannten Trupp; nach einer führenden Zeit) */
export function withTrupp(text: string, name: string, melder?: string): string {
  if (melder) {
    const re = new RegExp(`(^|[\\s(])${escRe(melder)}(?=[\\s:,]|$)`, "i");
    if (re.test(text)) return text.replace(re, `$1${name}`);
  }
  const t = text.replace(/^\s+/, "");
  if (!t) return `${name} `;
  const lead = /^(?:T\d+\s*)?\d{3,4}\s+/i.exec(t)?.[0] ?? "";
  return `${lead}${name} ${t.slice(lead.length)}`;
}

/**
 * Trupps in **fester** Reihenfolge, wie vorbereitet bzw. angelegt (H01, H02, …) – Entscheid MVP 1 Nachbesserung
 * (ändert Spez. 3.2): die Knöpfe springen nie; der zuletzt meldende Trupp wird nur hervorgehoben (`lastMelder`).
 */
export function truppOrder(ex: Pick<Exercise, "units">): string[] {
  return [...ex.units.blau];
}

/** Trupp der zuletzt eingegangenen Meldung (für die Hervorhebung «zuletzt gemeldet»), sonst null */
export function lastMelder(ex: Pick<Exercise, "events" | "units">): string | null {
  let best: { m: string; e: NonNullable<Exercise["events"]>[number]; c: string } | null = null;
  for (const e of ex.events ?? []) {
    if (e.deleted || !e.melder) continue;
    const c = e.createdAt ?? "";
    const d = best ? zeitCmp(e, best.e) : 1;
    if (d > 0 || (d === 0 && c > best!.c)) best = { m: e.melder, e, c };
  }
  if (!best) return null;
  return ex.units.blau.find((u) => u.toLowerCase() === best!.m.toLowerCase()) ?? null;
}

