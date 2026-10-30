/**
 * Lagejournal (linke Spalte, Modus «Lage führen»): dünne Hülle um Meldungsfeld (`EntryBox`), eine Suche
 * (`UnifiedSearch`) und Liste (`JournalList`) – Spez. MVP 1, Kap. 2.1, 3.2–3.4. Die Teile sind einzeln verdrahtbar
 * (Verträge in shell/contracts.ts); diese Hülle hält nur Suche, Filter und Korrektur-Anforderung zusammen.
 * `between` = Platz zwischen Meldungsfeld und Liste für den Umschalter «Journal | Was Rot vorhaben könnte» (Paket A);
 * `tab = "rot"` zeigt statt Suche und Liste `rot` (Panel von Paket D).
 *
 * MVP 3 (Spez. MVP 3, Kap. 2.1, 2.5, 3.6): `schicht`/`onNr` gehen ans Meldungsfeld (Kürzel-Abfrage, Nummer, «erfasst
 * von»); Trenner «Neu in deiner Schicht ↑» aus `schicht` (nicht im Rückblick, nicht bei Suche, ohne Kürzel keiner);
 * «Gestrichene zeigen (n)» / «Zurückholen»; «Mehr …» an der Zeile (`lvz`, sonst aus device/update/schicht);
 * `tab = "offen"` zeigt `offen` (Panel von Paket C). «Antwort eintragen» setzt den Text ins Feld (`prefillEntry`).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import L from "leaflet";
import type { EventQuality, Exercise, LV95 } from "@lage/core";
import { EntryBox } from "./entry/EntryBox";
import { prefillEntry, requestCorrection } from "./entry/useEntryDraft";
import { deleteEvent, restoreEvent } from "./journal/actions";
import { countGestrichene, filterJournal, wechselSuche } from "./journal/filter";
import { JournalList } from "./journal/JournalList";
import { UnifiedSearch } from "./journal/UnifiedSearch";
import { dayLabel, isoLocal } from "./Timeline";
import type { JournalEmpty, LvzRowProps, SchichtApi, SearchArt, ShowLast, ZeitApi } from "./shell/contracts";
import "./journal/journal.css";

interface Props {
  ex: Exercise;
  map: L.Map;
  device: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  update: (f: (x: Exercise) => Exercise) => void;
  say: (t: string) => void;
  /** alt (vor MVP 1): Fussknöpfe CSV/PDF – mit Menü (Paket A) weglassen */
  onExport?: (kind: "csv" | "pdf") => void;
  /** «Meldung hier» aus dem Kontextmenü der Karte: Ort vorbelegen */
  reportAt?: { pos: LV95; n: number } | null;
  /** Leerzustand: «Übung vorbereiten» bzw. alt Reiter Raster; «Beispiel ansehen» */
  onGoto?: (tab: "raster" | "nai") => void;
  onPrepare?: () => void;
  onDemo?: () => void;
  /** «Korrigieren» aus Meldungsband / Kontextmenü der Karte */
  editRequest?: { id: string; n: number } | null;
  /** Liste nur [from, to] (ISO lokal): Lagezeit und «Zeige letzte»; null = alles */
  win?: { from: string; to: string } | null;
  onWinClear?: () => void;
  quality?: Map<string, EventQuality>;
  // ---------- MVP 1 (alle optional)
  experte?: boolean;
  /** Lagezeit (Paket C); ohne Angabe LIVE */
  zeit?: Pick<ZeitApi, "zeit" | "tNow">;
  /** nach Eintragen/Korrektur (Paket A: `goLive("eintragen")`); die Zeile wird hier schon gewählt */
  onCommitted?: (ids: string[]) => void;
  /** «Zeige letzte» in Minuten (für den Leerzustand) */
  showLast?: ShowLast;
  /** Umschalter «Journal | Was Rot vorhaben könnte» */
  between?: ReactNode;
  tab?: "journal" | "rot" | "offen";
  rot?: ReactNode;
  // ---------- MVP 3 (alle optional, Paket C liefert)
  /** Kürzel/Schicht (Kürzel-Abfrage, «erfasst von», Trenner «Neu in deiner Schicht») */
  schicht?: SchichtApi;
  /** nächste laufende Nummer (Gerätezähler); fehlt → `takeNr` (commit.ts) */
  onNr?: () => number;
  /** «Mehr …» an der Zeile; fehlt → aus `device`, `update`, `schicht` gebildet */
  lvz?: Omit<LvzRowProps, "e" | "ex">;
  /** Ansicht «Offen» (Panel von Paket C) bei `tab = "offen"` */
  offen?: ReactNode;
  /** Trenner von aussen (C); fehlt → aus `schicht` (null = keiner). Bei aktiver Suche nie. */
  schichtSeit?: { seit: string; kuerzel: string } | null;
  /** (MVP 3.5, Phase 0 verdrahtet) einmaliger Schutzhinweis unter dem Feld – geht ans Meldungsfeld (Paket E zeigt ihn) */
  schutzHinweis?: import("./shell/contracts").SchutzHinweis;
  /** «Zur Meldung» (Offen): blendet die Suche den Eintrag aus, Suche leeren */
  reveal?: { id: string; n: number } | null;
}

