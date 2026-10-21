/**
 * Zeitstrahl mit Schwimmbahnen (eine Spur pro Element): Feind oben, Eigene unten.
 * Punkte = Meldungen (gefüllt mit Ort, hohl ohne Ort), gestrichelte Linie von jeder Sichtung zum Melder.
 * Lagezeit setzen durch Klicken/Ziehen (Maus, Stift, Touch), Abspielen, «Live», Zoom (Ctrl + Mausrad, Pinch).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { axisTicks, buildLanes, clusterX, kindLabel, liveTime, stackOffsets, timeBounds, type DotKind, type Exercise, type Lane, type LaneItem, type LageEvent } from "@lage/core";
import { dayLabel, isoLocal } from "./Timeline";
import "./swimtimeline.css";

export interface SwimTimelineProps {
  events: LageEvent[];
  days: string[];
  units: Exercise["units"];
  /** gewählter Zeitpunkt (ISO lokal «YYYY-MM-DDTHH:MM») oder null = Live */
  value: string | null;
  onChange: (t: string | null) => void;
  selectedId: string | null;
  /** Klick auf einen Punkt: Meldung auswählen (Workspace setzt dann auch die Zeit) */
  onSelect: (id: string) => void;
  /** Präsentation: kompakt, höchstens ca. 25 % der Bildschirmhöhe */
  compact?: boolean;
  /** zusätzlicher Inhalt rechts in der Kopfzeile (z. B. Knöpfe) */
  extra?: ReactNode;
  /** optional: eingeklappt (sonst merkt sich der Zeitstrahl den Zustand selbst) */
  collapsed?: boolean;
  onCollapsedChange?: (c: boolean) => void;
}

const MIN = 60000;
const KIND_VAR: Record<DotKind, string> = { eigen: "var(--blau)", feind: "var(--rot)", unklar: "var(--unklar)", ul: "var(--muted)" };
const GROUP_VAR = { feind: "var(--rot)", ul: "var(--muted)", eigen: "var(--blau)" } as const;
/** Abspieltempo in Übungsminuten pro Sekunde; 0 = automatisch (ganze Übung in ca. 30 s) */
const SPEEDS = [0, 1, 5, 15, 60];
const FOLD_KEY = "lage-tools.zeitstrahl.zu";
const SPEED_KEY = "lage-tools.zeitstrahl.tempo";

const hhmm = (ms: number) => isoLocal(ms).slice(11, 16);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const readLS = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLS = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* privat */ } };
const lastIndex = <T,>(a: T[], f: (v: T) => boolean) => { for (let i = a.length - 1; i >= 0; i--) if (f(a[i]!)) return i; return -1; };
const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName));

function useWindowSize() {
  const get = () => (typeof window === "undefined" ? { w: 1440, h: 900 } : { w: window.innerWidth, h: window.innerHeight });
  const [sz, setSz] = useState(get);
  useEffect(() => {
    let id = 0;
    const on = () => { window.clearTimeout(id); id = window.setTimeout(() => setSz(get()), 120); };
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("resize", on); window.clearTimeout(id); };
  }, []);
  return sz;
}

interface Tip { e: LageEvent; x: number; y: number; melder?: boolean }

