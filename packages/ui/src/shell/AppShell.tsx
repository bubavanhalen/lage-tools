/**
 * Hülle der App (Spez. MVP 1, Kap. 2): Grid Kopf (48 px) / Bänder (Speicher, Zeitzone, Fenster – im Fluss, verdecken
 * nichts) / Arbeitsfläche (linke Spalte + Kartenspalte mit Live-Band darunter). Nur Anordnung, kein Zustand.
 * Testhaken: `data-lagezeit` an `.app` (Wert von Paket C), dazu `data-modus` und `data-experte` (nur lesen).
 *
 * `LageColumn` ordnet die linke Spalte im Modus «Lage führen»: Meldungsfeld oben (fest), darunter der Umschalter
 * «Journal | Was Rot vorhaben könnte» und die Liste. `SideSwitch` ist der Umschalter (zählt im Inventar als 1).
 */
import type React from "react";
import type { ReactNode } from "react";
import type { Arbeitsweise } from "./contracts";
import "./shell.css";
import "../lvzui/lvzui.css";

export interface AppShellProps {
  aw: Arbeitsweise;
  lagezeit: "live" | "rueckblick";
  night?: boolean;
  present?: boolean;
  header: ReactNode;
  /** Speicher-, Konflikt-, Zeitzonenband (StatusBands) und Ergebnis «Öffnen» (MergeBar) */
  bands?: ReactNode;
  side: ReactNode;
  /** oben in der Kartenspalte (Rückblick-Band und -Rahmen, absolut) */
  mapTop?: ReactNode;
  /** Karte samt Werkzeugen (in `.mapbox`) */
  map: ReactNode;
  /** unter der Karte: Live-Band bzw. Zeitstrahl (Experte); leer im Modus Vorbereiten */
  band?: ReactNode;
  /** Präsentation: Spalte rechts über der Karte */
  presentAside?: ReactNode;
  /** Toast, Rückgängig, Dialoge … */
  children?: ReactNode;
}

export function AppShell(p: AppShellProps) {
  const cls = ["app", "shell", p.present ? "present" : "", p.night ? "night" : "", p.aw.modus === "vorbereiten" ? "m-vorbereiten" : "m-lage", p.aw.experte ? "experte" : ""].filter(Boolean).join(" ");
  return (
    <div className={cls} data-lagezeit={p.lagezeit} data-modus={p.aw.modus} data-experte={p.aw.experte ? "ja" : "nein"}>
      {!p.present && p.header}
      <div className="sh-bands">{p.bands}</div>
      <div className="work sh-work">
        {!p.present && <aside className="side sh-side" aria-label={p.aw.modus === "vorbereiten" ? "Übung vorbereiten" : "Meldungen"}>{p.side}</aside>}
        <main className="mapwrap sh-mapcol">
          {p.mapTop}
          <div className="mapbox">
            {p.map}
            {p.presentAside}
          </div>
          {p.band && <div className="sh-band">{p.band}</div>}
        </main>
      </div>
      {p.children}
    </div>
  );
}

export function LageColumn({ entry, switcher, list }: { entry?: ReactNode; switcher?: ReactNode; list: ReactNode }) {
  return (
    <div className="lc">
      {entry && <div className="lc-entry">{entry}</div>}
      {switcher && <div className="lc-switch">{switcher}</div>}
      <div className="lc-list">{list}</div>
    </div>
  );
}

/** Ansicht der Spalte – Vertrag in contracts.ts (MVP 3: + «offen»; Umschalter dreiteilig baut Paket C) */
export type { SideView } from "./contracts";
import type { SideView } from "./contracts";

/**
 * Umschalter der Spalte (zählt im Inventar als 1). MVP 3 (Kap. 2.1, E10): dreiteilig `Journal | Offen 4 | Was Rot ⚠3`,
 * sobald `offenLabel` gegeben ist; in schmaler Spalte steht «Was Rot» (Name für Screenreader bleibt voll).
 */
export function SideSwitch({ view, onView, redLabel, offenLabel }: { view: SideView; onView: (v: SideView) => void; redLabel: ReactNode; offenLabel?: ReactNode }) {
  const tabs: Array<[SideView, ReactNode]> = offenLabel ? [["journal", "Journal"], ["offen", offenLabel], ["rot", redLabel]] : [["journal", "Journal"], ["rot", redLabel]];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = tabs.findIndex(([v]) => v === view);
    const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]![0];
    e.preventDefault();
    const box = e.currentTarget as HTMLElement;
    onView(n);
    window.setTimeout(() => box.querySelector<HTMLElement>(`[data-view="${n}"]`)?.focus(), 0);
  };
  return (
    <div className="sw-box">
      <div className={offenLabel ? "sw2 sw3" : "sw2"} role="tablist" aria-label="Ansicht der Spalte" data-zaehl="umschalter" onKeyDown={onKey}>
        {tabs.map(([v, l]) => (
          <button key={v} type="button" role="tab" data-view={v} aria-selected={view === v} onClick={() => onView(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}
