/**
 * Anhänge anzeigen: Miniatur/Büroklammer in der Journalzeile und im Banner, Bildbetrachter (Zoom, Verschieben,
 * Wischen, Drehen). Der Betrachter ist einmal eingebunden (`ViewerHost`) und wird über `openViewer` geöffnet.
 */
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from "react";
import type { Attachment } from "@lage/core";
import { attLabel, fmtTime, useBlobUrl } from "./attachmentStore";
import { fmtSize } from "./photo";
import "./photo.css";

// ---------------------------------------------------------------- Betrachter (global)

interface ViewerState { list: Attachment[]; i: number; title?: string }
let viewer: ViewerState | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
/** Betrachter öffnen (Liste der Anhänge, Start bei `i`) */
export function openViewer(list: Attachment[], i = 0, title?: string): void {
  if (!list.length) return;
  viewer = { list, i: Math.max(0, Math.min(list.length - 1, i)), title };
  emit();
}
export function closeViewer(): void { viewer = null; emit(); }
const useViewer = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => viewer);

export function ViewerHost() {
  const v = useViewer();
  return v ? <AttachmentViewer key={v.list.map((a) => a.id).join()} list={v.list} start={v.i} title={v.title} onClose={closeViewer} /> : null;
}

const ICON_CLIP = <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M10.5 4.5 5.8 9.2a1.3 1.3 0 0 0 1.9 1.9l5-5a2.6 2.6 0 0 0-3.7-3.7l-5 5a3.9 3.9 0 0 0 5.5 5.5l4.2-4.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
const ICON_MIC = <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="5.5" y="1.8" width="5" height="8" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M3.5 7.8a4.5 4.5 0 0 0 9 0M8 12.3v2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;

function Thumb({ a, size }: { a: Attachment; size: number }) {
  const u = useBlobUrl(a.id, true);
  if (a.kind !== "foto") return <span className="att-ico">{ICON_MIC}</span>;
  if (u === null) return <span className="att-ico" title="Foto nicht auf diesem Gerät">{ICON_CLIP}</span>;
  return <span className="att-thumb" style={{ width: size, height: size }}>{u && <img src={u} alt="" draggable={false} />}</span>;
}

/** Miniaturen in Journalzeile/Banner; Klick öffnet den Betrachter */
export function AttachmentChips({ list, size = 26, compact }: { list: Attachment[]; size?: number; compact?: boolean }) {
  if (!list.length) return null;
  const fotos = list.filter((a) => a.kind === "foto");
  const shown = compact ? fotos.slice(0, 1) : fotos.slice(0, 3);
  const rest = list.length - shown.length;
  return (
    <span className="att-chips">
      <button type="button" className="att-btn" title={list.map((a) => attLabel(a) + (a.cell ? ` · an ${a.cell}` : "")).join(" · ") + " – ansehen"}
        aria-label={`${list.length} ${list.length === 1 ? "Anhang" : "Anhänge"} ansehen`}
        onClick={(ev) => { ev.stopPropagation(); openViewer(list, 0); }}
        onKeyDown={(ev) => ev.stopPropagation()}>
        {shown.map((a) => <Thumb key={a.id} a={a} size={size} />)}
        {!shown.length && <span className="att-ico">{list[0]!.kind === "audio" ? ICON_MIC : ICON_CLIP}</span>}
        {rest > 0 && <span className="att-more">+{rest}</span>}
      </button>
    </span>
  );
}

