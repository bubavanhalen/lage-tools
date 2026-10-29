/**
 * Messpunkte für die Leistung (Spez. MVP 3, Kap. 3.12 P1, Abnahme 8.6) und Testhaken der Ausdrucke.
 *
 * - `perfMark("enter" | "zeile" | "bereit")` setzt `performance.mark("lt:…")` (Namen in `PERF_MARK`, contracts.ts).
 *   Meldungsfeld (B: Enter), Liste (B: Zeile im DOM, `useLayoutEffect`) und Hülle (C: erste Liste + Feld bedienbar)
 *   dürfen die Marken selbst setzen. Bis dahin (und als Rückfall) setzt dieses Modul sie selbst:
 *   Enter im Feld «Was wurde gemeldet?» (keydown, Capture) → `lt:enter`; danach die erste neue Zeile
 *   `.jlist li[data-id]` im DOM (MutationObserver, läuft vor dem Zeichnen wie `useLayoutEffect`) → `lt:zeile`;
 *   erste Zeile und Feld vorhanden → `lt:bereit`. Doppelte Marken schaden nicht (gezählt wird je Enter die erste Zeile).
 * - `window.__ltPerf()` liefert die Abstände in ms (`LtPerf`): `bereit` = Navigation → `lt:bereit`,
 *   `enterZeile` = letztes Enter → Zeile, `enterZeileAlle`.
 * - `pdfInfo(doc, …)` legt `window.__ltPdfInfo` für das zuletzt erzeugte PDF ab (Seiten, Format, alle Textzeilen –
 *   gesammelt von `safePdf`, pdfSafe.ts). Nur lesen, bleibt im Browser, auch im Produktivbau.
 *
 * Wird einmal beim Laden angemeldet (Import von hintsData.ts bzw. Workspace); ohne `window`/`performance` tut es nichts.
 */
import type { jsPDF } from "jspdf";
import { PERF_MARK, type LtPdfInfo, type LtPerf } from "./shell/contracts";

type MarkName = keyof typeof PERF_MARK;

const has = typeof window !== "undefined" && typeof performance !== "undefined" && typeof performance.now === "function";

/**
 * eigene Ablage der Marken (ms seit Navigation): mit installierter Test-Uhr (Playwright `clock.install`) legt
 * `performance.mark` nichts ab – die Zeiten stimmen trotzdem (`performance.now` läuft weiter)
 */
const store: Record<string, number[]> = {};
function put(n: string) {
  const t = performance.now();
  (store[n] ??= []).push(t);
  try { performance.mark(n); } catch { /* egal */ }
}

/** Messpunkt setzen (`lt:enter`, `lt:zeile`, `lt:bereit`) */
export function perfMark(name: MarkName): void {
  if (!has) return;
  put(PERF_MARK[name]);
  if (name === "zeile") pending = null;
  if (name === "bereit") bereitGesetzt = true;
}

const marks = (n: string): number[] => store[n] ?? [];

/** Abstände der Messpunkte (ms, gerundet auf 0.1) */
export function ltPerf(): LtPerf {
  const r = (x: number) => Math.round(x * 10) / 10;
  const out: LtPerf = {};
  const b = marks(PERF_MARK.bereit);
  if (b.length) out.bereit = r(b[0]!);
  const en = marks(PERF_MARK.enter), ze = marks(PERF_MARK.zeile);
  const alle: number[] = [];
  for (let i = 0; i < en.length; i++) {
    const t0 = en[i]!, next = en[i + 1] ?? Infinity;
    const z = ze.find((x) => x >= t0 && x < next);
    if (z !== undefined) alle.push(r(z - t0));
  }
  if (alle.length) { out.enterZeile = alle[alle.length - 1]; out.enterZeileAlle = alle; }
  return out;
}

// ---------- Rückfall: Marken aus dem DOM

const FELD = 'textarea[placeholder="Was wurde gemeldet?"], input[placeholder="Was wurde gemeldet?"]';
const ZEILE = ".jlist li[data-id]";
/** Enter gedrückt, Zeile noch nicht da: IDs der Zeilen davor */
let pending: { ids: Set<string>; mo: MutationObserver; timer: number } | null = null;
let bereitGesetzt = false;

function rowIds(): Set<string> {
  const s = new Set<string>();
  document.querySelectorAll<HTMLElement>(ZEILE).forEach((li) => { if (li.dataset.id) s.add(li.dataset.id); });
  return s;
}

function stopPending() {
  if (!pending) return;
  pending.mo.disconnect();
  window.clearTimeout(pending.timer);
  pending = null;
}

function onEnter(ev: KeyboardEvent) {
  if (ev.key !== "Enter" || ev.shiftKey || ev.isComposing) return;
  const t = ev.target as HTMLElement | null;
  if (!t?.matches?.(FELD) || !(t as HTMLTextAreaElement).value.trim()) return;
  stopPending();
  perfMark("enter");
  const ids = rowIds();
  const mo = new MutationObserver(() => {
    if (!pending) return;
    for (const li of document.querySelectorAll<HTMLElement>(ZEILE)) {
      if (li.dataset.id && !ids.has(li.dataset.id)) { stopPending(); put(PERF_MARK.zeile); return; }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  // kein Eintrag (gelb/geht nicht): nach 5 s aufgeben
  pending = { ids, mo, timer: window.setTimeout(stopPending, 5000) };
}

function watchBereit() {
  const ready = () => !!document.querySelector(ZEILE) && !!document.querySelector(FELD);
  if (ready()) { perfMark("bereit"); return; }
  const mo = new MutationObserver(() => {
    if (bereitGesetzt) { mo.disconnect(); return; }
    if (ready()) { mo.disconnect(); perfMark("bereit"); }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  // leere Übung: nie eine Zeile – nach 30 s nicht mehr beobachten
  window.setTimeout(() => mo.disconnect(), 30000);
}

let installed = false;
/** Messpunkte und `window.__ltPerf` anmelden (einmal; wird beim Import aufgerufen) */
export function installPerf(): void {
  if (!has || installed) return;
  installed = true;
  window.__ltPerf = ltPerf;
  document.addEventListener("keydown", onEnter, true);
  if (document.body) watchBereit();
  else document.addEventListener("DOMContentLoaded", watchBereit, { once: true });
}
installPerf();

// ---------- PDF-Testhaken

/** Textzeilen eines Dokuments (von `safePdf` gesammelt) */
export function pdfZeilen(doc: jsPDF): string[] {
  return ((doc as jsPDF & { __zeilen?: string[] }).__zeilen ?? []).slice();
}

/** `window.__ltPdfInfo` für das eben erzeugte PDF setzen (vor `doc.output`) */
export function pdfInfo(doc: jsPDF, format: "a4" | "a3", quer: boolean): LtPdfInfo {
  const info: LtPdfInfo = { seiten: doc.getNumberOfPages(), format, quer, zeilen: pdfZeilen(doc) };
  if (typeof window !== "undefined") window.__ltPdfInfo = info;
  return info;
}
