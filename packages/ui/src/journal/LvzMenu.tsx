/**
 * Popover «Mehr …» an der gewählten Journal-Zeile (Spez. MVP 3, Kap. 2.4, 3.3, 3.5): Dringend · offen/erledigt ·
 * Massnahme · weitergemeldet an … um … (mit «jetzt an Bat», «jetzt an Kp») · «Aufgehoben (jetzt)» (nur Sperre,
 * Checkpoint, Fläche …) · «Antwort eintragen» (nur Rückfrage) · «Erfasst T2 07:14 von BSP · Nr 54».
 * Felder speichern bei Enter/Verlassen; jede Änderung mit Rückgängig-Leiste. Vermerke ändern die Revision nicht und
 * zählen beim Zusammenführen nie als Konflikt (`setVermerk`, Kern).
 *
 * Laptop: rechts neben der Zeile (320 px); schmal (Tablet): als Blatt unter der Zeile. Esc / Klick daneben schliesst,
 * Fokus zurück auf «Mehr …». Vertrag `LvzRowProps` (shell/contracts.ts) plus `anchor`/`onClose`.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { artOf, istAufhebbar, lvzIndex, nrLabel, vermerkeOf } from "@lage/core";
import { dayLabel } from "../Timeline";
import { takeNr } from "../commit";
import { hm } from "../entry/labels";
import type { LvzRowProps } from "../shell/contracts";
import { aufhebenJetzt, jetztT, setVermerkUndo } from "./actions";
import "./lvz.css";

/** Ziele für «jetzt an …» (Kap. 2.4) */
const JETZT_AN = ["Bat", "Kp"];

/** «0715» / «07:15» → «07:15», sonst null */
function hhmmOf(s: string): string | null {
  const m = /^\s*(\d{1,2})[:.]?(\d{2})\s*$/.exec(s);
  if (!m || +m[1]! > 23 || +m[2]! > 59) return null;
  return `${m[1]!.padStart(2, "0")}:${m[2]}`;
}

