/**
 * Über der Karte: Banner mit der gewählten Meldung (oben links neben dem Zoom) und
 * Legende (unten links, aus dem tatsächlich Sichtbaren gebaut, einklappbar).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { type Area, type LageEvent } from "@lage/core";
import { iconSvg } from "@lage/map";
import type { LayerFlags } from "./layers";
import { kindOf, kindText, situationModel, STALE_MIN } from "./journalLayer";
import { getSituationLayout, subscribeSituationLayout } from "./situationLayer";
import { dayLabel } from "./Timeline";
import "./mapoverlays.css";

const UNIT_VAR = { eigen: "var(--blau)", feind: "var(--rot)", unklar: "var(--unklar)", neutral: "var(--ok)", ul: "var(--muted)" } as const;

function Sym({ k, aff, size, sidc, status }: { k: string; aff: LageEvent["aff"]; size: number; sidc?: string; status?: LageEvent["status"] }) {
  const s = useMemo(() => iconSvg(k, aff, size, { sidc, status }), [k, aff, size, sidc, status]);
  return <span className="mo-sym" aria-hidden dangerouslySetInnerHTML={{ __html: s.svg }} />;
}

// ---------------------------------------------------------------- Banner

export interface EventBannerProps {
  event: LageEvent | null;
  days: string[];
  onClose: () => void;
  /** optional: Knopf «Bearbeiten» */
  onEdit?: (e: LageEvent) => void;
  /** optional: Anhänge (Miniatur/Büroklammer) nach dem Meldungstext */
  extra?: ReactNode;
}

