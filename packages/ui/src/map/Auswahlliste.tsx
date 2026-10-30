/**
 * Auswahlliste «Welches Zeichen?» (Spez. MVP 3.5, S12, B4, Wireframe 2.5): erscheint am Tipp-Punkt, wenn ≥ 2 verschiedene
 * Zeichen im Trefferradius liegen. Zeilen 48 px (`--hit` mindestens 48), nie über den Kartenrand, Pfeiltasten + Enter,
 * Esc oder Tipp daneben schliesst. Höchstens `AUSWAHL_MAX` Zeilen, dann «weitere …» (fächert auf bzw. zoomt hinein).
 * Testhaken: `role=listbox` mit Namen «Welches Zeichen?», Zeilen `role=option`.
 */
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import L from "leaflet";
import type { Affiliation, Status } from "@lage/core";
import { iconSvg } from "@lage/map";
import type { PickKandidat } from "../shell/contracts";
import { AUSWAHL_MAX } from "./pick";
import "./auswahl.css";

export interface AuswahlZeile extends PickKandidat {
  sym: string;
  aff: Affiliation;
  sidc?: string;
  status?: Status;
  /** «von H05», «AQ11 C» … (zweite Angabe nach der Zeit) */
  extra?: string;
}

interface Props {
  x: number;
  y: number;
  zeilen: AuswahlZeile[];
  onWahl: (id: string) => void;
  onMehr?: () => void;
  onClose: () => void;
}

function Liste({ x, y, zeilen, onWahl, onMehr, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const hid = useId();
  const shown = zeilen.slice(0, AUSWAHL_MAX);
  const mehr = zeilen.length - shown.length;
  // am Tipp-Punkt, aber nie über den Kartenrand
  useLayoutEffect(() => {
    const el = box.current;
    const par = el?.parentElement;
    if (!el || !par) return;
    const W = par.clientWidth, H = par.clientHeight, w = el.offsetWidth, h = el.offsetHeight;
    const left = x + 16 + w <= W - 8 ? x + 16 : Math.max(8, x - 16 - w);
    el.style.left = `${Math.round(Math.max(8, Math.min(W - w - 8, left)))}px`;
    el.style.top = `${Math.round(Math.max(8, Math.min(H - h - 8, y - h / 2)))}px`;
    el.style.visibility = "visible";
    el.querySelector<HTMLElement>("[role=option]")?.focus({ preventScroll: true });
  }, [x, y]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    // erst nach diesem Tipp (sonst schliesst der auslösende Zeiger die Liste gleich wieder)
    const t = window.setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    document.addEventListener("keydown", onKey, true);
    return () => { window.clearTimeout(t); document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey, true); };
  }, [onClose]);
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const opts = [...(box.current?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
    const i = opts.indexOf(document.activeElement as HTMLElement);
    const go = (j: number) => { const n = opts[Math.max(0, Math.min(opts.length - 1, j))]; n?.focus({ preventScroll: true }); };
    if (e.key === "ArrowDown") { e.preventDefault(); go(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); go(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(opts.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (document.activeElement as HTMLElement | null)?.click(); }
    else if (e.key === "Tab") { e.preventDefault(); go(e.shiftKey ? i - 1 : i + 1); }
  };
  return (
    <div ref={box} className="lt-pick" style={{ visibility: "hidden" }} onKeyDown={onKey}>
      <div className="lt-pick-h" id={hid}>Welches Zeichen?</div>
      <div role="listbox" aria-labelledby={hid}>
        {shown.map((z) => (
          <div key={z.id} role="option" aria-selected="false" tabIndex={-1} className={`lt-pick-o k-${z.kind}`}
            onClick={() => onWahl(z.id)}>
            <span className="lt-pick-s" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg(z.sym, z.aff, 18, { sidc: z.sidc, status: z.status }).svg }} />
            <span className="lt-pick-l">{z.label}</span>
            <span className="lt-pick-t tnum">{z.zeit}</span>
            {z.extra && <span className="lt-pick-x">{z.extra}</span>}
          </div>
        ))}
        {mehr > 0 && onMehr && (
          <div role="option" aria-selected="false" tabIndex={-1} className="lt-pick-o lt-pick-mehr" onClick={onMehr}>
            <span className="lt-pick-l">weitere … ({mehr})</span>
          </div>
        )}
      </div>
    </div>
  );
}

const offen = new WeakMap<L.Map, { root: Root; el: HTMLElement; close: () => void }>();

/** offene Auswahlliste dieser Karte? */
export function auswahlOffen(map: L.Map): boolean { return offen.has(map); }

/** Auswahlliste schliessen (falls offen) */
export function schliesseAuswahl(map: L.Map): void { offen.get(map)?.close(); }

/**
 * Auswahlliste an Containerpunkt `at` zeigen. `onWahl` erhält die ID der gewählten Zeile; die Liste schliesst danach.
 * @returns Funktion zum Schliessen
 */
export function zeigeAuswahl(map: L.Map, at: { x: number; y: number }, zeilen: AuswahlZeile[], onWahl: (id: string) => void, onMehr?: () => void): () => void {
  schliesseAuswahl(map);
  const el = document.createElement("div");
  el.className = "lt-pick-host";
  L.DomEvent.disableClickPropagation(el);
  L.DomEvent.disableScrollPropagation(el);
  map.getContainer().appendChild(el);
  const root = createRoot(el);
  const back = document.activeElement as HTMLElement | null;
  let zu = false;
  const close = () => {
    if (zu) return;
    zu = true;
    offen.delete(map);
    map.off("zoomstart movestart", close);
    window.setTimeout(() => { root.unmount(); el.remove(); }, 0);
    if (back?.isConnected && document.activeElement && el.contains(document.activeElement)) back.focus({ preventScroll: true });
  };
  offen.set(map, { root, el, close });
  map.on("zoomstart movestart", close);
  root.render(<Liste x={at.x} y={at.y} zeilen={zeilen} onClose={close}
    onWahl={(id) => { close(); onWahl(id); }} onMehr={onMehr ? () => { close(); onMehr(); } : undefined} />);
  return close;
}
