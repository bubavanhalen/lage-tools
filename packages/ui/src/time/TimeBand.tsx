/**
 * Live-Band unter der Karte (Spez. MVP 1, Kap. 2.1, 2.6, 3.5):
 * - LIVE: «● LIVE  T2 07:25 · letzte Meldung 07:25 · [zeigt nur letzte 2 h ✕] · [⏪ Zurückblicken]» (eine Zeile, 56 px),
 * - RÜCKBLICK (Grundansicht): Rückblick-Leiste «Lage um [05:30] [−1 h][−30 min] ━━●━━ [+30 min][+1 h]
 *   · zurück zu LIVE in 0:20 · [Zurück zu LIVE]» – auf schmaler Breite zweizeilig, Regler über die ganze Breite,
 * - Experte: ganzer Zeitstrahl (`SwimTimeline`) statt Band und Leiste; Band oben und Rahmen gelten gleich.
 * Nichts wird gespeichert; alle Zeitwechsel laufen über die `ZeitApi` (useLageZeit).
 *
 * MVP 3.5 (E6, S22/S23): LIVE zeigt immer die Geräteuhr (`tUhr`, `liveAnzeige`); Lagezeiten tragen den Offset, alle
 * Vergleiche über `zeitCmp`. «Lage um»: nach Enter und beim Fokus ist der Inhalt markiert, Eingabe ersetzt ihn; in der
 * doppelten Stunde (Rückstellung) zwei Knöpfe «02:30 MESZ» / «02:30 MEZ» statt sofortigem Sprung; fehlende Stunde
 * (Vorstellen): «02:30 gibt es heute nicht». Unter 420 px heisst «Zurückblicken» nur «« (Name bleibt).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent } from "react";
import { addMinuten, countdownText, lageZeitText, mitOffset, offsetOf, offsetsAt, parseLageZeit, showLastLabel, zeitCmp, zeitMs, zeitTeile } from "@lage/core";
import type { TimeBandProps } from "../shell/contracts";
import { SwimTimeline } from "../SwimTimeline";
import { RUECKBLICK_WARN_S, liveAnzeige } from "./useLageZeit";
import "./time.css";

const MIN = 60000;
/** «Zurückblicken» gedrückt: die Rückblick-Leiste setzt beim Erscheinen den Fokus auf «Lage um» (M1) */
let focusLageUm = false;
/** Regler: Anfang der Übung (erste Meldung, auf die volle Stunde abgerundet) – Lagezeit mit Offset */
function rangeStart(firstReport: string | null, tLive: string): string {
  const base = firstReport && zeitCmp(firstReport, tLive) < 0 ? firstReport : addMinuten(tLive, -6 * 60);
  const h = `${base.slice(0, 13)}:00`;
  return mitOffset(h, zeitTeile(base).off ?? offsetOf({ t: h }));
}
/** «02:30 MESZ» / «02:30 MEZ» (Mitteleuropa), sonst «02:30 +02:00» */
export function lesartText(t: string, off: string, offs: string[]): string {
  const mez = offs[0] === "+02:00" && offs[1] === "+01:00";
  return `${t.slice(11, 16)} ${mez ? (off === "+02:00" ? "MESZ" : "MEZ") : off}`;
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
  // schmal (Tablet quer): kurzer Text, damit weder Chip noch «letzte 07:29» abgeschnitten werden
  const kurz = zeit.showLast ? `nur letzte ${showLastLabel(zeit.showLast)}` : `nur ab ${zeit.ab!.slice(11, 16)}`;
  return (
    <button type="button" className="tb-chip" onClick={() => { zeit.setShowLast(null); zeit.setAb?.(null); }}
      aria-label={`${text} – alles zeigen`}>
      <span className="tb-long">{text}</span><span className="tb-short">{kurz}</span> <span aria-hidden="true">✕</span>
    </button>
  );
}

function LiveBand({ ex, zeit, lastReport }: { ex: TimeBandProps["ex"]; zeit: TimeBandProps["zeit"]; lastReport: string | null }) {
  const reason = useId();
  const tLive = zeit.tLive ?? zeit.tNow;
  // S22: LIVE zeigt die Geräteuhr (Meldungen bis 10 min voraus gehören schon zur Lage, verschieben die Anzeige nie)
  const anzeige = zeit.tUhr ? liveAnzeige(tLive, zeit.tUhr) : tLive;
  const back = () => {
    if (!lastReport) return;
    const first = firstReportOf(ex);
    const start = rangeStart(first, tLive);
    const t = addMinuten(tLive, -60);
    focusLageUm = true;
    zeit.lookBack(zeitCmp(t, start) < 0 ? start : t);
  };
  return (
    <section className="tb" aria-label="Lagezeit">
      <span className="tb-live"><i aria-hidden="true" />LIVE</span>
      <span className="tb-time tnum">{lageZeitText(anzeige, ex.days)}</span>
      <span className="tb-last" id={reason}>
        {lastReport
          ? <><span className="tb-long">letzte Meldung </span><span className="tb-short">letzte </span><span className="tnum">{lastReport.slice(11, 16)}</span></>
          : "noch keine Meldung"}
      </span>
      <ShowLastChip zeit={zeit} />
      <button type="button" className="tb-back" onClick={back} disabled={!lastReport} aria-describedby={lastReport ? undefined : reason} aria-label="Zurückblicken">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3 3 8l5 5M13 3 8 8l5 5" /></svg><span className="tb-back-t">Zurückblicken</span>
      </button>
    </section>
  );
}

