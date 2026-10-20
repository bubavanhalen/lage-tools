/**
 * Lage auf der Karte: pro Element das aktuelle Zeichen, dahinter die Spur; Meldungen ohne Element blass.
 */
import L from "leaflet";
import type { LageEvent, Side, UnitState } from "@lage/core";
import { symbolIcon, toLatLng } from "@lage/map";

export const SIDE_COLOR: Record<Side, string> = { rot: "#c8102e", blau: "#1f5fb8", ul: "#2e7d32" };

export function journalLayer(
  st: { units: UnitState[]; loose: LageEvent[] },
  opts: { tracks: boolean; selectedId?: string | null; onClick?: (e: LageEvent) => void },
): L.LayerGroup {
  const g = L.layerGroup();
  if (opts.tracks) {
    for (const u of st.units) {
      if (u.track.length < 2) continue;
      const ll = u.track.map(toLatLng);
      L.polyline(ll, { color: SIDE_COLOR[u.side], weight: 2.5, opacity: 0.75, dashArray: "6 5", interactive: false }).addTo(g);
      ll.slice(0, -1).forEach((p) => L.circleMarker(p, { radius: 3, color: SIDE_COLOR[u.side], weight: 1.5, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(g));
    }
  }
  for (const e of st.loose) {
    const m = L.marker(toLatLng(e.pos!), {
      icon: symbolIcon(e.sym, e.aff, 22, { count: e.count, dir: e.dir }, e.id === opts.selectedId ? "sel" : ""),
      opacity: e.id === opts.selectedId ? 1 : 0.6,
      title: `${e.t.slice(11, 16)} ${e.text}`,
    }).addTo(g);
    if (opts.onClick) m.on("click", () => opts.onClick!(e));
  }
  for (const u of st.units) {
    const e = u.event;
    const sel = e.id === opts.selectedId;
    const m = L.marker(toLatLng(u.pos), {
      icon: symbolIcon(e.sym, e.aff, 26, { unit: u.unit, count: e.count, dir: e.dir }, sel ? "sel" : ""),
      zIndexOffset: sel ? 1000 : 0,
      title: `${e.t.slice(11, 16)} ${u.unit}: ${e.text}`,
    }).addTo(g);
    if (opts.onClick) m.on("click", () => opts.onClick!(e));
  }
  return g;
}
