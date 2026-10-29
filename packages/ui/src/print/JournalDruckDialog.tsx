/**
 * Dialog «Journal drucken …» (Spez. MVP 3, Kap. 2.8, 3.9): Umfang Schicht · Tag · ganze Übung · Zeitraum, Anhänge,
 * «ca. n Seiten» aus derselben Rechnung wie das PDF (`journalPdfSeiten`), «PDF erstellen» lädt das PDF herunter.
 * Vorwahl nach Entscheid 4 (`journalDruckVorwahl`): laufende Schicht, ohne Übergaben der heutige Tag.
 * jsPDF wird erst beim Öffnen nachgeladen (wie bisher beim Direktdruck).
 */
import { useEffect, useId, useMemo, useState } from "react";
import { aktuelleSchicht, journalDruckVorwahl, type Exercise, type Hint, type SchichtWechsel } from "@lage/core";
import { Dialog } from "../shell/Dialog";
import { klassifizierungOf, type JournalDruck, type SchichtApi } from "../shell/contracts";
import type { LageRotState } from "../lageRot";
import { safeFileName } from "../store";
import { datum, eintraegeIm, grenzen, parseTagZeit, schichtAm, tagKurz, tagZeitText, tz } from "./umfang";
import "./print.css";

export interface JournalDruckDialogProps {
  ex: Exercise;
  /** LIVE-Zeit (ISO lokal) – Ende von Schicht und «Tag (heute)» */
  tLive: string;
  device: string;
  /** Kürzel/Schicht dieses Geräts (C: `useSchicht`) */
  schicht?: Pick<SchichtApi, "kuerzel" | "seit"> | null;
  /** Hinweise zu Rot (Anhang nur aus dem Zeitraum oder offen) */
  hints: Hint[];
  /** Lage Rot zur LIVE-Zeit (Anhang) */
  lage: LageRotState | null;
  /** Vermerk zur KI unter dem Journal (`kiPdfNote`), sonst null */
  kiNote?: string | null;
  onClose(): void;
  say(t: string): void;
}

type Art = JournalDruck["umfang"]["art"];

/** Schichtbeginn dieses Geräts als Wechsel (Lagezeit), sonst jüngster Wechsel der Übung bis jetzt */
function eigeneSchicht(ex: Exercise, device: string, tLive: string, seit: string | null | undefined): SchichtWechsel | null {
  const mine = aktuelleSchicht(ex, device);
  if (mine && mine.t <= tLive) return mine;
  if (seit) {
    const s = (ex.schichten ?? []).find((x) => x.at === seit);
    if (s) return s;
  }
  return schichtAm(ex, tLive);
}

