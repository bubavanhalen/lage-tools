/**
 * Zeichen-Auswahl: Sofortsuche («Halbzug», «IED», «pz gren», «sperre»), Kategorien, Raster mit Vorschau,
 * Zugehörigkeit (Eigene/Feind/Unklar/Neutral), Stufe (Trp … Br, nur bei Einheiten), «vermutet» (gestrichelt).
 * Zuletzt benutzte Zeichen stehen oben. Tastatur: Pfeile = wählen, Enter = übernehmen, Esc = schliessen.
 * Einsatz als Popover (schliesst bei Klick daneben / Esc) oder inline (Bearbeiten-Formular).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import ms from "milsymbol";
import {
  buildSidc,
  CATALOG,
  catalogEntry,
  ECHELONS,
  searchTactical,
  SYMBOLS,
  type Affiliation,
  type CatalogEntry,
  type Echelon,
  type Status,
} from "@lage/core";
import { germanPin, shapeIconSvg, symbolSvg } from "@lage/map";
import { IconClose, IconSearch } from "./navicons";
import { softHyphens } from "./hyphen";
import "./symbolpicker.css";

export interface SymbolChoice {
  key: string;
  sidc: string;
  echelon?: Echelon;
  status?: Status;
  aff: Affiliation;
}

export interface SymbolPickerProps {
  value: SymbolChoice;
  onChange: (c: SymbolChoice) => void;
  onClose?: () => void;
  /** «popover»: schwebend, schliesst bei Klick daneben/Esc; «inline»: im Formular (Standard: popover) */
  anchor?: "popover" | "inline";
  /** kleinere Kacheln */
  compact?: boolean;
}

export const AFFILIATIONS: Array<{ aff: Affiliation; label: string; title: string }> = [
  { aff: "F", label: "Eigene", title: "Eigene Kräfte (blau)" },
  { aff: "H", label: "Feind", title: "Feind (rot)" },
  { aff: "U", label: "Unklar", title: "Zugehörigkeit unklar (gelb)" },
  { aff: "N", label: "Neutral", title: "Neutral / Zivil / UL (grün)" },
];

/** Stufen für die Auswahl (Div gibt es auf Kp-Stufe nicht in der Auswahl) */
const PICK_ECHELONS = ECHELONS.filter((e) => e.key !== "div");
const ECH_SHORT: Record<string, string> = { trp: "Trp", gr: "Gr", hz: "Hz", zug: "Zug", kp: "Kp", bat: "Bat", rgt: "Rgt", br: "Br" };

const RECENT_KEY = "lage-tools.symbols.recent";
const RECENT_MAX = 8;

function loadRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}
function pushRecent(key: string): string[] {
  const next = [key, ...loadRecent().filter((k) => k !== key)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* egal */ }
  return next;
}

/** Eintrag zu einem Schlüssel – auch für alte Schlüssel aus `SYMBOLS` (gespeicherte Übungen). */
export function pickerEntry(key: string): CatalogEntry | undefined {
  const c = catalogEntry(key) ?? CATALOG.find((e) => e.key === key);
  if (c) return c;
  const old = SYMBOLS.find((s) => s.key === key);
  if (!old) return undefined;
  return {
    key: old.key, name: old.name, category: "Allgemein", sidc: old.sidc, aliases: [], kind: old.activity ? "taetigkeit" : "einheit",
    triangle: old.triangle, activity: old.activity, echelonable: old.sidc.startsWith("S") && old.sidc[2] === "G" && old.sidc[4] === "U",
  };
}

/** Auswahl vervollständigen (SIDC neu bilden, Stufe nur bei Einheiten). */
export function makeChoice(entry: CatalogEntry, aff: Affiliation, echelon?: Echelon, status?: Status): SymbolChoice {
  const ech = entry.echelonable ? echelon : undefined;
  return { key: entry.key, aff, echelon: ech, status, sidc: buildSidc(entry, aff, { echelon: ech, status }) };
}

/**
 * Bestehenden SIDC behalten (z. B. Kolonne mit Fahrzeugart aus dem Text) und nur Zugehörigkeit, Status und Stufe neu setzen.
 * Liefert undefined, wenn der SIDC nicht zum Zeichen passt.
 */
