/**
 * Offline-Popover «Offline auf diesem Gerät» (Spez. MVP 3.5, Kap. 2.3, S6/S7) – öffnet sich am Kopf-Knopf, **kein
 * Moduswechsel**. **Phase-0-Fassung:** zeigt den Stand (App, Karte, Ortsnamen, Speicher, Installiert, Datei) und bietet
 * «Datei sichern …» sowie übergangsweise «Offline-Karte laden (Vorbereiten) …» (bisheriger Weg, bis Paket A «Alles für
 * offline laden · ca. 27 MB», Fortschritt, Abbrechen und die Anleitung «So geht’s ▸» hier einbaut).
 * Esc, ✕ und Klick ausserhalb schliessen; Fokus zurück auf den Kopf-Knopf.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OfflinePopoverProps } from "../shell/contracts";
import { dateiText } from "./dateiSichern";
import "./betrieb.css";

export function OfflinePopover(p: OfflinePopoverProps) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const close = () => { p.onClose(); p.anker?.focus?.(); };

  useLayoutEffect(() => {
    const r = p.anker?.getBoundingClientRect();
    setPos(r ? { top: Math.round(r.bottom + 6), right: Math.max(8, Math.round(window.innerWidth - r.right)) } : { top: 56, right: 8 });
  }, [p.anker]);
  useEffect(() => { box.current?.querySelector<HTMLElement>("button")?.focus(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !p.anker?.contains(t)) p.onClose(); };
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", down, true);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", down, true); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const s = p.status;
  const zeile = (name: string, ok: boolean | null, text: string, zusatz?: string) => (
    <div className="bt-row" role="listitem">
      <span className="bt-name">{name}</span>
      <span className={"bt-val" + (ok === false ? " nein" : ok ? " ja" : "")}>{ok === null ? "" : ok ? "✓ " : "✗ "}{text}{zusatz && <span className="bt-zusatz">{zusatz}</span>}</span>
    </div>
  );
  const ortsnamen = s.online.ortssuche;
  return (
    <div ref={box} className="bt-pop" role="dialog" aria-label="Offline auf diesem Gerät" style={pos ? { top: pos.top, right: pos.right } : undefined}>
      <div className="bt-head">
        <h2>Offline auf diesem Gerät</h2>
        <button type="button" className="bt-x" aria-label="Schliessen" onClick={close}>✕</button>
      </div>
      <div role="list">
        {zeile("App", s.app, s.app ? "auf dem Gerät" : "noch nicht geladen")}
        {zeile("Karte", s.karte.share >= 1, s.karte.share >= 1 ? "Raster-Gebiet vollständig" : s.karte.total ? `${Math.floor(s.karte.share * 100)} % (${s.karte.cached} von ${s.karte.total} Teilen)` : "noch nicht geladen")}
        {zeile("Ortsnamen", null, ortsnamen ? "an – Ortsnamen gehen an swisstopo" : "aus – nichts geht ans Netz", ortsnamen ? undefined : "einschalten: Vorbereiten → Übung")}
        {zeile("Speicher", s.speicher, s.speicher ? "geschützt" : "nicht geschützt – der Browser darf Daten löschen")}
        {zeile("Installiert", s.installiert, "")}
        {zeile("Datei", null, s.dateiGesichert ? `${dateiText(s.dateiGesichert).replace(/^zuletzt/, "zuletzt gesichert:")}` : "zuletzt gesichert: nie")}
      </div>
      <div className="bt-acts">
        {p.onVorbereiten && <button type="button" className="bt-btn" onClick={() => p.onVorbereiten?.()}>Offline-Karte laden (Vorbereiten) …</button>}
        <button type="button" className="bt-btn" onClick={() => { p.onClose(); p.onSaveFile(); }}>Datei sichern …</button>
      </div>
    </div>
  );
}
