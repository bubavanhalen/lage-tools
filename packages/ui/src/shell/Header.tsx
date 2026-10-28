/**
 * Kopf (Spez. MVP 1, Kap. 1.2, 2.1, 3.1), 48 px: Übungsname (16 px 600, abgeschnitten, voller Name als `title`),
 * rechts «✓ gespeichert 07:25», «Offline bereit ✓» bzw. Knopf «Offline nicht bereit – beheben», Menü ☰.
 * Nur das Menü ist ein Bedienelement – ausser der Offline-Status ist ✗ (kontextuell +1).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { hasPending, persister } from "../persist";
import { onStoreStatus } from "../store";
import type { OfflineStatus, SaveStatus } from "./contracts";
import "./shell.css";

/** «speichert …» erst, wenn länger als so viele ms ausstehend (kein Flackern) */
export const SPEICHERT_AB_MS = 2000;

/** reine Ableitung (testbar): Fehler vor «speichert», «speichert» erst nach 2 s */
export function saveStatusOf(o: { problem: string | null; pendingSince: number | null; savedAt: number; now: number }): SaveStatus {
  if (o.problem) return { state: "fehler", text: o.problem, at: o.savedAt || undefined };
  if (o.pendingSince !== null && o.now - o.pendingSince > SPEICHERT_AB_MS) return { state: "speichert", at: o.savedAt || undefined };
  return { state: "gespeichert", at: o.savedAt || undefined };
}

/** Speicherstatus der angezeigten Übung (aus `persister` und `onStoreStatus`, ohne die Speicherlogik zu ändern) */
export function useSaveStatus(): SaveStatus {
  const [problem, setProblem] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const pendingSince = useRef<number | null>(null);
  useEffect(() => onStoreStatus((p, where) => { if (where === "uebung") setProblem(p ? p.text : null); }), []);
  useEffect(() => {
    const id = window.setInterval(() => {
      const busy = hasPending();
      if (busy && pendingSince.current === null) pendingSince.current = Date.now();
      if (!busy) pendingSince.current = null;
      setTick((n) => n + 1);
    }, 400);
    return () => window.clearInterval(id);
  }, []);
  void tick;
  return saveStatusOf({ problem, pendingSince: pendingSince.current, savedAt: persister.savedAt, now: Date.now() });
}

const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export function SaveStatusView({ s }: { s: SaveStatus }) {
  if (s.state === "fehler") return <span className="hd-save fehler" role="status" title={s.text}>⛔ nicht gespeichert</span>;
  if (s.state === "speichert") return <span className="hd-save speichert" role="status">speichert …</span>;
  return <span className="hd-save ok" role="status" title="Jede Änderung wird sofort auf diesem Gerät gespeichert">✓ gespeichert{s.at ? ` ${hhmm(s.at)}` : ""}</span>;
}

export function OfflineStatusView({ s, onFix }: { s: OfflineStatus & { checked?: boolean }; onFix: () => void }) {
  const net = s.net ? "" : "Kein Netz · ";
  if (s.checked === false) return net ? <span className="hd-off">Kein Netz</span> : null;
  if (s.ready) return <span className="hd-off ok" title="Journal, Karte und Speicher funktionieren auch ohne Netz">{net}Offline bereit ✓</span>;
  return (
    <button type="button" className="hd-off fix" onClick={onFix} title={s.missing.join(" · ")}>
      {net}Offline nicht bereit – beheben
    </button>
  );
}

export interface HeaderProps {
  name: string;
  save: SaveStatus;
  offline: OfflineStatus & { checked?: boolean };
  onFixOffline: () => void;
  /** Menü ☰ (MainMenu) */
  menu: ReactNode;
  /** Produktname (nur für Screenreader und Titel) */
  product: string;
}

export function Header({ name, save, offline, onFixOffline, menu, product }: HeaderProps) {
  useEffect(() => { document.title = `${name} – ${product}`; }, [name, product]);
  return (
    <header className="hd" aria-label={product}>
      <h1 className="hd-name" title={name}>{name}</h1>
      <div className="hd-status">
        <SaveStatusView s={save} />
        <OfflineStatusView s={offline} onFix={onFixOffline} />
      </div>
      {menu}
    </header>
  );
}
