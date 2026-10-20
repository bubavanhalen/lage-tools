/**
 * Werkzeugleiste der Karte: Grundkarte, Ebenen (Ausklappmenü mit Pills), Ganzes Raster, Zoom auf Feld/Unterquadrant, Messen.
 * Messen: Klick setzt Punkte, Doppelklick/Enter beendet, Backspace = Rückgängig, Esc = Abbrechen.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  activeMeasure,
  formatAzimuth,
  formatDistance,
  startMeasure,
  zoomToCellAtCenter,
  type Basemap,
  type MeasureEvent,
  type MeasureState,
} from "@lage/map";
import { DEFAULT_FLAGS, type LayerFlags } from "./layers";
import { IconCell, IconCheck, IconChevron, IconClose, IconFit, IconLayers, IconQuad, IconRuler, IconUndo } from "./navicons";
import "./navigation.css";

export interface MapToolbarProps {
  map: L.Map;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  flags: LayerFlags;
  onFlags: (f: LayerFlags) => void;
  /** Karte auf Raster/NAI der Übung einpassen */
  onFitAll: () => void;
}

const BASEMAPS: Array<{ id: Basemap; label: string; short: string }> = [
  { id: "lk", label: "Landeskarte", short: "Karte" },
  { id: "img", label: "Luftbild", short: "Luftbild" },
  { id: "grau", label: "Grau", short: "Grau" },
];

const LAYERS: Array<{ key: keyof LayerFlags; label: string; title: string; sw: string }> = [
  { key: "raster", label: "Raster", title: "Führungsraster mit Feld- und Randbeschriftung", sw: "raster" },
  { key: "nai", label: "NAI", title: "NAI, AO und Stao-Flächen", sw: "nai" },
  { key: "eigene", label: "Eigene", title: "Eigene Elemente (Blau)", sw: "blau" },
  { key: "feind", label: "Feind", title: "Feind und unklare Sichtungen (Rot/Gelb)", sw: "rot" },
  { key: "spuren", label: "Spuren", title: "Bisherige Standorte der Elemente als Linie", sw: "spur" },
  { key: "zeiten", label: "Zeiten", title: "Zeit neben frischen Meldungen", sw: "zeit" },
  { key: "legende", label: "Legende", title: "Legende der Zeichen", sw: "leg" },
];

export function MapToolbar(p: MapToolbarProps) {
  const [layersOpen, setLayersOpen] = useState(false);
  const [measure, setMeasure] = useState<MeasureState | null>(null);
  const layersRef = useRef<HTMLDivElement>(null);

  // Messung (auch aus dem Kontextmenü gestartet) verfolgen
  useEffect(() => {
    const on = (e: L.LeafletEvent) => setMeasure((e as MeasureEvent).state);
    p.map.on("lt-measure", on);
    return () => { p.map.off("lt-measure", on); };
  }, [p.map]);
  useEffect(() => () => { activeMeasure(p.map)?.cancel(); }, [p.map]);

  useEffect(() => {
    if (!layersOpen) return;
    const onDown = (e: PointerEvent) => { if (!layersRef.current?.contains(e.target as Node)) setLayersOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setLayersOpen(false); } };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [layersOpen]);

  const hidden = LAYERS.filter((l) => !p.flags[l.key]);
  const toggle = (k: keyof LayerFlags) => p.onFlags({ ...p.flags, [k]: !p.flags[k] });
  const measuring = !!measure;
  const toggleMeasure = () => {
    const c = activeMeasure(p.map);
    if (c) c.cancel();
    else startMeasure(p.map);
  };

  return (
    <div className="nav-tb">
      <div className="nav-bar" role="toolbar" aria-label="Kartenwerkzeuge">
        <div className="nav-row">
        <div className="nav-seg" role="group" aria-label="Grundkarte">
          {BASEMAPS.map((b) => (
            <button key={b.id} type="button" aria-pressed={p.basemap === b.id} onClick={() => p.onBasemap(b.id)} title={`Grundkarte ${b.label}`}>
              <span className="nav-long">{b.label}</span><span className="nav-short">{b.short}</span>
            </button>
          ))}
        </div>

        <div className="nav-layers" ref={layersRef}>
          <button type="button" className="nav-btn" aria-expanded={layersOpen} aria-haspopup="true" onClick={() => setLayersOpen((o) => !o)}
            title={hidden.length ? `Ausgeblendet: ${hidden.map((h) => h.label).join(", ")}` : "Ebenen ein-/ausblenden"}>
            <IconLayers /><span>Ebenen</span>
            {hidden.length > 0 && <span className="nav-off">{hidden.length} aus</span>}
            <IconChevron />
          </button>
          {layersOpen && (
            <div className="nav-pop nav-layerpop" role="group" aria-label="Ebenen">
              <div className="nav-pills">
                {LAYERS.map((l) => (
                  <button key={l.key} type="button" className="nav-pill" aria-pressed={p.flags[l.key]} onClick={() => toggle(l.key)} title={l.title}>
                    <i className={`nav-sw sw-${l.sw}`} aria-hidden="true" />{l.label}
                  </button>
                ))}
              </div>
              <div className="nav-pop-foot">
                <button type="button" className="nav-link" onClick={() => p.onFlags({ ...DEFAULT_FLAGS })} disabled={hidden.length === 0}>Alle einblenden</button>
              </div>
            </div>
          )}
        </div>
        </div>

        <div className="nav-row">
        <button type="button" className="nav-btn" onClick={p.onFitAll} title="Karte auf das ganze Raster und alle NAI einpassen">
          <IconFit /><span className="nav-long">Ganzes Raster</span><span className="nav-short">Alles</span>
        </button>

        <div className="nav-seg" role="group" aria-label="Zoom auf Planquadrat in der Kartenmitte">
          <button type="button" onClick={() => zoomToCellAtCenter(p.map, "feld")} title="Auf das Feld in der Kartenmitte zoomen (oder Doppelklick in ein Feld)">
            <IconCell /><span>Feld</span>
          </button>
          <button type="button" onClick={() => zoomToCellAtCenter(p.map, "quadrant")} title="Auf den Unterquadranten in der Kartenmitte zoomen (Doppelklick im gefüllten Feld)">
            <IconQuad /><span>¼</span>
          </button>
        </div>

        <button type="button" className="nav-btn" aria-pressed={measuring} onClick={toggleMeasure} title="Distanz und Azimut messen">
          <IconRuler /><span>Messen</span>
        </button>
        </div>
      </div>

      {measure && <MeasurePanel s={measure} map={p.map} />}
    </div>
  );
}

