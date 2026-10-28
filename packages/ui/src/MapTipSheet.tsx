/**
 * Handy/schmale Bildschirme: Tipp auf Hinweis-Fähnchen, Hinweis-Pille oder Fähnchen «Aktion Rot» zeigt ein kleines
 * Blatt über der Karte (Titel, Begründung kurz) – statt den Reiter zu wechseln und die Seite unter die Karte zu
 * scrollen. «Details» öffnet den Reiter auf Wunsch. Schliessen: ×, Esc, Tipp daneben auf die Karte.
 */
import { useEffect, useSyncExternalStore } from "react";
import L from "leaflet";
import type { Exercise, Hint, RedCoa } from "@lage/core";
import { COA_LABEL, windowLabel } from "./lageRot";
import "./maptip.css";

export interface MapTip {
  /** stabil (Hinweis-/Aktions-ID): gleiches Blatt nicht neu aufbauen */
  id: string;
  /** Zeile über dem Titel, z. B. «Hinweis C5 · hoch» */
  kicker: string;
  title: string;
  /** Begründung (wird auf zwei bis drei Zeilen gekürzt) */
  text?: string;
  /** Farbe des Rands links: hoch/mittel/info bzw. Aktion Rot */
  tone: "hoch" | "mittel" | "info" | "rot";
  onDetails?: () => void;
  detailsLabel?: string;
}

/** Ab dieser Fensterbreite (px) bleibt es beim Wechsel in den Reiter (Seitenleiste neben der Karte) */
export const MAP_TIP_MAX = 860;
/** Kartentipp als Blatt zeigen (statt Reiter wechseln)? */
export const tipOnMap = (): boolean => typeof window !== "undefined" && window.innerWidth < MAP_TIP_MAX;

let cur: MapTip | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export function showMapTip(t: MapTip): void { cur = t; emit(); }
export function closeMapTip(): void { if (cur) { cur = null; emit(); } }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** erster Satz bzw. höchstens ~160 Zeichen */
export function shortText(s: string | undefined, max = 160): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  const dot = t.search(/[.!?](\s|$)/);
  const first = dot > 20 && dot < max ? t.slice(0, dot + 1) : t;
  return first.length > max ? first.slice(0, max - 1).replace(/\s+\S*$/, "") + " …" : first;
}

const LEVEL_WORD: Record<Hint["level"], string> = { hoch: "hoch", mittel: "mittel", info: "Referenz" };

export function hintTip(h: Hint, onDetails: () => void): MapTip {
  return { id: `h:${h.id}`, kicker: `Hinweis ${h.rule} · ${LEVEL_WORD[h.level]}`, title: h.title, text: shortText(h.text), tone: h.level, onDetails, detailsLabel: "Details im Reiter Hinweise" };
}

export function coaTip(c: RedCoa, ex: Pick<Exercise, "days">, t: string, onDetails: () => void): MapTip {
  const w = windowLabel(c, ex.days, t);
  const why = c.approachText ? `Annäherung ${c.approachText}.` : undefined;
  return {
    id: `c:${c.id}`, kicker: `${COA_LABEL[c.label]} Aktion Rot${w ? ` · ${w.text}` : ""}`, title: c.title,
    text: shortText([why, c.check[0]].filter(Boolean).join(" "), 180), tone: "rot", onDetails, detailsLabel: "Details im Reiter Hinweise",
  };
}

/** Blatt über der Karte (einmal in der Karte einhängen) */
export function MapTipHost({ map }: { map: L.Map }) {
  const tip = useSyncExternalStore(subscribe, () => cur, () => null);
  useEffect(() => {
    if (!tip) return;
    const close = () => closeMapTip();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") closeMapTip(); };
    // Tipp daneben auf die Karte (nicht auf ein Fähnchen) schliesst; Fenster breiter → Reiter wie gewohnt
    map.on("click", close);
    window.addEventListener("keydown", key);
    const wide = () => { if (!tipOnMap()) closeMapTip(); };
    window.addEventListener("resize", wide);
    return () => { map.off("click", close); window.removeEventListener("keydown", key); window.removeEventListener("resize", wide); };
  }, [tip, map]);
  if (!tip) return null;
  return (
    <div className={`maptip t-${tip.tone}`} role="dialog" aria-label={tip.title} aria-live="polite"
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="maptip-k">{tip.kicker}</div>
      <div className="maptip-t">{tip.title}</div>
      {tip.text && <p className="maptip-x">{tip.text}</p>}
      <div className="maptip-b">
        {tip.onDetails && <button type="button" onClick={() => { const f = tip.onDetails!; closeMapTip(); f(); }}>{tip.detailsLabel ?? "Details"}</button>}
        <button type="button" className="maptip-close" onClick={closeMapTip} aria-label="Schliessen">Schliessen</button>
      </div>
    </div>
  );
}
