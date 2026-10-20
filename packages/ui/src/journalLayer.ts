/**
 * Lagebild-Modell für Karte und Legende: was ist zum Zeitpunkt `t` sichtbar, wie kräftig, mit welchem Zusatz.
 * Reine Berechnung (ohne Leaflet), damit Karte und Legende garantiert dasselbe zeigen.
 */
import { situationAt, symbolDef, unitKey, type Affiliation, type LageEvent, type LV95, type Side } from "@lage/core";
import type { LayerFlags } from "./layers";

/** Kartenfarben (entsprechen --m-rot, --m-blau, --unklar); Karte bleibt auch im Dunkelmodus hell */
export const SIDE_COLOR: Record<Side, string> = { rot: "#D3262D", blau: "#1F5FB8", ul: "#A86F12" };
export const MAP_INK = "#101414";

export type ItemKind = "eigen" | "feind" | "unklar" | "ul";

export interface SituationItem {
  /** Originalmeldung (bei Elementen die letzte Meldung) */
  e: LageEvent;
  /** Zeichen-Schlüssel (bei Elementen ggf. das zuletzt bekannte Zeichen) */
  sym: string;
  aff: Affiliation;
  pos: LV95;
  kind: ItemKind;
  /** Element mit Standort (eigenes Element oder bekanntes Feindelement) */
  isUnit: boolean;
  /** Minuten seit der Meldung bis zur Lagezeit */
  ageMin: number;
  /** eigenes Element: Minuten seit seiner letzten Meldung (auch als Melder einer Sichtung) */
  silentMin: number;
  /** jünger als `recentMin` */
  fresh: boolean;
  selected: boolean;
  /** Deckkraft (ältere Sichtungen blass) */
  opacity: number;
  /** Zusatz am Zeichen, z. B. «H04», «2× Det 1» */
  ud: string;
  /** Zeitlabel «hh:mm» zeigen */
  showTime: boolean;
}

export interface SituationTrack {
  side: Side;
  unit: string;
  pts: LV95[];
}

export interface SituationModel {
  items: SituationItem[];
  tracks: SituationTrack[];
}

/** eigene Elemente ohne Meldung seit so vielen Minuten bekommen eine Altersangabe («75′») */
export const STALE_MIN = 60;

export const kindOf = (e: Pick<LageEvent, "side" | "aff">): ItemKind =>
  e.side === "blau" ? "eigen" : e.side === "ul" ? "ul" : e.aff === "U" ? "unklar" : "feind";

const minutesBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);

/** Alter kurz: «75′», ab 2 h «3 h» */
export const ageText = (min: number) => (min < 120 ? `${min}′` : `${Math.floor(min / 60)} h`);

export function situationModel(
  events: LageEvent[],
  t: string,
  flags: Pick<LayerFlags, "eigene" | "feind" | "spuren" | "zeiten">,
  opts: { recentMin?: number; selectedId?: string | null } = {},
): SituationModel {
  const recent = opts.recentMin ?? 30;
  const sel = opts.selectedId ?? null;
  const st = situationAt(events, t);
  const byId = new Map(events.map((e) => [e.id, e]));
  // letzte Meldung jedes eigenen Elements (als Melder oder mit eigener Lage) bis t
  const lastReport = new Map<string, string>();
  for (const e of events) {
    if (e.deleted || e.t > t) continue;
    for (const name of [e.melder, e.side === "blau" ? e.unit : undefined]) {
      if (!name) continue;
      const k = unitKey("blau", name);
      if ((lastReport.get(k) ?? "") < e.t) lastReport.set(k, e.t);
    }
  }
  const show = (side: Side) => (side === "blau" ? flags.eigene : flags.feind);
  const items: SituationItem[] = [];
  const make = (ev: LageEvent, sym: string, pos: LV95, isUnit: boolean, unitName: string): SituationItem => {
    const e = byId.get(ev.id) ?? ev;
    const kind = kindOf(e);
    const ageMin = Math.max(0, minutesBetween(e.t, t));
    const fresh = ageMin <= recent;
    const selected = e.id === sel;
    const own = kind === "eigen";
    let ud = "";
    const silent = own && isUnit ? Math.max(0, minutesBetween(lastReport.get(unitKey("blau", unitName)) ?? e.t, t)) : 0;
    if (own) ud = unitName + (silent > STALE_MIN ? ` · ${ageText(silent)}` : "");
    else ud = [e.count && e.count > 1 ? `${e.count}×` : "", unitName].join(" ").trim();
    return {
      e, sym, aff: ev.aff, pos, kind, isUnit, ageMin, silentMin: silent, fresh, selected,
      opacity: own || fresh || selected ? 1 : 0.45,
      ud,
      showTime: flags.zeiten && (fresh || selected),
    };
  };
  for (const u of st.units) {
    if (!show(u.side)) continue;
    items.push(make(u.event, u.event.sym, u.pos, true, u.unit));
  }
  for (const e of st.loose) {
    if (!e.pos || !show(e.side)) continue;
    items.push(make(e, e.sym, e.pos, false, e.side === "blau" ? e.unit : symbolDef(e.sym).activity ? "" : e.unit));
  }
  // gewählte Meldung immer zeigen (auch wenn sie inzwischen von einer neueren Meldung überholt ist)
  if (sel && !items.some((i) => i.e.id === sel)) {
    const e = byId.get(sel);
    if (e && !e.deleted && e.pos && e.t <= t && show(e.side)) items.push(make(e, e.sym, e.pos, false, e.unit));
  }
  for (const it of items) if (it.e.id === sel) it.selected = true;
  const tracks: SituationTrack[] = flags.spuren
    ? st.units.filter((u) => show(u.side) && u.track.length > 1).map((u) => ({ side: u.side, unit: u.unit, pts: u.track }))
    : [];
  return { items, tracks };
}
