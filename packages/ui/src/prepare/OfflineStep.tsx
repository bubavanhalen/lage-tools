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

/**
 * «Karte ✓ · App ✓» – der Speicherschutz ist nur eine Empfehlung und steht nicht im Zustand (M1). Ohne Raster gibt es
 * kein Kartengebiet zum Laden: nie «Karte ✓», sondern «Karte: erst Raster» (Review 6, Erstbenutzer M4).
 */
export function offlinePartsText(s: OfflineStatus, hasRaster = true): string {
  return `Karte ${hasRaster ? mark(s.parts.karte) : "– erst Führungsraster anlegen"} · App ${mark(s.parts.app)}`;
}

export function OfflineStep({ ex, map, status }: { ex: Exercise; map: L.Map; status: OfflineStatus }) {
  return (
    <div className="pp">
      <p className="pp-parts" aria-label="Offline-Zustand">{offlinePartsText(status, ex.sheets.length > 0)}{status.net ? "" : " · Kein Netz"}</p>
      {status.missing.length > 0 && (
        <ul className="pp-why">
          {status.missing.map((m) => <li key={m}>✗ {m}</li>)}
        </ul>
      )}
      {!status.parts.app && <p className="pp-note">Die App wird beim ersten Öffnen mit Netz für offline gespeichert. Danach die Seite einmal neu laden.</p>}
      {!status.parts.speicher && (
        <div className="pp-rec" role="note">
          <b>Empfehlung: Speicher schützen</b>
          <p>Der Browser darf gespeicherte Daten bei Platzmangel löschen. Schutz: die Seite zum Startbildschirm hinzufügen
            (bzw. als App installieren) oder in den Einstellungen der Website «Daten speichern» erlauben. Unabhängig davon:
            regelmässig «Datei für anderes Gerät …» sichern.</p>
        </div>
      )}
      <OfflineBox ex={ex} map={map} />
      <div className="pp-opt">
        <div className="pp-l">Optional</div>
        <OcrOffline />
        <SpeechModelRow compact />
      </div>
    </div>
  );
}
