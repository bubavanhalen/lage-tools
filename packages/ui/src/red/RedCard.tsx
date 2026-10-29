/**
 * Liste «Was Rot vorhaben könnte»: Karte je Möglichkeit Rot und Zeile je Hinweis (Spez. MVP 1, Kap. 2.7).
 * Klartext, keine Codes; in Experte zusätzlich die Code-Marke («C5») an der Zeile.
 */
import { indicatorSummary, type Exercise, type Hint, type RedCoa } from "@lage/core";
import { decisionOf, hhmm, isOver } from "../hintsData";
import { COA_KICKER, coaLine, coaWhen, hintLine } from "./redText";
import "./redcard.css";

/** Möglichkeit Rot als Karte: Einordnung, Zeitraum, Titel; die wahrscheinlichste zusätzlich mit Anzeichen */
export function RedCard({ c, ex, t, sel, onOpen }: { c: RedCoa; ex: Exercise; t: string; sel: boolean; onOpen: () => void }) {
  const when = coaWhen(c, ex, t);
  const top = c.label === "wahrscheinlichste";
  return (
    <li className={`red-card k-${c.label}` + (sel ? " sel" : "")} data-coa={c.id}>
      <button className="red-card-btn" onClick={onOpen} aria-current={sel || undefined}>
        {/* Titel zuerst im DOM (Vorlesen, Text der Zeile beginnt mit dem Titel), angezeigt unter der Einordnung (redcard.css) */}
        <span className="red-card-title">{coaLine(c)}</span>
        <span className="red-kick">{COA_KICKER[c.label]}</span>
        {when && when.state !== "offen" && <span className={"red-when w-" + when.state}>{when.text}</span>}
        {top && <span className="red-card-sum">{indicatorSummary(c)}</span>}
      </button>
    </li>
  );
}

/**
 * Zeile eines Hinweises: Stufe als Zeichen (⚠ hoch, • mittel, i Normalbild), Klartext, Zeit; in Experte mit Code-Marke.
 * MVP 3 (Kap. 3.12): gleiche Hinweise gebündelt (`bundleHints`) mit «· 14×» (aria «14 gleiche Hinweise»).
 */
export function RedHintRow({ h, ex, t, sel, experte, onOpen }: { h: Hint; ex: Exercise; t: string; sel: boolean; experte: boolean; onOpen: () => void }) {
  const over = isOver(h, t);
  const st = decisionOf(ex, h);
  const state = st === "bestaetigt" ? "trifft zu" : st === "verworfen" ? "trifft nicht zu" : over ? "vorbei" : "";
  return (
    <li className={`red-hint l-${h.level}` + (sel ? " sel" : "") + (state ? " done" : "")} data-hint={h.id}>
      <button className="red-hint-btn" onClick={onOpen} aria-current={sel || undefined}>
        <span className="red-hint-title">{hintLine(h)}{h.bundled && h.bundled > 1 ? <span className="red-bund" aria-label={`${h.bundled} gleiche Hinweise`}> · {h.bundled}×</span> : null}
          {h.level === "hoch" && <span className="sr"> (wichtig)</span>}</span>
        <span className="red-lvl" aria-hidden={h.level === "info" || undefined}>{h.level === "hoch" ? "⚠" : h.level === "info" ? "i" : "•"}</span>
        {experte && <span className="red-code" title="Regel – Erklärung unter «Woher kommt das?»">{h.rule}</span>}
        <span className="red-hint-time">{state ? <span className="red-state">{state}</span> : hhmm(h.t, ex.days, t)}</span>
      </button>
    </li>
  );
}
