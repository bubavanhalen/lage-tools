/**
 * Lagejournal: Meldungen eingeben (eine Zeile pro Meldung), Erkennung prüfen, Liste führen.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  SYMBOLS,
  eventFromDraft,
  formatLv95,
  isoOf,
  kindLabel,
  lastPosition,
  minutesOf,
  parseMeldung,
  reviseEvent,
  sheetBounds,
  symbolDef,
  type Draft,
  type Exercise,
  type Kind,
  type LageEvent,
  type LV95,
  type Side,
} from "@lage/core";
import { pickPoint, symbolSvg, toLatLng, toLv95 } from "@lage/map";
import { dayLabel } from "./Timeline";

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
}

/** Auf Handy/Tablet nicht automatisch fokussieren (sonst springt die Seite und die Tastatur geht auf) */
const wideScreen = typeof window !== "undefined" && window.innerWidth >= 860 && !window.matchMedia?.("(pointer: coarse)").matches;
const KINDS: Array<[Kind, string]> = [["eigen", "Eigene"], ["feind", "Feind"], ["unklar", "Unklar"]];
export const KIND_COLOR: Record<Kind, string> = { eigen: "#1f5fb8", feind: "#c8102e", unklar: "#b8860b" };
const kindOf = (e: Pick<LageEvent, "side" | "aff">): Kind => (e.side === "blau" ? "eigen" : e.aff === "U" ? "unklar" : "feind");
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

function SymbolMini({ k, aff }: { k: string; aff: LageEvent["aff"] }) {
  const s = useMemo(() => symbolSvg(k, aff, 14), [k, aff]);
  return <span className="symmini" dangerouslySetInnerHTML={{ __html: s.svg }} />;
}

