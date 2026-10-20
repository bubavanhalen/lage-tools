/**
 * Zeitstrahl über der Karte: Lage zu jedem Zeitpunkt, Abspielen, «Live» (immer die neuste Lage).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { LageEvent } from "@lage/core";
import { SIDE_COLOR } from "./journalLayer";

interface Props {
  events: LageEvent[];
  days: string[];
  /** null = Live */
  value: string | null;
  onChange: (t: string | null) => void;
}

const toMs = (t: string) => Date.parse(t);
const pad = (n: number) => String(n).padStart(2, "0");
export const isoLocal = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dayLabel = (t: string, days: string[]) => { const i = days.indexOf(t.slice(0, 10)); return i >= 0 ? `T${i + 1}` : t.slice(5, 10).split("-").reverse().join("."); };

const SPEEDS = [1, 5, 15, 60]; // Übungsminuten pro Sekunde

export function Timeline({ events, days, value, onChange }: Props) {
  const live = events.filter((e) => !e.deleted);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(id); }, []);

  const { start, end } = useMemo(() => {
    if (!live.length) return { start: now - 3600000, end: now };
    const ts = live.map((e) => toMs(e.t));
    const first = Math.min(...ts), last = Math.max(...ts);
    const nowInRange = now >= first && now - last < 12 * 3600000;
    return { start: first - 15 * 60000, end: Math.max(last + 15 * 60000, nowInRange ? now : 0) };
  }, [live, now]);

  const cur = value ? toMs(value) : end;
  const ref = useRef({ cur, end });
  ref.current = { cur, end };
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const next = ref.current.cur + speed * 60000 * 0.2;
      if (next >= ref.current.end) { setPlaying(false); onChange(null); } else onChange(isoLocal(next));
    }, 200);
    return () => window.clearInterval(id);
  }, [playing, speed, onChange]);

  const span = Math.max(1, end - start);
  const frac = (ms: number) => Math.min(1, Math.max(0, (ms - start) / span));
  // Tagesgrenzen
  const midnights: number[] = [];
  for (let d = new Date(start); d.getTime() < end; d.setDate(d.getDate() + 1)) {
    const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    if (m > start && m < end) midnights.push(m);
  }
  const curIso = isoLocal(cur);

  return (
    <div className="timeline">
      <button className="tl-play" onClick={() => { if (!playing && value === null) onChange(isoLocal(start)); setPlaying(!playing); }} aria-label={playing ? "Anhalten" : "Abspielen"} title={playing ? "Anhalten" : "Abspielen"}>{playing ? "❚❚" : "▶"}</button>
      <select value={speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="Tempo" title="Übungsminuten pro Sekunde">
        {SPEEDS.map((s) => <option key={s} value={s}>{s} min/s</option>)}
      </select>
      <div className="tl-time mono"><b>{dayLabel(curIso, days)} {curIso.slice(11, 16)}</b></div>
      <div className="tl-track">
        <div className="tl-ticks">
          {midnights.map((m) => <span key={m} className="tl-mid" style={{ left: `${frac(m) * 100}%` }} title={dayLabel(isoLocal(m), days)} />)}
          {live.map((e) => <span key={e.id} className="tl-ev" style={{ left: `${frac(toMs(e.t)) * 100}%`, background: SIDE_COLOR[e.side] }} />)}
        </div>
        <input type="range" min={start} max={end} step={60000} value={cur} aria-label="Zeitpunkt"
          onChange={(e) => { setPlaying(false); const v = +e.target.value; onChange(v >= end - 60000 ? null : isoLocal(v)); }} />
      </div>
      <button className={"tl-live" + (value === null ? " on" : "")} onClick={() => { setPlaying(false); onChange(null); }} title="Immer die neuste Lage zeigen">Live</button>
    </div>
  );
}