function MeasurePanel({ s, map }: { s: MeasureState; map: L.Map }) {
  const c = () => activeMeasure(map);
  const legs = s.live ? [...s.legs, s.live] : s.legs;
  const total = s.total + (s.live?.m ?? 0);
  return (
    <div className="nav-pop nav-measure" role="region" aria-label="Messen" aria-live="polite">
      <div className="nav-mh">
        <b>Messen</b>
        <span className="nav-mtot mono">{legs.length ? formatDistance(total) : "–"}</span>
        <button type="button" className="nav-x" onClick={() => c()?.cancel()} aria-label="Messung schliessen" title="Schliessen (Esc)"><IconClose /></button>
      </div>
      {legs.length > 0 && (
        <table className="nav-legs mono">
          <thead><tr><th>#</th><th>Distanz</th><th>Azimut</th><th>‰</th></tr></thead>
          <tbody>
            {legs.map((l, i) => {
              const a = formatAzimuth(l.deg, l.mils);
              return (
                <tr key={i} className={s.live && i === legs.length - 1 ? "live" : ""}>
                  <td>{i + 1}</td><td>{formatDistance(l.m)}</td><td>{a.deg}</td><td>{a.mils.replace(" ‰", "")}</td>
                </tr>
              );
            })}
          </tbody>
          {legs.length > 1 && <tfoot><tr><td>Σ</td><td colSpan={3}>{formatDistance(total)}</td></tr></tfoot>}
        </table>
      )}
      {!s.done ? (
        <>
          <p className="nav-mhint">
            {s.points.length === 0 ? "Auf die Karte klicken, um den Startpunkt zu setzen." : "Weitere Punkte setzen. Doppelklick oder Enter beendet."}
            {" "}<kbd>⌫</kbd> zurück · <kbd>Esc</kbd> abbrechen
          </p>
          <div className="nav-mbtn">
            <button type="button" onClick={() => c()?.undo()} disabled={s.points.length === 0}><IconUndo />Rückgängig</button>
            <button type="button" className="primary" onClick={() => c()?.finish()} disabled={s.points.length < 2}><IconCheck />Fertig</button>
          </div>
        </>
      ) : (
        <div className="nav-mbtn">
          <span className="nav-mhint">Azimut auf Gitternord (LV95)</span>
          <button type="button" onClick={() => startMeasure(map)}><IconRuler />Neu</button>
        </div>
      )}
    </div>
  );
}
