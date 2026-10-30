/**
 * Über der Karte: Banner mit der gewählten Meldung (oben links neben dem Zoom) und
 * Legende (unten links, aus dem tatsächlich Sichtbaren gebaut, einklappbar).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { artOf, artText, type Area, type LageEvent } from "@lage/core";
import { FORM_ZEICHEN, formOf, nichtLageText } from "./entry/labels";
import { iconSvg, KARTE } from "@lage/map";
import type { LayerFlags } from "./layers";
import { kindOf, kindText, situationModel, STALE_MIN } from "./journalLayer";
import { getSituationLayout, ohneAufgehobene, subscribeSituationLayout } from "./situationLayer";
import { dayLabel } from "./Timeline";
import { LAGE_KARTE } from "./colors";
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
  /** optional: Knopf «Korrigieren» (lädt die Meldung ins Meldungsfeld, Spez. MVP 1 Kap. 3.3) */
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
      // im Rückblick liegt oben das gelbe Band (--rb-oben, Paket C): darunter rücken
      const rb = parseFloat(getComputedStyle(box).getPropertyValue("--rb-oben")) || 0;
      setPlace({ maxW, top, maxH: Math.max(48, bottom - top - rb - 8) });
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
  // Nicht-Meldung (Auftrag, Rückfrage, Vbk, Orientierung, Notiz): Art im Klartext mit Form, kein Zeichen, kein Ort (M2)
  if (artOf(event) !== "meldung") {
    const form = formOf(event);
    return (
      <div ref={ref} className="mo-banner" role="status" aria-label="Gewählter Eintrag"
        style={{ maxWidth: place.maxW, top: place.top !== undefined ? `calc(${place.top}px + var(--rb-oben, 0px))` : undefined, maxHeight: place.maxH }}>
        <span className="mo-time tnum">{(days.length ? dayLabel(event.t, days) + " " : "") + event.t.slice(11, 16)}</span>
        <span className="mo-art"><span aria-hidden="true">{FORM_ZEICHEN[form]} </span>{artText(event)}</span>
        <span className="mo-msg">{nichtLageText(event, [])}</span>
        <span className="mo-via">kein Ort auf der Karte</span>
        {extra}
        {onEdit && <button className="mo-btn" onClick={() => onEdit(event)} aria-label="Diesen Eintrag korrigieren">Korrigieren</button>}
        <button className="mo-x" onClick={onClose} aria-label="Auswahl aufheben" title="Schliessen (Esc)">×</button>
      </div>
    );
  }
  const kind = kindOf(event);
  const time = (days.length ? dayLabel(event.t, days) + " " : "") + event.t.slice(11, 16);
  const where = event.cells?.length ? event.cells.join(" · ") : event.where ?? "";
  const unit = event.unit || (kind === "eigen" ? event.melder ?? "" : "");
  return (
    <div ref={ref} className="mo-banner" role="status" aria-label="Gewählte Meldung"
      style={{ maxWidth: place.maxW, top: place.top !== undefined ? `calc(${place.top}px + var(--rb-oben, 0px))` : undefined, maxHeight: place.maxH }}>
      <span className="mo-time tnum">{time}</span>
      <span className={`mo-kind k-${kind}`}>{kindText(event)}</span>
      <Sym k={event.sym} aff={event.aff} size={14} sidc={event.sidc} status={event.status} />
      {unit && <span className="mo-unit" style={{ color: UNIT_VAR[kind] }}>{unit}</span>}
      {kind !== "eigen" && event.melder && <span className="mo-via">von {event.melder}</span>}
      {where && <span className="mo-pq tnum">{where}</span>}
      {event.road && <span className="mo-road">auf {event.road}</span>}
      {event.desc && <span className="mo-desc">{event.desc}</span>}
      <span className="mo-msg">{event.text}</span>
      {extra}
      {onEdit && <button className="mo-btn" onClick={() => onEdit(event)} aria-label="Diese Meldung korrigieren">Korrigieren</button>}
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
const LineSample = ({ color, dash, dots, width = 2.5, round }: { color: string; dash?: string; dots?: boolean; width?: number; round?: boolean }) => (
  <svg className="mo-swatch" viewBox="0 0 24 14" width="24" height="14" aria-hidden>
    <path d="M2 7 H22" stroke={color} strokeWidth={width} strokeDasharray={dash} strokeLinecap={round ? "round" : undefined} />
    {dots && <circle cx="6" cy="7" r="2.3" fill="#fff" stroke={color} strokeWidth="1.4" />}
  </svg>
);
/** Unklar-Fläche: Schraffur 45° wie auf der Karte (S11) */
const HatchSample = () => (
  <svg className="mo-swatch" viewBox="0 0 24 14" width="24" height="14" aria-hidden>
    <defs>
      <pattern id="mo-schraffur" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="4" stroke={LAGE_KARTE.unklar} strokeWidth="1.2" />
      </pattern>
    </defs>
    <rect x="2" y="2" width="20" height="10" fill="url(#mo-schraffur)" stroke={LAGE_KARTE.unklar} strokeOpacity=".6" strokeWidth="1" />
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
  // aufgehobene Sperren/Checkpoints fehlen ab der Aufhebung auch in der Legende (Spez. MVP 3, Kap. 3.5)
  const model = useMemo(() => situationModel(ohneAufgehobene(events, t), t, flags, { recentMin, selectedId, from }), [events, t, flags, recentMin, selectedId, from]);

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
    if (ant) out.push({ key: "vermutet", icon: <Sym k={ant.sym} aff={ant.aff} size={16} sidc={ant.sidc} status="anticipated" />, label: "- - - vermutet" });
    if (model.items.some((i) => i.road === "sperre")) out.push({
      key: "sperre",
      icon: <svg className="mo-swatch" viewBox="0 0 24 14" width="24" height="14" aria-hidden><path d="M3 9 L6 4 L9 9 L12 4 L15 9 L18 4 L21 9" fill="none" stroke={LAGE_KARTE.feind} strokeWidth="1.4" /><path d="M2 9 H22" stroke={LAGE_KARTE.feind} strokeWidth="3" /></svg>,
      label: "Sperre quer zur Strasse",
    });
    // bisherige Wege punktiert (S13: gestrichelt heisst nur «vermutet»)
    if (model.tracks.length) {
      const col = model.tracks.some((x) => x.side === "blau") ? LAGE_KARTE.eigen : LAGE_KARTE.feind;
      out.push({ key: "weg", icon: <LineSample color={col} dash="0.1 5" width={3} round />, label: "· · · bisheriger Weg" });
    }
    if (model.items.some((i) => /\d×/.test(i.ud))) out.push({ key: "anzahl", icon: <span className="mo-tl tnum">2×</span>, label: "2× = Anzahl" });
    // Unklar-Planquadrat (Punktzeichen mit Planquadrat) oder Unklar-Fläche: schraffiert
    if (model.items.some((i) => i.kind === "unklar" && !i.selected && !!i.e.cells?.length)) out.push({ key: "unklar-flaeche", icon: <HatchSample />, label: "Unklar (Fläche)" });
    if (flags.nai && areas?.length) {
      if (areas.some((a) => a.kind === "nai" || a.kind === "other")) out.push({ key: "nai", icon: <AreaSample color={KARTE.nai} fill={KARTE.nai} />, label: "NAI" });
      if (areas.some((a) => a.kind === "ao")) out.push({ key: "ao", icon: <AreaSample color={KARTE.ao} dash="4 3" />, label: "AO" });
      if (areas.some((a) => a.kind === "stao")) out.push({ key: "stao", icon: <AreaSample color={LAGE_KARTE.feind} dash="3 2" fill={LAGE_KARTE.feind} />, label: "Stao" });
    }
    if (model.items.some((i) => i.showTime)) out.push({ key: "zeit", icon: <span className="mo-tl tnum">hh:mm</span>, label: `Meldung jünger als ${recentMin} min` });
    if (model.items.some((i) => i.opacity < 1)) {
      const old = model.items.find((i) => i.opacity < 1)!;
      out.push({ key: "blass", icon: <span className="mo-alt"><Sym k={old.sym} aff={old.aff} size={16} /></span>, label: `blass = älter als ${recentMin} min` });
    }
    if (model.items.some((i) => i.kind === "eigen" && i.isUnit && i.silentMin > STALE_MIN)) out.push({ key: "alt", icon: <span className="mo-tl tnum">75 min</span>, label: `keine Meldung seit über ${STALE_MIN} min` });
    if (layout.stacks > 0) out.push({ key: "stapel", icon: <span className="mo-stk tnum">3</span>, label: "Zeichen übereinander – antippen" });
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
