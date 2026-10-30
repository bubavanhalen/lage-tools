/**
 * Massstab der Karte (Spez. MVP 3.5, B3, Wireframe 2.5): unten links über der Quellenangabe, nur metrisch, höchstens
 * 120 px breit («▬▬ 500 m»), Plex-Schrift; nachts dunkel (map.css `.lt-massstab`). Testhaken `.leaflet-control-scale`.
 */
import L from "leaflet";

export function massstab(map: L.Map): L.Control.Scale {
  const c = L.control.scale({ metric: true, imperial: false, maxWidth: 120, position: "bottomleft" });
  c.addTo(map);
  c.getContainer()?.classList.add("lt-massstab");
  return c;
}
