import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  blattFromRect,
  cellAtAny,
  exerciseToFile,
  feldFromRect,
  formatLv95,
  makeBlattSheet,
  journalToCsv,
  findCells,
  cellBounds,
  catalogEntry,
  type Bounds,
  makeFeldSheet,
  newDeviceId,
  demoExercise,
  newExercise,
  nextPrefix,
  niceCellSize,
  referencePoint,
  sheetBounds,
  situationAt,
  reviseEvent,
  type Area,
  type Exercise,
  type LageEvent,
  type LV95,
  type RasterSheet,
  wgs84ToLv95,
} from "@lage/core";
import {
  AffineImageLayer,
  areasLayer,
  toLatLng,
  createSwissMap,
  enableCellZoom,
  flyToBoundsSharp,
  drawRect,
  rasterLayer,
  toLv95,
  type Basemap,
  type SwissMap,
} from "@lage/map";
import { currentExerciseId, downloadText, getBlob, listExercises, loadExercise, onDbNotice, pickFile, safeFileName, saveExercise } from "./store";
import { AttachmentChips, ViewerHost, openViewer } from "./Attachments";
import { RowMemos } from "./VoiceInput";
import { attachmentLayer, attachmentsOf, forgetBlobUrls, putAttachmentBlob, useAttachmentGc } from "./attachmentStore";
import { NaiPanel } from "./NaiPanel";
import { GeorefPane } from "./GeorefPane";
import type { Candidate } from "./imageimport";
import { JournalPanel } from "./JournalPanel";
import { OfflineBox } from "./OfflineBox";
import { isoLocal } from "./Timeline";
import { SwimTimeline } from "./SwimTimeline";
import { situationLayer, whenNotDragging } from "./situationLayer";
import { shapeLayer } from "./shapeLayer";
import { EventBanner, Legend } from "./MapOverlays";
import { MapSearch } from "./MapSearch";
import { MapToolbar } from "./MapToolbar";
import { MapContextMenu } from "./MapContextMenu";
import { loadFlags, saveFlags, type LayerFlags } from "./layers";
import { windowStart } from "@lage/core";
import { useMoveEvent, useTimeWindow } from "./mapedit";
import { HintsPanel } from "./HintsPanel";
import { hintExtent, hintLayer } from "./hintLayer";
import { hasOpenHoch, newCount, useHints } from "./hintsData";
import { hintsToCsv } from "./hintsExport";
import type { Hint, RedCoa } from "@lage/core";
import { LageRotPanel } from "./LageRotPanel";
import { coaEventIds, useLageRot } from "./lageRot";
import { coaExtent, coaLayer } from "./coaLayer";
import { lageRotCsv } from "./lageRotExport";
import { KiMenuButton, KiProvider } from "./ki/context";
import { kiPdfNote } from "./ki/settings";
import { KI_PURPOSE_LABEL } from "@lage/core";

function deviceId(): string {
  try {
    let d = localStorage.getItem("lage-tools.device");
    if (!d) { d = newDeviceId(); localStorage.setItem("lage-tools.device", d); }
    return d;
  } catch { return "dev-unbekannt"; }
}

interface Props {
  product: string;
  tagline: string;
}

type Tab = "journal" | "hinweise" | "raster" | "nai";
type SheetPatch = Partial<{ name: string; prefix: string; cellSize: number; cols: number; rows: number; basemap: "lk" | "img"; classification: string; quadrants: boolean }>;

