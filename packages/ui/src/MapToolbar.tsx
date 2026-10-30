/**
 * Werkzeuge oben rechts an der Karte (Spez. MVP 1, Kap. 1.2, 2.10, 3.7):
 * - Basis: nur «Anzeige ▾» – 4 Ebenen (Führungsraster, NAI und Räume, Eigene, Feind und Unklar), «Zeige letzte»,
 *   Grundkarte (Grau Standard, Landeskarte, Luftbild), Legende. Zoom ± ist Leaflets eigene Steuerung links oben.
 * - Experte: davor Ganzes Raster, Planquadrat, Unterquadrant, Messen, Schloss «Zeichen nicht verschiebbar»; in der
 *   Anzeige zusätzlich Flächen und Linien, Bisherige Wege, Uhrzeit an Zeichen, Hinweise, Was Rot tun könnte, Fotos,
 *   «alles zeigen». Auf schmaler Karte (< 1180 px) wandern die Werkzeuge hinter «⋯».
 * Wahl pro Gerät gemerkt, getrennt für Basis und Experte (layers.ts); «Zeige letzte» nie (Paket C, `ZeitApi`).
 * MVP 3.5 (K3, B1): «Zeichengrösse S | M | L» (nur dieses Gerät, Standard M; `useZeichenGroesse`, map/symbolSize.ts) –
 * eine Gruppe (`data-zaehl="zeichengroesse"`), nur im Anzeige-Menü.
 * Messen: Klick setzt Punkte, Doppelklick/Enter beendet, Backspace = Rückgängig, Esc = Abbrechen.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
import type { Exercise } from "@lage/core";
import { DEFAULT_FLAGS, isLocked, setLocked, subscribeLock, type LayerFlags } from "./layers";
import { setOnlinePolicy } from "./onlinePolicy";
import { useZeichenGroesse, type ZeichenStufe } from "./map/symbolSize";
import type { ShowLast } from "./shell/contracts";
import { IconCell, IconCheck, IconChevron, IconClose, IconFit, IconMore, IconQuad, IconRuler, IconUndo } from "./navicons";
import "./navigation.css";
import "./shell/shell.css";

export interface MapToolbarProps {
  map: L.Map;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  flags: LayerFlags;
  onFlags: (f: LayerFlags) => void;
  /** Experten-Werkzeuge sichtbar */
  experte?: boolean;
  /** Karte auf Raster/NAI der Übung einpassen */
  onFitAll: () => void;
  /** Gibt es etwas einzupassen (Raster oder NAI)? Standard: ein Raster ist angemeldet. */
  canFitAll?: boolean;
  /** Online-Dienste der Übung (Standard an) – nur gespiegelt fürs Strassennetz, Schalter in Vorbereiten Schritt 1 */
  online?: Exercise["onlineDienste"];
  /** «Zeige letzte» (Paket C); ohne Angabe nicht angeboten */
  showLast?: ShowLast;
  onShowLast?: (s: ShowLast) => void;
  /** Netz vorhanden (Luftbild nur mit Netz, ausser vorbereitet) */
  net?: boolean;
  /** Anzeige offen/zu (Rückblick-Timer ruht, R4) */
  onOpenChange?: (open: boolean) => void;
  /** zusätzlich links in der Leiste (z. B. Kartensuche in Experte) */
  lead?: ReactNode;
}

const BASEMAPS: Array<{ id: Basemap; label: string }> = [
  { id: "grau", label: "Grau" },
  { id: "lk", label: "Landeskarte" },
  { id: "img", label: "Luftbild" },
];

const STUFEN: Array<{ v: ZeichenStufe; title: string }> = [
  { v: "S", title: "Zeichen klein" },
  { v: "M", title: "Zeichen mittel (Standard)" },
  { v: "L", title: "Zeichen gross" },
];

const SHOW_LAST: Array<{ v: ShowLast; label: string }> = [
  { v: 30, label: "30 min" },
  { v: 60, label: "1 h" },
  { v: 120, label: "2 h" },
  { v: 360, label: "6 h" },
  { v: null, label: "alles" },
];

type LayerDef = { key: keyof LayerFlags; label: string; sw: string };
const BASIS: LayerDef[] = [
  { key: "raster", label: "Führungsraster", sw: "raster" },
  { key: "nai", label: "NAI und Räume", sw: "nai" },
  { key: "eigene", label: "Eigene", sw: "blau" },
  { key: "feind", label: "Feind und Unklar", sw: "rot" },
];
const EXPERTE: LayerDef[] = [
  { key: "flaechen", label: "Flächen und Linien", sw: "flaeche" },
  { key: "spuren", label: "Bisherige Wege", sw: "spur" },
  { key: "zeiten", label: "Uhrzeit an Zeichen", sw: "zeit" },
  { key: "hinweise", label: "Hinweise", sw: "hinweis" },
  { key: "aktionen", label: "Was Rot tun könnte", sw: "coa" },
  { key: "anhaenge", label: "Fotos", sw: "anhang" },
];