export function SwimTimeline(p: SwimTimelineProps) {
  const { events, days, units, value, onChange, selectedId, onSelect, compact = false, extra } = p;

  // ---------- Daten ----------
  const { lanes, items } = useMemo(() => buildLanes(events, units), [events, units]);
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const sorted = useMemo(() => [...items].sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id)), [items]);
  const firstMs = sorted[0]?.ms;
  const lastMs = sorted[sorted.length - 1]?.ms;

  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setClock(Date.now()), 30000); return () => window.clearInterval(id); }, []);
  const liveMs = liveTime(lastMs, clock);
  const { t0, t1 } = timeBounds(firstMs, lastMs, liveMs);
  const multiDay = days.length > 1 || (firstMs !== undefined && new Date(t0).getDate() !== new Date(liveMs).getDate());

  // ---------- Zustand ----------
  const { w: winW, h: winH } = useWindowSize();
  /** kleiner Bildschirm (Tablet hochkant, Laptop mit wenig Höhe): standardmässig eingeklappt, offen höchstens ca. 20 % */
  const small = winW < 900 || winH < 800;
  /** wenig Höhe: dichte Spuren (14 px) */
  const dense = !compact && winH < 800;
  // Wahl des Benutzers (eingeklappt/offen) hat Vorrang vor der Voreinstellung nach Bildschirmgrösse
  const [ownFold, setOwnFold] = useState<boolean | null>(() => { const v = readLS(FOLD_KEY); return v === "1" ? true : v === "0" ? false : null; });
  const collapsed = p.collapsed ?? ownFold ?? small;
  const setCollapsed = (c: boolean) => { setOwnFold(c); writeLS(FOLD_KEY, c ? "1" : "0"); p.onCollapsedChange?.(c); };
  const [speed, setSpeedState] = useState(() => { const s = Number(readLS(SPEED_KEY)); return SPEEDS.includes(s) ? s : 0; });
  const setSpeed = (s: number) => { setSpeedState(s); writeLS(SPEED_KEY, String(s)); };
  const [playing, setPlaying] = useState(false);
  const [playMs, setPlayMs] = useState<number | null>(null);
  const [zoom, setZoom] = useState<{ v0: number; v1: number } | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [width, setWidth] = useState(0);

  const live = value === null;
  const valueMs = value ? Date.parse(value) : NaN;
  const cur = playing && playMs !== null ? playMs : Number.isFinite(valueMs) ? valueMs : liveMs;

  // aktuelle Werte für Callbacks (rAF, native Listener)
  const st = useRef({ cur, t0, t1, liveMs, zoom, onChange, onSelect, speed });
  st.current = { cur, t0, t1, liveMs, zoom, onChange, onSelect, speed };

  // ---------- Abspielen (rAF, sanft; Karte wird höchstens ca. 6× pro Sekunde nachgeführt) ----------
  const emitted = useRef<string | null | undefined>(undefined);
  const emit = (t: string | null) => { emitted.current = t; st.current.onChange(t); };
  const playFrom = useRef(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, prev = performance.now(), lastEmit = 0, ms = playFrom.current;
    const tick = (now: number) => {
      const s = st.current;
      const perSec = s.speed || Math.max(1, (s.liveMs - s.t0) / MIN / 30);
      ms += (Math.min(250, now - prev) / 1000) * perSec * MIN;
      prev = now;
      if (ms >= s.liveMs) { setPlaying(false); setPlayMs(null); emit(null); return; }
      setPlayMs(ms);
      const iso = isoLocal(ms);
      if (iso !== emitted.current && now - lastEmit > 160) { lastEmit = now; emit(iso); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps
  // Zeit von aussen geändert (Auswahl im Journal …) → Abspielen anhalten
  useEffect(() => {
    if (playing && emitted.current !== undefined && value !== emitted.current) { setPlaying(false); setPlayMs(null); }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = () => {
    if (!playing) return;
    setPlaying(false);
    if (playMs !== null) emit(isoLocal(playMs));
    setPlayMs(null);
  };
  const togglePlay = () => {
    if (playing) { stop(); return; }
    playFrom.current = live || cur >= liveMs - MIN ? t0 : cur;
    setPlayMs(playFrom.current);
    emit(isoLocal(playFrom.current));
    setPlaying(true);
  };
  /** Lagezeit setzen (ms); am Ende = Live */
  const setTime = (ms: number) => {
    if (playing) { setPlaying(false); setPlayMs(null); }
    const m = clamp(Math.round(ms / MIN) * MIN, t0, liveMs);
    emit(m >= liveMs - MIN / 2 ? null : isoLocal(m));
  };
  const goLive = () => { if (playing) { setPlaying(false); setPlayMs(null); } emit(null); };

  // ---------- Geometrie ----------
  const chartRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [headH, setHeadH] = useState(62);
  useLayoutEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const on = () => setHeadH(el.offsetHeight || 62);
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed, items.length === 0]);

  const v0 = zoom?.v0 ?? t0, v1 = zoom?.v1 ?? t1;
  const nLanes = lanes.length;
  const nGroups = new Set(lanes.map((l) => l.group)).size;
  const longest = lanes.reduce((m, l) => Math.max(m, l.label.length), 4);
  const LM = collapsed ? 12 : Math.round(clamp(18 + longest * (compact ? 6.4 : 7.6), compact ? 56 : 72, 150));
  const RM = 16;
  const W = Math.max(width, 200);
  const plotW = Math.max(40, W - LM - RM);
  const pxPerMin = plotW / Math.max(1, (v1 - v0) / MIN);
  const x = (ms: number) => LM + ((ms - v0) / MIN) * pxPerMin;
  const timeAtX = (px: number) => v0 + ((px - LM) / pxPerMin) * MIN;

  const TOP = compact ? 20 : 24, FOOT = compact ? 16 : 20, GAP = compact ? 5 : 10, PAD = compact ? 2 : 4;
  const gaps = Math.max(0, nGroups - 1) * GAP + 2 * PAD;
  // Höhe: höchstens ca. 30 % des Fensters (kleiner Bildschirm 20 %, Präsentation 25 %), darüber scrollen die Spuren
  // schmal (< 900 px): 20 %; nur wenig Höhe: dichte Spuren (14 px), damit trotzdem alle Platz haben
  const share = compact ? 0.25 : winW < 900 ? 0.2 : 0.3;
  const budget = winH * share - headH - TOP - FOOT - 1;
  const LANE = compact
    ? clamp(Math.floor((budget - gaps) / Math.max(1, nLanes)), 10, 26)
    : dense ? 14 : clamp(Math.floor((budget - gaps) / Math.max(1, nLanes)), 18, 34);
  const R = compact ? clamp(LANE * 0.42, 3.5, 6) : dense ? 5 : 6;
  const bodyMax = Math.max(budget, LANE * 2.5 + gaps);
  const laneY = new Map<string, number>();
  {
    let y = PAD, prevGroup = "";
    for (const l of lanes) {
      if (prevGroup && l.group !== prevGroup) y += GAP;
      laneY.set(l.key, y + LANE / 2);
      y += LANE;
      prevGroup = l.group;
    }
  }
  const bodyH = nLanes * LANE + gaps; // gaps enthält Gruppenabstände und Rand oben/unten

  // Hinweis «+n Spuren», wenn nicht alle Spuren Platz haben
  const [hidden, setHidden] = useState({ above: 0, below: 0 });
  const laneYs = lanes.map((l) => laneY.get(l.key)!);
  const updateHidden = () => {
    const b = bodyRef.current;
    if (!b) { setHidden((h) => (h.above || h.below ? { above: 0, below: 0 } : h)); return; }
    const top = b.scrollTop, bottom = top + b.clientHeight;
    const above = laneYs.filter((y) => y < top + LANE * 0.3).length;
    const below = laneYs.filter((y) => y > bottom - LANE * 0.3).length;
    setHidden((h) => (h.above === above && h.below === below ? h : { above, below }));
  };
  useLayoutEffect(updateHidden); // nach jeder Darstellung prüfen (billig, setzt nur bei Änderung)
  const scrollLanes = (dir: 1 | -1) => { const b = bodyRef.current; if (b) b.scrollBy({ top: dir * Math.max(LANE * 2, b.clientHeight * 0.8), behavior: "smooth" }); };

  // Ausschnitt folgt der Lagezeit (Abspielen, Live), wenn hineingezoomt
  useEffect(() => {
    if (!zoom) return;
    const span = zoom.v1 - zoom.v0;
    if (cur < zoom.v0 || cur > zoom.v1) {
      const a = cur > zoom.v1 ? cur - span * 0.75 : cur - span * 0.25;
      const v0n = clamp(a, t0, t1 - span);
      setZoom({ v0: v0n, v1: v0n + span });
    }
  }, [cur, zoom, t0, t1]);
  // lange Übung: mit den letzten 12 Stunden beginnen
  const autoZoom = useRef<number | null>(null);
  useEffect(() => {
    if (autoZoom.current === t0 || firstMs === undefined) return;
    autoZoom.current = t0;
    if (t1 - t0 > 36 * 3600000) setZoom({ v0: t1 - 12 * 3600000, v1: t1 });
  }, [t0, t1, firstMs]);
  const zoomAt = (factor: number, aroundMs: number) => {
    const z = st.current.zoom ?? { v0: st.current.t0, v1: st.current.t1 };
    const full = st.current.t1 - st.current.t0;
    const span = clamp((z.v1 - z.v0) * factor, 30 * MIN, full);
    if (span >= full - MIN) { setZoom(null); return; }
    const f = (aroundMs - z.v0) / (z.v1 - z.v0);
    const a = clamp(aroundMs - f * span, st.current.t0, st.current.t1 - span);
    setZoom({ v0: a, v1: a + span });
  };

  const LMref = useRef(LM);
  LMref.current = LM;
  // Mausrad: Ctrl/⌘ = Zoom, waagrecht/Shift = verschieben (nur wenn hineingezoomt)
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      const r = el.getBoundingClientRect();
      const s = st.current;
      const z = s.zoom ?? { v0: s.t0, v1: s.t1 };
      const lm = LMref.current;
      const ms = z.v0 + ((ev.clientX - r.left - lm) / Math.max(1, r.width - lm - RM)) * (z.v1 - z.v0);
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        zoomAt(Math.exp(ev.deltaY * 0.004), clamp(ms, z.v0, z.v1));
      } else if (s.zoom && (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) || ev.shiftKey)) {
        ev.preventDefault();
        const d = ((ev.shiftKey ? ev.deltaY : ev.deltaX) / Math.max(1, r.width - lm - RM)) * (z.v1 - z.v0);
        const span = z.v1 - z.v0;
        const a = clamp(z.v0 + d, s.t0, s.t1 - span);
        setZoom({ v0: a, v1: a + span });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [collapsed, items.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Zeiger: Klicken/Ziehen setzt die Lagezeit, zwei Finger = Zoom ----------
  const pointers = useRef(new Map<number, number>());
  const pinch = useRef<{ d: number; span: number; mid: number } | null>(null);
  const dragging = useRef(false);
  const timeAtClient = (clientX: number) => {
    const r = chartRef.current!.getBoundingClientRect();
    return timeAtX(((clientX - r.left) * W) / Math.max(1, r.width));
  };
  const onPointerDown = (ev: RPointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0 && ev.pointerType === "mouse") return;
    const target = ev.target as Element;
    if (chartRef.current) { chartRef.current.dataset.maus = "1"; chartRef.current.focus({ preventScroll: true }); }
    if (target.closest("[data-id],[data-zoom],button")) return;
    const r = chartRef.current!.getBoundingClientRect();
    if (ev.clientX - r.left < LM - 4) return; // Spurnamen
    pointers.current.set(ev.pointerId, ev.clientX);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [number, number];
      pinch.current = { d: Math.max(20, Math.abs(a - b)), span: v1 - v0, mid: timeAtClient((a + b) / 2) };
      dragging.current = false;
      return;
    }
    dragging.current = true;
    try { (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); } catch { /* egal */ }
    setTip(null);
    setTime(timeAtClient(ev.clientX));
  };
  const onPointerMove = (ev: RPointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(ev.pointerId)) pointers.current.set(ev.pointerId, ev.clientX);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [number, number];
      const d = Math.max(20, Math.abs(a - b));
      const want = (pinch.current.span * pinch.current.d) / d;
      const z = st.current.zoom ?? { v0: t0, v1: t1 };
      zoomAt(want / (z.v1 - z.v0), pinch.current.mid);
      return;
    }
    if (dragging.current) setTime(timeAtClient(ev.clientX));
  };
  const onPointerUp = (ev: RPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(ev.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    dragging.current = false;
  };
  const onClick = (ev: RMouseEvent) => {
    const t = ev.target as Element;
    const dot = t.closest("[data-id]");
    if (dot) { stop(); onSelect(dot.getAttribute("data-id")!); return; }
    const zb = t.closest("[data-zoom]");
    if (zb) {
      const [a, b] = zb.getAttribute("data-zoom")!.split(",").map(Number) as [number, number];
      const span = Math.max(45 * MIN, b - a + 40 * MIN);
      const mid = (a + b) / 2;
      const s0 = clamp(mid - span / 2, t0, t1 - span);
      if (span >= t1 - t0) setZoom(null); else setZoom({ v0: s0, v1: s0 + span });
    }
  };
  const onOver = (ev: RPointerEvent) => {
    if (ev.pointerType !== "mouse" || dragging.current) return;
    const g = (ev.target as Element).closest("[data-id]");
    const e = g ? byId.get(g.getAttribute("data-id")!) : undefined;
    if (!g || !e) { if (tip) setTip(null); return; }
    const root = rootRef.current!.getBoundingClientRect();
    const r = g.getBoundingClientRect();
    setTip({ e, x: r.left + r.width / 2 - root.left, y: r.top - root.top, melder: g.hasAttribute("data-melder") });
  };

  // ---------- Tastatur (nur wenn der Zeitstrahl den Fokus hat, nie in Eingabefeldern) ----------
  const rootRef = useRef<HTMLElement>(null);
  const onKeyDown = (ev: RKeyboardEvent) => {
    if (isField(ev.target) || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const onButton = ev.target instanceof HTMLButtonElement;
    const k = ev.key;
    const step = (ev.shiftKey ? 60 : 5) * MIN;
    const base = playing && playMs !== null ? playMs : cur;
    let done = true;
    if (k === "ArrowLeft") setTime(base - step);
    else if (k === "ArrowRight") setTime(base + step);
    else if (k === "Home") setTime(t0);
    else if (k === "End" || k === "l" || k === "L") goLive();
    else if (k === " " && !onButton) togglePlay();
    else if (k === "+" || k === "=") zoomAt(0.6, cur);
    else if (k === "-" || k === "_") zoomAt(1 / 0.6, cur);
    else if (k === "0") setZoom(null);
    else if (k === "Escape" && playing) stop();
    else if (k === "," || k === "." || (k === "Enter" && !onButton)) {
      if (!sorted.length) return;
      const selIdx = selectedId ? sorted.findIndex((i) => i.id === selectedId) : -1;
      let i: number;
      if (k === "Enter") i = Math.max(0, lastIndex(sorted, (s) => s.ms <= cur));
      else if (selIdx >= 0 && sorted[selIdx]!.ms === Math.round(cur / MIN) * MIN) i = selIdx + (k === "." ? 1 : -1);
      else i = k === "." ? sorted.findIndex((s) => s.ms > cur) : lastIndex(sorted, (s) => s.ms < cur);
      const it = sorted[clamp(i, 0, sorted.length - 1)];
      if (it && i >= 0 && i < sorted.length) { stop(); onSelect(it.id); }
    } else done = false;
    if (done) ev.preventDefault();
  };

  // ---------- Zeichnen ----------
  const ticks = useMemo(() => axisTicks(v0, v1, pxPerMin, compact ? 76 : 84, compact ? 30 : 40), [v0, v1, pxPerMin, compact]);
  const tickLabel = (ms: number, i: number) => {
    const d = new Date(ms);
    const showDay = multiDay && (i === 0 || (d.getHours() === 0 && d.getMinutes() === 0));
    return showDay ? `${dayLabel(isoLocal(ms), days)} ${hhmm(ms)}` : hhmm(ms);
  };

  const dots = useMemo(() => {
    if (collapsed || !width) return null;
    const vis = sorted.filter((i) => i.ms >= v0 - 10 * MIN && i.ms <= v1 + 10 * MIN);
    const lines: ReactNode[] = [];
    const rings: ReactNode[] = [];
    const pts: ReactNode[] = [];
    const badges: ReactNode[] = [];
    let selPt: ReactNode = null;
    const byLane = new Map<string, LaneItem[]>();
    for (const it of vis) { const a = byLane.get(it.lane); if (a) a.push(it); else byLane.set(it.lane, [it]); }
    const placed = new Map<string, { cx: number; cy: number }>();
    for (const [lk, arr] of byLane) {
      const ly = laneY.get(lk)!;
      const cl = clusterX(arr.map((i) => x(i.ms)), Math.max(R * 2, 12));
      let gi = 0;
      while (gi < arr.length) {
        const size = cl[gi]!.size;
        const grp = arr.slice(gi, gi + size);
        const gx = x(grp[0]!.ms) + (x(grp[grp.length - 1]!.ms) - x(grp[0]!.ms)) / 2;
        const so = stackOffsets(size, LANE, R);
        grp.forEach((it, j) => {
          const o = so.offs[j];
          if (!o) return;
          placed.set(it.id, { cx: size === 1 ? x(it.ms) : gx + o.dx, cy: ly + o.dy });
        });
        if (so.badge && so.overflow) {
          const hidden = grp.slice(so.offs.length);
          badges.push(
            <g key={"b" + grp[0]!.id} className="swt-badge" data-zoom={`${grp[0]!.ms},${grp[grp.length - 1]!.ms}`}>
              <title>{`${so.overflow} weitere Meldungen ${hhmm(hidden[0]!.ms)}–${hhmm(hidden[hidden.length - 1]!.ms)} – klicken zum Vergrössern`}</title>
              <circle cx={gx + so.badge.dx} cy={ly + so.badge.dy} r={R + 1.5} />
              <text x={gx + so.badge.dx} y={ly + so.badge.dy + 3}>+{so.overflow}</text>
            </g>,
          );
        }
        gi += size;
      }
    }
    for (const it of vis) {
      const pos = placed.get(it.id);
      if (!pos) continue;
      const color = KIND_VAR[it.kind];
      const sel = it.id === selectedId;
      const my = it.melderLane ? laneY.get(it.melderLane) : undefined;
      if (my !== undefined) {
        const mx = x(it.ms);
        lines.push(<line key={"l" + it.id} className={"swt-link" + (sel ? " sel" : "")} x1={pos.cx} y1={pos.cy} x2={mx} y2={my} />);
        rings.push(
          <g key={"m" + it.id} data-id={it.id} data-melder="" className={"swt-melder" + (sel ? " sel" : "")}>
            <circle className="hit" cx={mx} cy={my} r={Math.max(8, R)} />
            <circle cx={mx} cy={my} r={compact ? 2.6 : 3.5} />
          </g>,
        );
      }
      const dot = (
        <g key={it.id} data-id={it.id} className={"swt-dot" + (sel ? " sel" : "")}>
          <circle className="hit" cx={pos.cx} cy={pos.cy} r={Math.max(R + 4, 10)} />
          {sel && <circle className="swt-selring" cx={pos.cx} cy={pos.cy} r={R + 4} />}
          <circle cx={pos.cx} cy={pos.cy} r={it.located ? R : R - 0.6}
            style={it.located ? { fill: color, stroke: "var(--swt-bg)", strokeWidth: 1.5 } : { fill: "var(--swt-bg)", stroke: color, strokeWidth: 2.2 }} />
        </g>
      );
      if (sel) selPt = dot; else pts.push(dot);
    }
    return <>{lines}{rings}{pts}{badges}{selPt}</>;
  }, [sorted, v0, v1, width, W, LM, LANE, R, selectedId, collapsed, compact, lanes]); // eslint-disable-line react-hooks/exhaustive-deps

  const cx = x(cur);
  const curVisible = cur >= v0 - MIN && cur <= v1 + MIN;
  const endX = x(t1);
  const fit = zoom === null;
  const curIso = isoLocal(cur);
  const pct = clamp(((cur - t0) / Math.max(MIN, liveMs - t0)) * 100, 0, 100);
  const empty = items.length === 0;

  const veil = (y: number, h: number) =>
    curVisible || cur < v0 ? <rect className="swt-veil" x={clamp(cx + R + 1, LM, W - RM)} y={y} width={Math.max(0, Math.min(endX, W - RM) - clamp(cx + R + 1, LM, W - RM))} height={h} /> : null;

  const laneLabel = (l: Lane) => {
    const y = laneY.get(l.key)!;
    const fs = compact ? Math.min(12, LANE - 1) : Math.min(15, LANE - 1);
    return (
      <g key={l.key} className={"swt-lane" + (l.sammel ? " sammel" : "") + (l.count === 0 ? " leer" : "")}>
        {!compact && <rect x={4} y={y - 7} width={4} height={14} rx={1} style={{ fill: GROUP_VAR[l.group] }} />}
        <text x={compact ? 10 : 14} y={y + fs * 0.34} style={{ fontSize: fs }}>{l.label}</text>
        <line className="swt-sep" x1={LM} x2={W - RM} y1={y + LANE / 2} y2={y + LANE / 2} />
        <title>{`${l.label}: ${l.count} Meldung${l.count === 1 ? "" : "en"}${l.sammel ? " ohne bekanntes Element" : ""}`}</title>
      </g>
    );
  };
  const groupBars = compact
    ? (["feind", "ul", "eigen"] as const).map((g) => {
        const ls = lanes.filter((l) => l.group === g);
        if (!ls.length) return null;
        const y0 = laneY.get(ls[0]!.key)! - LANE / 2, y1 = laneY.get(ls[ls.length - 1]!.key)! + LANE / 2;
        return <rect key={g} x={3} y={y0 + 1} width={3} height={y1 - y0 - 2} style={{ fill: GROUP_VAR[g] }} />;
      })
    : null;

  const header = (
    <div className="swt-bar" ref={headRef}>
      <button className="swt-play" onClick={togglePlay} disabled={empty} aria-label={playing ? "Anhalten" : "Abspielen"} title={playing ? "Anhalten (Leertaste)" : "Abspielen (Leertaste)"}>
        {playing
          ? <svg viewBox="0 0 15 15" aria-hidden="true"><rect x="2.5" y="2" width="3.6" height="11" rx="1" /><rect x="8.9" y="2" width="3.6" height="11" rx="1" /></svg>
          : <svg viewBox="0 0 15 15" aria-hidden="true"><path d="M4 2.2v10.6c0 .5.5.8.9.5l8.2-5.3a.6.6 0 0 0 0-1L4.9 1.7C4.5 1.4 4 1.7 4 2.2Z" /></svg>}
      </button>
      <output className="swt-now" aria-label="Lagezeit">
        Lage {multiDay && <span className="swt-day">{dayLabel(curIso, days)}</span>} <span className="tnum">{hhmm(cur)}</span>
      </output>
      <input className="swt-range" type="range" min={t0} max={liveMs} step={MIN} value={clamp(cur, t0, liveMs)} disabled={empty}
        style={{ ["--p" as string]: `${pct}%` }} aria-label="Lagezeit" aria-valuetext={`${multiDay ? dayLabel(curIso, days) + " " : ""}${hhmm(cur)}${live ? " (Live)" : ""}`}
        onChange={(e) => setTime(+e.target.value)} />
      <select className="swt-speed" value={speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="Abspieltempo" title="Abspieltempo in Übungsminuten pro Sekunde (auto: ganze Übung in ca. 30 s)">
        {SPEEDS.map((s) => <option key={s} value={s}>{s ? `${s} min/s` : "auto"}</option>)}
      </select>
      <button className="swt-chip swt-live" aria-pressed={live} onClick={goLive} title="Immer die neuste Lage zeigen (L)"><i aria-hidden="true" />Live</button>
      {!compact || !collapsed ? (
        <button className="swt-chip" aria-pressed={fit} onClick={() => setZoom(null)} disabled={empty}
          title="Ganze Zeitachse zeigen (Zoom zurücksetzen) – die Lagezeit bleibt. Vergrössern: Ctrl + Mausrad, zwei Finger oder + / −. Neuste Lage: «Live»">Ganze Achse</button>
      ) : null}
      {extra}
      <button className="swt-fold" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-label={collapsed ? "Zeitstrahl aufklappen" : "Zeitstrahl einklappen"} title={collapsed ? "Spuren zeigen" : "Spuren ausblenden"}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d={collapsed ? "M4 6l4 4 4-4" : "M4 10l4-4 4 4"} /></svg>
      </button>
    </div>
  );

  const chartProps = {
    ref: chartRef,
    tabIndex: 0,
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp,
    onClick, onPointerOver: onOver, onPointerLeave: () => setTip(null),
    onBlur: () => { if (chartRef.current) delete chartRef.current.dataset.maus; },
    onKeyDown: () => { if (chartRef.current) delete chartRef.current.dataset.maus; },
    "aria-label": "Zeitstrahl: Klicken oder Ziehen setzt die Lagezeit. Pfeiltasten ±5 min (Shift ±1 h), Leertaste Abspielen, L Live, Komma/Punkt vorige/nächste Meldung, + / − Zoom.",
  };

  let body: ReactNode;
  if (empty) {
    body = (
      <div className="swt-empty">
        <b>Noch keine Meldungen.</b> Jede erfasste Meldung erscheint hier als Punkt in der Spur ihres Elements – Feind oben, Eigene unten.
      </div>
    );
  } else if (collapsed) {
    const MH = 18;
    body = (
      <div className="swt-chart swt-mini" {...chartProps}>
        <svg width={W} height={MH} role="presentation">
          <line className="swt-sep" x1={LM} x2={W - RM} y1={MH / 2} y2={MH / 2} />
          {sorted.filter((i) => i.ms >= v0 && i.ms <= v1).map((i) => (
            <circle key={i.id} data-id={i.id} cx={x(i.ms)} cy={MH / 2} r={i.id === selectedId ? 4.5 : 3.2}
              style={i.located ? { fill: KIND_VAR[i.kind] } : { fill: "var(--swt-bg)", stroke: KIND_VAR[i.kind], strokeWidth: 1.5 }} />
          ))}
          {veil(1, MH - 2)}
          {curVisible && <line className="swt-cursor" x1={cx} x2={cx} y1={0} y2={MH} />}
        </svg>
      </div>
    );
  } else {
    body = (
      <div className="swt-chart" {...chartProps}>
        <svg className="swt-axis" width={W} height={TOP} role="presentation">
          {ticks.minor.map((t) => <line key={t} className="swt-minor" x1={x(t)} x2={x(t)} y1={TOP - 6} y2={TOP} />)}
          {ticks.major.map((t, i) => {
            const label = tickLabel(t, i);
            const tw = label.length * 7.3;
            const lx = clamp(x(t), tw / 2 + 2, W - tw / 2 - 2);
            return (
              <g key={t}>
                <line className="swt-major" x1={x(t)} x2={x(t)} y1={TOP - 8} y2={TOP} />
                <text x={lx} y={TOP - 11}>{label}</text>
              </g>
            );
          })}
          {veil(TOP - 8, 8)}
          {curVisible && <line className="swt-cursor" x1={cx} x2={cx} y1={TOP - 8} y2={TOP} />}
        </svg>
        <div className="swt-bodywrap">
        {hidden.above > 0 && (
          <button className="swt-more up" onClick={() => scrollLanes(-1)} style={{ width: LM - 8 }} aria-label={`${hidden.above} Spuren weiter oben zeigen`}>▴ +{hidden.above} Spuren</button>
        )}
        {hidden.below > 0 && (
          <button className="swt-more down" onClick={() => scrollLanes(1)} style={{ width: LM - 8 }} aria-label={`${hidden.below} weitere Spuren zeigen`}>▾ +{hidden.below} Spuren</button>
        )}
        <div className="swt-body" ref={bodyRef} onScroll={updateHidden} style={{ maxHeight: Math.round(bodyMax) }}>
          <svg width={W} height={bodyH} role="presentation">
            <rect className="swt-plotbg" x={LM} y={0} width={plotW} height={bodyH} />
            {ticks.minor.map((t) => <line key={t} className="swt-minor" x1={x(t)} x2={x(t)} y1={0} y2={bodyH} />)}
            {ticks.major.map((t) => <line key={t} className="swt-major" x1={x(t)} x2={x(t)} y1={0} y2={bodyH} />)}
            {groupBars}
            {lanes.map(laneLabel)}
            <g className="swt-dots">{dots}</g>
            {veil(0, bodyH)}
            {curVisible && <line className="swt-cursor" x1={cx} x2={cx} y1={0} y2={bodyH} />}
          </svg>
        </div>
        </div>
        <svg className="swt-foot" width={W} height={FOOT} role="presentation">
          {curVisible && <line className="swt-cursor" x1={cx} x2={cx} y1={0} y2={4} />}
          {curVisible && <text className="swt-curlabel" x={clamp(cx, LM + 18, W - RM - 18)} y={FOOT - (compact ? 4 : 5)}>{hhmm(cur)}</text>}
          {!fit && (() => {
            const note = `Ausschnitt ${tickLabel(v0, 0)} – ${hhmm(v1)}`;
            const right = !curVisible || cx < W - RM - note.length * 6.8 - 40;
            return <text className="swt-zoomnote" x={right ? W - RM : LM} y={FOOT - (compact ? 4 : 5)} style={{ textAnchor: right ? "end" : "start" }}>{note}</text>;
          })()}
        </svg>
      </div>
    );
  }

  return (
    <section ref={rootRef} className={"swt" + (compact ? " compact" : "") + (dense ? " dense" : "") + (collapsed ? " collapsed" : "") + (playing ? " playing" : "")}
      aria-label="Zeitstrahl" onKeyDown={onKeyDown}>
      {header}
      {body}
      {tip && <TipBox tip={tip} days={days} multiDay={multiDay} width={W} />}
    </section>
  );
}

function TipBox({ tip, days, multiDay, width }: { tip: Tip; days: string[]; multiDay: boolean; width: number }) {
  const e = tip.e;
  const where = e.cells?.length ? e.cells.join(", ") : e.where;
  const located = !!(e.pos || e.cells?.length);
  const who = e.unit || (e.side === "blau" ? e.melder : "") || (e.side === "rot" ? "Sichtung" : "");
  const left = clamp(tip.x, 140, Math.max(140, width - 140));
  const below = tip.y < 70;
  return (
    <div className={"swt-tip" + (below ? " below" : "")} style={{ left, top: below ? tip.y + 26 : tip.y - 8 }} role="tooltip">
      <div className="swt-tip-h">
        <span className="tnum">{multiDay ? dayLabel(e.t, days) + " " : ""}{e.t.slice(11, 16)}</span>
        <b style={{ color: e.side === "rot" && e.aff === "N" ? "var(--ok)" : KIND_VAR[e.side === "blau" ? "eigen" : e.side === "ul" ? "ul" : e.aff === "U" ? "unklar" : "feind"] }}>{who}</b>
        <span className="swt-kind">{e.side === "rot" && e.aff === "N" ? "Neutral" : kindLabel(e)}</span>
      </div>
      <div className="swt-tip-t">{e.text}</div>
      <div className="swt-tip-m tnum">
        {located ? where || "Ort auf Karte" : "ohne Ort"}
        {e.melder && e.melder !== e.unit ? ` · gemeldet von ${e.melder}` : ""}
      </div>
    </div>
  );
}
