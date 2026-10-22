/**
 * Lagejournal: Meldungen eingeben (eine Zeile pro Meldung), Erkennung prüfen, Liste führen.
 */
import { createPortal } from "react-dom";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import L from "leaflet";
import {
  formatLv95,
  isoOf,
  lastPosition,
  minutesOf,
  parseMeldung,
  reviseEvent,
  sheetBounds,
  catalogEntry,
  cellBounds,
  describeTactical,
  findCells,
  type Affiliation,
  type Status,
  symbolDef,
  type Draft,
  type Exercise,
  type Kind,
  type LageEvent,
  type LV95,
  type Side,
  type EventQuality,
} from "@lage/core";
import { QualityMarks, useDraftMissing } from "./QualityMarks";
import { iconSvg, pickPoint, toLatLng, toLv95 } from "@lage/map";
import { dayLabel } from "./Timeline";
import { SymbolPicker, choiceSvg, makeChoice, pickerEntry, rebaseSidc, type SymbolChoice } from "./SymbolPicker";
import { RoadChoice, RoadEdit, roadOutside, useRoadChoice, type RoadPatch, type RoadPick } from "./RoadChoice";
import { kindText } from "./journalLayer";
import { WindowHint } from "./mapedit";
import { inWindow } from "@lage/core";
import { ShapeButton, shapePatch, takeDrawing } from "./ShapeDraw";
import { addEvents, buildEvent, commitTexts } from "./commit";
import { PhotoButton, PendingAttachment } from "./PhotoInput";
import { AttachmentChips } from "./Attachments";
import type { Attachment } from "@lage/core";

interface Props {
  ex: Exercise;
  map: L.Map;
  device: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  update: (f: (x: Exercise) => Exercise) => void;
  say: (t: string) => void;
  onExport: (kind: "csv" | "pdf") => void;
  /** «Meldung hier» aus dem Kontextmenü der Karte: Ort vorbelegen */
  reportAt?: { pos: LV95; n: number } | null;
  /** Leerzustand: zu Raster/NAI wechseln, Beispiel laden */
  onGoto?: (tab: "raster" | "nai") => void;
  onDemo?: () => void;
  /** «Bearbeiten» aus dem Meldungsband der Karte */
  editRequest?: { id: string; n: number } | null;
  /** Zeitfenster der Karte: Liste nur [from, to] (ISO lokal), null = alles */
  win?: { from: string; to: string } | null;
  onWinClear?: () => void;
  /** Meldungsqualität (E1 bestätigt/unbestätigt, E2 unvollständig) zur Lagezeit */
  quality?: Map<string, EventQuality>;
}

/** Auf Handy/Tablet nicht automatisch fokussieren (sonst springt die Seite und die Tastatur geht auf) */
const wideScreen = typeof window !== "undefined" && window.innerWidth >= 860 && !window.matchMedia?.("(pointer: coarse)").matches;
const KINDS: Array<[Kind, string]> = [["eigen", "Eigene"], ["feind", "Feind"], ["unklar", "Unklar"]];
export const KIND_COLOR: Record<Kind, string> = { eigen: "#1f5fb8", feind: "#c8102e", unklar: "#b8860b" };
/** Art für Filter und Bearbeiten: neutral (N) zählt zu «Unklar» (nicht Feind) */
const kindOf = (e: Pick<LageEvent, "side" | "aff">): Kind => (e.side === "blau" ? "eigen" : e.aff === "U" || e.aff === "N" ? "unklar" : "feind");
/** Zugehörigkeit ↔ Art: F = eigen, H = feind, U/N = unklar */
const kindOfAff = (a: Affiliation): Kind => (a === "F" ? "eigen" : a === "H" ? "feind" : "unklar");
const affOfKind = (k: Kind, cur: Affiliation): Affiliation => (k === "eigen" ? "F" : k === "feind" ? "H" : cur === "N" ? "N" : "U");
const sideOfAff = (a: Affiliation): Side => (a === "F" ? "blau" : "rot");
/** Farbe für Liste/Zeile: neutral grün */
const kindColor = (e: Pick<LageEvent, "side" | "aff">): string => (e.side !== "blau" && e.aff === "N" ? "#2d7a4b" : KIND_COLOR[kindOf(e)]);
const kindVar = (e: Pick<LageEvent, "side" | "aff">): string => {
  const k = kindOf(e);
  return k === "eigen" ? "var(--blau)" : e.aff === "N" ? "var(--ok)" : k === "feind" ? "var(--rot)" : "var(--unklar)";
};
const STATUS_WORD: Partial<Record<Status, string>> = { anticipated: "vermutet", destroyed: "zerstört", damaged: "beschädigt" };
const COMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8]!;
/** ausgeschriebener Sinn zu einer (von Hand gewählten) Zeichenwahl, inkl. Zugehörigkeit und Anzahl */
function choiceText(c: SymbolChoice, count?: number): string {
  const st = c.status && c.status !== "present" ? STATUS_WORD[c.status] : undefined;
  return describeTactical({ key: c.key, echelon: c.echelon, count: count && count > 0 ? count : undefined, statusWord: st }, c.aff === "H" || c.aff === "F" ? c.aff : null)
    || pickerEntry(c.key)?.name || c.key;
}
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Bereich der Übung (Raster, NAI) – für die Ortssuche */
function exerciseBox(ex: Exercise, map: L.Map) {
  const pts: LV95[] = [];
  ex.sheets.forEach((s) => { const b = sheetBounds(s); pts.push({ e: b.minE, n: b.minN }, { e: b.maxE, n: b.maxN }); });
  ex.areas.forEach((a) => pts.push(...a.ring));
  if (!pts.length) {
    const b = map.getBounds();
    pts.push(toLv95(b.getSouthWest()), toLv95(b.getNorthEast()));
  }
  const pad = 8000;
  return { minE: Math.min(...pts.map((p) => p.e)) - pad, maxE: Math.max(...pts.map((p) => p.e)) + pad, minN: Math.min(...pts.map((p) => p.n)) - pad, maxN: Math.max(...pts.map((p) => p.n)) + pad };
}

