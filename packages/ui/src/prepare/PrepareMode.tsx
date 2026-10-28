/**
 * Modus «Vorbereiten» (Spez. MVP 1, Kap. 1.1, 2.9): linke Spalte mit «Du bereitest vor. [Zurück zu Lage führen]»
 * und der Checkliste «Übung vorbereiten» in 6 Schritten. Ein Schritt öffnet sich als Akkordeon an Ort (nur einer
 * offen). Status je Schritt: ✓ erledigt, ✗ fehlt (nötig: 1–3 und 6), ○ offen (empfohlen: 4–5).
 * Raster und NAI sind nur hier veränderbar (mit Rückgängig).
 */
import { useState, type ReactNode } from "react";
import L from "leaflet";
import type { Area, Exercise } from "@lage/core";
import { NaiPanel } from "../NaiPanel";
import { GeorefPane } from "../GeorefPane";
import type { Candidate } from "../imageimport";
import type { OfflineStatus } from "../shell/contracts";
import { RasterPanel } from "./RasterPanel";
import { TruppsPanel } from "./TruppsPanel";
import { FeindannahmeEdit } from "./FeindannahmeEdit";
import { OfflineStep, offlinePartsText } from "./OfflineStep";
import "./prepare.css";

export type PrepStep = 1 | 2 | 3 | 4 | 5 | 6;
type Mark = "ok" | "fehlt" | "offen";

export interface PrepareModeProps {
  ex: Exercise;
  map: L.Map | null;
  update(f: (x: Exercise) => Exercise): void;
  say(t: string): void;
  offerUndo(label: string, restore: () => void): void;
  offline: OfflineStatus;
  /** offener Schritt (null = alle zu) */
  step: PrepStep | null;
  onStep(s: PrepStep | null): void;
  selSheet: string | null;
  onSelectSheet(id: string | null): void;
  selArea: string | null;
  onSelectArea(id: string | null): void;
  setDrawing(t: string | null): void;
  setBusy(t: string | null): void;
  /** «Zurück zu Lage führen» */
  onBack(): void;
}

/** Zustand der Schritte (testbar) */
export function prepMarks(ex: Pick<Exercise, "name" | "sheets" | "areas" | "units" | "feindannahme">, offlineReady: boolean): Record<PrepStep, Mark> {
  return {
    1: ex.name.trim() ? "ok" : "fehlt",
    2: ex.sheets.length ? "ok" : "fehlt",
    3: ex.areas.length ? "ok" : "fehlt",
    4: ex.units.blau.length ? "ok" : "offen",
    5: ex.feindannahme?.trim() ? "ok" : "offen",
    6: offlineReady ? "ok" : "fehlt",
  };
}

const SIGN: Record<Mark, string> = { ok: "✓", fehlt: "✗", offen: "○" };
const SIGN_LABEL: Record<Mark, string> = { ok: "erledigt", fehlt: "fehlt noch", offen: "empfohlen" };

const truppRange = (l: string[]) => (l.length === 0 ? "" : l.length <= 2 ? l.join(", ") : `${l[0]}–${l[l.length - 1]}`);

