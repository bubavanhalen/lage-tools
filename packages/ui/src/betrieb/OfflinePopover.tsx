/**
 * Offline-Popover «Offline auf diesem Gerät» (Spez. MVP 3.5, Kap. 2.3, S6/S7/S8) – öffnet sich am Kopf-Knopf «⚠ Offline
 * fehlt» bzw. «Lädt 42 %» und über Menü «Auf diesem Gerät sicher? …», **kein Moduswechsel**.
 * Sechs Zeilen: App · Karte (vollständig geprüft, «96 % (933 von 971 Teilen)») · Ortsnamen (Online-Dienst) · Speicher ·
 * Installiert («So geht’s ▸»: iOS-Anleitung, «App installieren» mit `beforeinstallprompt`, sonst Browser-Menü und
 * «Speicher schützen») · Datei (letzte Sicherung). Knöpfe «Alles für offline laden · ca. 27 MB» (lädt hier, Fortschritt
 * «Karte 412 von 971 …», «Abbrechen»; das Popover darf zu, das Laden läuft weiter) und «Datei sichern …».
 * Esc, ✕ und Klick ausserhalb schliessen; Fokus zurück auf den Kopf-Knopf. Höchstens 6 Bedienelemente.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OfflinePopoverProps } from "../shell/contracts";
import { requestPersist } from "../persist";
import { notifyOfflineChanged } from "../offlineStatus";
import { dateiText } from "./dateiSichern";
import { installieren } from "./install";
import { allesOffline, ladenAbbrechen, ladenUmfang, useLaden, useLadenErgebnis } from "./laden";
import { karteText, nimmAnleitungOffen } from "./status";
import "./betrieb.css";

export const ANLEITUNG_IOS = "1 Unten auf Teilen ⬆ tippen · 2 «Zum Home-Bildschirm» · 3 «Hinzufügen». Danach die App nur über das neue Symbol öffnen – erst dann behält Safari die Daten.";
export const ANLEITUNG_SONST = "Im Browser-Menü «App installieren» bzw. «Zum Startbildschirm» wählen.";

export function OfflinePopover(p: OfflinePopoverProps) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [anleitung, setAnleitung] = useState(nimmAnleitungOffen);
  const [meldung, setMeldung] = useState<string | null>(null);
  const laden = useLaden();
  const ergebnis = useLadenErgebnis();
  const close = () => { p.onClose(); p.anker?.focus?.(); };

  useLayoutEffect(() => {
    const r = p.anker?.getBoundingClientRect();
    // rechts am Knopf, aber nie über den linken Rand (Handy: Breite = Bildschirm − 16 px)
    const vw = window.innerWidth, breite = Math.min(400, vw - 16);
    setPos(r && r.width ? { top: Math.round(r.bottom + 6), right: Math.max(8, Math.min(Math.round(vw - r.right), vw - breite - 8)) } : { top: 56, right: 8 });
  }, [p.anker]);
  useEffect(() => { box.current?.querySelector<HTMLElement>(".bt-acts button, .bt-x")?.focus(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !p.anker?.contains(t)) p.onClose(); };
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", down, true);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", down, true); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const s = p.status;
  const zeile = (name: string, ok: boolean | null, text: string, extra?: React.ReactNode) => (
    <div className="bt-row" role="listitem">
      <span className="bt-name">{name}</span>
      <span className="bt-val">
        <span className={ok === false ? "nein" : ok ? "ja" : ""}>{ok === null ? "" : ok ? "✓ " : "✗ "}{text}</span>
        {extra}
      </span>
    </div>
  );
  const k = karteText(s.karte);
  const umfang = ladenUmfang(p.ex, p.map);
  const start = () => {
    setMeldung(null);
    allesOffline(p.ex, p.map).then((r) => {
      if (r.failed) setMeldung(`⚠ ${r.failed} Kartenteile nicht geladen – später nochmals «Alles für offline laden».`);
    }, (e: Error) => setMeldung(`⚠ ${e.message}.`));
  };
  const schuetzen = async () => {
    const st = await requestPersist({ geste: true });
    notifyOfflineChanged();
    p.say(st === "dauerhaft" ? "Speicher geschützt" : "Der Browser hat den Speicherschutz abgelehnt – App installieren bzw. zum Startbildschirm hinzufügen");
  };
  const fortschritt = !laden ? null : laden.teil === "pruefen" ? "Karte wird geprüft …"
    : `${laden.teil === "strassen" ? "Strassen" : "Karte"} ${laden.teilDone.toLocaleString("de-CH")} von ${laden.teilTotal.toLocaleString("de-CH")} …`;
  const fehlt = !laden && ergebnis && !ergebnis.abgebrochen && ergebnis.failed ? ergebnis.failed : 0;

  return (
    <div ref={box} className="bt-pop" role="dialog" aria-label="Offline auf diesem Gerät" style={pos ? { top: pos.top, right: pos.right } : undefined}>
      <div className="bt-head">
        <h2>Offline auf diesem Gerät</h2>
        <button type="button" className="bt-x" aria-label="Schliessen" onClick={close}>✕</button>
      </div>
      <div role="list">
        {zeile("App", s.app, s.app ? "auf dem Gerät" : "noch nicht geladen", !s.app && <span className="bt-zusatz">wird beim Öffnen mit Netz gespeichert – danach einmal neu laden</span>)}
        {zeile("Karte", k.ok, k.text, fortschritt && <span className="bt-zusatz bt-prog" role="status"><span className="bt-bar" aria-hidden="true"><span style={{ width: `${Math.round((laden!.done / Math.max(1, laden!.total)) * 100)}%` }} /></span>{fortschritt}</span>)}
        {zeile("Ortsnamen", null, s.online.ortssuche ? "an – Ortsnamen gehen an swisstopo" : "aus – nichts geht ans Netz", !s.online.ortssuche && <span className="bt-zusatz">einschalten: Vorbereiten → Übung</span>)}
        {zeile("Speicher", s.speicher, s.speicher ? "geschützt" : "nicht geschützt – der Browser darf Daten löschen")}
        {zeile("Installiert", s.installiert, "", !s.installiert && (
          <>
            <button type="button" className="bt-link" aria-expanded={anleitung} onClick={() => setAnleitung(!anleitung)}>So geht’s {anleitung ? "▾" : "▸"}</button>
            {anleitung && (
              <span className="bt-anl">
                {s.install === "ios" && <span>{ANLEITUNG_IOS}</span>}
                {s.install === "prompt" && (
                  <button type="button" className="bt-btn" onClick={() => { void installieren().then((ja) => { if (ja) p.say("App wird installiert"); }); }}>App installieren</button>
                )}
                {s.install === "manuell" && <span>{ANLEITUNG_SONST}</span>}
                {s.install !== "ios" && !s.speicher && <button type="button" className="bt-btn" onClick={() => void schuetzen()}>Speicher schützen</button>}
              </span>
            )}
          </>
        ))}
        {zeile("Datei", null, `zuletzt gesichert: ${s.dateiGesichert ? dateiText(s.dateiGesichert).replace(/^zuletzt /, "") : "nie"}`)}
      </div>
      {fehlt > 0 && <p className="bt-warn">⚠ {fehlt} Kartenteile nicht geladen (kein Netz?) – nochmals «Alles für offline laden».</p>}
      {meldung && !fehlt && <p className="bt-warn">{meldung}</p>}
      {!s.net && !laden && <p className="bt-note">Kein Netz – zum Laden braucht es einmal Netz.</p>}
      <div className="bt-acts">
        {laden ? (
          <button type="button" className="bt-btn" onClick={ladenAbbrechen}>Abbrechen</button>
        ) : (
          <button type="button" className="bt-btn primary" disabled={!s.net || !umfang} onClick={start}>
            Alles für offline laden{umfang ? ` · ca. ${umfang.mb} MB` : ""}
          </button>
        )}
        <button type="button" className="bt-btn" onClick={() => { p.onClose(); p.onSaveFile(); }}>Datei sichern …</button>
      </div>
      <p className="bt-note">Angesehene Kartenteile werden ab dem zweiten Öffnen automatisch gespeichert.{s.online.strassen ? "" : " Strassen werden nicht geladen (Online-Dienst aus)."}</p>
    </div>
  );
}