export function EventBanner({ event, days, onClose, onEdit, extra }: EventBannerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ maxW?: number; top?: number; maxH?: number }>({});

  // Platz finden: nicht unter die Kartenwerkzeuge (oben rechts, ggf. zwei Zeilen), die Legende und die Statuszeile
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const fit = () => {
      const b = box.getBoundingClientRect();
      const left = el.offsetLeft;
      const tools = box.querySelector<HTMLElement>(".maptools");
      let top = 10, maxW = Math.min(900, b.width - left - 12);
      if (tools && tools.offsetWidth) {
        const t = tools.getBoundingClientRect();
        const free = t.left - b.left - left - 12;
        if (free >= 360) maxW = Math.min(free, 900);
        else top = t.bottom - b.top + 8;
      }
      // unten: Legende bzw. Statuszeile (die höhere der beiden)
      let bottom = b.height;
      for (const sel of ["[data-legend]", ".status"]) {
        const o = box.querySelector<HTMLElement>(sel);
        if (o && o.offsetHeight) bottom = Math.min(bottom, o.getBoundingClientRect().top - b.top);
      }
      setPlace({ maxW, top, maxH: Math.max(48, bottom - top - 8) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    for (const sel of [".maptools", "[data-legend]", ".status"]) {
      const o = box.querySelector(sel);
      if (o) ro.observe(o);
    }
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
      style={{ maxWidth: place.maxW, top: place.top, maxHeight: place.maxH }}>
      <span className="mo-time tnum">{time}</span>
      <span className={`mo-kind k-${kind}`}>{kindText(event)}</span>
      <Sym k={event.sym} aff={event.aff} size={14} sidc={event.sidc} status={event.status} />
      {unit && <span className="mo-unit" style={{ color: UNIT_VAR[kind] }}>{unit}</span>}
      {kind !== "eigen" && event.melder && <span className="mo-via">via {event.melder}</span>}
      {where && <span className="mo-pq tnum">{where}</span>}
      {event.road && <span className="mo-road">auf {event.road}</span>}
      {event.desc && <span className="mo-desc">{event.desc}</span>}
      <span className="mo-msg">{event.text}</span>
      {extra}
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
  /** Anfang des Zeitfensters (ISO lokal), null = alles */
  from?: string | null;
}

const FOLD_KEY = "lage-tools.legende.zu";
const AFF_SUFFIX: Record<string, string> = { F: " (eigene)", U: " (unklar)", N: " (neutral / UL)" };

/** Muster in Kartenfarben auf hellem «Kartengrund» (auch im Dunkelmodus erkennbar) */
const LineSample = ({ color, dash, dots, width = 2.5 }: { color: string; dash?: string; dots?: boolean; width?: number }) => (
  <svg className="mo-swatch" viewBox="0 0 24 14" width="24" height="14" aria-hidden>
    <path d="M1 7 H23" stroke={color} strokeWidth={width} strokeDasharray={dash} />
    {dots && <circle cx="6" cy="7" r="2.3" fill="#fff" stroke={color} strokeWidth="1.4" />}
  </svg>
);
const AreaSample = ({ color, dash, fill }: { color: string; dash?: string; fill?: string }) => (
  <svg className="mo-swatch" viewBox="0 0 24 14" width="24" height="14" aria-hidden>
    <rect x="2" y="2" width="20" height="10" fill={fill ?? "none"} fillOpacity=".14" stroke={color} strokeWidth="2" strokeDasharray={dash} />
  </svg>
);

/** gespeicherte Wahl (null = keine, dann automatisch) */
function readFold(): boolean | null {
  try {
    const v = localStorage.getItem(FOLD_KEY);
    if (v !== null) return v === "1";
  } catch { /* egal */ }
  return null;
}

export function Legend({ events, t, flags, areas, recentMin = 30, selectedId = null, from = null }: LegendProps) {
  const ref = useRef<HTMLElement>(null);
  const [userFold, setUserFold] = useState<boolean | null>(readFold);
  /** automatisch zu: kleine Karte (Höhe < 700 px) oder schmales Fenster (< 1100 px) */
  const [autoFold, setAutoFold] = useState(true);
  /** Präsentation: standardmässig zu, Wahl wird nicht gespeichert */
  const [present, setPresent] = useState(false);
  const [presentOpen, setPresentOpen] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const app = el.closest(".app");
    const check = () => {
      setAutoFold(box.clientHeight < 700 || window.innerWidth < 1100 || !!window.matchMedia?.("(pointer: coarse)").matches);
      const p = !!app?.classList.contains("present");
      setPresent((old) => { if (old !== p) setPresentOpen(false); return p; });
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(box);
    const mo = app ? new MutationObserver(check) : null;
    if (app) mo!.observe(app, { attributes: true, attributeFilter: ["class"] });
    return () => { ro.disconnect(); mo?.disconnect(); };
  }, []);
  const folded = present ? !presentOpen : userFold ?? autoFold;
  const layout = useSyncExternalStore(subscribeSituationLayout, getSituationLayout);
  const model = useMemo(() => situationModel(events, t, flags, { recentMin, selectedId, from }), [events, t, flags, recentMin, selectedId, from]);

  const entries = useMemo(() => {
    const out: Array<{ key: string; icon: ReactNode; label: string }> = [];
    const seen = new Set<string>();
    const order = { eigen: 0, feind: 1, unklar: 2, neutral: 3, ul: 4 } as const;
    // je Zeichen + Stufe + Zugehörigkeit ein Eintrag (vermutet zählt nicht als eigenes Zeichen)
    const plain = (sidc?: string) => (sidc ? sidc.slice(0, 3) + "P" + sidc.slice(4) : undefined);
    [...model.items].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name)).forEach((it) => {
      const k = `${it.name}|${it.aff}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ key: k, icon: <Sym k={it.sym} aff={it.aff} size={16} sidc={plain(it.sidc)} />, label: it.name + (AFF_SUFFIX[it.aff] ?? "") });
    });
    const ant = model.items.find((i) => i.anticipated);
    if (ant) out.push({ key: "vermutet", icon: <Sym k={ant.sym} aff={ant.aff} size={16} sidc={ant.sidc} status="anticipated" />, label: "gestrichelt = vermutet" });
    if (model.items.some((i) => i.road === "sperre")) out.push({
      key: "sperre",
      icon: <svg className="mo-swatch" viewBox="0 0 24 14" width="24" height="14" aria-hidden><path d="M3 9 L6 4 L9 9 L12 4 L15 9 L18 4 L21 9" fill="none" stroke="#D3262D" strokeWidth="1.4" /><path d="M2 9 H22" stroke="#D3262D" strokeWidth="3" /></svg>,
      label: "Sperre quer zur Strasse",
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
    if (layout.stacks > 0) out.push({
      key: "stapel",
      icon: (
        <svg viewBox="0 0 26 18" width="26" height="18" aria-hidden>
          <rect x="11" y="2" width="11" height="9" fill="#fff" stroke="#101414" strokeWidth="1.2" />
          <rect x="8" y="5" width="11" height="9" fill="#fff" stroke="#101414" strokeWidth="1.2" />
          <rect x="5" y="8" width="11" height="9" fill="#FF8080" stroke="#101414" strokeWidth="1.2" />
          <circle cx="5" cy="8" r="4.6" fill="#101414" stroke="#fff" strokeWidth="1" />
          <text x="5" y="10.4" fontSize="6.5" fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="var(--f-mono)">3</text>
        </svg>
      ),
      label: "Stapel: Zahl = Meldungen am Ort, Klick fächert auf",
    });
    if (from) out.push({ key: "fenster", icon: <span className="mo-tl tnum">{from.slice(11, 16)}</span>, label: "Zeitfenster: Meldungen ab dieser Zeit, Elemente immer" });
    return out;
  }, [model, flags.nai, areas, recentMin, layout.stacks, from]);

  const toggle = () => {
    const v = !folded;
    if (present) { setPresentOpen(!v); return; }
    setUserFold(v);
    try { localStorage.setItem(FOLD_KEY, v ? "1" : "0"); } catch { /* egal */ }
  };
  // bleibt immer im DOM (data-legend): das Einpassen der Karte liest seine Grösse
  if (!entries.length) return <section ref={ref} className="mo-legend" data-legend hidden aria-hidden />;
  return (
    <section ref={ref} className={`mo-legend${folded ? " folded" : ""}`} aria-label="Legende" data-legend>
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