export function rebaseSidc(old: string | undefined, c: SymbolChoice): string | undefined {
  if (!old || old.length !== 15 || old[0] !== c.sidc[0]) return undefined;
  const x = old.split("");
  x[1] = c.aff;
  x[3] = c.sidc[3]!;
  if (x[0] === "S" || x[0] === "E") { x[10] = c.sidc[10]!; x[11] = c.sidc[11]!; }
  return x.join("");
}

const svgCache = new Map<string, string>();
/** Zeichen als SVG-Text (milsymbol; Dreieck für Beob Posten über `symbolSvg`; Fläche/Linie über `shapeIconSvg`). */
export function choiceSvg(entry: CatalogEntry, aff: Affiliation, size: number, o: { echelon?: Echelon; status?: Status } = {}): string {
  // Flächen und Linien: eigenes kleines Bild (Vieleck mit Muster bzw. Linienart) statt der unleserlichen Stecknadel
  const shape = shapeIconSvg(entry.key, aff, size, { status: o.status });
  if (shape) return shape.svg;
  if (entry.triangle && SYMBOLS.some((s) => s.key === entry.key && s.triangle)) return symbolSvg(entry.key, aff, size).svg;
  const sidc = buildSidc(entry, aff, o);
  const ck = `${sidc}|${size}|${entry.tag ?? ""}`;
  const hit = svgCache.get(ck);
  if (hit !== undefined) return hit;
  let svg = "";
  try { svg = germanPin(new ms.Symbol(sidc, { size, outlineWidth: 3, outlineColor: "#ffffff", fill: true }).asSVG(), sidc, entry.tag); } catch { svg = ""; }
  if (svgCache.size > 1500) svgCache.clear();
  svgCache.set(ck, svg);
  return svg;
}


const ALL = "Alle";
const RECENT = "Zuletzt";
const VISIBLE = CATALOG.filter((e) => !e.hidden);
const STATUS_WORD: Partial<Record<Status, string>> = { anticipated: "vermutet", destroyed: "zerstört", damaged: "beschädigt" };