export function Workspace({ product, tagline }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const sm = useRef<SwissMap | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [ex, setEx] = useState<Exercise | null>(null);
  const [saved, setSaved] = useState<Array<{ id: string; name: string }>>([]);
  const [tab, setTab] = useState<Tab>(product === "Lagejournal" ? "journal" : "raster");
  const [tCursor, setTCursor] = useState<string | null>(null);
  const [flags, setFlagsState] = useState<LayerFlags>(loadFlags);
  const setFlags = (f: LayerFlags) => { setFlagsState(f); saveFlags(f); };
  const [reportAt, setReportAt] = useState<{ pos: LV95; n: number } | null>(null);
  const [present, setPresent] = useState(false);
  const [editReq, setEditReq] = useState<{ id: string; n: number } | null>(null);
  const [night, setNight] = useState(() => { try { return localStorage.getItem("lage-tools.night") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("lage-tools.night", night ? "1" : "0"); } catch { /* egal */ } }, [night]);
  const [selEvent, setSelEvent] = useState<string | null>(null);
  const journalRef = useRef<L.LayerGroup | null>(null);
  const device = useRef(deviceId()).current;
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on); window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);
  const [basemap, setBasemap] = useState<Basemap>("lk");
  const [selSheet, setSelSheet] = useState<string | null>(null);
  const [selArea, setSelArea] = useState<string | null>(null);
  const [cursor, setCursor] = useState<LV95 | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [georef, setGeoref] = useState<Candidate[] | null>(null);
  const [drawing, setDrawing] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const say = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? null : x)), 4000);
  }, []);

  // Datenbank blockiert (altes Lagejournal-Fenster offen): Hinweis zeigen, App läuft mit leerer Übung weiter
  const [dbBlocked, setDbBlocked] = useState(false);
  const dbBlockedRef = useRef(false);
  /** Übung, die nur angelegt wurde, weil die Datenbank beim Start blockiert war (nicht speichern, später ersetzen) */
  const fallbackId = useRef<string | null>(null);
  useEffect(() => onDbNotice((n) => {
    dbBlockedRef.current = n === "blocked";
    setDbBlocked(n === "blocked");
    if (n !== "ready" || !fallbackId.current) return;
    // wieder frei: die zuletzt benutzte Übung laden, solange in der Ersatz-Übung noch nichts erfasst ist
    (async () => {
      const id = await currentExerciseId();
      const loaded = id ? await loadExercise(id) : null;
      setSaved(await listExercises());
      setEx((cur) => {
        const untouched = cur && cur.id === fallbackId.current && !(cur.events ?? []).length && !cur.sheets.length && !cur.areas.length;
        fallbackId.current = null;
        return untouched && loaded ? loaded : cur;
      });
    })();
  }), []);

  // Übung laden
  useEffect(() => {
    (async () => {
      const id = await currentExerciseId();
      const loaded = id ? await loadExercise(id) : null;
      const next = loaded ?? newExercise();
      if (!loaded && dbBlockedRef.current) fallbackId.current = next.id;
      setEx(next);
      setSaved(await listExercises());
    })();
  }, []);

  // Speichern (verzögert)
  useEffect(() => {
    if (!ex) return;
    // leere Ersatz-Übung bei blockierter Datenbank nicht als «aktuelle Übung» speichern
    if (fallbackId.current === ex.id && !(ex.events ?? []).length && !ex.sheets.length && !ex.areas.length) return;
    const t = window.setTimeout(async () => {
      await saveExercise(ex);
      setSaved(await listExercises());
    }, 400);
    return () => window.clearTimeout(t);
  }, [ex]);

  // Karte
  useEffect(() => {
    if (!el.current || sm.current) return;
    const s = createSwissMap(el.current, { center: { e: 2660000, n: 1190000 }, zoom: 16 });
    sm.current = s;
    s.map.on("mousemove", (ev: L.LeafletMouseEvent) => setCursor(toLv95(ev.latlng)));
    // Grösse der Karte ändert sich (Zeitstrahl ein/aus, Fenster, Seitenleiste) → Leaflet informieren
    const ro = new ResizeObserver(() => s.map.invalidateSize({ pan: false }));
    ro.observe(el.current);
    s.map.doubleClickZoom.disable();
    enableCellZoom(s.map, () => exRef.current?.sheets ?? []);
    setMapReady(true);
  }, [ex === null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { sm.current?.map.remove(); sm.current = null; }, []);

  // Ebenen neu zeichnen
  useEffect(() => {
    const s = sm.current;
    if (!s || !ex) return;
    layerRef.current?.remove();
    const g = L.layerGroup();
    for (const o of ex.overlays ?? []) if (o.visible) g.addLayer(new AffineImageLayer(o.dataUrl, o.width, o.height, o.affine, o.opacity));
    if (flags.raster || tab === "raster") for (const sh of ex.sheets) g.addLayer(rasterLayer(s.map, sh, { color: sh.id === selSheet ? "#c8102e" : "#111111" }));
    // NAI mit zugeteiltem Trupp: «NAI 2 · H03»
    const areas = ex.areas.map((a) => (a.kind === "nai" && a.trupp ? { ...a, name: `${a.name} · ${a.trupp}` } : a));
    if (flags.nai || tab === "nai") g.addLayer(areasLayer(areas, { selectedId: selArea ?? undefined, onClick: (a) => { setTab("nai"); setSelArea(a.id); } }));
    g.addTo(s.map);
    layerRef.current = g;
  }, [ex, selSheet, selArea, mapReady, flags.raster, flags.nai, tab]);

  // Zeitpunkt der Lage: gewählt oder Live (jetzt – oder, wenn die Übung vorbei ist, die letzte Meldung)
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setClock(Date.now()), 30000); return () => window.clearInterval(id); }, []);
  const tNow = (() => {
    if (tCursor) return tCursor;
    const last = (ex?.events ?? []).filter((e) => !e.deleted).reduce((m, e) => (e.t > m ? e.t : m), "");
    const now = isoLocal(clock);
    return !last || clock - Date.parse(last) < 12 * 3600000 ? (now > last ? now : last) : last;
  })();
  // Zeitfenster (pro Übung gemerkt): Anfang zur Lagezeit, null = alles
  const [win, setWin] = useTimeWindow(ex?.id);
  const winFrom = windowStart(win, tNow);

  // ---------- Hinweise zu Rot (folgen Lagezeit und Zeitfenster)
  const { hints, quality, all: allHints } = useHints(ex, tNow, winFrom);
  const [selHint, setSelHint] = useState<string | null>(null);
  const [presentHints, setPresentHints] = useState(false);
  const hintSel = hints.find((h) => h.id === selHint) ?? null;
  /** gewählter Hinweis hebt seine Auslöser hervor – nur solange die Hinweise sichtbar sind */
  const hintFocus = !!hintSel && (present ? presentHints : tab === "hinweise");
  // ---------- Lage Rot: mögliche Aktionen und Kräfte (ganzes Journal bis zur Lagezeit; Zeitfenster nur Spalte «im Fenster»)
  const lageRot = useLageRot(ex, tNow, allHints, winFrom);
  const [selCoa, setSelCoa] = useState<string | null>(null);
  const coaSel = lageRot.coas.find((c) => c.id === selCoa) ?? null;
  const coaFocus = !!coaSel && (present ? presentHints : tab === "hinweise");
  // Hinweis gewählt (Liste, Karte, Indikator) → Möglichkeit abwählen
  useEffect(() => { if (selHint) setSelCoa(null); }, [selHint]);
  const hintHl = (() => {
    if (coaFocus && coaSel) return coaEventIds(coaSel, lageRot.hints);
    if (!hintFocus || !hintSel) return null;
    const ids = new Set(hintSel.events);
    if (hintSel.unit) for (const e of ex?.events ?? []) if (e.side === "blau" && e.unit === hintSel.unit) ids.add(e.id);
    return ids;
  })();
  const nNew = ex ? newCount(ex, hints, tNow) : 0;
  const nHoch = ex ? hasOpenHoch(ex, hints, tNow) : false;
  // Zahl am Reiter pulsiert einmal, wenn neue Hinweise dazukommen (kein Pop-up, kein Ton)
  const prevNew = useRef(nNew);
  const [pulse, setPulse] = useState(0);
  useEffect(() => { if (nNew > prevNew.current) setPulse((n) => n + 1); prevNew.current = nNew; }, [nNew]);

  // Hindernisse, Checkpoint, IED … (und Meldungen «auf Hauptstrasse/Autobahn») ohne Ausrichtung nachträglich auf die
  // Strasse legen (z. B. Beispiel, Import, Meldung offline erfasst). Erledigt erst mit Ergebnis; fehlten Strassendaten
  // (offline, Fehler), wird es später erneut versucht (wieder online, nächste Änderung).
  const roadDone = useRef(new Set<string>());
  const roadBusy = useRef(new Set<string>());
  const [roadRetry, setRoadRetry] = useState(0);
  useEffect(() => {
    const on = () => setRoadRetry((n) => n + 1);
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, []);
  useEffect(() => {
    if (!ex) return;
    const todo = (ex.events ?? []).filter((e) => !e.deleted && !e.roadNone && e.angle === undefined && !roadDone.current.has(e.id) && !roadBusy.current.has(e.id)
      && (catalogEntry(e.sym)?.placement === "strasse" || !!e.roadHint) && (e.cells?.length || e.nai) && e.where !== "Karte");
    if (!todo.length) return;
    todo.forEach((e) => roadBusy.current.add(e.id));
    const exId = ex.id;
    (async () => {
      const { placeOnRoadTry } = await import("./roadsource");
      try {
        for (const e of todo) {
          let target: Bounds | LV95[] | null = null;
          const c = e.cells?.[0] ? findCells(e.cells[0], ex.sheets)[0] : undefined;
          const sh = c && ex.sheets.find((x) => x.id === c.sheetId);
          if (c && sh) target = cellBounds(sh, c.col, c.row, c.quadrant);
          else if (e.nai) target = ex.areas.find((a) => a.name === e.nai)?.ring ?? null;
          if (!target) { roadDone.current.add(e.id); continue; }
          const { pl, complete } = await placeOnRoadTry(target, undefined, { along: e.sym === "hinterhalt", hint: e.roadHint, text: e.text });
          if (exRef.current?.id !== exId) break;
          if (!pl) { if (complete) roadDone.current.add(e.id); continue; }
          roadDone.current.add(e.id);
          update((x) => {
            x.events = (x.events ?? []).map((y) => {
              if (y.id !== e.id) return y;
              // inzwischen von Hand verschoben, Ort entfernt/geändert oder schon ausgerichtet → nicht überschreiben
              const samePos = y.pos?.e === e.pos?.e && y.pos?.n === e.pos?.n;
              const sameWhere = (y.cells?.[0] ?? "") === (e.cells?.[0] ?? "") && (y.nai ?? "") === (e.nai ?? "");
              if (y.deleted || y.roadNone || y.where === "Karte" || y.angle !== undefined || !samePos || !sameWhere) return y;
              // neue Revision (für den Abgleich), aber Zeitstempel nur minimal weiter: automatische Ergänzung,
              // keine Benutzeränderung (sonst stünde jede Meldung des Beispiels als «neu» in der Liste)
              const at = new Date((Date.parse(y.updatedAt) || Date.now()) + 1);
              return reviseEvent(y, { pos: pl.pos, angle: pl.angle, road: pl.road, where: `${y.where ?? ""}${pl.road ? ` · auf ${pl.road}` : ""}`.replace(/^ · /, "") }, device, at);
            });
            return x;
          });
        }
      } finally {
        todo.forEach((e) => roadBusy.current.delete(e.id));
      }
    })();
  }, [ex?.events, ex?.id, roadRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lage zum Zeitpunkt
  useEffect(() => {
    const s = sm.current;
    if (!s || !ex) return;
    // nicht während ein Zeichen gezogen wird (Live-Takt, Abgleich, Abspielen …): nach dem Loslassen nachholen
    whenNotDragging(s.map, () => {
    journalRef.current?.remove();
    const g = situationLayer(s.map, ex.events ?? [], {
      t: tNow, flags, selectedId: selEvent, sheets: ex.sheets, days: ex.days, from: winFrom,
      onClick: (e) => { setTab("journal"); setSelEvent(e.id); },
      onMove: present ? undefined : mover.move,
      highlight: hintHl,
    });
    g.addTo(s.map);
    journalRef.current = g;
    });
  }, [ex?.events, ex?.sheets, tNow, winFrom, flags, selEvent, mapReady, present, hintHl ? [...hintHl].join() : ""]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flächen- und Linienzeichen (unter den Zeichen); Zeitfenster: `from` = Anfang des Fensters (null = alles)
  const shapeRef = useRef<L.LayerGroup | null>(null);
  const shapeFrom = winFrom;
  useEffect(() => {
    const s = sm.current;
    shapeRef.current?.remove();
    shapeRef.current = null;
    if (!s || !ex) return;
    const g = shapeLayer(ex.events ?? [], {
      t: tNow, from: shapeFrom, flags, selectedId: selEvent, sheets: ex.sheets, areas: ex.areas,
      onClick: (e) => { setTab("journal"); setSelEvent(e.id); },
    });
    g.addTo(s.map);
    shapeRef.current = g;
  }, [ex?.events, ex?.sheets, ex?.areas, tNow, shapeFrom, flags, selEvent, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fotos an Planquadraten (Ebene «Anhänge»): Kamera-Symbol, Klick öffnet den Betrachter
  const attRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const s = sm.current;
    attRef.current?.remove();
    attRef.current = null;
    if (!s || !ex || flags.anhaenge === false || !(ex.attachments ?? []).some((a) => a.cell)) return;
    attRef.current = attachmentLayer(ex, (list) => openViewer(list, 0, `Fotos an ${list[0]!.cell}`)).addTo(s.map);
  }, [ex?.attachments, ex?.sheets, flags.anhaenge, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hinweise auf der Karte (Ebene «Hinweise»; im Reiter «Hinweise» immer)
  const hintRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const s = sm.current;
    hintRef.current?.remove();
    hintRef.current = null;
    if (!s || !ex || !(flags.hinweise || tab === "hinweise" || (present && presentHints))) return;
    const g = hintLayer(s.map, {
      hints, ex, t: tNow, selectedId: selHint, focus: hintFocus,
      onClick: (h) => { if (present) setPresentHints(true); else setTab("hinweise"); setSelHint(h.id); },
    });
    g.addTo(s.map);
    hintRef.current = g;
  }, [hints, selHint, hintFocus, flags.hinweise, tab, present, presentHints, ex?.hintDecisions, ex?.events, ex?.sheets, ex?.areas, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mögliche Aktionen Rot auf der Karte (Ebene «Aktionen Rot»; gewählte immer)
  const coaRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const s = sm.current;
    coaRef.current?.remove();
    coaRef.current = null;
    if (!s || !ex || !lageRot.coas.length || !(flags.aktionen || coaFocus)) return;
    const g = coaLayer(s.map, {
      coas: flags.aktionen ? lageRot.coas : lageRot.coas.filter((c) => c === coaSel), ex, t: tNow, selectedId: selCoa, focus: coaFocus,
      onClick: (c) => { if (present) setPresentHints(true); else setTab("hinweise"); setSelHint(null); setSelCoa(c.id); },
    });
    g.addTo(s.map);
    coaRef.current = g;
  }, [lageRot.coas, selCoa, coaFocus, flags.aktionen, flags.hinweise, flags.nai, present, mapReady, hints]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectCoa = (id: string | null) => { setSelCoa(id); if (id) setSelHint(null); };
  /** Indikator-Hinweis einer Möglichkeit: Hinweis zeigen; liegt er ausserhalb des Zeitfensters, seine letzte Meldung */
  const coaHint = (id: string) => {
    const h = hints.find((x) => x.id === id);
    if (h) { focusHint(h); return; }
    const last = lageRot.hints.find((x) => x.id === id)?.events.at(-1);
    if (last) selectEvent(last);
  };
  /** Karte auf eine Möglichkeit: Ziel, Annäherung und Indikator-Orte mit Rand */
  const focusCoa = (c: RedCoa) => {
    const map = sm.current?.map;
    selectCoa(c.id);
    const box = ex ? coaExtent(c, ex, lageRot.hints) : null;
    if (!map || !box) return;
    if (window.innerWidth <= 560) window.scrollTo({ top: 0, behavior: "smooth" });
    const pad = Math.max(250, Math.max(box.maxE - box.minE, box.maxN - box.minN) * 0.5);
    flyToBoundsSharp(map, { minE: box.minE - pad, minN: box.minN - pad, maxE: box.maxE + pad, maxN: box.maxN + pad }, { maxZoom: 21 });
  };

  /** Karte auf einen Hinweis: Planquadrate/NAI bzw. Auslöser mit Rand */
  const focusHint = (h: Hint) => {
    const map = sm.current?.map;
    if (!map || !ex) return;
    setSelHint(h.id);
    const { box } = hintExtent(h, ex);
    if (!box) return;
    // Handy: Karte liegt oben – hinscrollen
    if (window.innerWidth <= 560) window.scrollTo({ top: 0, behavior: "smooth" });
    const pad = Math.max(250, Math.max(box.maxE - box.minE, box.maxN - box.minN) * 0.6);
    flyToBoundsSharp(map, { minE: box.minE - pad, minN: box.minN - pad, maxE: box.maxE + pad, maxN: box.maxN + pad }, { maxZoom: 21 });
  };

  /** Karte auf eine Meldung: Planquadrat (bzw. Unterquadrant) mit Rand, sonst Ort */
  const focusEvent = (e: LageEvent) => {
    const map = sm.current?.map;
    if (!map || !ex) return;
    const c = e.cells?.[0] ? findCells(e.cells[0], ex.sheets)[0] : undefined;
    const sh = c ? ex.sheets.find((x) => x.id === c.sheetId) : undefined;
    if (c && sh) {
      const b = cellBounds(sh, c.col, c.row, c.quadrant);
      const pad = Math.max(b.maxE - b.minE, b.maxN - b.minN) * 1.2;
      flyToBoundsSharp(map, { minE: b.minE - pad, minN: b.minN - pad, maxE: b.maxE + pad, maxN: b.maxN + pad }, { maxZoom: 22.5 });
    } else if (e.nai && ex.areas.some((a) => a.name === e.nai)) {
      const a = ex.areas.find((x) => x.name === e.nai)!;
      map.flyToBounds(L.latLngBounds(a.ring.map(toLatLng)).pad(0.6), { duration: 0.6, maxZoom: 22 });
    } else if (e.pos) {
      const ll = toLatLng(e.pos);
      map.flyTo(ll, Math.max(map.getZoom(), 20), { duration: 0.6 });
    }
  };
  const selectEvent = (id: string | null) => {
    setSelEvent(id);
    const e = (ex?.events ?? []).find((x) => x.id === id);
    if (e && tCursor && e.t > tCursor) setTCursor(e.t);
    if (e) focusEvent(e);
  };

  const exportJournal = async (kind: "csv" | "pdf") => {
    if (!ex) return;
    if (kind === "csv") { downloadText(`Lagejournal_${safeFileName(ex.name)}.csv`, journalToCsv(ex.events ?? [], ex.days), "text/csv;charset=utf-8"); return; }
    const { journalPdf } = await import("./journalpdf");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(journalPdf(ex, ex.sheets[0]?.classification ?? "INTERN", hints, { lage: lageRot, t: tNow }, kiPdfNote(ex, KI_PURPOSE_LABEL)));
    a.download = `Lagejournal_${safeFileName(ex.name)}.pdf`;
    a.click();
  };

  const fitSheet = (sh: RasterSheet) => {
    const b = sheetBounds(sh);
    sm.current?.fitLv95({ e: b.minE, n: b.minN }, { e: b.maxE, n: b.maxN }, 30);
  };
  const fitAll = (x: Exercise) => {
    const pts: LV95[] = [];
    x.sheets.forEach((s) => { const b = sheetBounds(s); pts.push({ e: b.minE, n: b.minN }, { e: b.maxE, n: b.maxN }); });
    x.areas.forEach((a) => pts.push(...a.ring));
    if (!pts.length) return;
    if (!sm.current) return;
    const b = { minE: Math.min(...pts.map((p) => p.e)), minN: Math.min(...pts.map((p) => p.n)), maxE: Math.max(...pts.map((p) => p.e)), maxN: Math.max(...pts.map((p) => p.n)) };
    flyToBoundsSharp(sm.current.map, b, { duration: 0 });
  };
  // Beim Laden einpassen – erst wenn das Layout (Zeitstrahl, Werkzeuge) steht
  useEffect(() => {
    if (!ex || !sm.current) return;
    const id = window.setTimeout(() => { sm.current?.map.invalidateSize(); if (exRef.current) fitAll(exRef.current); }, 350);
    return () => window.clearTimeout(id);
  }, [ex?.id, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const exRef = useRef<Exercise | null>(null);
  exRef.current = ex;
  const update = (f: (x: Exercise) => Exercise) => setEx((x) => (x ? f(structuredClone(x)) : x));
  // Speicher freigeben: Anhänge gelöschter Meldungen, verwaiste Fotos/Memos (still)
  useAttachmentGc(ex, update);
  // Zeichen auf der Karte verschoben → Ort der Meldung korrigieren (mit Rückgängig)
  const mover = useMoveEvent(update, device, ex);

  // ---------- Raster ----------
  const addSheet = async (kind: "gesamt" | "detail" | "feld") => {
    const s = sm.current;
    if (!s || !ex) return;
    setDrawing(kind === "gesamt" ? "Gesamtblatt: Rechteck über den ganzen Raum aufziehen (vorher hinzoomen)" : kind === "detail" ? "Detailblatt: Rechteck über den Ausschnitt aufziehen" : "Feld-Raster: Rechteck über den Raum aufziehen (vorher hinzoomen)");
    const r = await drawRect(s.map);
    setDrawing(null);
    if (!r) return;
    let sh: RasterSheet;
    if (kind === "feld") {
      const size = niceCellSize(Math.max(r.maxE - r.minE, r.maxN - r.minN) / 30);
      sh = feldFromRect(r, "AOR", size);
    } else {
      const prefix = kind === "gesamt" ? nextPrefix(ex.sheets, "A") : nextPrefix(ex.sheets, "U");
      sh = blattFromRect(r, kind === "gesamt" ? "GESAMT" : `BLATT ${prefix}`, prefix);
    }
    update((x) => { x.sheets.push(sh); return x; });
    setSelSheet(sh.id);
    fitSheet(sh);
  };

  const patchSheet = (id: string, patch: SheetPatch) =>
    update((x) => {
      const i = x.sheets.findIndex((s) => s.id === id);
      const old = x.sheets[i];
      if (!old) return x;
      const cols = patch.cols ?? old.colLabels.length, rows = patch.rows ?? old.rowLabels.length;
      const cell = patch.cellSize ?? old.cellW;
      let sh: RasterSheet;
      if (old.variant === "blatt") {
        const b = sheetBounds(old);
        const prefix = (patch.prefix ?? old.colLabels[0]!.slice(0, -1)).toUpperCase().slice(0, 1) || "A";
        sh = makeBlattSheet({ name: patch.name ?? old.name, prefix, center: { e: (b.minE + b.maxE) / 2, n: (b.minN + b.maxN) / 2 }, cellSize: cell, cols, rows, basemap: patch.basemap ?? old.basemap, classification: patch.classification ?? old.classification, quadrants: patch.quadrants ?? old.quadrants });
      } else {
        sh = makeFeldSheet({ name: patch.name ?? old.name, origin: old.origin, cellW: cell, cellH: cell, cols, rows, basemap: patch.basemap ?? old.basemap, classification: patch.classification ?? old.classification, quadrants: patch.quadrants ?? old.quadrants });
      }
      sh.id = old.id;
      sh.reference = referencePoint(sh);
      x.sheets[i] = sh;
      return x;
    });

  const pdf = async (sh: RasterSheet, paper: "A4" | "A3") => {
    setBusy("Karte wird geladen … 0 %");
    try {
      const { printSheet } = await import("./pdf");
      const blob = await printSheet(sh, { paper, areas: ex?.areas, onProgress: (p) => setBusy(`Karte wird geladen … ${Math.round(p * 100)} %`) });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Fhr_Raster_${safeFileName(sh.name)}_${paper}.pdf`;
      a.click();
    } catch (e) {
      say("PDF konnte nicht erstellt werden: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // ---------- Datei ----------
  // mit Anhängen (Fotos, Memos) als .lage.zip, sonst .lage.json
  const saveFile = async () => {
    if (!ex) return;
    if (!ex.attachments?.length) { downloadText(`${safeFileName(ex.name)}.lage.json`, exerciseToFile(ex)); return; }
    const { exerciseFile, sizeText } = await import("./exportZip");
    const r = await exerciseFile(ex, safeFileName(ex.name), getBlob);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(r.blob); a.download = r.name; a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say(`Gespeichert als ZIP mit ${r.files} ${r.files === 1 ? "Anhang" : "Anhängen"} (${sizeText(r.blob.size)})${r.missing ? ` – ${r.missing} nicht auf diesem Gerät` : ""}`);
  };
  const openFile = async () => {
    const f = await pickFile(".json,.lage.json,.zip,.lage.zip,application/json,application/zip");
    if (!f) return;
    try {
      const { exerciseFromAny } = await import("./exportZip");
      const { ex: x, files } = await exerciseFromAny(f, putAttachmentBlob);
      forgetBlobUrls();
      setEx(x);
      setSelSheet(null);
      say(`«${x.name}» geladen${files ? ` (${files} ${files === 1 ? "Anhang" : "Anhänge"})` : ""}`);
    } catch (e) {
      say((e as Error).message);
    }
  };

  const onGeorefAreas = (areas: Area[]) => {
    update((x) => { x.areas.push(...areas); return x; });
    say(`${areas.length} Fläche${areas.length === 1 ? "" : "n"} übernommen`);
  };

  const togglePresent = (on: boolean) => {
    setPresent(on);
    try {
      if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* egal */ }
    window.setTimeout(() => sm.current?.map.invalidateSize(), 80);
  };
  // Präsentation: Esc beendet, ←/→ vorherige/nächste Meldung
  useEffect(() => {
    if (!present) return;
    const key = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (ev.key === "Escape") { togglePresent(false); return; }
      if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        const list = (ex?.events ?? []).filter((e) => !e.deleted).sort((a, b) => a.t.localeCompare(b.t) || a.id.localeCompare(b.id));
        if (!list.length) return;
        const i = list.findIndex((e) => e.id === selEvent);
        const j = i < 0 ? (ev.key === "ArrowRight" ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, i + (ev.key === "ArrowRight" ? 1 : -1)));
        const e = list[j]!;
        setSelEvent(e.id); setTCursor(e.t); focusEvent(e);
        ev.preventDefault();
      }
    };
    const fs = () => { if (!document.fullscreenElement) window.setTimeout(() => sm.current?.map.invalidateSize(), 80); };
    window.addEventListener("keydown", key);
    document.addEventListener("fullscreenchange", fs);
    return () => { window.removeEventListener("keydown", key); document.removeEventListener("fullscreenchange", fs); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ex) return (
    <div className="app">
      <div className="loading">Wird geladen …</div>
      {dbBlocked && <div className="toast dbblocked" role="alert">Speicher blockiert: Bitte andere (ältere) Lagejournal-Fenster schliessen – dann geht es hier automatisch weiter.</div>}
    </div>
  );
  const cell = cursor ? cellAtAny(ex.sheets, cursor) : null;
  const sel = ex.sheets.find((s) => s.id === selSheet) ?? null;
  const hasBlatt = ex.sheets.some((s) => s.variant === "blatt");

  return (
    <KiProvider ex={ex} t={tNow} update={update} say={say}>
    <div className={"app" + (present ? " present" : "") + (night ? " night" : "")}>
      <header className="bar">
        <div className="brand">
          <strong title={tagline}>{product}</strong>
          {(ex.events ?? []).some((e) => !e.deleted) ? <Stats events={ex.events ?? []} /> : <span className="tag">{tagline}</span>}
          {!online && <span className="netbadge" title="Kein Netz – Journal und gespeicherte Karten funktionieren weiter">offline</span>}
        </div>
        <div className="tools">
          <input className="exname" value={ex.name} onChange={(e) => update((x) => { x.name = e.target.value; return x; })} aria-label="Name der Übung" />
          <select aria-label="Gespeicherte Übungen" value="" onChange={async (e) => {
            const v = e.target.value;
            if (v === "__new") { const x = newExercise(); setEx(x); setSelSheet(null); return; }
            if (v === "__demo") { const x = demoExercise(); setEx(x); setSelSheet(null); setTCursor(null); say("Beispielübung geladen (fiktiv, Raum Bern)"); return; }
            const x = await loadExercise(v);
            if (x) { setEx(x); setSelSheet(null); }
          }}>
            <option value="" disabled>Übungen …</option>
            <option value="__new">+ Neue Übung</option>
            <option value="__demo">Beispiel (fiktiv) laden</option>
            {saved.filter((s) => s.id !== ex.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={openFile}>Öffnen</button>
          <button onClick={saveFile}>Speichern</button>
          <KiMenuButton />
          <button className={"iconbtn" + (night ? " on" : "")} onClick={() => setNight(!night)} title="Nachtbetrieb: Karte abdunkeln" aria-pressed={night}>☾</button>
          <button className="primary" onClick={() => togglePresent(true)} title="Karte im Vollbild, Zeitstrahl oben (Esc beendet)">▶ Präsentation</button>
        </div>
      </header>
      <div className="work">
        <aside className="side">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "journal"} onClick={() => setTab("journal")}>Journal</button>
            <button role="tab" aria-selected={tab === "hinweise"} onClick={() => setTab("hinweise")} title={nNew ? `${nNew} offene Hinweise zu Rot` : "Hinweise zu Rot"}>
              Hinweise{nNew > 0 && <span key={pulse} className={"tab-n" + (nHoch ? "" : " mittel") + (pulse ? " pulse" : "")} aria-label={`${nNew} offen`}>{nNew}</span>}
            </button>
            <button role="tab" aria-selected={tab === "raster"} onClick={() => setTab("raster")}><span className="tab-l-long">Führungsraster</span><span className="tab-l-short">Raster</span></button>
            <button role="tab" aria-selected={tab === "nai"} onClick={() => setTab("nai")}><span className="tab-l-long">NAI / BNB</span><span className="tab-l-short">NAI</span></button>
          </div>
          {georef ? (
            <GeorefPane candidates={georef} map={sm.current!.map} existing={ex.areas} onAreas={onGeorefAreas} onClose={() => { setGeoref(null); setTab("nai"); }} />
          ) : !mapReady || !sm.current ? (
            <div className="panel"><p className="help">Karte wird geladen …</p></div>
          ) : tab === "journal" ? (
            <JournalPanel ex={ex} map={sm.current!.map} device={device} selected={selEvent}
              win={winFrom ? { from: winFrom, to: tNow } : null} onWinClear={() => setWin({ mode: "alles" })}
              onSelect={selectEvent} reportAt={reportAt} editRequest={editReq}
              onGoto={(t) => setTab(t)} onDemo={() => { const x = demoExercise(); setEx(x); setSelSheet(null); setTCursor(null); say("Beispielübung geladen (fiktiv, Raum Bern)"); }} update={update} say={say} onExport={exportJournal}
              quality={quality} />
          ) : tab === "hinweise" ? (
            <HintsPanel ex={ex} hints={hints} t={tNow} selected={selHint} onSelect={setSelHint}
              onMap={focusHint} onEvent={selectEvent} update={update} winFrom={winFrom} onWinClear={() => setWin({ mode: "alles" })}
              onCsv={() => downloadText(`Hinweise_${safeFileName(ex.name)}.csv`, hintsToCsv(ex, hints) + lageRotCsv(ex, lageRot, tNow), "text/csv;charset=utf-8")}
              lead={<LageRotPanel ex={ex} lage={lageRot} t={tNow} selected={selCoa} onSelect={selectCoa} onMap={focusCoa}
                onHint={coaHint} onEvent={selectEvent} update={update} />} />
          ) : tab === "raster" ? (
            <div className="panel">
              {ex.sheets.length === 0 && (
                <div className="empty">
                  <p>Noch kein Führungsraster. Wähle eine Variante und ziehe auf der Karte ein Rechteck über den Raum.</p>
                </div>
              )}
              <div className="btnrow">
                <button className="primary" onClick={() => addSheet(hasBlatt ? "detail" : "gesamt")}>{hasBlatt ? "+ Detailblatt" : "+ Blatt-Raster (Gesamtblatt)"}</button>
                <button onClick={() => addSheet("feld")}>+ Feld-Raster</button>
              </div>
              <ul className="list">
                {ex.sheets.map((s) => (
                  <li key={s.id} className={s.id === selSheet ? "sel" : ""}>
                    <button className="row" onClick={() => { setSelSheet(s.id); fitSheet(s); }}>
                      <b>{s.name}</b>
                      <span className="mono">{s.variant === "blatt" ? `${s.colLabels[0]}–${s.colLabels.at(-1)} · 1–${s.rowLabels.length}` : `A–${s.rowLabels.at(-1)} · 1–${s.colLabels.length}`} · {s.cellW} m</span>
                    </button>
                  </li>
                ))}
              </ul>
              {sel && <SheetForm sheet={sel} onPatch={(p) => patchSheet(sel.id, p)} onPdf={(paper) => pdf(sel, paper)}
                onDelete={() => { update((x) => { x.sheets = x.sheets.filter((s) => s.id !== sel.id); return x; }); setSelSheet(null); }} />}
              {ex.sheets.length > 0 ? <OfflineBox ex={ex} map={sm.current.map} /> : <p className="help">Karte für den Einsatz ohne Netz speichern: zuerst ein Raster anlegen.</p>}
            </div>
          ) : (
            <NaiPanel exercise={ex} selected={selArea} onSelect={(id) => setSelArea(id)} map={sm.current!.map}
              onChange={(areas: Area[]) => update((x) => { x.areas = areas; return x; })}
              onOverlays={(o) => update((x) => { x.overlays = o; return x; })}
              onImage={(c) => setGeoref(c)} say={say} />
          )}
        </aside>
        <main className="mapwrap">
          {(tab === "journal" || (ex.events ?? []).some((e) => !e.deleted)) && (
            <SwimTimeline events={ex.events ?? []} days={ex.days} units={ex.units} value={tCursor} onChange={setTCursor}
              selectedId={selEvent} compact={present} win={win} onWin={setWin}
              onSelect={(id) => { setSelEvent(id); setTab("journal"); const e = (ex.events ?? []).find((x) => x.id === id); if (e) { setTCursor(e.t); focusEvent(e); } }}
              extra={present ? <>
                <button className={"swt-chip" + (presentHints ? " on" : "")} aria-pressed={presentHints} onClick={() => { setPresentHints(!presentHints); window.setTimeout(() => sm.current?.map.invalidateSize(), 50); }}
                  title="Hinweise zu Rot als Spalte rechts">Hinweise{nNew ? ` (${nNew})` : ""}</button>
                <button className="swt-chip" onClick={() => togglePresent(false)}>Präsentation beenden (Esc)</button>
              </> : undefined} />
          )}
          <div className="mapbox">
          <div ref={el} className="map" />
          {present && presentHints && (
            <aside className="hp-present" aria-label="Hinweise zu Rot">
              <HintsPanel ex={ex} hints={hints} t={tNow} selected={selHint} onSelect={setSelHint} compact
                onMap={focusHint} onEvent={(id) => { const e = (ex.events ?? []).find((x) => x.id === id); setSelEvent(id); if (e) focusEvent(e); }} update={update}
                lead={<LageRotPanel ex={ex} lage={lageRot} t={tNow} selected={selCoa} onSelect={selectCoa} onMap={focusCoa} compact
                  onHint={coaHint}
                  onEvent={(id) => { const e = (ex.events ?? []).find((x) => x.id === id); setSelEvent(id); if (e) focusEvent(e); }} update={update} />} />
            </aside>
          )}
          {mapReady && sm.current && (
            <>
              <div className="maptools">
                <MapSearch ex={ex} map={sm.current.map} onSelectEvent={(id) => { setTab("journal"); setSelEvent(id); const e = (ex.events ?? []).find((x) => x.id === id); if (e && tCursor && e.t > tCursor) setTCursor(e.t); }} />
                <MapToolbar map={sm.current.map} basemap={basemap} onBasemap={(b) => { setBasemap(b); sm.current?.setBasemap(b); }}
                  flags={flags} onFlags={setFlags} onFitAll={() => fitAll(ex)} canFitAll={ex.sheets.length + ex.areas.length > 0} />
              </div>
              <EventBanner event={(ex.events ?? []).find((e) => e.id === selEvent && !e.deleted) ?? null} days={ex.days} onClose={() => setSelEvent(null)}
                extra={(() => { const e = (ex.events ?? []).find((x) => x.id === selEvent); if (!e?.attachments?.length) return null; const all = attachmentsOf(ex, e.attachments); const fotos = all.filter((a) => a.kind === "foto"); const memos = all.filter((a) => a.kind === "audio"); return <>{fotos.length ? <AttachmentChips list={fotos} size={22} /> : null}{memos.length ? <RowMemos list={memos} /> : null}</>; })()}
                onEdit={present ? undefined : (e) => { setTab("journal"); setEditReq({ id: e.id, n: Date.now() }); }} />
              {flags.legende && <Legend events={ex.events ?? []} t={tNow} flags={flags} areas={ex.areas} selectedId={selEvent} from={winFrom} />}
              <MapContextMenu map={sm.current.map} sheets={ex.sheets} onReportHere={(pos) => { setTab("journal"); setReportAt({ pos, n: Date.now() }); }} />
            </>
          )}
          {drawing && <div className="hint">{drawing} · Esc = Abbrechen</div>}
          <div className="status mono" aria-live="polite">
            {cursor ? <>{formatLv95(cursor)}{cell ? <> · <b>{cell.label}</b></> : null}</> : "Maus über die Karte bewegen"}
          </div>
          </div>
        </main>
      </div>
      {busy && <div className="busy"><div>{busy}</div></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
      {mover.notice}
      <ViewerHost />
      {dbBlocked && <div className="toast dbblocked" role="alert">Speicher blockiert: Bitte andere (ältere) Lagejournal-Fenster schliessen – dann geht es hier automatisch weiter.</div>}
    </div>
    </KiProvider>
  );
}

const CELL_OPTIONS = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1500, 2000];

function SheetForm({ sheet, onPatch, onPdf, onDelete }: {
  sheet: RasterSheet;
  onPatch: (p: SheetPatch) => void;
  onPdf: (paper: "A4" | "A3") => void;
  onDelete: () => void;
}) {
  const prefix = sheet.variant === "blatt" ? sheet.colLabels[0]!.slice(0, -1) : "";
  const cells = CELL_OPTIONS.includes(sheet.cellW) ? CELL_OPTIONS : [...CELL_OPTIONS, sheet.cellW].sort((a, b) => a - b);
  return (
    <div className="form">
      <label>Codename<input value={sheet.name} onChange={(e) => onPatch({ name: e.target.value })} /></label>
      {sheet.variant === "blatt" && (
        <label>Präfix<input value={prefix} maxLength={1} onChange={(e) => onPatch({ prefix: e.target.value })} className="short mono" /></label>
      )}
      <label>Feldgrösse
        <select value={sheet.cellW} onChange={(e) => onPatch({ cellSize: +e.target.value })}>
          {cells.map((v) => <option key={v} value={v}>{v} m</option>)}
        </select>
      </label>
      <div className="two">
        <label>Spalten<input type="number" min={2} max={sheet.variant === "blatt" ? 26 : 60} value={sheet.colLabels.length} onChange={(e) => onPatch({ cols: Math.max(2, +e.target.value || 2) })} /></label>
        <label>Zeilen<input type="number" min={2} max={60} value={sheet.rowLabels.length} onChange={(e) => onPatch({ rows: Math.max(2, +e.target.value || 2) })} /></label>
      </div>
      <label>Karte
        <select value={sheet.basemap} onChange={(e) => onPatch({ basemap: e.target.value as "lk" | "img" })}>
          <option value="lk">Landeskarte</option>
          <option value="img">Luftbild</option>
        </select>
      </label>
      <label>Klassifizierung<input value={sheet.classification} onChange={(e) => onPatch({ classification: e.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={sheet.quadrants} onChange={(e) => onPatch({ quadrants: e.target.checked })} /> Unterquadranten A B / D C</label>
      <div className="btnrow">
        <button className="primary" onClick={() => onPdf("A4")}>PDF A4</button>
        <button className="primary" onClick={() => onPdf("A3")}>PDF A3</button>
        <button className="danger" onClick={onDelete}>Löschen</button>
      </div>
    </div>
  );
}

/** Kopfzahlen für das LVZ: Meldungen, eigene Elemente, Sichtungen, letzte Meldung */
function Stats({ events }: { events: LageEvent[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(id); }, []);
  const live = events.filter((e) => !e.deleted);
  if (!live.length) return null;
  const own = new Set(live.flatMap((e) => [e.melder, e.side === "blau" ? e.unit : undefined]).filter((u): u is string => !!u).map((u) => u.toLowerCase())).size;
  const sight = live.filter((e) => e.side === "rot").length;
  const last = live.reduce((m, e) => (e.t > m ? e.t : m), "");
  const ago = Math.round((now - Date.parse(last)) / 60000);
  return (
    <span className="stats" aria-label="Kopfzahlen">
      <span><b className="tnum">{live.length}</b> {live.length === 1 ? "Meldung" : "Meldungen"}</span>
      <span><b className="tnum">{own}</b> {own === 1 ? "eigenes Element" : "eigene Elemente"}</span>
      <span><b className="tnum">{sight}</b> {sight === 1 ? "Sichtung" : "Sichtungen"}</span>
      {ago >= 0 && ago < 24 * 60 && <span>letzte vor <b className="tnum">{ago < 60 ? `${ago}′` : `${Math.floor(ago / 60)} h ${ago % 60}′`}</b></span>}
    </span>
  );
}