async function lookupPlace(q: string, box: ReturnType<typeof exerciseBox>, signal: AbortSignal): Promise<{ name: string; pos: LV95 } | null> {
  const url = `https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&sr=2056&limit=5&searchText=${encodeURIComponent(q)}&bbox=${Math.round(box.minE)},${Math.round(box.minN)},${Math.round(box.maxE)},${Math.round(box.maxN)}`;
  const r = await fetch(url, { signal });
  const j = await r.json();
  const hit = (j.results ?? []).find((x: { attrs: { y: number; x: number } }) => x.attrs.y >= box.minE && x.attrs.y <= box.maxE && x.attrs.x >= box.minN && x.attrs.x <= box.maxN);
  return hit ? { name: q, pos: { e: hit.attrs.y, n: hit.attrs.x } } : null;
}

function SymbolMini({ k, aff, sidc, status }: { k: string; aff: LageEvent["aff"]; sidc?: string; status?: LageEvent["status"] }) {
  // gleiches Objekt behalten: React 19 setzt innerHTML sonst bei jeder Darstellung neu (300 Zeilen bei jeder Mausbewegung)
  const html = useMemo(() => ({ __html: iconSvg(k, aff, 14, { sidc, status }).svg }), [k, aff, sidc, status]);
  return <span className="symmini" dangerouslySetInnerHTML={html} />;
}