export function SymbolPicker(p: SymbolPickerProps) {
  const anchor = p.anchor ?? "popover";
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>(ALL);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [active, setActive] = useState<string | null>(p.value.key);
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const gid = useId();

  const entry = pickerEntry(p.value.key) ?? CATALOG[0]!;
  const categories = useMemo(() => [...new Set(VISIBLE.map((e) => e.category))], []);
  // verborgene (alte) Einträge nie anbieten
  const recentEntries = useMemo(() => recent.map(pickerEntry).filter((e): e is CatalogEntry => !!e && !e.hidden), [recent]);
  // Suche liest auch Stufe, Zugehörigkeit und Status: «hz inf», «Halbzug», «gn Zug Pz Gren», «vermutete IED»
  const search = useMemo(() => (q.trim() ? searchTactical(q, 120) : null), [q]);

  // sichtbare Gruppen: Suche (flach) | Kategorie | Alle (Zuletzt + nach Kategorie)
  const groups = useMemo((): Array<{ title: string | null; items: CatalogEntry[] }> => {
    if (search) return [{ title: null, items: search.entries.filter((e) => !e.hidden) }];
    if (cat === RECENT) return [{ title: null, items: recentEntries }];
    if (cat !== ALL) return [{ title: null, items: VISIBLE.filter((e) => e.category === cat) }];
    const out: Array<{ title: string | null; items: CatalogEntry[] }> = [];
    if (recentEntries.length) out.push({ title: RECENT, items: recentEntries });
    for (const c of categories) out.push({ title: c, items: VISIBLE.filter((e) => e.category === c) });
    return out;
  }, [search, cat, recentEntries, categories]);
  const flat = useMemo(() => groups.flatMap((g) => g.items.map((e, i) => ({ e, id: `${g.title ?? ""}:${e.key}:${i}` }))), [groups]);

  // aktiven Eintrag gültig halten
  useEffect(() => {
    if (!flat.length) return;
    if (!flat.some((f) => f.id === active)) setActive(flat.find((f) => f.e.key === p.value.key)?.id ?? flat[0]!.id);
  }, [flat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Popover: Fokus ins Suchfeld, schliessen bei Klick daneben / Esc
  useEffect(() => {
    if (anchor === "popover") input.current?.focus({ preventScroll: true });
  }, [anchor]);
  useEffect(() => {
    if (anchor !== "popover" || !p.onClose) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) p.onClose?.(); };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [anchor, p.onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  // aktive Kachel sichtbar halten
  useLayoutEffect(() => {
    if (!active) return;
    grid.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // was die Suche vorgibt, gilt für die Auswahl (sonst die bisherigen Einstellungen)
  const tAff = search?.aff ?? p.value.aff;
  const tEch = search?.echelon ?? p.value.echelon;
  // beschreibt die Suche das Element (Zugehörigkeit/Stufe), gilt «vermutet» nur, wenn es dasteht
  const tStatus = search?.status ?? (search?.aff || search?.echelon ? undefined : p.value.status);
  const choose = (e: CatalogEntry, close = false) => {
    p.onChange(makeChoice(e, tAff, tEch, tStatus));
    setRecent(pushRecent(e.key));
    if (close) p.onClose?.();
  };
  const setAff = (aff: Affiliation) => p.onChange(makeChoice(entry, aff, p.value.echelon, p.value.status));
  const setEch = (echelon?: Echelon) => p.onChange(makeChoice(entry, p.value.aff, echelon, p.value.status));
  const setStatus = (anticipated: boolean) => p.onChange(makeChoice(entry, p.value.aff, p.value.echelon, anticipated ? "anticipated" : undefined));

  /** Spalten im Raster (für ↑/↓) */
  const columns = () => {
    const g = grid.current?.querySelector<HTMLElement>(".sp-grid");
    if (!g) return 1;
    return Math.max(1, getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length);
  };

  const onKey = (ev: React.KeyboardEvent) => {
    const i = flat.findIndex((f) => f.id === active);
    const move = (d: number) => {
      ev.preventDefault();
      const n = Math.max(0, Math.min(flat.length - 1, (i < 0 ? 0 : i) + d));
      setActive(flat[n]?.id ?? null);
    };
    const inInput = ev.target === input.current;
    if (ev.key === "ArrowDown") move(i < 0 ? 0 : columns());
    else if (ev.key === "ArrowUp") move(-columns());
    else if (ev.key === "ArrowRight" && (!inInput || !q)) move(1);
    else if (ev.key === "ArrowLeft" && (!inInput || !q)) move(-1);
    else if (ev.key === "Enter") {
      const f = flat[i] ?? flat[0];
      if (f) { ev.preventDefault(); choose(f.e, anchor === "popover"); }
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      if (q) setQ("");
      else p.onClose?.();
    }
  };

  const status = p.value.status && p.value.status !== "present" ? p.value.status : undefined;
  const big = choiceSvg(entry, p.value.aff, p.compact ? 30 : 36, { echelon: entry.echelonable ? p.value.echelon : undefined, status });
  const desc = [AFFILIATIONS.find((a) => a.aff === p.value.aff)?.label, entry.echelonable && p.value.echelon ? ECHELONS.find((e) => e.key === p.value.echelon)?.name : null, entry.name, status ? `(${STATUS_WORD[status]})` : null].filter(Boolean).join(" · ");
  // Kacheln so zeigen, wie sie übernommen würden
  const tileStatus = tStatus && tStatus !== "present" ? tStatus : undefined;
  const searchHint = search && (search.echelon || search.aff || (search.status && search.status !== "present"))
    ? [search.aff ? AFFILIATIONS.find((a) => a.aff === search.aff)?.label : null, search.echelon ? ECHELONS.find((e) => e.key === search.echelon)?.name : null, search.status ? STATUS_WORD[search.status] : null].filter(Boolean).join(" · ")
    : null;

  return (
    <div ref={root} lang="de" className={`sp sp-${anchor}${p.compact ? " sp-compact" : ""}`} role="dialog" aria-label="Taktisches Zeichen wählen" onKeyDown={onKey}>
      <div className="sp-head">
        <label className="sp-search">
          <IconSearch />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zeichen suchen: Halbzug, IED, Pz Gren, Sperre …"
            aria-label="Zeichen suchen" aria-controls={gid} autoComplete="off" spellCheck={false} />
          {q && <button type="button" className="sp-iconbtn" onClick={() => { setQ(""); input.current?.focus(); }} aria-label="Suche leeren"><IconClose /></button>}
        </label>
        {p.onClose && anchor === "popover" && (
          <button type="button" className="sp-iconbtn sp-close" onClick={p.onClose} aria-label="Schliessen" title="Schliessen (Esc)"><IconClose /></button>
        )}
      </div>

      <div className="sp-row" role="radiogroup" aria-label="Zugehörigkeit">
        {AFFILIATIONS.map((a) => (
          <button key={a.aff} type="button" role="radio" aria-checked={p.value.aff === a.aff} className={`sp-aff a-${a.aff}`} onClick={() => setAff(a.aff)} title={a.title}>
            <i aria-hidden="true" />{a.label}
          </button>
        ))}
        <label className="sp-toggle" title="Vermutet / nicht bestätigt: Zeichen gestrichelt">
          <input type="checkbox" checked={status === "anticipated"} onChange={(e) => setStatus(e.target.checked)} />
          <span>vermutet</span>
        </label>
      </div>

      {entry.echelonable && (
        <div className="sp-row sp-ech" role="radiogroup" aria-label="Stufe">
          <span className="sp-lbl">Stufe</span>
          <button type="button" role="radio" aria-checked={!p.value.echelon} onClick={() => setEch(undefined)} title="ohne Stufe">–</button>
          {PICK_ECHELONS.map((e) => (
            <button key={e.key} type="button" role="radio" aria-checked={p.value.echelon === e.key} onClick={() => setEch(e.key)} title={e.name}>{ECH_SHORT[e.key] ?? e.name}</button>
          ))}
        </div>
      )}

      {searchHint && <p className="sp-hint" aria-live="polite">Aus der Suche: <b>{searchHint}</b> – gilt beim Übernehmen</p>}

      {!q.trim() && (
        <div className="sp-cats" role="tablist" aria-label="Kategorien">
          {[ALL, ...(recentEntries.length ? [RECENT] : []), ...categories].map((c) => (
            <button key={c} type="button" role="tab" aria-selected={cat === c} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      )}

      <div ref={grid} id={gid} className="sp-body" role="listbox" aria-label="Zeichen" aria-activedescendant={active ? `${gid}-${active}` : undefined}>
        {flat.length === 0 && <p className="sp-empty">Kein Zeichen gefunden. Andere Begriffe versuchen, z. B. «Inf», «Pz», «Halbzug», «Sperre», «IED».</p>}
        {groups.map((g, gi) => g.items.length > 0 && (
          <section key={`${g.title}-${gi}`}>
            {g.title && <h4 className="sp-gh">{g.title}</h4>}
            <div className="sp-grid">
              {g.items.map((e, i) => {
                const id = `${g.title ?? ""}:${e.key}:${i}`;
                return (
                  <button
                    key={id}
                    id={`${gid}-${id}`}
                    data-id={id}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={e.key === p.value.key}
                    className={`sp-tile${id === active ? " act" : ""}`}
                    onClick={() => { setActive(id); choose(e); }}
                    onDoubleClick={() => choose(e, true)}
                    title={`${e.name}${e.aliases.length ? ` (${e.aliases.slice(0, 4).join(", ")})` : ""}`}
                  >
                    <span className="sp-sym" aria-hidden="true">
                      <span dangerouslySetInnerHTML={{ __html: choiceSvg(e, tAff, p.compact ? 22 : 26, { status: tileStatus, echelon: search?.echelon && e.echelonable ? search.echelon : undefined }) }} />
                    </span>
                    <span className="sp-name">{softHyphens(e.name)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="sp-foot">
        <span className="sp-big" aria-hidden="true" dangerouslySetInnerHTML={{ __html: big }} />
        <span className="sp-desc">{desc}</span>
        {p.onClose && anchor === "popover" && <button type="button" className="sp-done" onClick={p.onClose}>Fertig</button>}
      </div>
    </div>
  );
}
