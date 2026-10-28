/**
 * Vorbereiten, Schritt 6 «Offline bereit» (Spez. MVP 1, Kap. 2.9, 3.1, 4.6): Zustand der drei Teile (Karte, Speicher,
 * App) mit Klartext-Grund, Knopf «Alles für offline laden» (OfflineBox), optional Texterkennung und Spracherkennung.
 */
import L from "leaflet";
import type { Exercise } from "@lage/core";
import { OfflineBox } from "../OfflineBox";
import { OcrOffline } from "../PhotoInput";
import { SpeechModelRow } from "../SpeechSettings";
import type { OfflineStatus } from "../shell/contracts";
import "./prepare.css";

const mark = (ok: boolean) => (ok ? "✓" : "✗");

export function offlinePartsText(s: OfflineStatus): string {
  return `Karte ${mark(s.parts.karte)} · Speicher ${mark(s.parts.speicher)} · App ${mark(s.parts.app)}`;
}

export function OfflineStep({ ex, map, status }: { ex: Exercise; map: L.Map; status: OfflineStatus }) {
  return (
    <div className="pp">
      <p className="pp-parts" aria-label="Offline-Zustand">{offlinePartsText(status)}{status.net ? "" : " · Kein Netz"}</p>
      {status.missing.length > 0 && (
        <ul className="pp-why">
          {status.missing.map((m) => <li key={m}>✗ {m}</li>)}
        </ul>
      )}
      {!status.parts.app && <p className="pp-note">Die App wird beim ersten Öffnen mit Netz für offline gespeichert. Danach die Seite einmal neu laden.</p>}
      <OfflineBox ex={ex} map={map} />
      <div className="pp-opt">
        <div className="pp-l">Optional</div>
        <OcrOffline />
        <SpeechModelRow compact />
      </div>
    </div>
  );
}
