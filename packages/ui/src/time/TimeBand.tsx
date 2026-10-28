/**
 * Live-Band unter der Karte (Spez. MVP 1, Kap. 2.1, 2.6, 3.5):
 * - LIVE: «● LIVE  T2 07:25 · letzte Meldung 07:25 · [zeigt nur letzte 2 h ✕] · [⏪ Zurückblicken]» (eine Zeile, 56 px),
 * - RÜCKBLICK (Grundansicht): Rückblick-Leiste «Lage um [05:30] [−1 h][−30 min] ━━●━━ [+30 min][+1 h]
 *   · zurück zu LIVE in 0:20 · [Zurück zu LIVE]» – auf schmaler Breite zweizeilig, Regler über die ganze Breite,
 * - Experte: ganzer Zeitstrahl (`SwimTimeline`) statt Band und Leiste; Band oben und Rahmen gelten gleich.
 * Nichts wird gespeichert; alle Zeitwechsel laufen über die `ZeitApi` (useLageZeit).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent } from "react";
import { countdownText, lageZeitText, parseLageZeit, shiftMinutes, showLastLabel, zeitAbstand } from "@lage/core";
import type { TimeBandProps } from "../shell/contracts";
import { SwimTimeline } from "../SwimTimeline";
import { RUECKBLICK_WARN_S } from "./useLageZeit";
import "./time.css";

const MIN = 60000;
/** Regler: Anfang der Übung (erste Meldung, auf die volle Stunde abgerundet) */
function rangeStart(firstReport: string | null, tLive: string): string {
  const base = firstReport && firstReport < tLive ? firstReport : shiftMinutes(tLive, -6 * 60);
  return `${base.slice(0, 13)}:00`;
}

export function TimeBand({ ex, zeit, experte, lastReport, swim }: TimeBandProps) {
  if (experte && swim) {
    return (
      <div className="tb-wrap tb-experte" data-lagezeit={zeit.zeit.kind}>
        <SwimTimeline {...swim} zeit={zeit} />
      </div>
    );
  }
  return (
    <div className="tb-wrap" data-lagezeit={zeit.zeit.kind}>
      {zeit.zeit.kind === "rueckblick" ? <RueckblickLeiste ex={ex} zeit={zeit} /> : <LiveBand ex={ex} zeit={zeit} lastReport={lastReport} />}
    </div>
  );
}

/** Chip «zeigt nur letzte 2 h ✕» (R8) – kontextuell, nur wenn «Zeige letzte» aktiv ist */
export function ShowLastChip({ zeit }: { zeit: TimeBandProps["zeit"] }) {
  if (!zeit.showLast && !zeit.ab) return null;
  const text = zeit.showLast ? `zeigt nur letzte ${showLastLabel(zeit.showLast)}` : `zeigt nur ab ${zeit.ab!.slice(11, 16)}`;
  return (
    <button type="button" className="tb-chip" onClick={() => { zeit.setShowLast(null); zeit.setAb?.(null); }}
      aria-label={`${text} – alles zeigen`}>
      {text} <span aria-hidden="true">✕</span>
    </button>
  );
}

function LiveBand({ ex, zeit, lastReport }: { ex: TimeBandProps["ex"]; zeit: TimeBandProps["zeit"]; lastReport: string | null }) {
  const reason = useId();
  const tLive = zeit.tLive ?? zeit.tNow;
  const back = () => {
    if (!lastReport) return;
    const first = firstReportOf(ex);
    const start = rangeStart(first, tLive);
    const t = shiftMinutes(tLive, -60);
    zeit.lookBack(t < start ? start : t);
  };
  return (
    <section className="tb" aria-label="Lagezeit">
      <span className="tb-live"><i aria-hidden="true" />LIVE</span>
      <span className="tb-time tnum">{lageZeitText(tLive, ex.days)}</span>
      <span className="tb-last" id={reason}>
        {lastReport
          ? <><span className="tb-long">letzte Meldung </span><span className="tb-short">letzte </span><span className="tnum">{lastReport.slice(11, 16)}</span></>
          : "noch keine Meldung"}
      </span>
      <ShowLastChip zeit={zeit} />
      <button type="button" className="tb-back" onClick={back} disabled={!lastReport} aria-describedby={lastReport ? undefined : reason}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3 3 8l5 5M13 3 8 8l5 5" /></svg>Zurückblicken
      </button>
    </section>
  );
}

