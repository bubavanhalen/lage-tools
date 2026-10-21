/**
 * Über der Karte: Banner mit der gewählten Meldung (oben links neben dem Zoom) und
 * Legende (unten links, aus dem tatsächlich Sichtbaren gebaut, einklappbar).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { kindLabel, symbolDef, type Area, type LageEvent } from "@lage/core";
import { symbolSvg } from "@lage/map";
import type { LayerFlags } from "./layers";
import { kindOf, situationModel, STALE_MIN } from "./journalLayer";
import { getSituationLayout, subscribeSituationLayout } from "./situationLayer";
import { dayLabel } from "./Timeline";
import "./mapoverlays.css";

const UNIT_VAR = { eigen: "var(--blau)", feind: "var(--rot)", unklar: "var(--unklar)", ul: "var(--muted)" } as const;

function Sym({ k, aff, size }: { k: string; aff: LageEvent["aff"]; size: number }) {
  const s = useMemo(() => symbolSvg(k, aff, size), [k, aff, size]);
  return <span className="mo-sym" aria-hidden dangerouslySetInnerHTML={{ __html: s.svg }} />;
}

// ---------------------------------------------------------------- Banner

export interface EventBannerProps {
  event: LageEvent | null;
  days: string[];
  onClose: () => void;
  /** optional: Knopf «Bearbeiten» */
  onEdit?: (e: LageEvent) => void;
}

