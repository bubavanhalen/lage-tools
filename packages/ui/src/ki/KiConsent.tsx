/**
 * Einwilligung beim ersten Einschalten der KI in einer Übung – in einfacher Sprache.
 */
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { KiMark } from "./context";
import "./ki.css";

export function KiConsent({ hasKey, onAgree, onCancel }: { hasKey: boolean; onAgree: () => void; onCancel: () => void }) {
  const [ok, setOk] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.preventDefault(); onCancel(); } };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onCancel]);
  return createPortal(
    <div className="ki-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="ki-dlg ki-consent" role="dialog" aria-modal="true" aria-labelledby="ki-consent-h">
        <header className="ki-head">
          <KiMark size={18} />
          <h2 id="ki-consent-h">KI für diese Übung einschalten?</h2>
        </header>
        <div className="ki-body">
          <p className="ki-lead">Claude (eine KI von Anthropic) kann dir helfen – <b>nur wenn du einen KI-Knopf drückst</b>.</p>
          <div className="ki-cols">
            <section>
              <h3>Was die KI kann</h3>
              <ul className="ki-list">
                <li>Handschrift auf Fotos von Meldezetteln lesen</li>
                <li>Unklare Meldungen in Kurzschrift bringen</li>
                <li>Hinweise und mögliche Aktionen Rot in Worte fassen</li>
                <li>Einen Lagebericht für Rapport oder Übergabe entwerfen</li>
              </ul>
              <p className="ki-note">Alles sind <b>Vorschläge</b>. Du prüfst und übernimmst – nichts wird automatisch eingetragen.</p>
            </section>
            <section>
              <h3>Was das Gerät verlässt</h3>
              <ul className="ki-list">
                <li>Nur das, was du beim Knopfdruck siehst: <b>vor jedem Senden</b> steht genau, was geht</li>
                <li>Die Daten gehen an <b>Anthropic in den USA</b></li>
                <li>Kosten laufen über <b>dein eigenes Anthropic-Konto</b></li>
              </ul>
            </section>
          </div>
          <p className="ki-warn" role="note"><b>Keine klassifizierten Daten senden.</b> Nur einschalten, wenn das für diese Übung erlaubt ist.</p>
          <label className="ki-check">
            <input ref={first} type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
            <span>Verstanden – Inhalte dürfen auf Knopfdruck an Anthropic (USA) gehen.</span>
          </label>
          <p className="ki-help">Ohne KI funktioniert alles andere weiter. Ausschalten jederzeit im Menü «KI».{!hasKey && " Danach braucht es noch einen Schlüssel."}</p>
        </div>
        <footer className="ki-foot">
          <button onClick={onCancel}>Nicht einschalten</button>
          <button className="primary" disabled={!ok} onClick={onAgree}>KI einschalten</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
