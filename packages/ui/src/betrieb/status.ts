/**
 * Betriebs-Status «Offline auf diesem Gerät» (Spez. MVP 3.5, S6/S7/S8, A4): App · Karte (vollständig geprüft, mit
 * Teilezahl) · Ortsnamen · Speicher geschützt · Installiert · letzte Datei-Sicherung · Ladefortschritt. Quellen:
 * `useOfflineStatus` (App, Karte aus `areaTileCoverage`, `storage.persisted()`, Netz), `install.ts` (standalone,
 * `beforeinstallprompt`, iOS), `onlineAllowed`, `dateiGesichertAm`, `laden.ts`.
 *
 * Dazu der einmalige Schutzhinweis (S7): «Dieses Gerät schützt die Daten nicht dauerhaft.» – nur wenn der Speicher nicht
 * geschützt **und** die App nicht installiert ist, höchstens einmal pro Übung und Gerät
 * (`localStorage[SCHUTZHINWEIS_KEY(exId)]`, bleibt bis «OK»).
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { onlineAllowed, type Exercise } from "@lage/core";
import { SCHUTZHINWEIS_KEY, type BetriebStatus, type OfflineStatus, type SchutzHinweis } from "../shell/contracts";
import type { KartenAbdeckung } from "../offlineStatus";
import { useDateiGesichert } from "./dateiSichern";
import { installWeg, istInstalliert, onInstallWeg, type InstallWeg } from "./install";
import { useLaden, useLadenErgebnis, type LadenErgebnis, type LadenStand } from "./laden";

/** Eingaben der reinen Ableitung (testbar ohne Browser) */
export interface BetriebQuellen {
  offline: OfflineStatus & { abdeckung?: KartenAbdeckung };
  onlineDienste: Exercise["onlineDienste"];
  installiert: boolean;
  install: InstallWeg;
  dateiGesichert: string | null;
  laden: LadenStand | null;
  /** Ergebnis des letzten Ladens (Abbruch → «abgebrochen – 241 von 971», Review 6 Feld H1) */
  ergebnis?: Pick<LadenErgebnis, "abgebrochen"> | null;
}

/** reine Ableitung des Status (Spez. 5.7): Karte ✓ nur bei 100 %, Teilezahlen aus der vollständigen Prüfung */
export function betriebAus(q: BetriebQuellen): BetriebStatus {
  const ab = q.offline.abdeckung;
  const karte: BetriebStatus["karte"] = ab
    ? { share: ab.total ? ab.share : 1, total: ab.total, cached: ab.cached, geprueft: ab.geprueft,
      ...(ab.uebersicht ? { uebersicht: ab.uebersicht } : {}), ...(ab.detail ? { detail: ab.detail } : {}) }
    : { share: q.offline.parts.karte ? 1 : 0, total: 0, cached: 0, geprueft: false };
  // abgebrochen und noch unvollständig: nie still «✓» (Review 6 Feld H1)
  if (q.ergebnis?.abgebrochen && !q.laden && karte.geprueft && karte.total > 0 && karte.share < 1) karte.abgebrochen = { cached: karte.cached, total: karte.total };
  return {
    app: q.offline.parts.app,
    karte,
    speicher: q.offline.parts.speicher,
    installiert: q.installiert,
    install: q.installiert ? "fertig" : q.install,
    online: { ortssuche: onlineAllowed({ onlineDienste: q.onlineDienste }, "ortssuche"), strassen: onlineAllowed({ onlineDienste: q.onlineDienste }, "strassen") },
    dateiGesichert: q.dateiGesichert,
    laden: q.laden ? { done: q.laden.done, total: q.laden.total } : null,
    net: q.offline.net,
  };
}

/** Kopf-Text zum Status: «Lädt 42 %» während des Ladens, sonst null */
export function ladenText(l: { done: number; total: number } | null): string | null {
  if (!l) return null;
  return `Lädt ${l.total ? Math.min(99, Math.floor((l.done / l.total) * 100)) : 0} %`;
}

/**
 * Karte im Popover (Review 6 Feld H1 – Ampel ehrlich): «Raster-Gebiet vollständig» nur, wenn **alle** Stufen bis zur
 * Ladestufe vorhanden sind · «Übersicht ✓ · Detail 25 %» mit `zusatz` «241 von 971 Teilen» bzw. nach Abbruch
 * «abgebrochen – 241 von 971» · «96 % (933 von 971 Teilen)» (ohne Stufen-Angabe) · «noch nicht geladen» · «wird geprüft …».
 */