export function JournalPanel({ ex, map, device, selected, onSelect, update, say, onExport, reportAt, editRequest, onGoto, onDemo }: Props) {
  const events = ex.events ?? [];
  const [kindOverride, setKindOverride] = useState<Kind | null>(null);
  const [day, setDay] = useState(() => (ex.days.includes(todayIso()) ? todayIso() : ex.days[ex.days.length - 1] ?? todayIso()));
  const [text, setText] = useState("");
  const [manualPos, setManualPos] = useState<LV95 | null>(null);
  const [found, setFound] = useState<{ q: string; name: string; pos: LV95 } | null>(null);
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState<"alle" | Kind>("alle");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [confirmNoMelder, setConfirmNoMelder] = useState(false);

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
  const effPos = manualPos ?? (found && draft?.placeQuery === found.q && (!draft.pos || draft.where?.kind === "zuletzt") ? found.pos : draft?.pos);
  const effWhere = manualPos ? "Karte" : found && effPos === found.pos ? found.name : draft?.where?.label;

  const pickOnMap = async () => {
    setPicking(true);
    const p = await pickPoint(map);
    setPicking(false);
    if (p) setManualPos(p);
    inputRef.current?.focus();
  };

  const add = () => {
    if (!draft) return;
    if (!draft.melder && !confirmNoMelder) { setConfirmNoMelder(true); return; }
    setConfirmNoMelder(false);
    const ev = eventFromDraft({ ...draft, pos: effPos, where: effWhere ? { kind: manualPos ? "karte" : "ort", label: effWhere } : undefined }, device);
    update((x) => {
      x.events = [...(x.events ?? []), ev];
      if (!x.days.includes(ev.t.slice(0, 10))) x.days = [...x.days, ev.t.slice(0, 10)].sort();
      const remember = (side: Side, u?: string) => { if (u && !x.units[side].some((v) => v.toLowerCase() === u.toLowerCase())) x.units[side] = [...x.units[side], u]; };
      remember("blau", ev.melder);
      remember(ev.side, ev.unit);
      if (found && effPos === found.pos && !(x.places ?? []).some((p) => p.name === found.name)) x.places = [...(x.places ?? []), { name: found.name, pos: found.pos }];
      return x;
    });
    setText(""); setManualPos(null); setFound(null); setKindOverride(null);
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
      .filter((e) => !e.deleted && (filter === "alle" || kindOf(e) === filter) && (!q || `${e.unit} ${e.melder ?? ""} ${e.text} ${e.where ?? ""} ${(e.cells ?? []).join(" ")}`.toLowerCase().includes(q)))
      .sort((a, b) => b.t.localeCompare(a.t) || b.id.localeCompare(a.id));
  }, [events, filter, search]);

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
      <div className="entry" style={{ borderColor: draft ? KIND_COLOR[draft.kind] : undefined }}>
        <div className="btnrow">
          <b className="entry-title">Meldung</b>
          <select value={day} onChange={(e) => (e.target.value === "__add" ? addDay() : setDay(e.target.value))} aria-label="Übungstag">
            {ex.days.map((d, i) => <option key={d} value={d}>T{i + 1} · {d.slice(8, 10)}.{d.slice(5, 7)}.</option>)}
            <option value="__add">+ Tag</option>
          </select>
        </div>
        <textarea ref={inputRef} className="msg" value={text} autoFocus={wideScreen} rows={1} placeholder={wideScreen ? "z. B. 1015 H04 2 Fz in NAI 3 Rtg N" : "1015 H04 2 Fz NAI 3"} aria-label="Meldung"
          onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 96) + "px"; }}
          onChange={(e) => { setText(e.target.value.replace(/\n/g, " ")); setConfirmNoMelder(false); if (!e.target.value) { setManualPos(null); setKindOverride(null); e.target.style.height = "auto"; } }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); }
            if (e.key === "Escape") { setText(""); setManualPos(null); setKindOverride(null); }
            // ↑ in leerer Zeile: letzte Meldung zum Korrigieren öffnen
            if (e.key === "ArrowUp" && !text) { const last = [...events].filter((x) => !x.deleted).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]; if (last) { e.preventDefault(); setEditing(last.id); onSelect(last.id); } }
            // Alt+1/2/3: Einordnung festlegen
            if (e.altKey && ["1", "2", "3"].includes(e.key)) { e.preventDefault(); setKindOverride(KINDS[+e.key - 1]![0]); }
          }} />
        {draft ? (
          <div className="preview">
            <span className={"chip" + (draft.timeFromText ? "" : " soft")} title={draft.timeFromText ? "Zeit aus der Meldung" : "keine Zeit genannt – jetzt"}>{dayLabel(draft.t, ex.days)} {draft.t.slice(11, 16)}</span>
            {draft.melder ? <span className="chip" title="eigenes Element, das meldet">Melder <b>{draft.melder}</b></span>
              : <span className={"chip " + (confirmNoMelder ? "err" : "warnsoft")} title="Wer meldet? z. B. «H04» an den Anfang">{confirmNoMelder ? "Ohne Melder? Nochmals Enter" : "Melder fehlt"}</span>}
            {future && <span className="chip warnsoft" title="Zeit liegt nach jetzt">liegt in der Zukunft – Vortag?</span>}
            <span className="seg kinds" role="group" aria-label="Einordnung" title={draft.kindFrom === "inhalt" ? "aus dem Inhalt erkannt – zum Ändern anklicken" : undefined}>
              {KINDS.map(([k, l]) => (
                <button key={k} className={k} aria-pressed={draft.kind === k} onClick={() => { setKindOverride(k); inputRef.current?.focus(); }}>{l}</button>
              ))}
            </span>
            {draft.kind !== "eigen" && draft.unit && <span className="chip"><b>{draft.unit}</b></span>}
            <span className="chip"><SymbolMini k={draft.sym} aff={draft.aff} /> {symbolDef(draft.sym).name}{draft.count && draft.count > 1 ? ` ×${draft.count}` : ""}</span>
            {(draft.dir !== undefined || draft.dirLabel) && <span className="chip">{draft.dirLabel ?? `Rtg ${["N", "NO", "O", "SO", "S", "SW", "W", "NW"][Math.round(draft.dir! / 45) % 8]}`}</span>}
            {effPos ? <span className="chip where">📍 {effWhere}</span> : <span className="chip warn">kein Ort{draft.placeQuery ? ` («${draft.placeQuery}» nicht gefunden)` : ""}</span>}
            <button className="chipbtn" onClick={pickOnMap} disabled={picking}>{picking ? "Auf Karte klicken …" : effPos ? "Ort ändern" : "Ort auf Karte"}</button>
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
                    <span className="sbar" style={{ background: KIND_COLOR[k] }} />
                    <span className="jt tnum">{e.t.slice(11, 16)}</span>
                    <span className="ju">
                      <b style={{ color: k === "eigen" ? "var(--blau)" : k === "feind" ? "var(--rot)" : "var(--unklar)" }}>{e.unit || (k === "eigen" ? e.melder : kindLabel(e))}</b>
                      {e.melder && e.melder !== e.unit && <small>via {e.melder}</small>}
                    </span>
                    <span className="jb">
                      <span className="jtext" title={e.text}><SymbolMini k={e.sym} aff={e.aff} />{displayText(e)}</span>
                      <span className="jmeta">
                        {(e.cells ?? []).slice(0, 2).map((c) => <span key={c} className="pq">{c}</span>)}
                        {e.nai && <span className="naichip">{e.nai}</span>}
                        {!e.cells?.length && !e.nai && (e.where ? <span className="wh">{e.where}</span> : <span className="wh warn">ohne Ort</span>)}
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
        <span className="help">{(() => { const n = events.filter((e) => !e.deleted).length; return `${n} ${n === 1 ? "Eintrag" : "Einträge"}`; })()}</span>
        <button onClick={() => onExport("csv")} disabled={!events.length}>CSV</button>
        <button onClick={() => onExport("pdf")} disabled={!events.length}>PDF</button>
      </div>
    </div>
  );
}