export function PrepareMode(p: PrepareModeProps) {
  const { ex, map, update, say, offerUndo, offline, step, onStep } = p;
  const [georef, setGeoref] = useState<Candidate[] | null>(null);
  const marks = prepMarks(ex, offline.ready);
  const done = Object.values(marks).filter((m) => m === "ok").length;
  const nai = ex.areas.filter((a) => a.kind === "nai").length;

  if (georef && map) {
    return (
      <div className="pm">
        <GeorefPane candidates={georef} map={map} existing={ex.areas}
          onAreas={(areas: Area[]) => { update((x) => { x.areas.push(...areas); return x; }); say(`${areas.length} Fläche${areas.length === 1 ? "" : "n"} übernommen`); }}
          onClose={() => { setGeoref(null); onStep(3); }} />
      </div>
    );
  }

  const steps: Array<{ n: PrepStep; title: string; sub: string; body: () => ReactNode }> = [
    { n: 1, title: "Übung", sub: "Name, Klassifizierung, Online-Dienste", body: () => <UebungStep ex={ex} update={update} /> },
    { n: 2, title: ex.sheets.length ? `Führungsraster ${ex.sheets.map((s) => s.name).join(", ")}` : "Führungsraster", sub: ex.sheets.length ? "" : "noch keines",
      body: () => (map ? <RasterPanel ex={ex} map={map} update={update} say={say} offerUndo={offerUndo} selected={p.selSheet} onSelect={p.onSelectSheet} setDrawing={p.setDrawing} setBusy={p.setBusy} /> : <p className="pp-note">Karte lädt …</p>) },
    { n: 3, title: ex.areas.length ? `NAI und Räume (${ex.areas.length})` : "NAI und Räume", sub: ex.areas.length ? (nai ? `${nai} NAI` : "") : "noch keine",
      body: () => (map ? (
        <NaiPanel exercise={ex} selected={p.selArea} onSelect={p.onSelectArea} map={map}
          onChange={(areas: Area[]) => {
            // gelöschte Flächen (NAI, AO …): Rückgängig anbieten
            const gone = ex.areas.map((a, i) => ({ a, i })).filter(({ a }) => !areas.some((b) => b.id === a.id));
            update((x) => { x.areas = areas; return x; });
            if (gone.length) offerUndo(gone.length === 1 ? `«${gone[0]!.a.name}» gelöscht` : `${gone.length} Flächen gelöscht`,
              () => update((x) => { for (const { a, i } of gone) if (!x.areas.some((b) => b.id === a.id)) x.areas.splice(Math.min(i, x.areas.length), 0, a); return x; }));
          }}
          onOverlays={(o) => {
            // entferntes Bild (BNB, Skizze): Rückgängig anbieten
            const gone = (ex.overlays ?? []).map((a, i) => ({ a, i })).filter(({ a }) => !o.some((b) => b.id === a.id));
            update((x) => { x.overlays = o; return x; });
            if (gone.length) offerUndo(`Bild «${gone[0]!.a.name}» entfernt`,
              () => update((x) => { const l = x.overlays ?? []; for (const { a, i } of gone) if (!l.some((b) => b.id === a.id)) l.splice(Math.min(i, l.length), 0, a); x.overlays = l; return x; }));
          }}
          onImage={(c) => setGeoref(c)} say={say} />
      ) : <p className="pp-note">Karte lädt …</p>) },
    { n: 4, title: ex.units.blau.length ? `Trupps (${truppRange(ex.units.blau)})` : "Trupps", sub: ex.units.blau.length ? "" : "empfohlen", body: () => <TruppsPanel ex={ex} update={update} offerUndo={offerUndo} /> },
    { n: 5, title: "Erwartete Kräfte Rot", sub: ex.feindannahme?.trim() ? ex.feindannahme.trim() : "empfohlen", body: () => <FeindannahmeEdit ex={ex} update={update} /> },
    { n: 6, title: "Offline bereit", sub: offlinePartsText(offline), body: () => (map ? <OfflineStep ex={ex} map={map} status={offline} /> : <p className="pp-note">Karte lädt …</p>) },
  ];

  return (
    <div className="pm">
      <div className="pm-head">
        <p>Du bereitest vor.</p>
        <button type="button" className="pp-btn primary" onClick={p.onBack}>Zurück zu Lage führen</button>
      </div>
      <h2 className="pm-title">Übung vorbereiten</h2>
      <ol className="pm-steps">
        {steps.map((s) => {
          const open = step === s.n;
          const m = marks[s.n];
          return (
            <li key={s.n} className={"pm-step m-" + m + (open ? " open" : "")}>
              <button type="button" className="pm-row" aria-expanded={open} onClick={() => onStep(open ? null : s.n)}>
                <span className="pm-mark" aria-label={SIGN_LABEL[m]}>{SIGN[m]}</span>
                <span className="pm-txt">
                  <b><span className="pm-n">{s.n}</span> {s.title}</b>
                  {s.sub && <small>{s.sub}</small>}
                </span>
                <span className="pm-chev" aria-hidden="true">{open ? "▾" : "›"}</span>
              </button>
              {open && <div className="pm-body">{s.body()}</div>}
            </li>
          );
        })}
      </ol>
      <p className="pm-foot">Bereit für Lage führen: <b>{done}/6</b>{marks[1] === "ok" && marks[2] === "ok" && marks[3] === "ok" && marks[6] === "ok" ? " – alles Nötige ist da." : ""}</p>
    </div>
  );
}

const ONLINE: Array<{ key: "ortssuche" | "strassen"; label: string; text: string }> = [
  { key: "ortssuche", label: "Ortsnamen nachschlagen", text: "Ortsnamen aus Meldungen bei swisstopo suchen (Text und Übungsraum gehen ans Netz)." },
  { key: "strassen", label: "Strassennetz laden", text: "Strassen (swisstopo) laden, um Sperren, Checkpoints usw. auf die Strasse zu legen." },
];

function UebungStep({ ex, update }: { ex: Exercise; update(f: (x: Exercise) => Exercise): void }) {
  const cls = ex.sheets[0]?.classification ?? "";
  const mixed = ex.sheets.some((s) => s.classification !== cls);
  return (
    <div className="pp">
      <label className="pp-field">Name der Übung
        <input value={ex.name} onChange={(e) => update((x) => { x.name = e.target.value; return x; })} />
      </label>
      <label className="pp-field">Klassifizierung <span className="pp-meta">(gilt für alle Raster und den Ausdruck)</span>
        <input value={cls} disabled={!ex.sheets.length} placeholder={ex.sheets.length ? "z. B. INTERN" : "zuerst ein Führungsraster anlegen"}
          onChange={(e) => { const v = e.target.value; update((x) => { x.sheets = x.sheets.map((s) => ({ ...s, classification: v })); return x; }); }} />
      </label>
      {mixed && <p className="pp-note">Die Raster haben verschiedene Klassifizierungen – eine Eingabe setzt sie für alle gleich.</p>}
      <fieldset className="pp-set">
        <legend>Online-Dienste (diese Übung)</legend>
        {ONLINE.map((o) => {
          const on = ex.onlineDienste?.[o.key] !== false;
          return (
            <label key={o.key} className="pp-check">
              <input type="checkbox" checked={on} onChange={() => update((x) => { x.onlineDienste = { ...(x.onlineDienste ?? {}), [o.key]: !on }; return x; })} />
              <span><b>{o.label}</b> <span className="pp-meta">{o.text}</span></span>
            </label>
          );
        })}
        <p className="pp-note">Aus = keine Anfrage ans Netz. Ohne Netz wird ohnehin nichts abgefragt.</p>
      </fieldset>
    </div>
  );
}
