/**
 * Dialog «Lagekarte drucken …» (Spez. MVP 3, Kap. 2.9, 3.10): Papier A4/A3 quer, Ausschnitt (Karte jetzt oder ganzes
 * Raster), Stand und Zeitfenster wie die Karte, Abdeckung der Karte **vor** dem Druck («✓ offline vorhanden» bzw.
 * «⚠ 12 % fehlen – ohne Netz weiss»), Fortschritt «Karte wird zusammengesetzt … 60 %», Fehler im Klartext.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type L from "leaflet";
import type { Exercise } from "@lage/core";
import { Dialog } from "../shell/Dialog";
import { klassifizierungOf, type LagekarteDruck } from "../shell/contracts";
import { safeFileName } from "../store";
import { lagekartePdf, lagekartePlan, mapBounds, rasterBounds, stufeText, type LagekartePlan } from "./lagekarte";
import { datum, tagKurz } from "./umfang";
import "./print.css";

export interface LagekarteDialogProps {
  ex: Exercise;
  /** Karte (Ausschnitt «wie die Karte jetzt»); null = nur ganzes Raster */
  map: L.Map | null;
  /** Lagezeit wie die Karte (ISO lokal) */
  t: string;
  /** Anfang «Zeige letzte» bzw. Zeitfenster (ISO lokal), null = alle */
  from: string | null;
  /** LIVE (sonst Rückblick) */
  live: boolean;
  kuerzel: string | null;
  onClose(): void;
  say(t: string): void;
}

const prozent = (x: number) => `${Math.max(1, Math.round(x * 100))} %`;

