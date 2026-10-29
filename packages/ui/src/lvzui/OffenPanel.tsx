/**
 * Ansicht «Offen» in der Spalte (Spez. MVP 3, Kap. 2.6, 3.7, E9/E10): was bei einer Übergabe nicht vergessen gehen
 * darf – gruppiert (Dringend · Aufträge · Rückfragen · Verbindung · Ohne Ort · Offen markiert · Konflikt), darunter
 * (nicht gezählt) die offenen Hinweise zu Rot als Verweis. Oben «Übergabe …».
 *
 * Gewählter Punkt: Hauptaktion je Art (Erledigt · Antwort eintragen · Vbk eintragen · Ort setzen · Fassungen ansehen)
 * und «Zur Meldung». Die Punkte sind `.jlist li` (zählen im Inventar nicht). «Offen» zeigt immer den Stand jetzt (LIVE).
 */
import { useEffect, useRef, type KeyboardEvent as RKeyboardEvent } from "react";
import { setVermerk, type Hint, type LageEvent, type OffenArt, type OffenItem } from "@lage/core";
import type { OffenPanelProps } from "../shell/contracts";
import { isOpen } from "../hintsData";
import { hintLine } from "../red/redText";
import "./lvzui.css";

/** Gruppen in der Reihenfolge der Ansicht (Kap. 2.6) */
const GRUPPEN: Array<{ key: string; titel: string; arten: OffenArt[] }> = [
  { key: "dringend", titel: "Dringend", arten: ["dringend"] },
  { key: "auftrag", titel: "Aufträge", arten: ["auftrag"] },
  { key: "rueckfrage", titel: "Rückfragen", arten: ["rueckfrage"] },
  { key: "verbindung", titel: "Verbindung", arten: ["verbindung", "still"] },
  { key: "ohne-ort", titel: "Ohne Ort", arten: ["ohne-ort"] },
  { key: "offen", titel: "Als offen markiert", arten: ["offen"] },
  { key: "konflikt", titel: "Konflikt beim Zusammenführen", arten: ["konflikt"] },
];

/** Zeichen je Art (Form statt nur Farbe): ! dringend, ✎ Auftrag/Rückfrage, ⇄ Verbindung, ◆ ohne Ort, ⚠ Konflikt */
const MARK: Record<OffenArt, string> = { dringend: "!", auftrag: "✎", rueckfrage: "✎", verbindung: "⇄", still: "⇄", "ohne-ort": "◆", offen: "•", konflikt: "⚠" };

/** Hauptaktion je Art (Kap. 2.6) */
export function hauptAktion(it: Pick<OffenItem, "art">): string {
  switch (it.art) {
    case "rueckfrage": return "Antwort eintragen";
    case "verbindung": case "still": return "Vbk eintragen";
    case "ohne-ort": return "Ort setzen";
    case "konflikt": return "Fassungen ansehen";
    default: return "Erledigt";
  }
}