// ---------------------------------------------------------------- Betrachter

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function AttachmentViewer({ list, start = 0, title, onClose }: { list: Attachment[]; start?: number; title?: string; onClose: () => void }) {
  const [i, setI] = useState(start);
  const a = list[i]!;
  const url = useBlobUrl(a.id);
  const [z, setZ] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rot, setRot] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; px: number; py: number; d?: number; z: number; t: number; moved: boolean } | null>(null);

  const reset = () => { setZ(1); setPan({ x: 0, y: 0 }); };
  const go = (d: number) => { if (list.length < 2) return; setI((x) => (x + d + list.length) % list.length); reset(); setRot(0); };
  const zoomAt = (f: number, cx?: number, cy?: number) => {
    const r = stage.current?.getBoundingClientRect();
    setZ((z0) => {
      const z1 = clamp(z0 * f, 1, 8);
      if (r && cx !== undefined && cy !== undefined) {
        // Punkt unter dem Finger/Zeiger bleibt stehen
        const ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2);
        setPan((p) => (z1 === 1 ? { x: 0, y: 0 } : { x: ox - ((ox - p.x) * z1) / z0, y: oy - ((oy - p.y) * z1) / z0 }));
      } else if (z1 === 1) setPan({ x: 0, y: 0 });
      return z1;
    });
  };

  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); onClose(); }
      else if (ev.key === "ArrowRight") go(1);
      else if (ev.key === "ArrowLeft") go(-1);
      else if (ev.key === "+" || ev.key === "=") zoomAt(1.4);
      else if (ev.key === "-") zoomAt(1 / 1.4);
      else if (ev.key === "r" || ev.key === "R") setRot((r) => r + 90);
      else if (ev.key === "0") reset();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: RPointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...pts.current.values()];
    if (ps.length === 1) gesture.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, z, t: Date.now(), moved: false };
    else if (ps.length === 2) gesture.current = { ...(gesture.current ?? { x: 0, y: 0, px: pan.x, py: pan.y, t: Date.now(), moved: true }), d: Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y), z, moved: true };
  };
  const move = (e: RPointerEvent) => {
    if (!pts.current.has(e.pointerId) || !gesture.current) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const ps = [...pts.current.values()];
    if (ps.length >= 2 && g.d) {
      const d = Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y);
      const z1 = clamp((g.z * d) / g.d, 1, 8);
      setZ(z1);
      if (z1 === 1) setPan({ x: 0, y: 0 });
      return;
    }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
    if (z > 1) setPan({ x: g.px + dx, y: g.py + dy });
  };
  const up = (e: RPointerEvent) => {
    const g = gesture.current;
    pts.current.delete(e.pointerId);
    if (pts.current.size) return;
    gesture.current = null;
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    // Wischen (nicht vergrössert): nächstes/voriges Foto
    if (z === 1 && !g.d && Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy) && Date.now() - g.t < 800) go(dx < 0 ? 1 : -1);
  };
  const lastTap = useRef(0);
  const tap = (e: RMouseEvent) => {
    const now = Date.now();
    if (now - lastTap.current < 300) { if (z > 1) reset(); else zoomAt(2.5, e.clientX, e.clientY); lastTap.current = 0; }
    else lastTap.current = now;
  };

  return createPortal(
    <div className="av-back" role="dialog" aria-modal="true" aria-label="Anhang ansehen">
      <header className="av-head">
        <b className="av-title">{title ?? attLabel(a)}</b>
        <span className="av-meta">
          {list.length > 1 && <span className="tnum">{i + 1} / {list.length}</span>}
          {a.cell && <span className="pq">an {a.cell}</span>}
          {a.width && a.height ? <span className="tnum">{a.width} × {a.height}</span> : null}
          {a.duration ? <span className="tnum">{Math.round(a.duration)} s</span> : null}
          {a.size ? <span>{fmtSize(a.size)}</span> : null}
          {title && <span>{attLabel(a)}</span>}
        </span>
        <span className="av-sp" />
        {a.kind === "foto" && <>
          <button className="av-b" onClick={() => zoomAt(1 / 1.4)} aria-label="Verkleinern" title="Verkleinern (−)" disabled={z <= 1}>−</button>
          <button className="av-b tnum av-z" onClick={reset} title="Einpassen (0)">{Math.round(z * 100)} %</button>
          <button className="av-b" onClick={() => zoomAt(1.4)} aria-label="Vergrössern" title="Vergrössern (+)">+</button>
          <button className="av-b" onClick={() => setRot((r) => r + 90)} aria-label="Drehen" title="Drehen (R)">↻</button>
        </>}
        {url && <a className="av-b" href={url} download={`${attLabel(a).replace(/[^\w]+/g, "_")}.${a.mime.includes("png") ? "png" : a.kind === "audio" ? (a.mime.includes("mp4") ? "m4a" : "webm") : "jpg"}`} title="Datei speichern">⤓</a>}
        <button className="av-b av-x" onClick={onClose} aria-label="Schliessen" title="Schliessen (Esc)">×</button>
      </header>
      <div className="av-stage" ref={stage}
        onWheel={(e) => { if (a.kind === "foto") zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={tap}>
        {url === null ? <p className="av-missing">Inhalt nicht auf diesem Gerät (Übung ohne Anhänge geöffnet).</p>
          : a.kind === "audio" ? (url && <div className="av-audio"><audio controls src={url} /></div>)
          : url && <img className="av-img" src={url} alt={attLabel(a)} draggable={false}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${z}) rotate(${rot}deg)`, cursor: z > 1 ? "grab" : "zoom-in" }} />}
        {list.length > 1 && <>
          <button className="av-nav prev" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Voriges">‹</button>
          <button className="av-nav next" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Nächstes">›</button>
        </>}
      </div>
      {a.text && <details className="av-text"><summary>Erkannter Text{a.engine ? ` (${a.engine === "ocr-offline" ? "Texterkennung offline" : a.engine})` : ""}</summary><pre>{a.text}</pre></details>}
      {list.length > 1 && (
        <div className="av-strip">
          {list.map((x, j) => (
            <button key={x.id} className={"av-strip-b" + (j === i ? " on" : "")} onClick={() => { setI(j); reset(); setRot(0); }} title={attLabel(x)}>
              <Thumb a={x} size={44} />
            </button>
          ))}
        </div>
      )}
      <span className="sr-only" aria-live="polite">{attLabel(a)} {fmtTime(a.createdAt)}</span>
    </div>,
    document.body,
  );
}