export function JournalPanel({ ex, map, device, selected, onSelect, update, say, onExport, reportAt, editRequest, onGoto, onDemo, win, onWinClear, quality }: Props) {
  const events = ex.events ?? [];
  const [kindOverride, setKindOverride] = useState<Kind | null>(null);
  const [day, setDay] = useState(() => (ex.days.includes(todayIso()) ? todayIso() : ex.days[ex.days.length - 1] ?? todayIso()));
  const [text, setText] = useState("");
  const [manualPos, setManualPos] = useState<LV95 | null>(null);
  /** von Hand gezeichnete Fläche/Linie für die neue Meldung */
  const [shapeDraft, setShapeDraft] = useState<LageEvent["shape"]>(undefined);
  const [found, setFound] = useState<{ q: string; name: string; pos: LV95 } | null>(null);
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState<"alle" | Kind | "unbest">("alle");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [confirmNoMelder, setConfirmNoMelder] = useState(false);
  const [symOverride, setSymOverride] = useState<SymbolChoice | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  /** Popover fest am Bildschirm ausrichten (die Seitenleiste schneidet sonst ab) */
  const [pickPos, setPickPos] = useState<{ left: number; top: number; maxH: number } | null>(null);
  const pickClosedAt = useRef(0);
  const openPicker = (btn: HTMLElement) => {
    if (pickOpen) { setPickOpen(false); return; }
    if (Date.now() - pickClosedAt.current < 300) return; // Klick auf den Chip hat das Popover eben geschlossen
    const r = btn.getBoundingClientRect();
    const w = Math.min(440, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
    const below = window.innerHeight - r.bottom - 18;
    const top = below >= 360 ? r.bottom + 6 : Math.max(12, window.innerHeight - Math.min(560, window.innerHeight - 24) - 12);
    setPickPos({ left, top, maxH: Math.min(560, window.innerHeight - top - 12) });
    setPickOpen(true);
  };
  /** Strassenwahl von Hand (Kreuzung), bleibt wie die Zeichenwahl bis zum Eintragen */
  const [roadPick, setRoadPick] = useState<RoadPick | null>(null);
  /** Anhang (Foto), der an die nächste eingetragene Meldung gehängt wird */
  const [pendingAtt, setPendingAtt] = useState<Attachment | null>(null);

  // Taste «N» (ausserhalb von Eingabefeldern): zurück in die Meldungszeile
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if ((ev.key === "n" || ev.key === "N") && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => { if (editRequest) { setFilter("alle"); setSearch(""); setEditing(editRequest.id); } }, [editRequest?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (reportAt) { setManualPos(reportAt.pos); inputRef.current?.focus(); } }, [reportAt?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!ex.days.includes(day)) setDay(ex.days[ex.days.length - 1] ?? todayIso()); }, [ex.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = useMemo(() => ({
    sheets: ex.sheets, areas: ex.areas, units: ex.units, places: ex.places ?? [], kind: kindOverride ?? undefined, days: ex.days, day, now: new Date(),
    lastPos: (u: string, s: Side) => lastPosition(events, s, u),
  }), [ex, kindOverride, day, events]);
  const draft: Draft | null = useMemo(() => (text.trim() ? parseMeldung(text, ctx) : null), [text, ctx]);
  /** E2: was der Meldung fehlt (Rückfrage nach AEIOU) */
  const draftMissing = useDraftMissing(draft, ex);

  // Ortsname online nachschlagen (nur wenn sonst kein Ort erkannt wurde)
  useEffect(() => {
    const q = draft?.placeQuery;
    if (!q || (draft?.pos && draft.where?.kind !== "zuletzt") || !navigator.onLine) { setFound(null); return; }
    if (found?.q === q) return;
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const r = await lookupPlace(q, exerciseBox(ex, map), ctl.signal);
        setFound(r ? { q, ...r } : null);
      } catch { /* offline */ }
    }, 350);
    return () => { ctl.abort(); window.clearTimeout(t); };
  }, [draft?.placeQuery, draft?.pos]); // eslint-disable-line react-hooks/exhaustive-deps

  const future = !!draft && draft.timeFromText && Date.parse(draft.t) - Date.now() > 10 * 60000 && Date.parse(draft.t) - Date.now() < 36 * 3600000;
  // Zeichen: erkannt oder von Hand gewählt
  const autoEntry = draft ? pickerEntry(draft.sym) ?? pickerEntry("einheit")! : null;
  const choice: SymbolChoice | null = draft ? symOverride ?? makeChoice(autoEntry!, draft.aff, draft.echelon, draft.status) : null;
  const choiceEntry = choice ? pickerEntry(choice.key) ?? autoEntry : null;
  const choiceDesc = symOverride && choiceEntry ? choiceText(symOverride, draft?.count) : draft?.desc;
  // Art folgt einer von Hand gewählten Zugehörigkeit (Neutral → unklar)
  const effKind: Kind | null = draft ? (symOverride ? kindOfAff(symOverride.aff) : draft.kind) : null;
  const setKind = (k: Kind) => {
    setKindOverride(k);
    if (symOverride) setSymOverride(makeChoice(pickerEntry(symOverride.key) ?? pickerEntry("einheit")!, affOfKind(k, symOverride.aff), symOverride.echelon, symOverride.status));
  };
  // Hindernisse, Checkpoint, IED …: auf die wahrscheinlichste Strasse im gemeldeten Gebiet legen
  const roadTarget = (() => {
    if (!draft || !choice || manualPos) return null;
    const ce = catalogEntry(choice.key);
    // Hindernis & Co. – oder ausdrücklich «auf Hauptstrasse / Autobahn» gemeldet
    if (ce?.placement !== "strasse" && !draft.roadHint) return null;
    const hint = draft.roadHint;
    if (draft.where?.kind === "raster" && draft.cells?.[0]) {
      const c = findCells(draft.cells[0], ex.sheets)[0];
      const sh = c && ex.sheets.find((x) => x.id === c.sheetId);
      if (c && sh) return { key: `${choice.key}|${draft.cells[0]}|${hint ?? ""}`, target: cellBounds(sh, c.col, c.row, c.quadrant) as import("@lage/core").Bounds | LV95[], along: choice.key === "hinterhalt", hint };
    }
    if (draft.where?.kind === "nai" && draft.nai) {
      const a = ex.areas.find((x) => x.name === draft.nai);
      if (a) return { key: `${choice.key}|${a.id}|${hint ?? ""}`, target: a.ring as import("@lage/core").Bounds | LV95[], along: choice.key === "hinterhalt", hint };
    }
    return null;
  })();
  // Strasse: im Text genannte gewinnt, sonst wahrscheinlichste; von Hand wählbar (RoadChoice)
  const roadRes = useRoadChoice(roadTarget, text, roadPick);
  const road = roadTarget ? roadRes.pl : null;
  const effPos0 = manualPos ?? (found && draft?.placeQuery === found.q && (!draft.pos || draft.where?.kind === "zuletzt") ? found.pos : draft?.pos);
  const effWhere0 = manualPos ? "Karte" : found && effPos0 === found.pos ? found.name : draft?.where?.label;
  const effPos = road ? road.pos : effPos0;
  const effWhere = road ? `${effWhere0} · auf ${road.road ?? "Strasse"}` : effWhere0;

  const pickOnMap = async () => {
    setPicking(true);
    const p = await pickPoint(map);
    setPicking(false);
    if (p) setManualPos(p);
    inputRef.current?.focus();
  };

  const add = () => {
    if (!draft) return;
    // Fläche/Linie wird noch gezeichnet: zuerst abschliessen (Form übernehmen), dann eintragen
    const drawn = takeDrawing("neu");
    if (drawn === "unfertig") { say("Fläche/Linie noch nicht fertig – weitere Punkte setzen, dann «Fertig» (oder Esc)."); return; }
    if (drawn) setShapeDraft(drawn);
    const sd = drawn ?? shapeDraft;
    if (!draft.melder && !confirmNoMelder) { setConfirmNoMelder(true); return; }
    setConfirmNoMelder(false);
    // Eintrage-Weg in commit.ts (gleich für mehrere Meldungen aus Foto/Sprachmemo)
    const ev = buildEvent(draft, device, ex, {
      pos: effPos, where: effWhere, whereKind: manualPos ? "karte" : "ort",
      sym: symOverride ? { ...symOverride, desc: choiceDesc } : undefined,
      road,
      // genannte Strasse liegt ausserhalb des gemeldeten Feldes: Feld nachführen
      roadCell: roadOutside(road, effWhere0 ?? "", ex.sheets)?.cell,
      roadNone: !!(roadTarget && roadPick?.none),
      shape: sd,
      attachments: pendingAtt ? [pendingAtt.id] : undefined,
      source: pendingAtt ? { kind: pendingAtt.kind === "audio" ? "audio" : "image", ref: pendingAtt.id } : undefined,
    });
    update((x) => addEvents(x, [ev], { place: found && effPos0 === found.pos ? found : undefined, attachments: pendingAtt ? [pendingAtt] : undefined }));
    setPendingAtt(null);
    setText(""); setManualPos(null); setFound(null); setKindOverride(null); setSymOverride(null); setPickOpen(false); setRoadPick(null); setShapeDraft(undefined);
    onSelect(ev.id);
    if (ev.pos && !map.getBounds().contains(toLatLng(ev.pos))) map.panTo(toLatLng(ev.pos));
    if (!ev.pos) say("Eingetragen – ohne Ort. Mit ✎ kann der Ort später auf der Karte gesetzt werden.");
    inputRef.current?.focus();
  };

  const patch = (id: string, p: Partial<LageEvent>) => update((x) => { x.events = (x.events ?? []).map((e) => (e.id === id ? reviseEvent(e, p, device) : e)); return x; });
  const [undo, setUndo] = useState<string | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const removeWithUndo = (id: string) => {
    patch(id, { deleted: true });
    setUndo(id);
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 6000);
  };
  // Auswahl von aussen (Karte, Zeitstrahl): Zeile zeigen und kurz aufblitzen
  const listRef = useRef<HTMLOListElement>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!selected) return;
    const li = listRef.current?.querySelector<HTMLElement>(`li[data-id="${selected}"]`);
    if (!li) return;
    const r = li.getBoundingClientRect(), pr = listRef.current!.closest(".side")?.getBoundingClientRect();
    if (!pr || r.top < pr.top + 230 || r.bottom > pr.bottom) li.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlashId(selected);
    const t = window.setTimeout(() => setFlashId(null), 1600);
    return () => window.clearTimeout(t);
  }, [selected]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events
      .filter((e) => !e.deleted && (filter === "alle" || (filter === "unbest" ? quality?.get(e.id)?.status === "unbestaetigt" : kindOf(e) === filter)) && (!q || `${e.unit} ${e.melder ?? ""} ${e.text} ${e.where ?? ""} ${(e.cells ?? []).join(" ")}`.toLowerCase().includes(q)))
      .filter((e) => !win || inWindow(e.t, win.from, win.to))
      .sort((a, b) => b.t.localeCompare(a.t) || b.id.localeCompare(a.id));
  }, [events, filter, search, win?.from, win?.to, filter === "unbest" && quality]); // eslint-disable-line react-hooks/exhaustive-deps

  const addDay = () => {
    const last = ex.days[ex.days.length - 1] ?? todayIso();
    const d = new Date(last + "T12:00"); d.setDate(d.getDate() + 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    update((x) => { x.days = [...x.days, iso]; return x; });
    setDay(iso);
  };

  return (
    <div className="panel journal">
      {!ex.sheets.length && !events.some((e) => !e.deleted) && (
        <div className="onboard">
          <h3>So startest du</h3>
          <ol>
            <li><b>Führungsraster</b> über den Raum legen – damit «AK7 C» verstanden wird.{onGoto && <> <button className="chipbtn" onClick={() => onGoto("raster")}>Raster anlegen</button></>}</li>
            <li><b>NAI / BNB</b> einpflegen (Word, Bild, KML) – optional.{onGoto && <> <button className="chipbtn" onClick={() => onGoto("nai")}>NAI einpflegen</button></>}</li>
            <li><b>Meldungen</b> unten eintippen: Zeit · Melder · was · wo.</li>
          </ol>
          {onDemo && <div className="btnrow"><button onClick={onDemo}>Beispiel (fiktiv) ansehen</button></div>}
        </div>
      )}
      <div className="entry" style={{ borderColor: effKind ? (symOverride?.aff === "N" ? "#2d7a4b" : KIND_COLOR[effKind]) : undefined }}>
        <div className="btnrow">
          <b className="entry-title">Meldung</b>
          <select value={day} onChange={(e) => (e.target.value === "__add" ? addDay() : setDay(e.target.value))} aria-label="Übungstag">
            {ex.days.map((d, i) => <option key={d} value={d}>T{i + 1} · {d.slice(8, 10)}.{d.slice(5, 7)}.</option>)}
            <option value="__add">+ Tag</option>
          </select>
        </div>
        <textarea ref={inputRef} className="msg" value={text} autoFocus={wideScreen} rows={1} placeholder={wideScreen ? "z. B. 1015 H04 2 Fz in NAI 3 Rtg N" : "1015 H04 2 Fz NAI 3"} aria-label="Meldung"
          onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 96) + "px"; }}
          onChange={(e) => { setText(e.target.value.replace(/\n/g, " ")); setConfirmNoMelder(false); if (!e.target.value) { setManualPos(null); setKindOverride(null); setSymOverride(null); setRoadPick(null); setShapeDraft(undefined); e.target.style.height = "auto"; } }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); }
            if (e.key === "Escape") { setText(""); setManualPos(null); setKindOverride(null); }
            // ↑ in leerer Zeile: letzte Meldung zum Korrigieren öffnen
            if (e.key === "ArrowUp" && !text) { const last = [...events].filter((x) => !x.deleted).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]; if (last) { e.preventDefault(); setEditing(last.id); onSelect(last.id); } }
            // Alt+1/2/3: Einordnung festlegen
            if (e.altKey && ["1", "2", "3"].includes(e.key)) { e.preventDefault(); setKind(KINDS[+e.key - 1]![0]); }
          }} />
        {draft ? (
          <div className="preview">
            <span className={"chip" + (draft.timeFromText ? "" : " soft")} title={draft.timeFromText ? "Zeit aus der Meldung" : "keine Zeit genannt – jetzt"}>{dayLabel(draft.t, ex.days)} {draft.t.slice(11, 16)}</span>
            {draft.melder ? <span className="chip" title="eigenes Element, das meldet">Melder <b>{draft.melder}</b></span>
              : <span className={"chip " + (confirmNoMelder ? "err" : "warnsoft")} title="Wer meldet? z. B. «H04» an den Anfang">{confirmNoMelder ? "Ohne Melder? Nochmals Enter" : "Melder fehlt"}</span>}
            {future && <span className="chip warnsoft" title="Zeit liegt nach jetzt">liegt in der Zukunft – Vortag?</span>}
            <span className="seg kinds" role="group" aria-label="Einordnung" title={draft.kindFrom === "inhalt" ? "aus dem Inhalt erkannt – zum Ändern anklicken" : undefined}>
              {KINDS.map(([k, l]) => (
                <button key={k} className={k === "unklar" && symOverride?.aff === "N" ? "neutral" : k} aria-pressed={effKind === k} onClick={() => { setKind(k); inputRef.current?.focus(); }}>{k === "unklar" && symOverride?.aff === "N" ? "Neutral" : l}</button>
              ))}
            </span>
            {effKind !== "eigen" && draft.unit && draft.unit !== draft.melder && <span className="chip"><b>{draft.unit}</b></span>}
            <span className="symchipwrap">
              <button className={"chip symchip" + (symOverride ? " manual" : "")} onClick={(ev) => openPicker(ev.currentTarget)} title="Zeichen ändern" aria-expanded={pickOpen}>
                {choiceEntry && <span className="symmini" dangerouslySetInnerHTML={{ __html: !symOverride && draft.sidc ? iconSvg(draft.sym, draft.aff, 16, { sidc: draft.sidc, status: draft.status }).svg : choiceSvg(choiceEntry, choice!.aff, 16, { echelon: choice!.echelon, status: choice!.status }) }} />}
                {choiceDesc ?? choiceEntry?.name ?? symbolDef(draft.sym).name}{!choiceDesc && draft.count && draft.count > 1 ? ` ×${draft.count}` : ""} ▾
              </button>
              {pickOpen && choice && createPortal(
                <div className="sympop" style={pickPos && window.innerWidth > 560 ? ({ left: pickPos.left, top: pickPos.top, "--sp-maxh": `${pickPos.maxH}px` } as CSSProperties) : undefined}>
                  <SymbolPicker value={choice} onChange={(c) => setSymOverride(c)} onClose={() => { pickClosedAt.current = Date.now(); setPickOpen(false); inputRef.current?.focus(); }} />
                </div>
              , document.body)}
            </span>
            {(draft.dir !== undefined || draft.dirLabel) && <span className="chip" title="Bewegungsrichtung">{draft.dirLabel ?? `Rtg ${compass(draft.dir!)}`}</span>}
            {(draft.from !== undefined || draft.fromLabel) && <span className="chip" title="Herkunft (woher) – kein Bewegungspfeil">{draft.fromLabel ?? `aus ${compass(draft.from!)}`}</span>}
            {(() => {
              // «Melder fehlt» und «kein Ort» stehen schon als eigene Chips
              const m = draftMissing.filter((x) => x !== "Melder" && !(x === "Ort" && !effPos));
              return m.length > 0 && <span className="chip aeiou" title={`Unvollständig: ${m.join(", ")} – Rückfrage nach AEIOU (Wann · Wer tut was · Wie · Wo · Umwelt)`}>unvollständig: {m.join(", ")}</span>;
            })()}
            {draft.roadHint && <span className="chip soft" title="wird auf die passende Strasse gelegt">{draft.roadHint === "autobahn" ? "auf Autobahn" : "auf Hauptstrasse"}</span>}
            {effPos ? (roadTarget ? <RoadChoice where={effWhere0 ?? ""} res={roadRes} pick={roadPick} onPick={setRoadPick} onMap={pickOnMap} map={map} sheets={ex.sheets} /> : <span className="chip where">📍 {effWhere}</span>) : <span className="chip warn">kein Ort{draft.placeQuery ? ` («${draft.placeQuery}» nicht gefunden)` : ""}</span>}
            <button className="chipbtn" onClick={pickOnMap} disabled={picking}>{picking ? "Auf Karte klicken …" : effPos ? "Ort ändern" : "Ort auf Karte"}</button>
            <ShapeButton map={map} sym={choice?.key ?? draft.sym} value={shapeDraft} onChange={setShapeDraft} color={effKind ? KIND_COLOR[effKind] : undefined} owner="neu"
              ctx={{ sheets: ex.sheets, areas: ex.areas, event: { sym: choice?.key ?? draft.sym, pos: effPos, cells: draft.cells, nai: draft.nai, where: effWhere, angle: road?.angle, dir: draft.dir } }} />
          </div>
        ) : (
          <p className="help">Zeit · Melder · was · wo – z. B. <span className="mono">1015 H04 2 Fz in NAI 3 Rtg N</span>. Ort als Planquadrat, NAI, Koordinate oder Ortsname. Ob eigene Lage oder Feind, erkenne ich aus dem Inhalt. <b>Enter</b> = eintragen · <b>↑</b> = letzte korrigieren · <b>N</b> = zurück ins Feld.</p>
        )}
        <div className="btnrow">
          <button className="primary" disabled={!draft} onClick={add}>Eintragen</button>
          {manualPos && <span className="help mono">{formatLv95(manualPos)}</span>}
        </div>
      </div>

      <div className="btnrow filters">
        <div className="seg" role="group" aria-label="Filter">
          {(["alle", "eigen", "feind", "unklar"] as const).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "alle" ? "Alle" : KINDS.find((k) => k[0] === f)![1]}</button>)}
        </div>
        <input className="aname" placeholder="Suchen …" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Journal durchsuchen" />
      </div>
      {win && <WindowHint events={events} from={win.from} to={win.to} onClear={onWinClear} />}

      {list.length === 0 ? (
        <div className="empty"><p>{events.length ? "Keine Einträge für diesen Filter." : "Noch keine Meldungen. Oben eintippen und Enter drücken."}</p></div>
      ) : (
        <ol className="jlist" ref={listRef}>
          {list.map((e, i) => {
            const hour = e.t.slice(0, 13);
            const head = i === 0 || list[i - 1]!.t.slice(0, 13) !== hour;
            const k = kindOf(e);
            const age = Date.now() - Date.parse(e.updatedAt);
            const fresh = age >= 0 && age < 10 * 60000;
            return (
              <Fragment key={e.id}>
                {head && <li className="hourhead" aria-hidden="true">{dayLabel(e.t, ex.days)} {e.t.slice(11, 13)}:00</li>}
                {editing === e.id ? (
                  <EditRow e={e} ex={ex} map={map} onCancel={() => setEditing(null)} onSave={(p) => { patch(e.id, p); setEditing(null); }} />
                ) : (
                  <li data-id={e.id} className={"jrow " + k + (e.id === selected ? " sel" : "") + (e.id === flashId ? " flash" : "")} tabIndex={0}
                    onClick={() => onSelect(e.id)} onKeyDown={(ev) => { if (ev.key === "Enter") onSelect(e.id); }}>
                    <span className="sbar" style={{ background: kindColor(e) }} />
                    <span className="jt tnum">{e.t.slice(11, 16)}</span>
                    <span className="ju">
                      <b style={{ color: kindVar(e) }}>{e.unit || (k === "eigen" ? e.melder : kindText(e))}</b>
                      {e.melder && e.melder !== e.unit && <small>via {e.melder}</small>}
                    </span>
                    <span className="jb">
                      <span className="jtext" title={e.desc ? `${e.desc} – ${e.text}` : e.text}><SymbolMini k={e.sym} aff={e.aff} sidc={e.sidc} status={e.status} />{displayText(e)}</span>
                      <span className="jmeta">
                        {(e.cells ?? []).slice(0, 2).map((c) => <span key={c} className="pq">{c}</span>)}
                        {e.nai && <span className="naichip">{e.nai}</span>}
                        {!e.cells?.length && !e.nai && (e.where ? <span className="wh">{e.where}</span> : <span className="wh warn">ohne Ort</span>)}
                        {quality && <QualityMarks e={e} q={quality.get(e.id)} events={events} />}
                        {fresh && <span className="newdot" title="in den letzten 10 Minuten erfasst">neu</span>}
                      </span>
                    </span>
                    <span className="acts">
                      <button title="Bearbeiten" onClick={(ev) => { ev.stopPropagation(); setEditing(e.id); }}>✎</button>
                      <button title="Löschen" className="danger" onClick={(ev) => { ev.stopPropagation(); removeWithUndo(e.id); }}>✕</button>
                    </span>
                  </li>
                )}
              </Fragment>
            );
          })}
        </ol>
      )}

      {undo && (
        <div className="undobar" role="status">
          <span>Eintrag gelöscht</span>
          <button onClick={() => { patch(undo, { deleted: false }); setUndo(null); }}>Rückgängig</button>
        </div>
      )}

      <div className="btnrow foot">
        <span className="help">{(() => { const n = events.filter((e) => !e.deleted).length; return `${n} ${n === 1 ? "Eintrag" : "Einträge"}`; })()}
          {(() => { const u = quality ? events.filter((e) => !e.deleted && quality.get(e.id)?.status === "unbestaetigt").length : 0; return u > 0 || filter === "unbest" ? <> · <button className="linkbtn" aria-pressed={filter === "unbest"} title="Sichtungen aus nur einer Quelle – bestätigt, sobald ein zweiter Melder dasselbe in der Nähe meldet" onClick={() => setFilter(filter === "unbest" ? "alle" : "unbest")}>{filter === "unbest" ? "alle zeigen" : `${u} unbestätigt`}</button></> : null; })()}</span>
        <button onClick={() => onExport("csv")} disabled={!events.length}>CSV</button>
        <button onClick={() => onExport("pdf")} disabled={!events.length}>PDF</button>
      </div>
    </div>
  );
}