/** «seit 11 min», «seit 1 h 05 min» */
export function seitLabel(min: number): string {
  if (min < 60) return `seit ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return `seit ${h} h${m ? ` ${String(m).padStart(2, "0")} min` : ""}`;
}

export interface OffenPanelExtra {
  /** Rückgängig-Leiste der Hülle («Nr 55 erledigt · Rückgängig») */
  offerUndo?: (label: string, restore: () => void) => void;
  say?: (t: string) => void;
  /** Lagezeit LIVE (für den Kopf «Stand jetzt») */
  tLive?: string;
}

export function OffenPanel(p: OffenPanelProps & OffenPanelExtra) {
  const { ex, items, hints, selected, onSelect } = p;
  const byId = new Map((ex.events ?? []).map((e) => [e.id, e]));
  const box = useRef<HTMLDivElement>(null);
  // gewählter Punkt verschwunden (erledigt, Lebenszeichen): Auswahl lösen
  useEffect(() => { if (selected && !items.some((i) => i.key === selected)) onSelect(null); }, [items, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const offeneHinweise: Hint[] = p.tLive ? hints.filter((h) => isOpen(ex, h, p.tLive!)) : hints.filter((h) => h.level !== "info" && !h.until);

  const setStatus = (e: LageEvent, v: "offen" | "erledigt", nr?: string) => {
    const prev = e.lvz?.status?.v;
    p.update((x) => ({ ...x, events: (x.events ?? []).map((y) => (y.id === e.id ? setVermerk(y, "status", v, { device: p.device, kuerzel: p.kuerzel ?? undefined }) : y)) }));
    if (v === "erledigt") p.offerUndo?.(`Nr ${nr ?? "?"} erledigt`, () => {
      p.update((x) => ({ ...x, events: (x.events ?? []).map((y) => (y.id === e.id ? setVermerk(y, "status", prev ?? "offen", { device: p.device, kuerzel: p.kuerzel ?? undefined }) : y)) }));
    });
  };

  const act = (it: OffenItem) => {
    const e = it.eventId ? byId.get(it.eventId) : undefined;
    switch (it.art) {
      case "rueckfrage": p.onPrefill(`Antwort zu ${it.nr ?? ""}: `); return;
      case "verbindung": case "still": p.onPrefill(`${it.unit ?? ""} Vbk `); return;
      case "ohne-ort": if (e) p.onCorrect(e.id); return;
      case "konflikt":
        if (e) { setStatus(e, "erledigt", it.nr); p.onEvent(e.id); }
        return;
      default: if (e) setStatus(e, "erledigt", it.nr);
    }
  };

  const onKey = (ev: RKeyboardEvent) => {
    const li = (ev.target as HTMLElement).closest<HTMLElement>("li[data-key]");
    if (!li || (ev.target as HTMLElement).closest("button")) return;
    const keys = items.map((i) => i.key);
    const i = keys.indexOf(li.dataset.key!);
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(selected === li.dataset.key ? null : li.dataset.key!); }
    else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const n = keys[i + (ev.key === "ArrowDown" ? 1 : -1)];
      if (n) box.current?.querySelector<HTMLElement>(`li[data-key="${CSS.escape(n)}"]`)?.focus();
    }
  };

  const groups = GRUPPEN.map((g) => ({ ...g, list: items.filter((i) => g.arten.includes(i.art)) })).filter((g) => g.list.length);
  // ein Tab-Stopp für die Liste: gewählter bzw. erster Punkt
  const tabKey = selected && items.some((i) => i.key === selected) ? selected : items[0]?.key;

  return (
    <div className="of" role="tabpanel" aria-label="Offen" ref={box} onKeyDown={onKey}>
      <div className="of-top">
        <button type="button" className="jl-btn of-ueb" onClick={p.onUebergabe}>Übergabe …</button>
        <span className="of-stand">Stand jetzt (LIVE)</span>
      </div>
      {p.rueckblick && <p className="of-rb" role="status">Offen zeigt immer den Stand jetzt (LIVE).</p>}
      {!items.length ? (
        <p className="of-leer">Nichts offen. Dringende Meldungen, Aufträge, Rückfragen und Meldungen ohne Ort erscheinen hier.</p>
      ) : groups.map((g) => (
        <section key={g.key} className="of-g" aria-label={g.titel}>
          <h4 className="jl-head of-h">{g.titel}</h4>
          <ol className="jlist of-list">
            {g.list.map((it) => {
              const sel = it.key === selected;
              const t = it.t.slice(11, 16);
              const meta = it.art === "auftrag" ? (it.ueberfaellig ? "⚠ Frist vorbei" : seitLabel(it.seitMin)) : it.art === "rueckfrage" ? seitLabel(it.seitMin) : null;
              return (
                <li key={it.key} data-key={it.key} data-art={it.art} className={"of-row" + (sel ? " sel" : "") + (it.ueberfaellig ? " spaet" : "")}
                  tabIndex={it.key === tabKey ? 0 : -1} aria-selected={sel} onClick={(ev) => { if ((ev.target as HTMLElement).closest("button")) return; onSelect(sel ? null : it.key); }}>
                  <span className={"of-mark m-" + it.art} aria-hidden="true">{MARK[it.art]}</span>
                  <span className="of-body">
                    <span className="of-l1">
                      {it.art !== "still" && <span className="of-t mono">{t}</span>}
                      {it.nr && <span className="of-nr mono" aria-label={`Nummer ${it.nr}`}>{it.nr}</span>}
                      <span className="of-text">{it.text}</span>
                    </span>
                    {meta && <span className={"of-meta" + (it.ueberfaellig ? " spaet" : "")}>{meta}</span>}
                    {sel && (
                      <span className="jl-acts of-acts">
                        <button type="button" className="jl-btn" onClick={() => act(it)}>{hauptAktion(it)}</button>
                        {it.eventId && <button type="button" className="jl-btn" onClick={() => p.onEvent(it.eventId!)}>Zur Meldung</button>}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {offeneHinweise.length > 0 && (
        <section className="of-g of-hints" aria-label="Was Rot vorhaben könnte">
          <hr className="jp-sep" />
          <button type="button" className="of-hlink" onClick={() => p.onHint(offeneHinweise[0]!.id)}>
            Was Rot: {offeneHinweise.length} {offeneHinweise.length === 1 ? "offener Hinweis" : "offene Hinweise"} → ansehen
          </button>
          <ol className="jlist of-list">
            {offeneHinweise.slice(0, 3).map((h) => (
              <li key={h.id} className="of-row of-hint" data-hint={h.id} onClick={() => p.onHint(h.id)}>
                <span className="of-mark m-hint" aria-hidden="true">{h.level === "hoch" ? "⚠" : "•"}</span>
                <span className="of-body"><span className="of-l1"><span className="of-text">{hintLine(h)}</span>
                  {h.bundled && h.bundled > 1 && <span className="of-bund" aria-label={`${h.bundled} gleiche Hinweise`}> · {h.bundled}×</span>}</span></span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