export function EventBanner({ event, days, onClose, onEdit }: EventBannerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ maxW?: number; top?: number }>({});

  // nicht unter die Kartenwerkzeuge (oben rechts) schieben: Breite begrenzen oder darunter ausweichen
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const fit = () => {
      const tools = box.querySelector<HTMLElement>(".maptools");
      const b = box.getBoundingClientRect();
      const left = el.offsetLeft;
      if (!tools) { setPlace({}); return; }
      const t = tools.getBoundingClientRect();
      const free = t.left - b.left - left - 12;
      if (free >= 360) setPlace({ maxW: Math.min(free, 900) });
      else setPlace({ maxW: b.width - left - 12, top: t.bottom - b.top + 8 });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    const tools = box.querySelector(".maptools");
    if (tools) ro.observe(tools);
    return () => ro.disconnect();
  }, [event === null]);

  // Esc schliesst (nicht während der Eingabe in einem Feld)
  useEffect(() => {
    if (!event) return;
    const key = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (ev.key !== "Escape" || ev.defaultPrevented || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [event, onClose]);

  if (!event) return null;
  const kind = kindOf(event);
  const time = (days.length ? dayLabel(event.t, days) + " " : "") + event.t.slice(11, 16);
  const where = event.cells?.length ? event.cells.join(" · ") : event.where ?? "";
  const unit = event.unit || (kind === "eigen" ? event.melder ?? "" : "");
  return (
    <div ref={ref} className="mo-banner" role="status" aria-label="Gewählte Meldung"
      style={{ maxWidth: place.maxW, top: place.top }}>
      <span className="mo-time tnum">{time}</span>
      <span className={`mo-kind k-${kind}`}>{kindLabel(event)}</span>
      <Sym k={event.sym} aff={event.aff} size={14} />
      {unit && <span className="mo-unit" style={{ color: UNIT_VAR[kind] }}>{unit}</span>}
      {kind !== "eigen" && event.melder && <span className="mo-via">via {event.melder}</span>}
      {where && <span className="mo-pq tnum">{where}</span>}
      <span className="mo-msg">{event.text}</span>
      {onEdit && <button className="mo-btn" onClick={() => onEdit(event)} title="Meldung bearbeiten">✎ Bearbeiten</button>}
      <button className="mo-x" onClick={onClose} aria-label="Auswahl aufheben" title="Schliessen (Esc)">×</button>
    </div>
  );
}

// ---------------------------------------------------------------- Legende

export interface LegendProps {
  events: LageEvent[];
  t: string;
  flags: LayerFlags;
  /** Flächen der Übung (für NAI / AO / Stao); ohne Angabe keine Flächeneinträge */
  areas?: Area[];
  /** wie bei der Kartenebene (Standard 30) */
  recentMin?: number;
  selectedId?: string | null;
}

const FOLD_KEY = "lage-tools.legende.zu";
const AFF_SUFFIX: Record<string, string> = { F: " (eigene)", U: " (unklar)", N: " (neutral / UL)" };

const LineSample = ({ color, dash, dots, width = 2.5 }: { color: string; dash?: string; dots?: boolean; width?: number }) => (
  <svg viewBox="0 0 24 14" width="24" height="14" aria-hidden>
    <path d="M1 7 H23" stroke={color} strokeWidth={width} strokeDasharray={dash} />
    {dots && <circle cx="6" cy="7" r="2.3" fill="#fff" stroke={color} strokeWidth="1.4" />}
  </svg>
);
const AreaSample = ({ color, dash, fill }: { color: string; dash?: string; fill?: string }) => (
  <svg viewBox="0 0 24 14" width="24" height="14" aria-hidden>
    <rect x="2" y="2" width="20" height="10" fill={fill ?? "none"} fillOpacity=".14" stroke={color} strokeWidth="2" strokeDasharray={dash} />
  </svg>
);

function readFold(): boolean {
  try {
    const v = localStorage.getItem(FOLD_KEY);
    if (v !== null) return v === "1";
  } catch { /* egal */ }
  return typeof window !== "undefined" && (window.innerWidth < 1100 || window.matchMedia?.("(pointer: coarse)").matches);
}

export function Legend({ events, t, flags, areas, recentMin = 30, selectedId = null }: LegendProps) {
  const [folded, setFolded] = useState(readFold);
  const layout = useSyncExternalStore(subscribeSituationLayout, getSituationLayout);
  const model = useMemo(() => situationModel(events, t, flags, { recentMin, selectedId }), [events, t, flags, recentMin, selectedId]);

  const entries = useMemo(() => {
    const out: Array<{ key: string; icon: ReactNode; label: string }> = [];
    const seen = new Set<string>();
    const order = { eigen: 0, feind: 1, unklar: 2, ul: 3 } as const;
    [...model.items].sort((a, b) => order[a.kind] - order[b.kind] || a.sym.localeCompare(b.sym)).forEach((it) => {
      const k = `${it.sym}|${it.aff}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ key: k, icon: <Sym k={it.sym} aff={it.aff} size={16} />, label: symbolDef(it.sym).name + (AFF_SUFFIX[it.aff] ?? "") });
    });
    if (model.tracks.some((x) => x.side === "blau")) out.push({ key: "spur-b", icon: <LineSample color="#1F5FB8" dash="5 3" dots width={2} />, label: "Spur eigene" });
    if (model.tracks.some((x) => x.side !== "blau")) out.push({ key: "spur-r", icon: <LineSample color="#D3262D" dash="5 3" dots width={2} />, label: "Spur Feind" });
    if (flags.nai && areas?.length) {
      if (areas.some((a) => a.kind === "nai" || a.kind === "other")) out.push({ key: "nai", icon: <AreaSample color="#1F78D1" fill="#1F78D1" />, label: "NAI" });
      if (areas.some((a) => a.kind === "ao")) out.push({ key: "ao", icon: <AreaSample color="#0B3D91" dash="4 3" />, label: "AO" });
      if (areas.some((a) => a.kind === "stao")) out.push({ key: "stao", icon: <AreaSample color="#B3242A" dash="3 2" fill="#D3262D" />, label: "Stao" });
    }
    if (model.items.some((i) => i.showTime)) out.push({ key: "zeit", icon: <span className="mo-tl tnum">hh:mm</span>, label: `Meldung jünger als ${recentMin} min` });
    if (model.items.some((i) => i.opacity < 1)) {
      const old = model.items.find((i) => i.opacity < 1)!;
      out.push({ key: "blass", icon: <span style={{ opacity: 0.45 }}><Sym k={old.sym} aff={old.aff} size={16} /></span>, label: `blass = älter als ${recentMin} min` });
    }
    if (model.items.some((i) => i.kind === "eigen" && i.isUnit && i.silentMin > STALE_MIN)) out.push({ key: "alt", icon: <span className="mo-tl tnum">75′</span>, label: `keine Meldung seit über ${STALE_MIN} min` });
    if (layout.moved > 0) out.push({
      key: "lead",
      icon: <svg viewBox="0 0 24 14" width="24" height="14" aria-hidden><path d="M4 10 L20 4" stroke="currentColor" strokeWidth="1.5" /><circle cx="4" cy="10" r="3" fill="currentColor" /></svg>,
      label: "versetzt, Punkt = wahrer Ort",
    });
    return out;
  }, [model, flags.nai, areas, recentMin, layout.moved]);

  if (!entries.length) return null;
  const toggle = () => {
    const v = !folded;
    setFolded(v);
    try { localStorage.setItem(FOLD_KEY, v ? "1" : "0"); } catch { /* egal */ }
  };
  return (
    <section className={`mo-legend${folded ? " folded" : ""}`} aria-label="Legende">
      <button className="mo-legend-h" onClick={toggle} aria-expanded={!folded}>
        <span>Legende</span>
        <span className="mo-chev" aria-hidden>{folded ? "▴" : "▾"}</span>
      </button>
      {!folded && (
        <ul className="mo-legend-l">
          {entries.map((x) => <li key={x.key}><span className="mo-ic">{x.icon}</span>{x.label}</li>)}
        </ul>
      )}
    </section>
  );
}