export function LvzMenu(p: LvzRowProps & {
  /** Knopf «Mehr …» (Lage des Popovers, Fokus nach dem Schliessen) */
  anchor: HTMLElement | null;
  onClose(): void;
  /** laufende Nummer für «Aufgehoben (jetzt)» (Standard: `takeNr`) */
  onNr?(): number;
}) {
  const { e, ex, device, kuerzel, update } = p;
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const idx = lvzIndex(ex.events ?? []);
  const v = vermerkeOf(e, idx);
  const art = artOf(e);
  const nr = nrLabel(e, ex);
  const [massnahme, setMassnahme] = useState(v.massnahme ?? "");
  const [an, setAn] = useState(v.weiter?.an ?? "");
  const [um, setUm] = useState(v.weiter?.um?.slice(11, 16) ?? "");
  const [pos, setPosRaw] = useState<CSSProperties | null>(null);
  /** nur bei echter Änderung setzen (sonst zeichnet die Lage-Messung endlos neu) */
  const setPos = useCallback((n: CSSProperties) => setPosRaw((o) => (o && o.left === n.left && o.top === n.top && o.width === n.width ? o : n)), []);
  // Werte von aussen (anderes Fenster, Rückgängig) übernehmen, solange das Feld nicht bearbeitet wird
  useEffect(() => { if (document.activeElement?.id !== `${id}-m`) setMassnahme(v.massnahme ?? ""); }, [v.massnahme, id]);
  useEffect(() => { const a = document.activeElement?.id; if (a !== `${id}-an` && a !== `${id}-um`) { setAn(v.weiter?.an ?? ""); setUm(v.weiter?.um?.slice(11, 16) ?? ""); } }, [v.weiter?.an, v.weiter?.um, id]);

  const close = useCallback((focusBack = true) => { p.onClose(); if (focusBack) requestAnimationFrame(() => p.anchor?.focus({ preventScroll: true })); }, [p]);

  // Lage: rechts neben der Zeile, wenn Platz (Laptop); sonst als Blatt unter der Zeile in der Spalte
  const place = useCallback(() => {
    const a = p.anchor;
    const row = a?.closest<HTMLElement>("li[data-id]");
    if (!a || !row) return;
    const r = row.getBoundingClientRect();
    const col = row.closest<HTMLElement>(".jl")?.getBoundingClientRect() ?? r;
    const w = 320, vw = window.innerWidth, vh = window.innerHeight;
    const h = box.current?.offsetHeight ?? 360;
    if (vw >= 860 && col.right + 8 + w <= vw - 8) {
      setPos({ left: col.right + 8, top: Math.max(8, Math.min(r.top, vh - h - 8)), width: w });
    } else {
      const b = a.getBoundingClientRect();
      const below = b.bottom + 6;
      const top = below + h <= vh - 8 ? below : Math.max(8, b.top - h - 6);
      setPos({ left: Math.max(8, col.left), top, width: Math.min(col.width, vw - 16) });
    }
  }, [p.anchor, setPos]);
  useLayoutEffect(() => { place(); });
  useEffect(() => {
    const on = () => place();
    window.addEventListener("resize", on);
    document.addEventListener("scroll", on, true);
    return () => { window.removeEventListener("resize", on); document.removeEventListener("scroll", on, true); };
  }, [place]);

  // Fokus hinein, Esc und Klick daneben schliessen
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
    const down = (ev: PointerEvent) => { const t = ev.target as Node; if (!box.current?.contains(t) && !p.anchor?.contains(t)) { flush.current(); close(false); } };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const o = { device, kuerzel };
  const saveMassnahme = () => {
    const t = massnahme.trim();
    if (t === (v.massnahme ?? "")) return;
    setVermerkUndo(update, ex, e.id, "massnahme", t, o);
  };
  const saveWeiter = () => {
    const a = an.trim();
    if (!a) { if (v.weiter) setVermerkUndo(update, ex, e.id, "weiter", null, o); return; }
    const hhmm = hhmmOf(um) ?? jetztT(ex).slice(11, 16);
    const u = `${jetztT(ex).slice(0, 10)}T${hhmm}`;
    if (v.weiter && v.weiter.an === a && v.weiter.um === u) return;
    setUm(hhmm);
    setVermerkUndo(update, ex, e.id, "weiter", { an: a, um: u }, o);
  };
  const jetztAn = (ziel: string) => {
    const u = jetztT(ex);
    setAn(ziel); setUm(u.slice(11, 16));
    setVermerkUndo(update, ex, e.id, "weiter", { an: ziel, um: u }, o);
  };
  /** offene Eingaben speichern (Esc, Klick daneben) */
  const flush = useRef(() => {});
  flush.current = () => { saveMassnahme(); saveWeiter(); };
  const enter = (f: () => void) => (ev: React.KeyboardEvent) => { if (ev.key === "Enter") { ev.preventDefault(); f(); } };

  const aufhebbar = art === "meldung" && !e.deleted && !e.hebtAuf && istAufhebbar(e) && !v.aufgehoben;
  const erfasst = e.tReported ?? e.t;

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={box} className="lvzm" role="dialog" aria-label={`Mehr zu Nr ${nr}`} style={pos ?? { visibility: "hidden" }}
      onClick={(ev) => ev.stopPropagation()}
      onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === "Escape") { ev.preventDefault(); flush.current(); close(); } }}>
      <label className="lvzm-check">
        <input type="checkbox" checked={v.dringend} onChange={(ev) => setVermerkUndo(update, ex, e.id, "dringend", ev.target.checked, o)} />
        <span className="lvzm-box" aria-hidden="true" />
        <span>Dringend</span>
      </label>
      <div className="lvzm-radio" role="radiogroup" aria-label="Status">
        {(["offen", "erledigt"] as const).map((s) => (
          <label key={s}>
            <input type="radio" name={`${id}-st`} checked={v.status === s} onChange={() => setVermerkUndo(update, ex, e.id, "status", s, o)} />
            <span className="lvzm-box lvzm-rund" aria-hidden="true" />
            <span>{s}</span>
          </label>
        ))}
      </div>
      <div className="lvzm-row">
        <label htmlFor={`${id}-m`}>Massnahme</label>
        <input id={`${id}-m`} className="lvzm-in" value={massnahme} onChange={(ev) => setMassnahme(ev.target.value)} onBlur={saveMassnahme} onKeyDown={enter(saveMassnahme)}
          placeholder="z. B. Zfhr orientiert" autoComplete="off" />
      </div>
      <div className="lvzm-row lvzm-weiter">
        <label htmlFor={`${id}-an`}>Weitergemeldet an</label>
        <input id={`${id}-an`} className="lvzm-in lvzm-an" value={an} onChange={(ev) => setAn(ev.target.value)} onBlur={saveWeiter} onKeyDown={enter(saveWeiter)} placeholder="Bat" autoComplete="off" />
        <label htmlFor={`${id}-um`}>um</label>
        <input id={`${id}-um`} className="lvzm-in lvzm-um mono" value={um} onChange={(ev) => setUm(ev.target.value)} onBlur={saveWeiter} onKeyDown={enter(saveWeiter)}
          placeholder="0715" inputMode="numeric" autoComplete="off" maxLength={5} />
      </div>
      <div className="lvzm-btns">
        {JETZT_AN.map((z) => <button key={z} type="button" className="lvzm-btn" onClick={() => jetztAn(z)}>jetzt an {z}</button>)}
      </div>
      {aufhebbar && (
        <button type="button" className="lvzm-btn lvzm-wide" onClick={() => {
          aufhebenJetzt(update, ex, e.id, { ...o, nr: p.onNr ? p.onNr() : takeNr(ex) });
          close();
        }}>Aufgehoben (jetzt)</button>
      )}
      {art === "rueckfrage" && !e.deleted && (
        <button type="button" className="lvzm-btn lvzm-wide" onClick={() => { close(false); p.onPrefill(`Antwort zu ${nr}: `); }}>Antwort eintragen</button>
      )}
      <p className="lvzm-foot">Erfasst {dayLabel(erfasst, ex.days)} {hm(erfasst)}{e.erfasstVon ? ` von ${e.erfasstVon}` : ""}{nr ? ` · Nr ${nr}` : ""}</p>
    </div>,
    document.body,
  );
}