export function LagekarteDialog({ ex, map, t, from, live, kuerzel, onClose, say }: LagekarteDialogProps) {
  const name = useId();
  const raster = useMemo(() => rasterBounds(ex), [ex]);
  const [paper, setPaper] = useState<LagekarteDruck["paper"]>("A4");
  const [ausschnitt, setAusschnitt] = useState<LagekarteDruck["ausschnitt"]>(map ? "karte" : "raster");
  const [online, setOnline] = useState(typeof navigator === "undefined" || navigator.onLine !== false);
  const [plan, setPlan] = useState<LagekartePlan | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bounds = useMemo(() => (ausschnitt === "karte" && map ? mapBounds(map) : raster ?? (map ? mapBounds(map) : null)), [ausschnitt, map, raster]);

  useEffect(() => {
    const on = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", on); window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); abort.current?.abort(); };
  }, []);
  // Abdeckung prüfen (nur Cache), bei jeder Wahl neu
  useEffect(() => {
    setPlan(null);
    if (!bounds) return;
    let stop = false;
    void lagekartePlan(bounds, paper, online).then((p) => { if (!stop) setPlan(p); }).catch(() => { /* bleibt «wird geprüft» – Erstellen prüft erneut */ });
    return () => { stop = true; };
  }, [bounds, paper, online]);

  const fenster = !from ? "alle" : (() => {
    const min = Math.round((Date.parse(t) - Date.parse(from)) / 60000);
    return min % 60 === 0 ? `letzte ${min / 60} h` : min < 60 ? `letzte ${min} min` : `ab ${from.slice(11, 16)}`;
  })();
  const sheetName = ex.sheets.length === 1 ? ex.sheets[0]!.name : ex.sheets.length ? `(${ex.sheets.length} Blätter)` : "und NAI";

  const karte = (() => {
    if (!plan) return { cls: "", text: "Karte wird geprüft …" };
    if (plan.cov.share >= 0.999) return { cls: "ok", sym: "✓", text: `offline vorhanden (${stufeText(plan.res)})` };
    if (!online) return plan.cov.share > 0
      ? { cls: "warn", sym: "⚠", text: `${prozent(1 - plan.cov.share)} fehlen – ohne Netz weiss${plan.groeber ? ` (gröbere Stufe: ${stufeText(plan.res)})` : ""}` }
      : { cls: "warn", sym: "⚠", text: "100 % fehlen – ohne Netz weiss, Blatt «ohne Kartenhintergrund»" };
    return { cls: "", sym: "", text: `wird beim Erstellen geladen (${prozent(1 - plan.cov.share)} noch nicht offline gespeichert)` };
  })();

  const erstellen = async () => {
    if (!bounds) return;
    setFehler(null); setProgress(0);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const r = await lagekartePdf(ex, {
        paper, ausschnitt, bounds, t, from, klassifizierung: klassifizierungOf(ex), kuerzel,
        onProgress: (p) => setProgress(p), signal: ac.signal, plan: plan ?? undefined,
      });
      if (ac.signal.aborted) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(r.blob);
      a.download = `Lagekarte_${safeFileName(ex.name)}_${tagKurz(t, ex.days)}_${t.slice(11, 13)}${t.slice(14, 16)}_${paper}.pdf`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      say(r.fehlt >= 0.999 ? "Lagekarte erstellt – ohne Kartenhintergrund (Karte nicht offline gespeichert)" : r.fehlt > 0.005 ? `Lagekarte erstellt – ${prozent(r.fehlt)} der Karte fehlen (weiss)` : "Lagekarte als PDF erstellt");
      onClose();
    } catch (e) {
      if (!ac.signal.aborted) setFehler(`Lagekarte konnte nicht erstellt werden: ${(e as Error).message || "unbekannter Fehler"}.`);
    } finally {
      if (abort.current === ac) abort.current = null;
      setProgress(null);
    }
  };

  const radio = <T extends string>(group: string, v: T, cur: T, set: (v: T) => void) => ({ type: "radio" as const, name: name + group, checked: cur === v, onChange: () => set(v) });
  return (
    <Dialog title="Lagekarte drucken" onClose={() => { abort.current?.abort(); onClose(); }}>
      <form className="pr-form" onSubmit={(e) => { e.preventDefault(); void erstellen(); }}>
        <fieldset className="pr-group">
          <legend>Papier</legend>
          <div className="pr-opts">
            <label className="pr-opt"><input {...radio("p", "A4", paper, setPaper)} />A4 quer</label>
            <label className="pr-opt"><input {...radio("p", "A3", paper, setPaper)} />A3 quer</label>
          </div>
        </fieldset>
        <fieldset className="pr-group">
          <legend>Ausschnitt</legend>
          <div className="pr-opts">
            <label className="pr-opt"><input {...radio("a", "karte", ausschnitt, setAusschnitt)} disabled={!map} />wie die Karte jetzt</label>
            <label className="pr-opt"><input {...radio("a", "raster", ausschnitt, setAusschnitt)} disabled={!raster} />ganzes Raster {sheetName}</label>
          </div>
        </fieldset>
        <div className="pr-group">
          <span className="pr-key">Stand</span>
          <p className="pr-info">{tagKurz(t, ex.days)} {datum(t)} {t.slice(11, 16)} ({live ? "LIVE" : "Rückblick"}) · zeigt Meldungen: {fenster} <span className="pr-muted">(folgt «Zeige letzte»)</span></p>
        </div>
        <div className="pr-group">
          <span className="pr-key">Karte</span>
          <p className={`pr-info ${karte.cls}`} aria-live="polite">{karte.sym && <span className="pr-sym" aria-hidden="true">{karte.sym} </span>}{karte.text}</p>
        </div>
        {progress !== null && (
          <div aria-live="polite">
            <p className="pr-info">Karte wird zusammengesetzt … {Math.round(progress * 100)} %</p>
            <div className="pr-progress" aria-hidden="true"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          </div>
        )}
        {fehler && <p className="pr-info stop" role="alert">⛔ {fehler}</p>}
        {!bounds && <p className="pr-info warn"><span className="pr-sym" aria-hidden="true">⚠ </span>Kein Ausschnitt: zuerst ein Raster anlegen oder die Karte zeigen.</p>}
        <div className="pr-foot">
          <span className="pr-est">{paper} quer · 1 Seite</span>
          <button type="button" onClick={() => { abort.current?.abort(); onClose(); }}>Abbrechen</button>
          <button type="submit" className="primary" disabled={!bounds || progress !== null}>{progress !== null ? "PDF wird erstellt …" : "PDF erstellen"}</button>
        </div>
      </form>
    </Dialog>
  );
}
