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

/** zuletzt gespeichert, über das Neuladen hinweg (pro Gerät, für die angezeigte Übung): «✓ gespeichert 07:25» auch nach F5 */
const SAVED_KEY = "lage-tools.gespeichert";
function rememberSaved(exId: string | null, at: number): void {
  if (!exId || !at) return;
  try { localStorage.setItem(SAVED_KEY, JSON.stringify({ id: exId, at })); } catch { /* egal */ }
}
/** gemerkte Zeit der letzten Speicherung, wenn sie zur angezeigten Übung gehört */
export function rememberedSaved(exId: string | null): number {
  if (!exId) return 0;
  try { const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "null") as { id?: string; at?: number } | null; return v?.id === exId && typeof v.at === "number" ? v.at : 0; } catch { return 0; }
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
  const last = useRef(0);
  if (persister.savedAt && persister.savedAt !== last.current) { last.current = persister.savedAt; rememberSaved(persister.current, persister.savedAt); }
  const savedAt = persister.savedAt || rememberedSaved(persister.current);
  return saveStatusOf({ problem, pendingSince: pendingSince.current, savedAt, now: Date.now() });
}

const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export function SaveStatusView({ s }: { s: SaveStatus }) {
  if (s.state === "fehler") return <span className="hd-save fehler" role="status" title={s.text}>⛔ nicht gespeichert</span>;
  if (s.state === "speichert") return <span className="hd-save speichert" role="status">speichert …</span>;
  // schmal (< 860 px): nur «✓ 07:25» – das Wort steht dann im Titel und für Screenreader
  return (
    <span className="hd-save ok" role="status" title="Jede Änderung wird sofort auf diesem Gerät gespeichert">
      ✓<span className="hd-long"> gespeichert</span>{s.at ? <> <span className="tnum">{hhmm(s.at)}</span></> : <span className="hd-short"> gespeichert</span>}
    </span>
  );
}

export function OfflineStatusView({ s, onFix }: { s: OfflineStatus & { checked?: boolean }; onFix: () => void }) {
  const net = s.net ? "" : "Kein Netz · ";
  if (s.checked === false) return net ? <span className="hd-off net">Kein Netz</span> : null;
  if (s.ready) return <>{net && <span className="hd-off net">Kein Netz ·</span>}<span className="hd-off ok" title="Journal und Karte funktionieren auch ohne Netz">Offline bereit ✓</span></>;
  return (
    <button type="button" className="hd-off fix" onClick={onFix} title={s.missing.join(" · ")} aria-label={`${net}Offline nicht bereit – beheben`}>
      {net}<span className="hd-long">Offline nicht bereit – beheben</span><span className="hd-short">Offline ✗</span>
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