function EditRow({ e, ex, map, onCancel, onSave }: { e: LageEvent; ex: Exercise; map: L.Map; onCancel: () => void; onSave: (p: Partial<LageEvent>) => void }) {
  const [time, setTime] = useState(e.t.slice(11, 16));
  const [day, setDay] = useState(e.t.slice(0, 10));
  const [kind, setKind] = useState<Kind>(kindOf(e));
  const [unit, setUnit] = useState(e.unit);
  const [melder, setMelder] = useState(e.melder ?? "");
  const [text, setText] = useState(e.text);
  const [sym, setSym] = useState(e.sym);
  const [count, setCount] = useState(e.count ?? 0);
  const [pos, setPos] = useState<LV95 | undefined>(e.pos);
  const [where, setWhere] = useState(e.where);
  const [picking, setPicking] = useState(false);
  const days = ex.days.includes(day) ? ex.days : [...ex.days, day];
  const save = () => {
    const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(time.trim());
    const minutes = m ? Math.min(23, +m[1]!) * 60 + Math.min(59, +m[2]!) : minutesOf(e.t);
    onSave({
      t: isoOf(day, minutes), side: kind === "eigen" ? "blau" : "rot", unit: unit.trim(), melder: melder.trim() || undefined, text, sym, count: count > 0 ? count : undefined, label: count > 1 ? String(count) : undefined,
      aff: kind === "eigen" ? "F" : kind === "feind" ? "H" : "U", pos, where,
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
          <label>Art<select value={kind} onChange={(x) => setKind(x.target.value as Kind)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Melder<input value={melder} onChange={(x) => setMelder(x.target.value)} /></label>
        </div>
        <div className="two">
          <label>Element auf der Karte<input value={unit} onChange={(x) => setUnit(x.target.value)} placeholder={kind === "eigen" ? "= Melder" : "leer = einzelne Sichtung"} /></label>
          <span />
        </div>
        <label>Meldung<input value={text} onChange={(x) => setText(x.target.value)} /></label>
        <div className="two">
          <label>Zeichen<select value={sym} onChange={(x) => setSym(x.target.value)}>{SYMBOLS.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label>
          <label>Anzahl<input type="number" min={0} value={count || ""} onChange={(x) => setCount(+x.target.value)} /></label>
        </div>
        <div className="btnrow">
          <span className="help">{pos ? `📍 ${where ?? formatLv95(pos)}` : "ohne Ort"}</span>
          <button disabled={picking} onClick={async () => { setPicking(true); const p = await pickPoint(map); setPicking(false); if (p) { setPos(p); setWhere("Karte"); } }}>{picking ? "Auf Karte klicken …" : "Ort auf Karte"}</button>
          {pos && <button onClick={() => { setPos(undefined); setWhere(undefined); }}>Ort entfernen</button>}
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
