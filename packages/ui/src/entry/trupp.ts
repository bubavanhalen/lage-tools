/**
 * «Wer meldet?» ohne Browser (Spez. MVP 1, Kap. 3.2): Trupp als Text an den Anfang, Reihenfolge der Chips.
 */
import type { Exercise } from "@lage/core";

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

/** Trupps «zuletzt meldend zuerst» */
export function truppOrder(ex: Exercise): string[] {
  const last = new Map<string, string>();
  for (const e of ex.events ?? []) if (!e.deleted && e.melder && (last.get(e.melder) ?? "") < e.t) last.set(e.melder, e.t);
  return ex.units.blau.map((u, i) => ({ u, i, t: last.get(u) ?? "" })).sort((a, b) => (a.t === b.t ? a.i - b.i : a.t < b.t ? 1 : -1)).map((x) => x.u);
}