/** Schloss: Zeichen nicht verschiebbar (zu) bzw. verschiebbar (offen) */
const IconLock = ({ closed }: { closed: boolean }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="3" y="7.2" width="10" height="7" rx="1.2" />
    <path d={closed ? "M5.2 7.2V5a2.8 2.8 0 0 1 5.6 0v2.2" : "M5.2 7.2V5a2.8 2.8 0 0 1 5.4-1"} />
    {closed && <circle cx="8" cy="10.7" r=".9" fill="currentColor" stroke="none" />}
  </svg>
);
const LOCK_TITLE = (on: boolean) => on
  ? "Zeichen sind nicht verschiebbar – klicken, damit sie sich wieder ziehen lassen"
  : "Zeichen nicht verschiebbar machen: kein versehentliches Verschieben auf der Karte";

/** Ab dieser Kartenbreite (px) alle Experten-Werkzeuge in einer Zeile, darunter hinter «⋯». */
export const TOOLBAR_FULL_MIN = 1180;

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

/** Aufklappmenü schliessen bei Klick daneben oder Esc (Fokus zurück auf den Knopf). */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: (focus: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(true); } };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function MapToolbar(p: MapToolbarProps) {
  const [showOpen, setShowOpenState] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [measure, setMeasure] = useState<MeasureState | null>(null);
  const showRef = useRef<HTMLDivElement>(null);
  const showBtn = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const width = useMapWidth(p.map);
  const [stufe, setStufe] = useZeichenGroesse();
  // Strassennetz (roadsource) hat keine Übung: Einstellung hier spiegeln
  setOnlinePolicy(p.online);
  const locked = useSyncExternalStore(subscribeLock, isLocked);
  const x = !!p.experte;
  const full = width >= TOOLBAR_FULL_MIN;
  const setShowOpen = (o: boolean) => { setShowOpenState(o); p.onOpenChange?.(o); };

  // Messung (auch aus dem Kontextmenü gestartet) verfolgen
  useEffect(() => {
    const on = (e: L.LeafletEvent) => setMeasure((e as MeasureEvent).state);
    p.map.on("lt-measure", on);
    return () => { p.map.off("lt-measure", on); };
  }, [p.map]);
  useEffect(() => () => { activeMeasure(p.map)?.cancel(); }, [p.map]);
  // Experte aus: Messung beenden
  useEffect(() => { if (!x) activeMeasure(p.map)?.cancel(); }, [x, p.map]);
  useDismiss(showOpen, showRef, (f) => { setShowOpen(false); if (f) showBtn.current?.focus(); });
  useDismiss(moreOpen, moreRef, () => setMoreOpen(false));
  useEffect(() => () => p.onOpenChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k: keyof LayerFlags) => p.onFlags({ ...p.flags, [k]: !p.flags[k] });
  const layers = x ? [...BASIS, ...EXPERTE] : BASIS;
  const hidden = layers.filter((l) => !p.flags[l.key]);
  const measuring = !!measure;
  const hasRaster = registeredSheets(p.map).length > 0;
  const canFit = p.canFitAll ?? hasRaster;
  const fitTitle = canFit ? "Karte auf das ganze Raster und alle NAI einpassen" : "Noch kein Raster und keine NAI (Vorbereiten)";
  const cellTitle = hasRaster ? "" : " – noch kein Raster vorhanden";
  const toggleMeasure = () => {
    const c = activeMeasure(p.map);
    if (c) c.cancel();
    else startMeasure(p.map);
  };
  const more = (fn: () => void) => () => { setMoreOpen(false); fn(); };

  const lockBtn = (
    <button type="button" className="nav-btn nav-lock" aria-pressed={locked} onClick={() => setLocked(!locked)} title={LOCK_TITLE(locked)}
      aria-label="Zeichen nicht verschiebbar">
      <IconLock closed={locked} />
    </button>
  );

  return (
    <div className={`nav-tb az-tb${full ? " full" : " compact"}`}>
      <div className="nav-bar" role="toolbar" aria-label="Karte">
        {p.lead}
        {x && (full ? (
          <>
            <button type="button" className="nav-btn" onClick={p.onFitAll} disabled={!canFit} title={fitTitle}>
              <IconFit /><span>Ganzes Raster</span>
            </button>
            <div className="nav-seg" role="group" aria-label="Zoom auf Planquadrat in der Kartenmitte" data-zaehl="zoom-pq">
              <button type="button" disabled={!hasRaster} onClick={() => zoomToCellAtCenter(p.map, "feld")} title={`Auf das Planquadrat in der Kartenmitte zoomen (oder Doppelklick)${cellTitle}`}>
                <IconCell /><span>Planquadrat</span>
              </button>
              <button type="button" disabled={!hasRaster} onClick={() => zoomToCellAtCenter(p.map, "quadrant")} title={`Auf den Unterquadranten in der Kartenmitte zoomen${cellTitle}`}>
                <IconQuad /><span>Unterquadrant</span>
              </button>
            </div>
            <button type="button" className="nav-btn" aria-pressed={measuring} onClick={toggleMeasure} title="Distanz und Azimut messen">
              <IconRuler /><span>Messen</span>
            </button>
            {lockBtn}
          </>
        ) : (
          <>
            {lockBtn}
            <div className="nav-more" ref={moreRef}>
              <button type="button" className="nav-btn nav-dots" aria-expanded={moreOpen} aria-haspopup="menu" aria-pressed={measuring}
                onClick={() => { setMoreOpen((o) => !o); setShowOpen(false); }} aria-label="Weitere Werkzeuge" title="Ganzes Raster, Planquadrat, Unterquadrant, Messen">
                <IconMore />
              </button>
              {moreOpen && (
                <div className="nav-pop nav-menu" role="menu" aria-label="Weitere Werkzeuge">
                  <button type="button" role="menuitem" onClick={more(p.onFitAll)} disabled={!canFit} title={fitTitle}><IconFit /><span>Ganzes Raster</span></button>
                  <button type="button" role="menuitem" onClick={more(() => zoomToCellAtCenter(p.map, "feld"))} disabled={!hasRaster} title={`Auf das Planquadrat in der Kartenmitte zoomen${cellTitle}`}><IconCell /><span>Auf Planquadrat zoomen</span><kbd>Doppelklick</kbd></button>
                  <button type="button" role="menuitem" onClick={more(() => zoomToCellAtCenter(p.map, "quadrant"))} disabled={!hasRaster} title={`Auf den Unterquadranten in der Kartenmitte zoomen${cellTitle}`}><IconQuad /><span>Auf Unterquadrant zoomen</span></button>
                  <hr />
                  <button type="button" role="menuitem" aria-pressed={measuring} onClick={more(toggleMeasure)}><IconRuler /><span>{measuring ? "Messen beenden" : "Messen (Distanz, Azimut)"}</span></button>
                </div>
              )}
            </div>
          </>
        ))}

        <div className="nav-layers" ref={showRef}>
          <button ref={showBtn} type="button" className="nav-btn az-btn" aria-expanded={showOpen} aria-haspopup="true"
            onClick={() => { setShowOpen(!showOpen); setMoreOpen(false); }}>
            <span>Anzeige</span><IconChevron />
          </button>
          {showOpen && (
            <div className="nav-pop az-pop" role="group" aria-label="Anzeige">
              <div className="az-h">Auf der Karte</div>
              {layers.map((l) => (
                <label key={l.key} className="az-row">
                  <i className={`nav-sw sw-${l.sw}`} aria-hidden="true" />
                  <span>{l.label}</span>
                  <input type="checkbox" role="switch" checked={p.flags[l.key]} onChange={() => toggle(l.key)} />
                </label>
              ))}
              {x && hidden.length > 0 && (
                <button type="button" className="az-link" onClick={() => p.onFlags({ ...DEFAULT_FLAGS, legende: p.flags.legende })}>alles zeigen</button>
              )}
              <div className="az-h" id="az-zg">Zeichengrösse <span className="az-hint">(nur dieses Gerät)</span></div>
              <div className="az-seg az-seg3" role="group" aria-labelledby="az-zg" data-zaehl="zeichengroesse">
                {STUFEN.map((x) => (
                  <button key={x.v} type="button" aria-pressed={stufe === x.v} title={x.title} onClick={() => setStufe(x.v)}>{x.v}</button>
                ))}
              </div>
              {p.onShowLast && (
                <>
                  <div className="az-h">Zeige letzte</div>
                  <div className="az-seg" role="group" aria-label="Zeige letzte">
                    {SHOW_LAST.map((s) => (
                      <button key={String(s.v)} type="button" aria-pressed={(p.showLast ?? null) === s.v} onClick={() => p.onShowLast!(s.v)}>{s.label}</button>
                    ))}
                  </div>
                </>
              )}
              <div className="az-h">Grundkarte</div>
              <div className="az-seg" role="group" aria-label="Grundkarte">
                {BASEMAPS.map((b) => (
                  <button key={b.id} type="button" aria-pressed={p.basemap === b.id} onClick={() => p.onBasemap(b.id)}>{b.label}</button>
                ))}
              </div>
              {p.basemap === "img" && p.net === false && <p className="az-note">Luftbild nur mit Netz, ausser offline vorbereitet.</p>}
              <label className="az-row az-sep">
                <span>Legende</span>
                <input type="checkbox" role="switch" checked={p.flags.legende} onChange={() => toggle("legende")} />
              </label>
            </div>
          )}
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
