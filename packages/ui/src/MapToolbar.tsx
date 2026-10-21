/**
 * Werkzeugleiste der Karte, immer einzeilig: Grundkarte, Ebenen (Ausklappmenü mit Pills), Ganzes Raster, Zoom auf Feld/Unterquadrant, Messen.
 * Auf schmaleren Karten (< 1180 px) wandert die Grundkarte ins Ebenen-Menü und die Werkzeuge hinter «⋯».
 * Messen: Klick setzt Punkte, Doppelklick/Enter beendet, Backspace = Rückgängig, Esc = Abbrechen.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  activeMeasure,
  formatAzimuth,
  formatDistance,
  registeredSheets,
  startMeasure,
  zoomToCellAtCenter,
  type Basemap,
  type MeasureEvent,
  type MeasureState,
} from "@lage/map";
import { DEFAULT_FLAGS, type LayerFlags } from "./layers";
import { IconCell, IconCheck, IconChevron, IconClose, IconFit, IconLayers, IconMore, IconQuad, IconRuler, IconUndo } from "./navicons";
import "./navigation.css";

export interface MapToolbarProps {
  map: L.Map;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  flags: LayerFlags;
  onFlags: (f: LayerFlags) => void;
  /** Karte auf Raster/NAI der Übung einpassen */
  onFitAll: () => void;
  /** Gibt es etwas einzupassen (Raster oder NAI)? Standard: ein Raster ist angemeldet. */
  canFitAll?: boolean;
}

