/**
 * Lagejournal (linke Spalte, Modus «Lage führen»): dünne Hülle um Meldungsfeld (`EntryBox`), eine Suche
 * (`UnifiedSearch`) und Liste (`JournalList`) – Spez. MVP 1, Kap. 2.1, 3.2–3.4. Die Teile sind einzeln verdrahtbar
 * (Verträge in shell/contracts.ts); diese Hülle hält nur Suche, Filter und Korrektur-Anforderung zusammen.
 * `between` = Platz zwischen Meldungsfeld und Liste für den Umschalter «Journal | Was Rot vorhaben könnte» (Paket A);
 * `tab = "rot"` zeigt statt Suche und Liste `rot` (Panel von Paket D).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import L from "leaflet";
import type { EventQuality, Exercise, LV95 } from "@lage/core";
import { EntryBox } from "./entry/EntryBox";
import { requestCorrection } from "./entry/useEntryDraft";
import { deleteEvent } from "./journal/actions";
import { filterJournal } from "./journal/filter";
import { JournalList } from "./journal/JournalList";
import { UnifiedSearch } from "./journal/UnifiedSearch";
import { dayLabel, isoLocal } from "./Timeline";
import type { JournalEmpty, SearchArt, ShowLast, ZeitApi } from "./shell/contracts";
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
  tab?: "journal" | "rot";
  rot?: ReactNode;
}

export function JournalPanel(p: Props) {
  const { ex, map, device, selected, onSelect, update, say, quality } = p;
  const events = ex.events ?? [];
  const [q, setQ] = useState("");
  const [art, setArt] = useState<SearchArt>(null);
  const [resetSearch, setResetSearch] = useState(0);
  const [ownReq, setOwnReq] = useState<{ id: string; n: number } | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const zeit = p.zeit ?? { zeit: { kind: "live" as const }, tNow: isoLocal(Date.now()) };
  const rueckblick = zeit.zeit.kind === "rueckblick";
  // Korrektur: Anforderung von aussen (Karte) oder aus der Liste – die jüngere gilt
  const correct = !p.editRequest ? ownReq : !ownReq ? p.editRequest : ownReq.n > p.editRequest.n ? ownReq : p.editRequest;

  const list = useMemo(() => filterJournal(events, { q, art, from: p.win?.from, to: rueckblick ? zeit.tNow : p.win?.to ?? null, quality: art === "einzeln" ? quality : undefined }),
    [events, q, art, p.win?.from, p.win?.to, rueckblick, zeit.tNow, art === "einzeln" && quality]); // eslint-disable-line react-hooks/exhaustive-deps
  const any = events.some((e) => !e.deleted);
  const empty: JournalEmpty = list.length ? null : !any ? "erststart" : q || art ? "suche" : rueckblick ? "rueckblick" : p.win ? "zeige-letzte" : null;

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
  const hiddenNew = (q || art) && justIds.length > 0
    && justIds.some((id) => events.some((e) => e.id === id && !e.deleted) && !list.some((e) => e.id === id));

  return (
    <div className="panel journal jpanel">
      <EntryBox ex={ex} map={map} device={device} experte={!!p.experte} update={update} say={say} zeit={zeit}
        onCommitted={onCommitted} correct={correct} reportAt={p.reportAt ?? null} onCorrecting={setCorrecting} />
      <hr className="jp-sep" />
      {any && p.between}
      {p.tab === "rot" ? p.rot : (
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
            onDelete={(id) => { deleteEvent(update, ex, id, device); if (selected === id) onSelect(null); }}
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