function firstReportOf(ex: TimeBandProps["ex"]): string | null {
  let m: NonNullable<TimeBandProps["ex"]["events"]>[number] | null = null;
  for (const e of ex.events ?? []) if (!e.deleted && (!m || zeitCmp(e, m) < 0)) m = e;
  return m ? mitOffset(m.t.slice(0, 16), offsetOf(m)) : null;
}

function RueckblickLeiste({ ex, zeit }: { ex: TimeBandProps["ex"]; zeit: TimeBandProps["zeit"] }) {
  const t = zeit.zeit.kind === "rueckblick" ? zeit.zeit.t : zeit.tNow;
  const tLive = zeit.tLive ?? zeit.tNow;
  const start = useMemo(() => rangeStart(firstReportOf(ex), tLive), [ex.events, tLive]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = Math.max(1, Math.round((zeitMs(tLive) - zeitMs(start)) / MIN));
  const pos = Math.min(total, Math.max(0, Math.round((zeitMs(t) - zeitMs(start)) / MIN)));

  // Eingabe «Lage um»: eigener Text, solange das Feld bearbeitet wird
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  /** (MVP 3.5) doppelte Stunde: zwei Lesarten zur Wahl; fehlende Stunde: Hinweis */
  const [wahl, setWahl] = useState<{ t: string; offs: string[] } | null>(null);
  const [fehlt, setFehlt] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setBad(false); }, [t]);
  useEffect(() => { if (focusLageUm) { focusLageUm = false; inputRef.current?.focus(); } }, []);
  /** Inhalt markieren (nach Enter): die nächste Eingabe ersetzt ihn (kein «02:00T1 2000») */
  const markieren = () => requestAnimationFrame(() => { const el = inputRef.current; if (el && document.activeElement === el) el.select(); });
  const go = (to: string) => {
    const clamped = zeitCmp(to, start) < 0 ? start : to;
    zeit.lookBack(clamped);
  };
  const step = (min: number) => go(addMinuten(t, min));
  const commit = () => {
    if (draft === null) return;
    let v = parseLageZeit(draft, { days: ex.days, t: t.slice(0, 16), tLive: tLive.slice(0, 16) });
    if (!v) { setBad(true); return; }
    // doppelte Stunde am Tag der gezeigten Zeit: der Tag bleibt, wenn eine Lesart vor LIVE liegt (der Text-Vergleich in
    // `parseLageZeit` hielte «02:30» um 02:10 MEZ für später und nähme den Vortag)
    const gleich = `${t.slice(0, 10)}T${v.slice(11, 16)}`;
    if (v.slice(0, 10) !== t.slice(0, 10) && !/^\s*t/i.test(draft)) {
      const o2 = offsetsAt(gleich);
      if (o2.length > 1 && zeitMs(mitOffset(gleich, o2[0]!)) <= zeitMs(tLive)) v = gleich;
    }
    setDraft(null);
    setWahl(null); setFehlt(null);
    const offs = offsetsAt(v);
    if (offs.length > 1) { setWahl({ t: v, offs }); markieren(); return; }
    if (!offs.length) { setFehlt(v.slice(11, 16)); markieren(); return; }
    go(mitOffset(v, offs[0]!));
    markieren();
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
          onFocus={(e) => { const el = e.currentTarget; setDraft(t.slice(11, 16)); el.select(); requestAnimationFrame(() => { if (document.activeElement === el) el.select(); }); }}
          onChange={(e) => { setDraft(e.target.value); setBad(false); setWahl(null); setFehlt(null); }}
          onBlur={() => { if (draft !== null && parseLageZeit(draft, { days: ex.days, t, tLive })) commit(); else { setDraft(null); setBad(false); } }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
        <span className="tb-day">{lageZeitText(t, ex.days).split(" ")[0]}</span>
      </label>
      {bad && <span className="tb-bad" id={hint} role="alert">⛔ «{draft}» ist keine Uhrzeit.</span>}
      {wahl && (
        <span className="tb-wahl" role="group" aria-label={`${wahl.t.slice(11, 16)} gibt es heute zweimal – welche?`}>
          {wahl.offs.map((o) => (
            <button key={o} type="button" onClick={() => { const w = wahl; setWahl(null); go(mitOffset(w.t, o)); }}>{lesartText(wahl.t, o, wahl.offs)}</button>
          ))}
        </span>
      )}
      {fehlt && <span className="tb-bad" role="alert">{fehlt} gibt es heute nicht (Uhr vorgestellt).</span>}
      <span className="tb-steps" data-zaehl="rueckblick-zurueck">
        <button type="button" onClick={() => step(-60)}>−1 h</button>
        <button type="button" onClick={() => step(-30)}>−30 min</button>
      </span>
      <input className="tb-range" type="range" min={0} max={total} step={1} value={pos}
        style={{ ["--p" as string]: `${(pos / total) * 100}%` }}
        aria-label="Lagezeit" aria-valuetext={`${lageZeitText(t, ex.days)}`}
        onChange={(e) => go(addMinuten(start, +e.target.value))} onKeyDown={onRangeKey} />
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