const BASEMAPS: Array<{ id: Basemap; label: string }> = [
  { id: "lk", label: "Landeskarte" },
  { id: "img", label: "Luftbild" },
  { id: "grau", label: "Grau" },
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

/** Ab dieser Kartenbreite (px) alle Werkzeuge in einer Zeile ausgeschrieben, darunter kompakt (Ebenen-Menü + «⋯»). */
export const TOOLBAR_FULL_MIN = 1180;
/** Unter dieser Kartenbreite nur noch Symbole */
const TOOLBAR_TINY_MAX = 560;

/** Breite der Karte (folgt Grössenänderungen). */
function useMapWidth(map: L.Map): number {
  const [w, setW] = useState(() => map.getContainer().clientWidth || 1024);
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return w;
}

/** Aufklappmenü schliessen bei Klick daneben oder Esc. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function MapToolbar(p: MapToolbarProps) {
  const [layersOpen, setLayersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [measure, setMeasure] = useState<MeasureState | null>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const width = useMapWidth(p.map);
  const full = width >= TOOLBAR_FULL_MIN;
  const tiny = width < TOOLBAR_TINY_MAX;

  // Messung (auch aus dem Kontextmenü gestartet) verfolgen
  useEffect(() => {
    const on = (e: L.LeafletEvent) => setMeasure((e as MeasureEvent).state);
    p.map.on("lt-measure", on);
    return () => { p.map.off("lt-measure", on); };
  }, [p.map]);
  useEffect(() => () => { activeMeasure(p.map)?.cancel(); }, [p.map]);
  useDismiss(layersOpen, layersRef, () => setLayersOpen(false));
  useDismiss(moreOpen, moreRef, () => setMoreOpen(false));

  const hidden = LAYERS.filter((l) => !p.flags[l.key]);
  const toggle = (k: keyof LayerFlags) => p.onFlags({ ...p.flags, [k]: !p.flags[k] });
  const measuring = !!measure;
  const hasRaster = registeredSheets(p.map).length > 0;
  const canFit = p.canFitAll ?? hasRaster;
  const fitTitle = canFit ? "Karte auf das ganze Raster und alle NAI einpassen" : "Noch kein Raster und keine NAI – zuerst unter «Führungsraster» ein Raster anlegen";
  const cellTitle = hasRaster ? "" : " – noch kein Raster vorhanden";
  const toggleMeasure = () => {
    const c = activeMeasure(p.map);
    if (c) c.cancel();
    else startMeasure(p.map);
  };
  const more = (fn: () => void) => () => { setMoreOpen(false); fn(); };

  const basemapSeg = (
    <div className="nav-seg" role="group" aria-label="Grundkarte">
      {BASEMAPS.map((b) => (
        <button key={b.id} type="button" aria-pressed={p.basemap === b.id} onClick={() => p.onBasemap(b.id)} title={`Grundkarte ${b.label}`}>
          {b.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`nav-tb${full ? " full" : " compact"}${tiny ? " tiny" : ""}`}>
      <div className="nav-bar" role="toolbar" aria-label="Kartenwerkzeuge">
        {full && basemapSeg}

        <div className="nav-layers" ref={layersRef}>
          <button type="button" className="nav-btn" aria-expanded={layersOpen} aria-haspopup="true" onClick={() => { setLayersOpen((o) => !o); setMoreOpen(false); }}
            aria-label="Ebenen und Grundkarte"
            title={hidden.length ? `Ausgeblendet: ${hidden.map((h) => h.label).join(", ")}` : full ? "Ebenen ein-/ausblenden" : "Grundkarte und Ebenen"}>
            <IconLayers />{!tiny && <span>Ebenen</span>}
            {hidden.length > 0 && <span className="nav-off">{tiny ? hidden.length : `${hidden.length} aus`}</span>}
            {!tiny && <IconChevron />}
          </button>
          {layersOpen && (
            <div className="nav-pop nav-layerpop" role="group" aria-label="Ebenen">
              {!full && (
                <>
                  <div className="nav-pop-h">Grundkarte</div>
                  {basemapSeg}
                  <div className="nav-pop-h">Ebenen</div>
                </>
              )}
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

        {full ? (
          <>
            <button type="button" className="nav-btn" onClick={p.onFitAll} disabled={!canFit} title={fitTitle}>
              <IconFit /><span>Ganzes Raster</span>
            </button>
            <div className="nav-seg" role="group" aria-label="Zoom auf Planquadrat in der Kartenmitte">
              <button type="button" disabled={!hasRaster} onClick={() => zoomToCellAtCenter(p.map, "feld")} title={`Auf das Feld in der Kartenmitte zoomen (oder Doppelklick in ein Feld)${cellTitle}`}>
                <IconCell /><span>Feld</span>
              </button>
              <button type="button" disabled={!hasRaster} onClick={() => zoomToCellAtCenter(p.map, "quadrant")} title={`Auf den Unterquadranten in der Kartenmitte zoomen (Doppelklick im gezeigten Feld)${cellTitle}`}>
                <IconQuad /><span>¼</span>
              </button>
            </div>
            <button type="button" className="nav-btn" aria-pressed={measuring} onClick={toggleMeasure} title="Distanz und Azimut messen">
              <IconRuler /><span>Messen</span>
            </button>
          </>
        ) : (
          <div className="nav-more" ref={moreRef}>
            <button type="button" className="nav-btn nav-dots" aria-expanded={moreOpen} aria-haspopup="menu" aria-pressed={measuring}
              onClick={() => { setMoreOpen((o) => !o); setLayersOpen(false); }} aria-label="Weitere Werkzeuge" title="Ganzes Raster, Feld, Unterquadrant, Messen">
              <IconMore />
            </button>
            {moreOpen && (
              <div className="nav-pop nav-menu" role="menu" aria-label="Weitere Werkzeuge">
                <button type="button" role="menuitem" onClick={more(p.onFitAll)} disabled={!canFit} title={fitTitle}><IconFit /><span>Ganzes Raster</span></button>
                <button type="button" role="menuitem" onClick={more(() => zoomToCellAtCenter(p.map, "feld"))} disabled={!hasRaster} title={`Auf das Feld in der Kartenmitte zoomen${cellTitle}`}><IconCell /><span>Auf Feld zoomen</span><kbd>Doppelklick</kbd></button>
                <button type="button" role="menuitem" onClick={more(() => zoomToCellAtCenter(p.map, "quadrant"))} disabled={!hasRaster} title={`Auf den Unterquadranten in der Kartenmitte zoomen${cellTitle}`}><IconQuad /><span>Auf Unterquadrant zoomen</span></button>
                <hr />
                <button type="button" role="menuitem" aria-pressed={measuring} onClick={more(toggleMeasure)}><IconRuler /><span>{measuring ? "Messen beenden" : "Messen (Distanz, Azimut)"}</span></button>
              </div>
            )}
          </div>
        )}
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
        <span className="nav-mtot mono">{legs.length ? formatDistance(total) : ""}</span>
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
