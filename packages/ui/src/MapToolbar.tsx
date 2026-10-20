/**
 * Werkzeugleiste der Karte: Grundkarte, Ebenen, Ganzes Raster, Messen – PLATZHALTER, wird ersetzt.
 */
import L from "leaflet";
import type { Basemap } from "@lage/map";
import type { LayerFlags } from "./layers";

export interface MapToolbarProps {
  map: L.Map;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  flags: LayerFlags;
  onFlags: (f: LayerFlags) => void;
  /** Karte auf Raster/NAI der Übung einpassen */
  onFitAll: () => void;
}

export function MapToolbar(p: MapToolbarProps) {
  return (
    <div className="seg" role="group" aria-label="Kartengrundlage">
      {(["lk", "img", "grau"] as Basemap[]).map((b) => (
        <button key={b} aria-pressed={p.basemap === b} onClick={() => p.onBasemap(b)}>{b === "lk" ? "Landeskarte" : b === "img" ? "Luftbild" : "Grau"}</button>
      ))}
    </div>
  );
}
