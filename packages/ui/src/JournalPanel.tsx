/**
 * Lagejournal: Meldungen eingeben (eine Zeile pro Meldung), Erkennung prüfen, Liste führen.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  SYMBOLS,
  eventFromDraft,
  formatLv95,
  isoOf,
  lastPosition,
  minutesOf,
  parseMeldung,
  reviseEvent,
  sheetBounds,
  symbolDef,
  type Draft,
  type Exercise,
  type LageEvent,
  type LV95,
  type Side,
} from "@lage/core";
import { pickPoint, symbolSvg, toLatLng, toLv95 } from "@lage/map";
import { dayLabel } from "./Timeline";
import { SIDE_COLOR } from "./journalLayer";

interface Props {
  ex: Exercise;
  map: L.Map;
  device: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  update: (f: (x: Exercise) => Exercise) => void;
  say: (t: string) => void;
  onExport: (kind: "csv" | "pdf") => void;
}

const SIDES: Array<[Side, string]> = [["rot", "Rot"], ["blau", "Blau"], ["ul", "UL"]];
const sideName = (s: Side) => (s === "rot" ? "Rot" : s === "blau" ? "Blau" : "UL");
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

export function JournalPanel({ ex, map, device, selected, onSelect, update, say, onExport }: Props) {
  const events = ex.events ?? [];
  const [side, setSide] = useState<Side>("rot");
  const [day, setDay] = useState(() => (ex.days.includes(todayIso()) ? todayIso() : ex.days[ex.days.length - 1] ?? todayIso()));
  const [text, setText] = useState("");
  const [manualPos, setManualPos] = useState<LV95 | null>(null);
  const [found, setFound] = useState<{ q: string; name: string; pos: LV95 } | null>(null);
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState<"alle" | Side>("alle");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!ex.days.includes(day)) setDay(ex.days[ex.days.length - 1] ?? todayIso()); }, [ex.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = useMemo(() => ({
    sheets: ex.sheets, areas: ex.areas, units: ex.units, places: ex.places ?? [], side, days: ex.days, day, now: new Date(),
    lastPos: (u: string, s: Side) => lastPosition(events, s, u),
  }), [ex, side, day, events]);
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
    const ev = eventFromDraft({ ...draft, pos: effPos, where: effWhere ? { kind: manualPos ? "karte" : "ort", label: effWhere } : undefined }, device);
    update((x) => {
      x.events = [...(x.events ?? []), ev];
      if (!x.days.includes(ev.t.slice(0, 10))) x.days = [...x.days, ev.t.slice(0, 10)].sort();
      if (ev.unit && !x.units[ev.side].some((u) => u.toLowerCase() === ev.unit.toLowerCase())) x.units[ev.side] = [...x.units[ev.side], ev.unit];
      if (found && effPos === found.pos && !(x.places ?? []).some((p) => p.name === found.name)) x.places = [...(x.places ?? []), { name: found.name, pos: found.pos }];
      return x;
    });
    setText(""); setManualPos(null); setFound(null);
    onSelect(ev.id);
    if (ev.pos && !map.getBounds().contains(toLatLng(ev.pos))) map.panTo(toLatLng(ev.pos));
    if (!ev.pos) say("Eingetragen – ohne Ort. Mit ✎ kann der Ort später auf der Karte gesetzt werden.");
    inputRef.current?.focus();
  };

  const patch = (id: string, p: Partial<LageEvent>) => update((x) => { x.events = (x.events ?? []).map((e) => (e.id === id ? reviseEvent(e, p, device) : e)); return x; });
  const remove = (id: string) => patch(id, { deleted: true });

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events
      .filter((e) => !e.deleted && (filter === "alle" || e.side === filter) && (!q || `${e.unit} ${e.text} ${e.where ?? ""}`.toLowerCase().includes(q)))
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
      <div className="entry" style={{ borderColor: SIDE_COLOR[draft?.side ?? side] }}>
        <div className="btnrow">
          <div className="seg sides" role="group" aria-label="Seite">
            {SIDES.map(([s, l]) => <button key={s} className={s} aria-pressed={side === s} onClick={() => { setSide(s); inputRef.current?.focus(); }}>{l}</button>)}
          </div>
          <select value={day} onChange={(e) => (e.target.value === "__add" ? addDay() : setDay(e.target.value))} aria-label="Übungstag">
            {ex.days.map((d, i) => <option key={d} value={d}>T{i + 1} · {d.slice(8, 10)}.{d.slice(5, 7)}.</option>)}
            <option value="__add">+ Tag</option>
          </select>
        </div>
        <input ref={inputRef} className="msg" value={text} autoFocus placeholder="z. B. 1015 2 Fz in NAI 3 Rtg N" aria-label="Meldung"
          onChange={(e) => { setText(e.target.value); if (!e.target.value) setManualPos(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") { setText(""); setManualPos(null); } }} />
        {draft ? (
          <div className="preview">
            <span className={"chip" + (draft.timeFromText ? "" : " soft")} title={draft.timeFromText ? "Zeit aus der Meldung" : "keine Zeit genannt – jetzt"}>{dayLabel(draft.t, ex.days)} {draft.t.slice(11, 16)}</span>
            <span className="chip side" style={{ background: SIDE_COLOR[draft.side] }}>{sideName(draft.side)}</span>
            {draft.unit && <span className="chip"><b>{draft.unit}</b></span>}
            <span className="chip"><SymbolMini k={draft.sym} aff={draft.aff} /> {symbolDef(draft.sym).name}{draft.count && draft.count > 1 ? ` ×${draft.count}` : ""}</span>
            {(draft.dir !== undefined || draft.dirLabel) && <span className="chip">{draft.dirLabel ?? `Rtg ${["N", "NO", "O", "SO", "S", "SW", "W", "NW"][Math.round(draft.dir! / 45) % 8]}`}</span>}
            {effPos ? <span className="chip where">📍 {effWhere}</span> : <span className="chip warn">kein Ort{draft.placeQuery ? ` («${draft.placeQuery}» nicht gefunden)` : ""}</span>}
            <button className="chipbtn" onClick={pickOnMap} disabled={picking}>{picking ? "Auf Karte klicken …" : effPos ? "Ort ändern" : "Ort auf Karte"}</button>
          </div>
        ) : (
          <p className="help">Zeit · (Rot/Blau) · Element · was · wo. Ort als Planquadrat, NAI, Koordinate oder Ortsname. <b>Enter</b> = eintragen.</p>
        )}
        <div className="btnrow">
          <button className="primary" disabled={!draft} onClick={add}>Eintragen</button>
          {manualPos && <span className="help mono">{formatLv95(manualPos)}</span>}
        </div>
      </div>

      <div className="btnrow filters">
        <div className="seg" role="group" aria-label="Filter">
          {(["alle", "rot", "blau", "ul"] as const).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "alle" ? "Alle" : sideName(f)}</button>)}
        </div>
        <input className="aname" placeholder="Suchen …" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Journal durchsuchen" />
      </div>

      {list.length === 0 ? (
        <div className="empty"><p>{events.length ? "Keine Einträge für diesen Filter." : "Noch keine Meldungen. Oben eintippen und Enter drücken."}</p></div>
      ) : (
        <ol className="jlist">
          {list.map((e) => editing === e.id ? (
            <EditRow key={e.id} e={e} ex={ex} map={map} onCancel={() => setEditing(null)} onSave={(p) => { patch(e.id, p); setEditing(null); }} />
          ) : (
            <li key={e.id} className={(e.id === selected ? "sel " : "") + e.side} onClick={() => { onSelect(e.id); if (e.pos) map.panTo(toLatLng(e.pos)); }}>
              <span className="sbar" style={{ background: SIDE_COLOR[e.side] }} />
              <span className="time mono">{dayLabel(e.t, ex.days)}<br />{e.t.slice(11, 16)}</span>
              <span className="body">
                <span className="head"><SymbolMini k={e.sym} aff={e.aff} />{e.unit && <b>{e.unit}</b>}{e.where ? <span className="wh">{e.where}</span> : <span className="wh warn">ohne Ort</span>}</span>
                <span className="txt">{e.text}</span>
              </span>
              <span className="acts">
                <button title="Bearbeiten" onClick={(ev) => { ev.stopPropagation(); setEditing(e.id); }}>✎</button>
                <button title="Löschen" className="danger" onClick={(ev) => { ev.stopPropagation(); if (window.confirm("Eintrag löschen?")) remove(e.id); }}>✕</button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="btnrow foot">
        <span className="help">{events.filter((e) => !e.deleted).length} Einträge</span>
        <button onClick={() => onExport("csv")} disabled={!events.length}>CSV</button>
        <button onClick={() => onExport("pdf")} disabled={!events.length}>PDF</button>
      </div>
    </div>
  );
}

function EditRow({ e, ex, map, onCancel, onSave }: { e: LageEvent; ex: Exercise; map: L.Map; onCancel: () => void; onSave: (p: Partial<LageEvent>) => void }) {
  const [time, setTime] = useState(e.t.slice(11, 16));
  const [day, setDay] = useState(e.t.slice(0, 10));
  const [side, setSide] = useState<Side>(e.side);
  const [unit, setUnit] = useState(e.unit);
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
      t: isoOf(day, minutes), side, unit: unit.trim(), text, sym, count: count > 0 ? count : undefined, label: count > 1 ? String(count) : undefined,
      aff: e.aff === "U" ? "U" : side === "rot" ? "H" : side === "blau" ? "F" : "N", pos, where,
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
          <label>Seite<select value={side} onChange={(x) => setSide(x.target.value as Side)}>{SIDES.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select></label>
          <label>Element<input value={unit} onChange={(x) => setUnit(x.target.value)} /></label>
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