function EditRow({ e, ex, map, onCancel, onSave }: { e: LageEvent; ex: Exercise; map: L.Map; onCancel: () => void; onSave: (p: Partial<LageEvent>) => void }) {
  const [time, setTime] = useState(e.t.slice(11, 16));
  const [day, setDay] = useState(e.t.slice(0, 10));
  const [unit, setUnit] = useState(e.unit);
  const [melder, setMelder] = useState(e.melder ?? "");
  const [text, setText] = useState(e.text);
  // Zeichen und Art bleiben synchron: Art = Zugehörigkeit (F eigen, H Feind, U/N unklar)
  const initial = useMemo(() => {
    const aff: Affiliation = e.side === "blau" ? "F" : e.aff === "F" ? "H" : e.aff;
    return makeChoice(pickerEntry(e.sym) ?? pickerEntry("einheit")!, aff, e.echelon, e.status);
  }, [e]);
  const [choice, setChoice] = useState<SymbolChoice>(initial);
  const kind = kindOfAff(choice.aff);
  const setKind = (k: Kind) => setChoice((c) => makeChoice(pickerEntry(c.key) ?? pickerEntry("einheit")!, affOfKind(k, c.aff), c.echelon, c.status));
  const [count, setCount] = useState(e.count ?? 0);
  const [pos, setPos] = useState<LV95 | undefined>(e.pos);
  const [where, setWhere] = useState(e.where);
  const [picking, setPicking] = useState(false);
  /** Fläche/Linie: von Hand gezeichnet (auto: false) – Punktzeichen dann am Schwerpunkt */
  const [shape, setShape] = useState(e.shape);
  /** Planquadrat nach dem Zeichnen (Schwerpunkt der Form) */
  const [cells, setCells] = useState(e.cells);
  /** Strassenwahl beim Bearbeiten (gilt nur, solange der Ort nicht anders geändert wurde) */
  const [roadPatch, setRoadPatch] = useState<RoadPatch | null>(null);
  const days = ex.days.includes(day) ? ex.days : [...ex.days, day];
  const save = () => {
    // Fläche/Linie wird noch gezeichnet: zuerst abschliessen und übernehmen
    const drawn = takeDrawing(`edit:${e.id}`);
    if (drawn === "unfertig") return;
    const dp = drawn ? shapePatch(drawn, ex.sheets) : null;
    const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(time.trim());
    const minutes = m ? Math.min(23, +m[1]!) * 60 + Math.min(59, +m[2]!) : minutesOf(e.t);
    const entry = pickerEntry(choice.key) ?? pickerEntry("einheit")!;
    // SIDC immer neu aus Zeichen + Zugehörigkeit + Stufe + Status (nie einen alten SIDC mit alter Zugehörigkeit behalten)
    const c0 = makeChoice(entry, choice.aff, choice.echelon, choice.status);
    // gleiches Zeichen: erkannten SIDC (z. B. Kolonne «Lastwagen») behalten, nur Zugehörigkeit/Status/Stufe anpassen
    const c = c0.key === e.sym ? { ...c0, sidc: rebaseSidc(e.sidc, c0) ?? c0.sidc } : c0;
    const n = count > 0 ? count : undefined;
    const same = c.key === e.sym && c.aff === e.aff && c.echelon === e.echelon && (c.status ?? "present") === (e.status ?? "present") && n === e.count;
    const side = sideOfAff(c.aff);
    const u = unit.trim() || (side === "blau" ? melder.trim() : "");
    const moved = (dp?.pos ?? pos)?.e !== e.pos?.e || (dp?.pos ?? pos)?.n !== e.pos?.n;
    onSave({
      t: isoOf(day, minutes), side, unit: u, melder: melder.trim() || undefined, text, count: n, label: n && n > 1 ? String(n) : undefined,
      sym: c.key, sidc: c.sidc, echelon: c.echelon, status: c.status, aff: c.aff,
      // ausgeschriebenen Sinn nur neu bilden, wenn sich am Zeichen etwas geändert hat (sonst bleibt «mögliche IED» usw.)
      desc: same && e.desc ? e.desc : choiceText(c, n),
      pos, where,
      // von Hand verschoben: Ausrichtung auf der alten Strasse gilt nicht mehr
      ...(moved ? { angle: undefined, road: undefined } : {}),
      ...(roadPatch && pos === roadPatch.pos ? { angle: roadPatch.angle, road: roadPatch.road, roadNone: roadPatch.roadNone, ...(roadPatch.cells ? { cells: roadPatch.cells } : {}) } : {}),
      ...(shape !== e.shape ? { shape } : {}),
      ...(cells !== e.cells ? { cells } : {}),
      ...(dp ?? {}),
    });
  };
  return (
    <li className="edit">
      <div className="form">
        <div className="two">
          <label>Zeit<input value={time} onChange={(x) => setTime(x.target.value)} className="mono" /></label>
          <label>Tag<select value={day} onChange={(x) => setDay(x.target.value)}>{days.map((d, i) => <option key={d} value={d}>T{i + 1} · {d.slice(8, 10)}.{d.slice(5, 7)}.</option>)}</select></label>
        </div>
        <div className="two">
          <label>Art<select value={kind} onChange={(x) => setKind(x.target.value as Kind)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{k === "unklar" && choice.aff === "N" ? "Unklar (neutral)" : l}</option>)}</select></label>
          <label>Melder<input value={melder} onChange={(x) => setMelder(x.target.value)} /></label>
        </div>
        <div className="two">
          <label>Element auf der Karte<input value={unit} onChange={(x) => setUnit(x.target.value)} placeholder={kind === "eigen" ? "= Melder" : "leer = einzelne Sichtung"} /></label>
          <label>Anzahl<input type="number" min={0} value={count || ""} onChange={(x) => setCount(+x.target.value)} /></label>
        </div>
        <label>Meldung<input value={text} onChange={(x) => setText(x.target.value)} /></label>
        <div className="editpick">
          <span className="help">Zeichen</span>
          <SymbolPicker anchor="inline" compact value={choice} onChange={setChoice} />
        </div>
        <div className="btnrow">
          {pos && where !== "Karte"
            ? <RoadEdit e={e} ex={ex} map={map} symKey={choice.key} text={text} where={where}
                onChange={(p) => { setRoadPatch(p); setPos(p.pos); setWhere(p.where); }}
                fallback={<span className="help">📍 {where ?? formatLv95(pos)}</span>} />
            : <span className="help">{pos ? `📍 ${where ?? formatLv95(pos)}` : "ohne Ort"}</span>}
          <button disabled={picking} onClick={async () => { setPicking(true); const p = await pickPoint(map); setPicking(false); if (p) { setPos(p); setWhere("Karte"); } }}>{picking ? "Auf Karte klicken …" : "Ort auf Karte"}</button>
          {pos && <button onClick={() => { setPos(undefined); setWhere(undefined); }}>Ort entfernen</button>}
          <ShapeButton map={map} sym={choice.key} value={shape?.auto ? undefined : shape} className="" color={KIND_COLOR[kind]} owner={`edit:${e.id}`}
            ctx={{ sheets: ex.sheets, areas: ex.areas, event: { ...e, sym: choice.key, pos, where, cells, shape } }}
            onChange={(sh) => {
              if (!sh) { setShape(undefined); return; }
              const p = shapePatch(sh, ex.sheets);
              setShape(sh); setPos(p.pos); setWhere(p.where); setCells(p.cells);
            }} />
        </div>
        <div className="btnrow">
          <button className="primary" onClick={save}>Speichern</button>
          <button onClick={onCancel}>Abbrechen</button>
        </div>
      </div>
    </li>
  );
}

/** Anzeigetext ohne vorangestellten Melder («H01 4 Pers …» → «4 Pers …»), der Melder steht separat */
function displayText(e: LageEvent): string {
  const m = e.melder;
  if (!m) return e.text;
  const re = new RegExp("^" + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*") + "\\s*[:,]?\\s*", "i");
  const t = e.text.replace(re, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : e.text;
}