export function JournalPanel(p: Props) {
  const { ex, map, device, selected, onSelect, update, say, quality } = p;
  const events = ex.events ?? [];
  const [q, setQ] = useState("");
  const [art, setArt] = useState<SearchArt>(null);
  const [resetSearch, setResetSearch] = useState(0);
  const [ownReq, setOwnReq] = useState<{ id: string; n: number } | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  /** «Gestrichene zeigen» – nie gespeichert, gilt bis Übungswechsel */
  const [gestrichene, setGestrichene] = useState(false);
  useEffect(() => setGestrichene(false), [ex.id]);
  const kuerzel = p.schicht?.kuerzel ?? null;
  const zeit = p.zeit ?? { zeit: { kind: "live" as const }, tNow: isoLocal(Date.now()) };
  const rueckblick = zeit.zeit.kind === "rueckblick";
  // Korrektur: Anforderung von aussen (Karte) oder aus der Liste – die jüngere gilt
  const correct = !p.editRequest ? ownReq : !ownReq ? p.editRequest : ownReq.n > p.editRequest.n ? ownReq : p.editRequest;

  const to = rueckblick ? zeit.tNow : p.win?.to ?? null;
  const list = useMemo(() => filterJournal(events, { q, art, from: p.win?.from, to, quality: art === "einzeln" ? quality : undefined, gestrichene, ex }),
    [events, q, art, p.win?.from, to, gestrichene, art === "einzeln" && quality]); // eslint-disable-line react-hooks/exhaustive-deps
  const nDel = useMemo(() => countGestrichene(events, { from: p.win?.from, to }), [events, p.win?.from, to]);
  const any = events.some((e) => !e.deleted);
  // Trenner «Neu in deiner Schicht ↑»: nicht im Rückblick, nicht bei aktiver Suche, ohne Kürzel keiner
  const schichtSeit = rueckblick || q || art ? null
    : p.schichtSeit !== undefined ? p.schichtSeit
    : p.schicht?.kuerzel && p.schicht.seit ? { seit: p.schicht.seit, kuerzel: p.schicht.kuerzel } : null;
  const lvz = useMemo<Omit<LvzRowProps, "e" | "ex">>(() => p.lvz ?? {
    device, kuerzel, update, onPrefill: (t: string) => { prefillEntry(t); },
  }, [p.lvz, device, kuerzel, update]);
  /** Übergaben als Zeile im Journal: im gezeigten Zeitraum; bei Suche nur, wenn nach «Übergabe»/«Schichtwechsel» gesucht wird */
  const wechsel = useMemo(() => {
    const ws = (ex.schichten ?? []).filter((w) => w.art === "uebergabe" && (!to || w.t <= to.slice(0, 16)) && (!p.win?.from || w.t >= p.win.from.slice(0, 16)));
    if (art) return [];
    if (!q) return ws;
    const qq = q.trim().toLowerCase();
    // «Schichtwechsel», «Schichtw», «Übergabe», «Schichtwechsel 07:30 BSP → MU» (Vorschlag) bzw. ein Kürzel
    if (wechselSuche(q)) return ws;
    return ws.filter((w) => qq === w.an.toLowerCase() || qq === (w.von ?? "").toLowerCase());
  }, [ex.schichten, to, p.win?.from, q, art]);
  const empty: JournalEmpty = list.length || wechsel.length ? null : !any ? "erststart" : q || art ? "suche" : rueckblick ? "rueckblick" : p.win ? "zeige-letzte" : null;

  /** zuletzt eingetragene Zeilen: bei aktivem Suchfilter sagen, wenn sie dadurch ausgeblendet sind (Filter bleibt, Klartext) */
  const [justIds, setJustIds] = useState<string[]>([]);
  const onCommitted = useCallback((ids: string[]) => {
    const last = ids[ids.length - 1];
    if (last) onSelect(last);
    setJustIds(ids);
    p.onCommitted?.(ids);
  }, [onSelect, p.onCommitted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setJustIds([]), [q, art]);
  useEffect(() => { if (!justIds.length) return; const t = window.setTimeout(() => setJustIds([]), 15000); return () => window.clearTimeout(t); }, [justIds]);
  useEffect(() => {
    const id = p.reveal?.id;
    if (id && (q || art) && !list.some((e) => e.id === id)) setResetSearch((n) => n + 1);
  }, [p.reveal?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const hiddenNew = (q || art) && justIds.length > 0
    && justIds.some((id) => events.some((e) => e.id === id && !e.deleted) && !list.some((e) => e.id === id));

  return (
    <div className="panel journal jpanel">
      <EntryBox ex={ex} map={map} device={device} experte={!!p.experte} update={update} say={say} zeit={zeit}
        onCommitted={onCommitted} correct={correct} reportAt={p.reportAt ?? null} onCorrecting={setCorrecting}
        schicht={p.schicht} onNr={p.onNr} schutzHinweis={p.schutzHinweis} />
      <hr className="jp-sep" />
      {any && p.between}
      {p.tab === "rot" ? p.rot : p.tab === "offen" && p.offen ? p.offen : (
        <>
          {/* ohne Meldungen: dieselbe Suche als Ortssuche (Karte hinfliegen), sobald es Meldungen gibt auch Listenfilter */}
          <UnifiedSearch ex={ex} map={map} today={dayLabel(zeit.tNow, ex.days)} reset={resetSearch} variant={any ? "journal" : "ort"}
            onQuery={(qq, a) => { setQ(qq); setArt(a); }}
            onPickEvent={(id) => onSelect(id)} />
          {hiddenNew && (
            <p className="jp-hidden" role="status">
              <span>Eingetragen – durch Suchfilter ausgeblendet</span>
              <button type="button" className="jl-btn" onClick={() => { setResetSearch((n) => n + 1); setJustIds([]); }}>Filter löschen</button>
            </p>
          )}
          <JournalList ex={ex} events={list} selected={selected} onSelect={(id) => onSelect(id)} quality={quality} empty={empty}
            onCorrect={(id) => { if (!requestCorrection(id)) setOwnReq({ id, n: Date.now() }); }}
            onDelete={(id) => { deleteEvent(update, ex, id, device, kuerzel); if (selected === id && !gestrichene) onSelect(null); }}
            onRestore={(id) => restoreEvent(update, ex, id, device, kuerzel)}
            gestrichene={gestrichene} onGestrichene={setGestrichene} gestricheneN={nDel} schichtSeit={schichtSeit} lvz={lvz} onNr={p.onNr} wechsel={wechsel}
            correcting={correcting} zeit={zeit} query={q} showLast={p.showLast ?? null} stand={rueckblick ? zeit.tNow : null}
            onClearSearch={() => setResetSearch((n) => n + 1)} onShowAll={p.onWinClear}
            onPrepare={p.onPrepare ?? (p.onGoto ? () => p.onGoto!("raster") : undefined)} onDemo={p.onDemo} />
          {p.onExport && any && (
            <div className="jp-filter">
              <button type="button" className="jl-btn" onClick={() => p.onExport!("pdf")}>Journal drucken (PDF)</button>
              <button type="button" className="jl-btn" onClick={() => p.onExport!("csv")}>Journal als Tabelle (CSV)</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
