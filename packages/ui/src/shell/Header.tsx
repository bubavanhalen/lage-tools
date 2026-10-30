/**
 * Kopf (Spez. MVP 1, Kap. 1.2, 2.1, 3.1), 48 px: Übungsname (16 px 600, abgeschnitten, voller Name als `title`),
 * rechts «✓ gespeichert 07:25», «Offline bereit ✓» bzw. Knopf «⚠ Offline fehlt», Menü ☰.
 * Nur das Menü ist ein Bedienelement – ausser der Offline-Status ist ✗ (kontextuell +1).
 * MVP 3.5 (Kap. 2.3, S6, A1.6): der Knopf öffnet das Offline-Popover (kein Moduswechsel); während «Alles für offline
 * laden» heisst er «Lädt 42 %»; Laptop und Handy «⚠ Offline fehlt» (nie «×»). Text «Online an», wenn ein Online-Dienst
 * der Übung an ist (kein Bedienelement).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { hasPending, persister } from "../persist";
import { onStoreStatus } from "../store";
import type { OfflineStatus, SaveStatus } from "./contracts";
import { useLaden } from "../betrieb/laden";
import { ladenText } from "../betrieb/status";
import { useOnlinePolicy } from "../onlinePolicy";
import { KUERZEL_FELD_ID } from "../entry/KuerzelZeile";
import "./shell.css";
import "../lvzui/lvzui.css";
import "../betrieb/betrieb.css";

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

/** Kopf-Text «Online an» (A1.6): title nennt die Dienste; nur wenn mindestens einer an ist */
export const ONLINE_AN_TITEL = "Online-Dienste dieser Übung: Ortsnamen, Strassen, Spracherkennung des Browsers (Vorbereiten → Übung)";

export function OfflineStatusView({ s, onFix, laden }: { s: OfflineStatus & { checked?: boolean }; onFix: () => void; laden?: { done: number; total: number } | null }) {
  const net = s.net ? "" : "Kein Netz · ";
  const lt = ladenText(laden ?? null);
  // während des Ladens: «Lädt 42 %» statt «⚠ Offline fehlt» (öffnet das Popover wieder)
  if (lt) {
    return (
      <button type="button" className="hd-off fix laedt" onClick={onFix} title="Offline auf diesem Gerät: Fortschritt, Abbrechen">
        {net}<span className="tnum">{lt}</span>
      </button>
    );
  }
  if (s.checked === false) return net ? <span className="hd-off net">Kein Netz</span> : null;
  // schmal (< 860 px) kurz «Offline ✓», für Screenreader immer «Offline bereit» (Review 6, Feld N: Handy ohne Anzeige)
  if (s.ready) return <>{net && <span className="hd-off net">Kein Netz ·</span>}<span className="hd-off ok" title="Journal und Karte funktionieren auch ohne Netz">
    <span className="hd-long">Offline bereit ✓</span><span className="hd-short" aria-hidden="true">Offline ✓</span><span className="sr-only hd-sr">Offline bereit</span></span></>;
  return (
    <button type="button" className="hd-off fix" onClick={onFix} title={s.missing.join(" · ")}>
      {net}<span className="bt-warnzeichen" aria-hidden="true">⚠</span><span>Offline fehlt</span>
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
  /** (MVP 3) Schicht dieses Geräts: «Schicht MU seit 22:00» bzw. «Kürzel fehlt» (Text, kein Bedienelement); weglassen = nichts */
  schicht?: { kuerzel: string | null; seit: string | null } | null;
  /**
   * (MVP 3.5, A1.6) mindestens ein Online-Dienst der Übung an → Text «Online an». Weglassen = aus der Online-Regel der
   * angezeigten Übung (`onlinePolicy.ts`, gesetzt von der Werkzeugleiste der Karte).
   */
  online?: boolean;
  /** «Kürzel fehlt» angeklickt, ohne Kürzel-Zeile im Bild: Dialog «Kürzel ändern …» */
  onKuerzel?: () => void;
  /** (MVP 3.5) Fortschritt «Alles für offline laden»; weglassen = aus `betrieb/laden.ts` */
  laden?: { done: number; total: number } | null;
}

/** Kopf-Text der Schicht (Kap. 2.1): «Schicht BSP seit 06:00»; schmal (< 860 px) nur «BSP», voller Text im Titel */
export function SchichtText({ s, onKuerzel }: { s: { kuerzel: string | null; seit: string | null }; onKuerzel?: () => void }) {
  // Review 6 (Erstbenutzer N): «Kürzel fehlt» anklickbar – Label des Kürzel-Felds (Fokus in die Kürzel-Zeile); ist die
  // Zeile nicht da (Vorbereiten, Rückfall-Abfrage übergangen), öffnet der Klick «Kürzel ändern …»
  if (!s.kuerzel) return (
    <label className="hd-schicht fehlt" htmlFor={KUERZEL_FELD_ID} title="Kürzel fehlt – hier klicken und Kürzel eintragen"
      onClick={(e) => {
        const f = document.getElementById(KUERZEL_FELD_ID);
        if (f) { f.scrollIntoView({ block: "nearest" }); return; }
        e.preventDefault();
        onKuerzel?.();
      }}>Kürzel fehlt</label>
  );
  const full = `Schicht ${s.kuerzel}${s.seit ? ` seit ${s.seit}` : ""}`;
  return (
    <span className="hd-schicht" title={full}>
      <span className="hd-long">{full}</span><span className="hd-short" aria-hidden="true">{s.kuerzel}</span>
    </span>
  );
}

export function Header({ name, save, offline, onFixOffline, menu, product, schicht, online, laden, onKuerzel }: HeaderProps) {
  useEffect(() => { document.title = `${name} – ${product}`; }, [name, product]);
  const ladenModul = useLaden();
  const policy = useOnlinePolicy();
  const onlineAn = online ?? (policy.ortssuche || policy.strassen);
  return (
    <header className="hd" aria-label={product}>
      <h1 className="hd-name" title={name}>{name}</h1>
      <div className="hd-status">
        {schicht && <SchichtText s={schicht} onKuerzel={onKuerzel} />}
        <SaveStatusView s={save} />
        <OfflineStatusView s={offline} onFix={onFixOffline} laden={laden === undefined ? ladenModul : laden} />
        {onlineAn && <span className="hd-off online" title={ONLINE_AN_TITEL}>Online an</span>}
      </div>
      {menu}
    </header>
  );
}
