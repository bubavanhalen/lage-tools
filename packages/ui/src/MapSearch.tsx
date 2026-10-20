/**
 * Ein Suchfeld für alles: Planquadrat, NAI, Element, Koordinate, Ort – PLATZHALTER, wird ersetzt.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { wgs84ToLv95, type Exercise, type LV95 } from "@lage/core";
import { toLatLng } from "@lage/map";

export function MapSearch({ map }: { ex: Exercise; map: L.Map; onSelectEvent?: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ label: string; p: LV95 }>>([]);
  const chosen = useRef<string | null>(null);
  const onGo = (p: LV95) => map.setView(toLatLng(p), 21);
  useEffect(() => {
    if (q.trim().length < 2 || q === chosen.current) { setHits([]); return; }
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const r = await fetch(`https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&limit=8&searchText=${encodeURIComponent(q)}`, { signal: ctl.signal });
        const j = await r.json();
        setHits((j.results ?? []).map((x: { attrs: { label: string; lat: number; lon: number } }) => ({ label: x.attrs.label.replace(/<[^>]+>/g, ""), p: wgs84ToLv95({ lat: x.attrs.lat, lon: x.attrs.lon }) })));
      } catch { /* offline */ }
    }, 250);
    return () => { ctl.abort(); window.clearTimeout(t); };
  }, [q]);
  return (
    <div className="search">
      <input placeholder="Ort suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ort suchen"
        onKeyDown={(e) => { if (e.key === "Escape") setHits([]); if (e.key === "Enter" && hits[0]) { chosen.current = hits[0].label; onGo(hits[0].p); setHits([]); setQ(hits[0].label); } }} />
      {hits.length > 0 && (
        <ul className="hits">
          {hits.map((h, i) => <li key={i}><button onClick={() => { chosen.current = h.label; onGo(h.p); setHits([]); setQ(h.label); }}>{h.label}</button></li>)}
        </ul>
      )}
    </div>
  );
}