export function karteText(k: BetriebStatus["karte"]): { ok: boolean | null; text: string; zusatz?: string } {
  if (!k.geprueft) return { ok: null, text: "wird geprüft …" };
  if (k.total === 0 || k.share >= 1) return { ok: true, text: k.total === 0 ? "kein Raster – nichts zu laden" : "Raster-Gebiet vollständig" };
  const teile = (c: number, t: number) => `${c.toLocaleString("de-CH")} von ${t.toLocaleString("de-CH")}`;
  const zusatz = k.abgebrochen ? { zusatz: `abgebrochen – ${teile(k.abgebrochen.cached, k.abgebrochen.total)}` } : {};
  if (!k.cached) return { ok: false, text: "noch nicht geladen", ...zusatz };
  // nie «100 %» zeigen, solange etwas fehlt (abrunden)
  const pz = (t: { total: number; cached: number }) => `${Math.floor((t.cached / Math.max(1, t.total)) * 100)} %`;
  const u = k.uebersicht, d = k.detail;
  if (u && d && u.total && d.total) {
    const ueb = u.cached >= u.total ? "Übersicht ✓" : `Übersicht ${pz(u)}`;
    return { ok: false, text: `${ueb} · Detail ${d.cached >= d.total ? "✓" : pz(d)}`, zusatz: `${teile(k.cached, k.total)} Teilen`, ...zusatz };
  }
  return { ok: false, text: `${Math.floor(k.share * 100)} % (${k.cached} von ${k.total} Teilen)`, ...zusatz };
}

export function useBetriebStatus(ex: Exercise | null, offline: OfflineStatus): BetriebStatus {
  const [n, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onInstallWeg(bump), []);
  // installiert/standalone kann sich ändern (App aus dem Browser installiert): bei Sichtbarkeit neu lesen
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try { mq = matchMedia("(display-mode: standalone)"); mq.addEventListener?.("change", bump); } catch { /* alter Browser */ }
    document.addEventListener("visibilitychange", bump);
    return () => { mq?.removeEventListener?.("change", bump); document.removeEventListener("visibilitychange", bump); };
  }, []);
  const dateiGesichert = useDateiGesichert(ex?.id);
  const laden = useLaden();
  const ergebnis = useLadenErgebnis();
  const online = ex?.onlineDienste;
  const ab = (offline as OfflineStatus & { abdeckung?: KartenAbdeckung }).abdeckung;
  return useMemo(() => {
    const inst = istInstalliert();
    return betriebAus({ offline: { ...offline, abdeckung: ab }, onlineDienste: online, installiert: inst, install: installWeg(), dateiGesichert, laden, ergebnis });
  }, [offline.parts.app, offline.parts.karte, offline.parts.speicher, offline.net, ab, online, dateiGesichert, laden, ergebnis, n]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------- einmaliger Schutzhinweis (S7)

/** Hinweis zeigen? Speicher nicht geschützt ∧ nicht installiert ∧ noch nicht mit «OK» bestätigt (pro Übung und Gerät) */
export function schutzHinweisNoetig(s: Pick<BetriebStatus, "speicher" | "installiert">, gesehen: boolean): boolean {
  return !s.speicher && !s.installiert && !gesehen;
}

const gesehenAm = (exId: string): boolean => {
  try { return localStorage.getItem(SCHUTZHINWEIS_KEY(exId)) !== null; } catch { return true; /* Speicher gesperrt: nicht bei jedem Start zeigen */ }
};

/** «So geht’s» im Hinweis: Popover mit aufgeklappter Anleitung öffnen (Workspace hört mit `onSchutzAnleitung`) */
const anleitungHoerer = new Set<() => void>();
let anleitungOffen = false;
/** Workspace: Offline-Popover öffnen, wenn der Hinweis «So geht’s» will */
export function onSchutzAnleitung(h: () => void): () => void { anleitungHoerer.add(h); return () => { anleitungHoerer.delete(h); }; }
/** Popover beim Öffnen: Anleitung aufgeklappt? (einmal lesen, dann zurückgesetzt) */
export function nimmAnleitungOffen(): boolean { const v = anleitungOffen; anleitungOffen = false; return v; }
/** Anleitung im Popover zeigen: Hörer (Workspace) oder – solange keiner da ist – den Kopf-Knopf «⚠ Offline fehlt» drücken */
export function zeigeSchutzAnleitung(): void {
  anleitungOffen = true;
  if (anleitungHoerer.size) { for (const h of anleitungHoerer) h(); return; }
  const knopf = document.querySelector<HTMLButtonElement>(".hd button.hd-off");
  if (knopf) knopf.click();
  else document.querySelector<HTMLButtonElement>(".hd .mm-btn")?.click();
}

export function useSchutzHinweis(exId: string | null, s: BetriebStatus): SchutzHinweis {
  const [gesehen, setGesehen] = useState(() => (exId ? gesehenAm(exId) : true));
  useEffect(() => { setGesehen(exId ? gesehenAm(exId) : true); }, [exId]);
  const ok = useCallback(() => {
    if (!exId) return;
    try { localStorage.setItem(SCHUTZHINWEIS_KEY(exId), new Date().toISOString()); } catch { /* nur diese Sitzung */ }
    setGesehen(true);
  }, [exId]);
  const zeigen = !!exId && schutzHinweisNoetig(s, gesehen);
  return useMemo(() => ({ zeigen, ok, mehr: zeigeSchutzAnleitung }), [zeigen, ok]);
}
