/**
 * Lagebild-Modell für Karte und Legende: was ist zum Zeitpunkt `t` sichtbar, wie kräftig, mit welchem Zusatz.
 * Reine Berechnung (ohne Leaflet), damit Karte und Legende garantiert dasselbe zeigen.
 */
import { catalogEntry, ECHELONS, situationAt, symbolDef, unitKey, type Affiliation, type Echelon, type LageEvent, type LV95, type Side, type Status } from "@lage/core";
import { isAnticipated, sidcAffiliation } from "@lage/map";
import type { LayerFlags } from "./layers";

/** Kartenfarben (entsprechen --m-rot, --m-blau, --unklar); Karte bleibt auch im Dunkelmodus hell */
export const SIDE_COLOR: Record<Side, string> = { rot: "#D3262D", blau: "#1F5FB8", ul: "#A86F12" };
export const MAP_INK = "#101414";

/** Kartenfarbe nach Art (unklar = gelb wie das Zeichen, nicht rot wie die Seite): Linie und Füllung */
export const KIND_COLOR: Record<"eigen" | "feind" | "unklar" | "ul", { line: string; fill: string }> = {
  eigen: { line: "#1F5FB8", fill: "#1F5FB8" },
  feind: { line: "#D3262D", fill: "#D3262D" },
  unklar: { line: "#B88A00", fill: "#FFD400" },
  ul: { line: "#A86F12", fill: "#A86F12" },
};

export type ItemKind = "eigen" | "feind" | "unklar" | "ul";

/** Stufe aus der Meldung oder aus dem SIDC (Stelle 12) */
export function echelonOf(e: { echelon?: Echelon; sidc?: string }): Echelon | undefined {
  if (e.echelon) return e.echelon;
  const c = e.sidc?.[0]?.toUpperCase() === "S" ? e.sidc[11]?.toUpperCase() : undefined;
  return c ? ECHELONS.find((x) => x.code === c)?.key : undefined;
}

/** Anzeigename des Zeichens: Katalogname (sonst alter Zeichenname) + Stufe, z. B. «Infanterie · Halbzug» */
export function symbolName(sym: string, ech?: Echelon): string {
  const base = catalogEntry(sym)?.name ?? symbolDef(sym).name;
  const en = ech ? ECHELONS.find((x) => x.key === ech)?.name : undefined;
  return en ? `${base} · ${en}` : base;
}

/** Darstellung im Gelände an einer Strasse (nur mit `angle` und Katalog-Platzierung «strasse») */
export type RoadMark = "sperre" | "checkpoint" | "punkt";
const OLD_ROAD_KEYS = new Set(["sperre", "kontrollposten"]);
export function roadMark(e: Pick<LageEvent, "sym" | "angle" | "pos">): RoadMark | null {
  if (e.angle === undefined || e.angle === null || !isFinite(e.angle) || !e.pos) return null;
  const cat = catalogEntry(e.sym);
  if (cat?.placement !== "strasse" && !OLD_ROAD_KEYS.has(e.sym)) return null;
  const k = `${e.sym} ${cat?.name ?? ""} ${cat?.category ?? ""}`.toLowerCase();
  if (/sperr|hindernis|barrik|block|graben|mine|verhau|stacheldraht/.test(k)) return "sperre";
  if (/kontroll|checkpoint|\bcp\b/.test(k)) return "checkpoint";
  return "punkt";
}

export interface SituationItem {
  /** Originalmeldung (bei Elementen die letzte Meldung) */
  e: LageEvent;
  /** Zeichen-Schlüssel (bei Elementen ggf. das zuletzt bekannte Zeichen) */
  sym: string;
  aff: Affiliation;
  /** voller SIDC für die Darstellung (falls bekannt) */
  sidc?: string;
  status?: Status;
  /** vermutet (gestrichelt) */
  anticipated: boolean;
  /** Katalogname + Stufe */
  name: string;
  /** Hindernis/Zeichen quer zur Strasse */
  road: RoadMark | null;
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
  // letzter bekannter SIDC je Element (z. B. «gn Hz Inf»), damit spätere Meldungen ohne Zeichen die Stufe behalten
  const lastSidc = new Map<string, LageEvent>();
  for (const e of events) {
    if (e.deleted || e.t > t || !e.sidc || !e.unit) continue;
    const k = unitKey(e.side, e.unit);
    if ((lastSidc.get(k)?.t ?? "") <= e.t) lastSidc.set(k, e);
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
    // SIDC nur, wenn das Zeichen wirklich zu dieser Meldung gehört (Elemente behalten sonst ihr bekanntes Zeichen)
    let src: LageEvent | undefined = sym === e.sym && e.sidc ? e : undefined;
    if (!src && isUnit) { const l = lastSidc.get(unitKey(e.side, unitName)); if (l && l.sym === sym) src = l; }
    const sidc = src?.sidc;
    const status = src?.status ?? (sym === e.sym ? e.status : undefined);
    return {
      e, sym, aff: sidc ? sidcAffiliation(sidc, ev.aff) : ev.aff, sidc, status, anticipated: isAnticipated(sidc, status),
      name: symbolName(sym, src ? echelonOf(src) : sym === e.sym ? echelonOf(e) : undefined),
      road: sym === e.sym ? roadMark({ sym, angle: e.angle, pos }) : null,
      pos, kind, isUnit, ageMin, silentMin: silent, fresh, selected,
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
    items.push(make(e, e.sym, e.pos, false, e.side === "blau" ? e.unit : (catalogEntry(e.sym)?.activity ?? symbolDef(e.sym).activity) ? "" : e.unit));
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
