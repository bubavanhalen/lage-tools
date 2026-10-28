/**
 * Speicherstatus sichtbar machen:
 * - `SaveBand`: rotes Band «Nicht gespeichert – Datei sichern», sobald das Speichern fehlschlägt (Speicher voll,
 *   blockiert, nicht verfügbar) – mit Knopf «Datei sichern». Verschwindet, sobald wieder gespeichert ist (Übung)
 *   bzw. nach dem Sichern/Schliessen (Anhang).
 * - `MergeBar`: Ergebnis von «Öffnen» (Zusammenführen) und der ausdrückliche zweite Weg «Ersetzen durch Datei».
 */
import { useEffect, useState } from "react";
import { onStoreStatus, type StoreProblem } from "./store";
import "./persist.css";

export function SaveBand({ onSaveFile }: { onSaveFile: () => Promise<boolean> | void }) {
  const [ex, setEx] = useState<StoreProblem | null>(null);
  const [att, setAtt] = useState<StoreProblem | null>(null);
  useEffect(() => onStoreStatus((p, where) => {
    if (where === "uebung") setEx(p);
    else if (p) setAtt(p);
  }), []);
  const p = ex ?? att;
  if (!p) return null;
  const save = async () => {
    const ok = await onSaveFile();
    if (ok !== false) setAtt(null);
  };
  return (
    <div className="savefail" role="alert">
      <b>Nicht gespeichert – Datei sichern</b>
      <span className="savefail-why">{p.text}{ex ? "" : " (Foto/Sprachmemo)"}. {ex ? "Neue Meldungen sind nur in diesem Fenster und im Notfallpuffer." : "Der Anhang liegt nur im Arbeitsspeicher."}</span>
      <button className="savefail-btn" onClick={save}>Datei sichern</button>
      {!ex && <button className="savefail-x" aria-label="Schliessen" onClick={() => setAtt(null)}>×</button>}
    </div>
  );
}

export interface MergeInfo {
  name: string;
  text: string;
  /** Meldungen nur auf diesem Gerät (gingen beim Ersetzen verloren) */
  nurHier: number;
  /** null = neu geöffnet (nichts zusammenzuführen) */
  replace: (() => void) | null;
}

export function MergeBar({ info, onClose }: { info: MergeInfo; onClose: () => void }) {
  return (
    <div className="mergebar" role="status">
      <span><b>«{info.name}»</b> {info.replace ? "zusammengeführt" : "geöffnet"}: {info.text}</span>
      <span className="mergebar-acts">
        {info.replace && (
          <button title="Übung auf diesem Gerät ganz durch die Datei ersetzen (nur auf ausdrücklichen Wunsch)"
            onClick={() => {
              const loss = info.nurHier ? `\n\n${info.nurHier} ${info.nurHier === 1 ? "Meldung ist" : "Meldungen sind"} nur auf diesem Gerät und ${info.nurHier === 1 ? "geht" : "gehen"} verloren – vorher «Speichern».` : "";
              if (window.confirm(`Übung «${info.name}» durch die Datei ersetzen?${loss}`)) info.replace!();
            }}>Ersetzen durch Datei …</button>
        )}
        <button onClick={onClose}>OK</button>
      </span>
    </div>
  );
}
