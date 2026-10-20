/**
 * Rechtsklick bzw. langes Drücken (Touch) auf die Karte: kleines Menü an der Stelle mit LV95-Koordinate,
 * Planquadrat inkl. Unterquadrant, Kopieren, «Meldung hier», «Messen ab hier», Zoom auf Feld/Unterquadrant.
 * Schliesst mit Esc, Klick daneben oder Verschieben der Karte. Während einer Messung beendet Rechtsklick die Messung.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import L from "leaflet";
import { cellAtAny, formatLv95, type CellRef, type LV95, type RasterSheet } from "@lage/core";
import { activeMeasure, isMeasuring, overlayPane, startMeasure, toLatLng, toLv95, zoomToCell } from "@lage/map";
import { IconCell, IconCopy, IconPen, IconQuad, IconRuler } from "./navicons";
import "./navigation.css";

interface Open {
  pos: LV95;
  x: number;
  y: number;
  cell: CellRef | null;
  sheet?: RasterSheet;
}

async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    // Fallback (z. B. ohne sichere Verbindung)
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

const LONG_PRESS_MS = 550;

export function MapContextMenu({ map, sheets, onReportHere }: { map: L.Map; sheets: RasterSheet[]; onReportHere: (pos: LV95) => void }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;
  const marker = useRef<L.CircleMarker | null>(null);
  const lastOpen = useRef(0);

  // Öffnen: Rechtsklick (Leaflet «contextmenu») und eigenes langes Drücken für Touch/Stift
  useEffect(() => {
    const show = (latlng: L.LatLng) => {
      if (Date.now() - lastOpen.current < 700) return; // Long-Press + natives contextmenu nicht doppelt
      lastOpen.current = Date.now();
      const pos = toLv95(latlng);
      const pt = map.latLngToContainerPoint(latlng);
      const cell = cellAtAny(sheetsRef.current, pos);
      setCopied(null);
      setPlace(null);
      setOpen({ pos, x: pt.x, y: pt.y, cell, sheet: cell ? sheetsRef.current.find((s) => s.id === cell.sheetId) : undefined });
    };
    const onCtx = (ev: L.LeafletMouseEvent) => {
      ev.originalEvent?.preventDefault();
      if (isMeasuring(map)) { activeMeasure(map)?.finish(); return; }
      show(ev.latlng);
    };
    map.on("contextmenu", onCtx);

    const el = map.getContainer();
    let timer = 0;
    let start: { x: number; y: number; id: number } | null = null;
    let suppressClick = false;
    const cancel = () => { window.clearTimeout(timer); start = null; };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (start) { cancel(); return; } // zweiter Finger: Pinch
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      timer = window.setTimeout(() => {
        if (!start || isMeasuring(map)) return;
        const r = el.getBoundingClientRect();
        show(map.containerPointToLatLng(L.point(start.x - r.left, start.y - r.top)));
        suppressClick = true;
        start = null;
        navigator.vibrate?.(15);
      }, LONG_PRESS_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
    };
    const onClickCapture = (e: MouseEvent) => {
      if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", cancel);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("click", onClickCapture, true);
    return () => {
      map.off("contextmenu", onCtx);
      cancel();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", cancel);
      el.removeEventListener("pointercancel", cancel);
      el.removeEventListener("click", onClickCapture, true);
    };
  }, [map]);

  // Schliessen: Esc, Klick daneben, Karte bewegt
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    const onDown = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node)) close(); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    map.on("movestart zoomstart", close);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      map.off("movestart zoomstart", close);
    };
  }, [open, map]);

  // Punkt markieren, solange das Menü offen ist
  useEffect(() => {
    marker.current?.remove();
    marker.current = null;
    if (open) {
      marker.current = L.circleMarker(toLatLng(open.pos), { pane: overlayPane(map), radius: 5, color: "#fff", weight: 2, fillColor: "#101414", fillOpacity: 1, interactive: false }).addTo(map);
    }
    return () => { marker.current?.remove(); marker.current = null; };
  }, [open, map]);

  // Lage im Kartenbereich halten (nach rechts/unten kippen, wenn kein Platz)
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const box = map.getSize();
    const w = menu.current.offsetWidth, h = menu.current.offsetHeight;
    let left = open.x + 6, top = open.y + 6;
    if (left + w > box.x - 8) left = Math.max(8, open.x - w - 6);
    if (top + h > box.y - 8) top = Math.max(8, open.y - h - 6);
    setPlace({ left, top });
    menu.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [open, map]);

  if (!open) return null;

  const coord = `${Math.round(open.pos.e)} / ${Math.round(open.pos.n)}`;
  const doCopy = async (what: string, text: string) => {
    const ok = await copyText(text);
    setCopied(ok ? what : "fehler");
    window.setTimeout(() => setOpen(null), ok ? 700 : 1500);
  };
  const act = (fn: () => void) => () => { setOpen(null); fn(); };

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const n = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[n]?.focus();
  };

  return (
    <div
      ref={menu}
      className="nav-ctx"
      role="menu"
      aria-label="Kartenpunkt"
      style={place ?? { left: open.x + 6, top: open.y + 6, visibility: "hidden" }}
      onKeyDown={onMenuKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="nav-ctx-h">
        {open.cell ? (
          <><b className="mono">{open.cell.label}</b>{open.sheet && <span>Blatt {open.sheet.name}</span>}</>
        ) : (
          <span className="nav-ctx-out">ausserhalb des Rasters</span>
        )}
        <div className="mono nav-ctx-c">{formatLv95(open.pos)}</div>
      </div>
      <button type="button" role="menuitem" className="nav-ctx-main" onClick={act(() => onReportHere(open.pos))}>
        <IconPen /><span>Meldung hier</span>
      </button>
      <button type="button" role="menuitem" onClick={() => doCopy("koord", coord)}>
        <IconCopy /><span>{copied === "koord" ? "Koordinate kopiert" : "Koordinate kopieren"}</span>
      </button>
      <button type="button" role="menuitem" disabled={!open.cell} onClick={() => open.cell && doCopy("pq", open.cell.label)}>
        <IconCopy /><span>{copied === "pq" ? "Planquadrat kopiert" : "Planquadrat kopieren"}</span>
      </button>
      {copied === "fehler" && <div className="nav-ctx-err">Kopieren nicht möglich</div>}
      <hr />
      <button type="button" role="menuitem" onClick={act(() => startMeasure(map, { start: open.pos }))}>
        <IconRuler /><span>Messen ab hier</span>
      </button>
      {open.cell && (
        <>
          <button type="button" role="menuitem" onClick={act(() => zoomToCell(map, open.pos, "feld", sheets))}>
            <IconCell /><span>Auf Feld zoomen</span>
          </button>
          {open.sheet?.quadrants !== false && (
            <button type="button" role="menuitem" onClick={act(() => zoomToCell(map, open.pos, "quadrant", sheets))}>
              <IconQuad /><span>Auf Unterquadrant zoomen</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