function firstReportOf(ex: TimeBandProps["ex"]): string | null {
  let m = "";
  for (const e of ex.events ?? []) if (!e.deleted && (!m || e.t < m)) m = e.t;
  return m ? m.slice(0, 16) : null;
}

function RueckblickLeiste({ ex, zeit }: { ex: TimeBandProps["ex"]; zeit: TimeBandProps["zeit"] }) {
  const t = zeit.zeit.kind === "rueckblick" ? zeit.zeit.t : zeit.tNow;
  const tLive = zeit.tLive ?? zeit.tNow;
  const start = useMemo(() => rangeStart(firstReportOf(ex), tLive), [ex.events, tLive]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = Math.max(1, Math.round(zeitAbstand(start, tLive) / MIN));
  const pos = Math.min(total, Math.max(0, Math.round(zeitAbstand(start, t) / MIN)));

  // Eingabe «Lage um»: eigener Text, solange das Feld bearbeitet wird
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setBad(false); }, [t]);
  const go = (to: string) => {
    const clamped = to < start ? start : to;
    zeit.lookBack(clamped);
  };
  const step = (min: number) => go(shiftMinutes(t, min));
  const commit = () => {
    if (draft === null) return;
    const v = parseLageZeit(draft, { days: ex.days, t, tLive });
    if (!v) { setBad(true); return; }
    setDraft(null);
    go(v);
  };
  const onRangeKey = (ev: RKeyboardEvent<HTMLInputElement>) => {
    const k = ev.key;
    const d = ev.shiftKey ? 30 : 5;
    if (k === "ArrowLeft" || k === "ArrowDown") step(-d);
    else if (k === "ArrowRight" || k === "ArrowUp") step(d);
    else if (k === "Home") go(start);
    else if (k === "End") zeit.goLive("taste");
    else return;
    ev.preventDefault();
  };
  const onBandKey = (ev: RKeyboardEvent) => {
    if (ev.key !== "Escape") return;
    if (ev.target === inputRef.current && draft !== null) { setDraft(null); setBad(false); ev.preventDefault(); return; }
    ev.preventDefault();
    zeit.goLive("taste");
  };
  const warn = zeit.remaining !== null && zeit.remaining <= RUECKBLICK_WARN_S;
  const hint = useId();
  return (
    <section className="tb tb-rb" aria-label="Rückblick: Lagezeit wählen" onKeyDown={onBandKey}>
      <label className="tb-at">
        <span>Lage um</span>
        <input ref={inputRef} className={"tb-in tnum" + (bad ? " bad" : "")} inputMode="numeric" autoComplete="off" spellCheck={false}
          value={draft ?? t.slice(11, 16)} aria-invalid={bad || undefined} aria-describedby={bad ? hint : undefined}
          onFocus={(e) => { setDraft(t.slice(11, 16)); e.currentTarget.select(); }}
          onChange={(e) => { setDraft(e.target.value); setBad(false); }}
          onBlur={() => { if (draft !== null && parseLageZeit(draft, { days: ex.days, t, tLive })) commit(); else { setDraft(null); setBad(false); } }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
        <span className="tb-day">{lageZeitText(t, ex.days).split(" ")[0]}</span>
      </label>
      {bad && <span className="tb-bad" id={hint} role="alert">⛔ «{draft}» ist keine Uhrzeit.</span>}
      <span className="tb-steps" data-zaehl="rueckblick-zurueck">
        <button type="button" onClick={() => step(-60)}>−1 h</button>
        <button type="button" onClick={() => step(-30)}>−30 min</button>
      </span>
      <input className="tb-range" type="range" min={0} max={total} step={1} value={pos}
        style={{ ["--p" as string]: `${(pos / total) * 100}%` }}
        aria-label="Lagezeit" aria-valuetext={`${lageZeitText(t, ex.days)}`}
        onChange={(e) => go(shiftMinutes(start, +e.target.value))} onKeyDown={onRangeKey} />
      <span className="tb-steps" data-zaehl="rueckblick-vor">
        <button type="button" onClick={() => step(30)}>+30 min</button>
        <button type="button" onClick={() => step(60)}>+1 h</button>
      </span>
      <span className={"tb-count" + (warn ? " on" : "")} aria-live="polite">
        {warn ? <>zurück zu LIVE in <span className="tnum">{countdownText(zeit.remaining!)}</span></> : ""}
      </span>
      <ShowLastChip zeit={zeit} />
      <button type="button" className="tb-golive" onClick={() => zeit.goLive("knopf")}>Zurück zu LIVE</button>
    </section>
  );
}