export function JournalDruckDialog({ ex, tLive, device, schicht, hints, lage, kiNote, onClose, say }: JournalDruckDialogProps) {
  const name = useId();
  const sch = useMemo(() => eigeneSchicht(ex, device, tLive, schicht?.seit), [ex, device, tLive, schicht?.seit]);
  const hatUebergaben = (ex.schichten ?? []).some((s) => s.art === "uebergabe");
  const vorwahl = journalDruckVorwahl(hatUebergaben);
  const g = useMemo(() => grenzen(ex), [ex]);
  const heute = ex.days.includes(tLive.slice(0, 10)) ? tLive.slice(0, 10) : g.to.slice(0, 10);
  const [art, setArt] = useState<Art>(vorwahl === "schicht" && !sch ? "tag" : vorwahl);
  const [tag, setTag] = useState(heute);
  const [von, setVon] = useState(tagZeitText(`${heute}T00:00`, ex.days));
  const [bis, setBis] = useState(tagZeitText(tLive, ex.days));
  const [anhang, setAnhang] = useState({ lageRot: !!lage, hinweise: hints.length > 0, ohneGestrichene: false });
  const [seiten, setSeiten] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const ende = tLive > g.to ? tLive : g.to;
  const zeitraum = useMemo(() => {
    const f = parseTagZeit(von, ex.days, tLive), t = parseTagZeit(bis, ex.days, tLive);
    return f && t && f <= t ? { from: f, to: t } : null;
  }, [von, bis, ex.days, tLive]);
  const umfang = useMemo((): JournalDruck["umfang"] | null => {
    switch (art) {
      case "schicht": return sch ? { art, from: sch.t, to: tLive } : null;
      case "tag": return { art, from: `${tag}T00:00`, to: tag === tLive.slice(0, 10) ? tLive : `${tag}T23:59` };
      case "alles": return { art, from: g.from, to: ende };
      default: return zeitraum ? { art, ...zeitraum } : null;
    }
  }, [art, sch, tag, tLive, g, ende, zeitraum]);
  const opts = useMemo((): JournalDruck | null => umfang && {
    umfang, anhang, klassifizierung: klassifizierungOf(ex), kuerzel: schicht?.kuerzel ?? null,
  }, [umfang, anhang, ex, schicht?.kuerzel]);

  const zahl = (from: string | null, to: string) => eintraegeIm(ex, { from, to }).filter((e) => !e.deleted).length;
  const n = (k: number) => `${k} ${k === 1 ? "Eintrag" : "Einträge"}`;
  const tagTo = (d: string) => (d === tLive.slice(0, 10) ? tLive : `${d}T23:59`);

  // «ca. n Seiten»: gleiche Rechnung wie das PDF, kurz verzögert (jsPDF nachgeladen)
  useEffect(() => {
    setSeiten(null);
    if (!opts) return;
    let stop = false;
    const id = window.setTimeout(async () => {
      try {
        const { journalPdfSeiten } = await import("../journalpdf");
        if (!stop) setSeiten(journalPdfSeiten(ex, opts, { hints, lageRot: lage ? { lage, t: tLive } : undefined, kiNote }));
      } catch { /* Schätzung fehlt – Erstellen geht trotzdem */ }
    }, 150);
    return () => { stop = true; window.clearTimeout(id); };
  }, [opts, ex, hints, lage, tLive, kiNote]);

  const erstellen = async () => {
    if (!opts) return;
    setBusy(true); setFehler(null);
    try {
      const { journalPdf } = await import("../journalpdf");
      const blob = journalPdf(ex, opts, { hints, lageRot: lage ? { lage, t: tLive } : undefined, kiNote });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const teil = opts.umfang.art === "schicht" ? `Schicht_${sch?.an ?? ""}` : opts.umfang.art === "tag" ? tagKurz(opts.umfang.from!, ex.days) : opts.umfang.art === "alles" ? "ganz" : "Zeitraum";
      a.download = `Lagejournal_${safeFileName(ex.name)}_${safeFileName(teil)}.pdf`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      say(`Journal als PDF erstellt (${n(zahl(opts.umfang.from, opts.umfang.to))})`);
      onClose();
    } catch (e) {
      setFehler(`PDF konnte nicht erstellt werden: ${(e as Error).message}.`);
    } finally {
      setBusy(false);
    }
  };

  const radio = (v: Art) => ({ type: "radio" as const, name, checked: art === v, onChange: () => setArt(v) });
  return (
    <Dialog title="Journal drucken" onClose={onClose}>
      <form className="pr-form" onSubmit={(e) => { e.preventDefault(); void erstellen(); }}>
        <fieldset className="pr-group">
          <legend>Umfang</legend>
          <div className="pr-opts">
            {sch && (
              <label className="pr-opt"><input {...radio("schicht")} />
                Diese Schicht – seit {tz(sch.t, ex.days)} ({sch.an}), {n(zahl(sch.t, tLive))}
              </label>
            )}
            <span className="pr-opt">
              <label className="pr-row"><input {...radio("tag")} />
                Tag {tagKurz(tag, ex.days)} – {datum(tag)}, {n(zahl(`${tag}T00:00`, tagTo(tag)))}
              </label>
              {ex.days.length > 1 && (
                <select aria-label="Welcher Tag" value={tag} onChange={(e) => { setTag(e.target.value); setArt("tag"); }}>
                  {ex.days.map((d) => <option key={d} value={d}>{tagKurz(d, ex.days)}</option>)}
                </select>
              )}
            </span>
            <label className="pr-opt"><input {...radio("alles")} />Ganze Übung – {n(zahl(null, ende))}</label>
            <span className="pr-opt">
              <label className="pr-row"><input {...radio("zeitraum")} />Zeitraum</label>
              <label className="pr-row">von <input type="text" value={von} onChange={(e) => { setVon(e.target.value); setArt("zeitraum"); }} aria-label="Zeitraum von" /></label>
              <label className="pr-row">bis <input type="text" value={bis} onChange={(e) => { setBis(e.target.value); setArt("zeitraum"); }} aria-label="Zeitraum bis" /></label>
              {art === "zeitraum" && !zeitraum && <span className="pr-muted">Zeit wie «T2 0731» schreiben, «von» vor «bis».</span>}
            </span>
          </div>
        </fieldset>
        <fieldset className="pr-group">
          <legend>Anhang</legend>
          <div className="pr-opts">
            <label className="pr-opt"><input type="checkbox" checked={anhang.lageRot} disabled={!lage} onChange={(e) => setAnhang({ ...anhang, lageRot: e.target.checked })} />Lage Rot (1 Seite)</label>
            <label className="pr-opt"><input type="checkbox" checked={anhang.hinweise} disabled={!hints.length} onChange={(e) => setAnhang({ ...anhang, hinweise: e.target.checked })} />Hinweise aus dem Zeitraum</label>
            <label className="pr-opt"><input type="checkbox" checked={anhang.ohneGestrichene} onChange={(e) => setAnhang({ ...anhang, ohneGestrichene: e.target.checked })} />gestrichene Einträge weglassen</label>
          </div>
        </fieldset>
        {fehler && <p className="pr-info stop" role="alert">⛔ {fehler}</p>}
        <div className="pr-foot">
          <span className="pr-est" aria-live="polite">{opts ? (seiten === null ? "Seiten werden gezählt …" : `ca. ${seiten} ${seiten === 1 ? "Seite" : "Seiten"}`) : ""}</span>
          <button type="button" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="primary" disabled={!opts || busy}>{busy ? "PDF wird erstellt …" : "PDF erstellen"}</button>
        </div>
      </form>
    </Dialog>
  );
}
