/**
 * Arbeitsfläche Lagejournal (MVP 1): nur Zustand und Verdrahtung. Anordnung in `shell/AppShell.tsx`, Kopf und Menü in
 * `shell/`, Modus «Vorbereiten» in `prepare/`, Zeit in `time/` (Paket C). Speichern/Abgleich unverändert aus MVP 0
 * (`useExerciseStore`, `persist.ts`), ebenso Speicherbänder, Zusammenführen beim Öffnen und Rückgängig.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  cellAtAny,
  exerciseToFile,
  formatLv95,
  journalToCsv,
  findCells,
  cellBounds,
  catalogEntry,
  type Bounds,
  newDeviceId,
  demoExercise,
  newExercise,
  sheetBounds,
  reviseEvent,
  type Exercise,
  type LageEvent,
  type LV95,
  mergeExercise,
  mergeReportText,
  markRemovals,
  takeHullItems,
  compareEvents,
  KI_PURPOSE_LABEL,
  type Hint,
  type RedCoa,
} from "@lage/core";
import {
  AffineImageLayer,
  areasLayer,
  toLatLng,
  createSwissMap,
  enableCellZoom,
  flyToBoundsSharp,
  rasterLayer,
  symbolIcon,
  toLv95,
  type Basemap,
  type SwissMap,
} from "@lage/map";
import { currentExerciseId, downloadText, getBlob, listExercises, onDbNotice, pickFile, safeFileName } from "./store";
import { lastCurrent, openStored, peekStored, persister, requestPersist } from "./persist";
import { useExerciseStore } from "./useExerciseStore";
import { beispielAusUrl, beispielAusUrlEntfernen, beispielSchichtSetzen, beispielUebung } from "./beispiel";
import { MergeBar, StatusBands, type MergeInfo } from "./SaveBand";
import { useUndo } from "./undo";
import { AttachmentChips, ViewerHost, openViewer } from "./Attachments";
import { RowMemos } from "./VoiceInput";
import { attachmentLayer, attachmentsOf, forgetBlobUrls, putAttachmentBlob, useAttachmentGc } from "./attachmentStore";
import { JournalPanel } from "./JournalPanel";
import { situationLayer, whenNotDragging } from "./situationLayer";
import { shapeLayer } from "./shapeLayer";
import { EventBanner, Legend } from "./MapOverlays";
import { MapToolbar } from "./MapToolbar";
import { MapContextMenu } from "./MapContextMenu";
import { effectiveFlags, flagVariant, loadBasemap, loadFlags, saveBasemap, saveFlags, type FlagVariant, type LayerFlags } from "./layers";
import { useMoveEvent } from "./mapedit";
import { HintsPanel } from "./HintsPanel";
import { hintExtent, hintLayer } from "./hintLayer";
import { redBadge, useHints } from "./hintsData";
import { hintsToCsv } from "./hintsExport";
import { LageRotPanel } from "./LageRotPanel";
import { coaEventIds, useLageRot } from "./lageRot";
import { coaExtent, coaLayer } from "./coaLayer";
import { MapTipHost, coaTip, hintTip, showMapTip, tipOnMap } from "./MapTipSheet";
import { lageRotCsv } from "./lageRotExport";
import { KiProvider, useKi } from "./ki/context";
import { kiPdfNote } from "./ki/settings";
import { SpeechSettings } from "./SpeechSettings";
import { LAGE_KARTE } from "./colors";
import { useOfflineStatus } from "./offlineStatus";
import { useLageZeit, lastReportUntil } from "./time/useLageZeit";
import { RueckblickBanner } from "./time/RueckblickBanner";
import { TimeBand } from "./time/TimeBand";
import { RedPanel, RedTabLabel } from "./red/RedPanel";
import { AppShell, SideSwitch, type SideView } from "./shell/AppShell";
import { requestCorrection } from "./entry/useEntryDraft";
import { Header, useSaveStatus } from "./shell/Header";
import { MainMenu, APP_VERSION } from "./shell/MainMenu";
import { ExerciseList } from "./shell/ExerciseList";
import { Dialog } from "./shell/Dialog";
import { useArbeitsweise } from "./shell/mode";
import { PrepareMode, type PrepStep } from "./prepare/PrepareMode";

/**
 * `f` nach dem nächsten gezeichneten Bild ausführen (rAF → Task): so erscheinen Feld, Liste und Band sofort, die
 * teuren Kartenebenen kommen gleich danach. Gibt die Aufräumfunktion für `useEffect` zurück (neuerer Auftrag ersetzt).
 */
function afterPaint(f: () => void): () => void {
  let t: number | undefined;
  const raf = requestAnimationFrame(() => { t = window.setTimeout(f, 0); });
  return () => { cancelAnimationFrame(raf); if (t !== undefined) window.clearTimeout(t); };
}

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

type DialogKind = "uebungen" | "hilfe" | "ueber" | "sprache" | null;

export function Workspace({ product, tagline }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const sm = useRef<SwissMap | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [ex, setEx] = useState<Exercise | null>(null);
  const [, setSaved] = useState<Array<{ id: string; name: string }>>([]);
  // ---------- Arbeitsweise (Modus, Experte), Ansicht der Spalte, Vorbereiten-Schritt
  const { aw, setModus, setExperte } = useArbeitsweise();
  const experte = aw.experte;
  const lage = aw.modus === "lage";
  const [sideView, setSideView] = useState<SideView>("journal");
  const [prepStep, setPrepStep] = useState<PrepStep | null>(null);
  // ---------- Ebenen und Grundkarte, getrennt für Basis und Experte (pro Gerät)
  const fv: FlagVariant = flagVariant(experte);
  const [flagsBy, setFlagsBy] = useState<Record<FlagVariant, LayerFlags>>(() => ({ basis: loadFlags("basis"), experte: loadFlags("experte") }));
  const userFlags = flagsBy[fv];
  const setUserFlags = (f: LayerFlags) => { setFlagsBy((x) => ({ ...x, [fv]: f })); saveFlags(fv, f); };
  const flags = useMemo(() => effectiveFlags(aw, userFlags), [aw, userFlags]);
  const [baseBy, setBaseBy] = useState<Record<FlagVariant, Basemap>>(() => ({ basis: loadBasemap("basis"), experte: loadBasemap("experte") }));
  const basemap = baseBy[fv];
  const setBasemap = (b: Basemap) => { setBaseBy((x) => ({ ...x, [fv]: b })); saveBasemap(fv, b); };
  useEffect(() => { sm.current?.setBasemap(basemap); }, [basemap]);

  const [reportAt, setReportAt] = useState<{ pos: LV95; n: number } | null>(null);
  const [present, setPresent] = useState(false);
  /** «Korrigieren» von der Karte, solange das Meldungsfeld noch nicht eingehängt ist (Modus Vorbereiten) */
  const pendingCorr = useRef<string | null>(null);
  // Nacht: beim Erststart wie die Systemeinstellung (dunkel → Nacht an), danach die Wahl des Benutzers
  const [night, setNight] = useState(() => {
    let v: string | null = null;
    try { v = localStorage.getItem("lage-tools.night"); } catch { /* egal */ }
    if (v === "1" || v === "0") return v === "1";
    try { return matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("lage-tools.night", night ? "1" : "0"); } catch { /* egal */ }
    // Nacht: dunkle Oberfläche (data-theme), Karte abgedunkelt (shell.css)
    const root = document.documentElement;
    if (night) root.setAttribute("data-theme", "dark"); else if (root.getAttribute("data-theme") === "dark") root.removeAttribute("data-theme");
  }, [night]);
  const [selEvent, setSelEvent] = useState<string | null>(null);
  const journalRef = useRef<L.LayerGroup | null>(null);
  const device = useRef(deviceId()).current;
  const [selSheet, setSelSheet] = useState<string | null>(null);
  const [selArea, setSelArea] = useState<string | null>(null);
  const [cursor, setCursor] = useState<LV95 | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);

  const say = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? null : x)), 4000);
  }, []);

  // ---------- Kopf: Speicher- und Offline-Status
  const saveStatus = useSaveStatus();
  const offline = useOfflineStatus(ex);

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
      const id = lastCurrent() ?? await currentExerciseId();
      const loaded = id ? (await openStored(id).catch(() => null))?.ex ?? null : null;
      setSaved(await listExercises());
      setEx((cur) => {
        const untouched = cur && cur.id === fallbackId.current && !(cur.events ?? []).length && !cur.sheets.length && !cur.areas.length;
        fallbackId.current = null;
        return untouched && loaded ? loaded : cur;
      });
    })();
  }), []);

  // Übung laden (mit Notfall-Puffer: was beim letzten Mal noch nicht in der Datenbank war)
  useEffect(() => {
    (async () => {
      // Testzugang ?beispiel / ?beispiel=leer / ?beispiel=lang (beispiel.ts): ersetzt nur die Beispielübung, wie «Beispiel ansehen»
      const art = beispielAusUrl();
      if (art) {
        const b = beispielUebung(art);
        // MVP 3: Schicht «BSP» auf diesem Gerät (leer: keine – dort fragt das Meldungsfeld); noch ohne Anzeige
        beispielSchichtSetzen(art, b);
        void persister.writeAll(b, true);
        void requestPersist();
        setEx(b);
        beispielAusUrlEntfernen();
        setSaved(await listExercises());
        return;
      }
      const id = lastCurrent() ?? await currentExerciseId().catch(() => null);
      let r = id ? await openStored(id).catch(() => null) : null;
      if (!r && id) { const db = await currentExerciseId().catch(() => null); if (db && db !== id) r = await openStored(db).catch(() => null); }
      const next = r?.ex ?? newExercise();
      if (!r && dbBlockedRef.current) fallbackId.current = next.id;
      setEx(next);
      if (r?.recovered) say(`${r.recovered} ${r.recovered === 1 ? "Änderung" : "Änderungen"} aus dem Notfallpuffer übernommen`);
      setSaved(await listExercises());
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Karte
  useEffect(() => {
    if (!el.current || sm.current) return;
    const s = createSwissMap(el.current, { center: { e: 2660000, n: 1190000 }, zoom: 16, basemap });
    sm.current = s;
    s.map.on("mousemove", (ev: L.LeafletMouseEvent) => setCursor(toLv95(ev.latlng)));
    s.map.on("mouseout", () => setCursor(null));
    // Zoom ± zählt im Inventar als ein Element (Kap. 7.2)
    s.map.zoomControl?.getContainer()?.setAttribute("data-zaehl", "zoom");
    // Grösse der Karte ändert sich (Band, Fenster, Seitenleiste) → Leaflet informieren
    const ro = new ResizeObserver(() => s.map.invalidateSize({ pan: false }));
    ro.observe(el.current);
    s.map.doubleClickZoom.disable();
    enableCellZoom(s.map, () => exRef.current?.sheets ?? []);
    setMapReady(true);
  }, [ex === null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { sm.current?.map.remove(); sm.current = null; }, []);

  // Raster, NAI, Bilder: im Modus Lage leise und nicht bearbeitbar, in Vorbereiten bearbeitbar (gewähltes Raster kräftig)
  useEffect(() => {
    const s = sm.current;
    if (!s || !ex) return;
    layerRef.current?.remove();
    const g = L.layerGroup();
    for (const o of ex.overlays ?? []) if (o.visible) g.addLayer(new AffineImageLayer(o.dataUrl, o.width, o.height, o.affine, o.opacity));
    if (flags.raster) for (const sh of ex.sheets) g.addLayer(rasterLayer(s.map, sh, lage ? { quiet: true } : sh.id === selSheet ? { color: LAGE_KARTE.ink } : { quiet: true }));
    // NAI mit zugeteiltem Trupp: «NAI 2 · H03»
    const areas = ex.areas.map((a) => (a.kind === "nai" && a.trupp ? { ...a, name: `${a.name} · ${a.trupp}` } : a));
    if (flags.nai) g.addLayer(areasLayer(areas, {
      selectedId: lage ? undefined : selArea ?? undefined,
      onClick: lage ? (a) => say(a.name) : (a) => { setPrepStep(3); setSelArea(a.id); },
    }));
    g.addTo(s.map);
    layerRef.current = g;
  }, [ex, selSheet, selArea, mapReady, flags.raster, flags.nai, lage]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Lagezeit (Paket C): LIVE / Rückblick, «Zeige letzte»
  const zeit = useLageZeit({ exId: ex?.id, events: ex?.events, say });
  const tNow = zeit.tNow;
  const winFrom = zeit.from;
  /**
   * Karte und «Was Rot» rechnen mit einer verzögerten Fassung (useDeferredValue): nach Enter, Zeitwechsel oder
   * «Zeige letzte» zeichnet React zuerst Feld, Liste und Band; Kartenebenen und Hinweise folgen im nächsten Durchgang
   * (800 Meldungen, Feld-Tablet: sonst blockiert der Neuaufbau der Karte die Antwort der Liste).
   */
  const exLater = useDeferredValue(ex);
  const tLater = useDeferredValue(tNow);
  const fromLater = useDeferredValue(winFrom);
  useEffect(() => { zeit.suspend("praesentation", present); }, [present]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { zeit.suspend("dialog", dialog !== null); }, [dialog]); // eslint-disable-line react-hooks/exhaustive-deps
  const suspendMenu = useCallback((key: string) => (o: boolean) => zeit.suspend(key, o), [zeit.suspend]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Hinweise zu Rot: folgen der Lagezeit, nie «Zeige letzte» (Entscheid: «Was Rot» rechnet immer über alles)
  const { hints, quality, all: allHints } = useHints(exLater, tLater, null);
  const [selHint, setSelHint] = useState<string | null>(null);
  const [presentHints, setPresentHints] = useState(false);
  const hintSel = hints.find((h) => h.id === selHint) ?? null;
  const redVisible = present ? presentHints : lage && sideView === "rot";
  /** gewählter Hinweis hebt seine Auslöser hervor – nur solange «Was Rot» sichtbar ist */
  const hintFocus = !!hintSel && redVisible;
  const lageRot = useLageRot(exLater, tLater, allHints, null);
  const [selCoa, setSelCoa] = useState<string | null>(null);
  const coaSel = lageRot.coas.find((c) => c.id === selCoa) ?? null;
  const coaFocus = !!coaSel && redVisible;
  useEffect(() => { if (selHint) setSelCoa(null); }, [selHint]);
  const hintHl = (() => {
    if (coaFocus && coaSel) return coaEventIds(coaSel, lageRot.hints);
    if (!hintFocus || !hintSel) return null;
    const ids = new Set(hintSel.events);
    if (hintSel.unit) for (const e of ex?.events ?? []) if (e.side === "blau" && e.unit === hintSel.unit) ids.add(e.id);
    return ids;
  })();
  // Entscheide («Trifft nicht zu») sofort aus der aktuellen Übung, nur die Hinweise selbst sind verzögert gerechnet
  const badge = redBadge(ex, hints, tLater);
  const showRed = () => { setModus("lage"); setSideView("rot"); };

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
      // Ergebnisse gesammelt übernehmen (eine Änderung pro Schub statt pro Meldung: 800 Meldungen aus einer Datei
      // lösten sonst 800 Neuaufbauten von Karte, Hinweisen und Speicher aus) und zwischendurch dem Browser Zeit lassen
      const done = new Map<string, { e: LageEvent; pl: NonNullable<Awaited<ReturnType<typeof placeOnRoadTry>>["pl"]> }>();
      const flush = () => {
        if (!done.size || exRef.current?.id !== exId) { done.clear(); return; }
        const batch = new Map(done);
        done.clear();
        update((x) => {
          x.events = (x.events ?? []).map((y) => {
            const r = batch.get(y.id);
            if (!r) return y;
            const { e, pl } = r;
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
      };
      let slice = performance.now(), sinceFlush = performance.now();
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
          done.set(e.id, { e, pl });
          // höchstens ~40 ms am Stück rechnen, höchstens alle 400 ms eine Änderung
          if (performance.now() - sinceFlush > 400) { flush(); sinceFlush = performance.now(); }
          if (performance.now() - slice > 40) { await new Promise((r) => window.setTimeout(r, 16)); slice = performance.now(); }
        }
      } finally {
        flush();
        todo.forEach((e) => roadBusy.current.delete(e.id));
      }
    })();
  }, [ex?.events, ex?.id, roadRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lage zum Zeitpunkt (ruhige Karte in der Basis: Beschriftung nur Neues und Gewähltes)
  /** eigene Eingabe (Eintragen/Korrektur): die neuen Meldungen sofort als einfache Zeichen setzen (bis zum Neuaufbau) */
  const mapNow = useRef<string[] | null>(null);
  const pendingRef = useRef<L.LayerGroup | null>(null);
  /** womit die Lageebene zuletzt gebaut wurde – gleiche Angaben → kein zweiter Neuaufbau */
  const builtKey = useRef<unknown[] | null>(null);
  const hlKey = hintHl ? [...hintHl].join() : "";
  const buildSituation = (s: SwissMap, x: Exercise, t: string, from: string | null) => {
    const key = [x.events, x.sheets, t, from, flags, selEvent, present, experte, hlKey, mapReady];
    if (builtKey.current && key.length === builtKey.current.length && key.every((v, i) => v === builtKey.current![i])) return;
    // nicht während ein Zeichen gezogen wird (Live-Takt, Abgleich, Abspielen …): nach dem Loslassen nachholen
    whenNotDragging(s.map, () => {
      builtKey.current = key;
      journalRef.current?.remove();
      pendingRef.current?.remove();
      pendingRef.current = null;
      const g = situationLayer(s.map, x.events ?? [], {
        t, flags, selectedId: selEvent, sheets: x.sheets, days: x.days, from, quiet: !experte,
        onClick: (e) => { setSideView("journal"); selectEventRef.current(e.id); },
        onMove: present ? undefined : mover.move,
        highlight: hintHl,
      });
      g.addTo(s.map);
      journalRef.current = g;
    });
  };
  // eigene Eingabe: im selben Durchgang wie die neue Zeile ein einfaches Zeichen am Ort (die volle Lageebene mit Stapeln,
  // Beschriftung und Hinweisen folgt nach dem nächsten Bild – ein voller Neuaufbau kostet bei 800 Meldungen zu viel)
  useEffect(() => {
    const s = sm.current;
    const ids = mapNow.current;
    if (!ids || !s || !ex) return;
    mapNow.current = null;
    const g = pendingRef.current ?? L.layerGroup().addTo(s.map);
    pendingRef.current = g;
    for (const id of ids) {
      const e = (ex.events ?? []).find((x) => x.id === id);
      if (!e || e.deleted || !e.pos || e.t.slice(0, 16) > tNow || (winFrom && e.t < winFrom)) continue;
      L.marker(toLatLng(e.pos), { icon: symbolIcon(e.sym, e.aff, 18, { sidc: e.sidc, dir: e.dir }, "lt-ev lt-pending"), interactive: false, keyboard: false, zIndexOffset: 900 }).addTo(g);
    }
  }, [ex?.events]); // eslint-disable-line react-hooks/exhaustive-deps
  // sonst: mit der verzögerten Fassung nach dem nächsten Bild (Feld, Liste und Band sind dann schon gezeichnet);
  // ein neuerer Auftrag ersetzt den offenen, solange die verzögerte Fassung nachhinkt wird nichts gebaut
  useEffect(() => {
    const s = sm.current;
    const x = exLater;
    if (!s || !x || x !== ex || tLater !== tNow || fromLater !== winFrom) return;
    return afterPaint(() => buildSituation(s, x, tLater, fromLater));
  }, [exLater?.events, exLater?.sheets, ex?.events, tLater, tNow, fromLater, winFrom, flags, selEvent, mapReady, present, experte, hlKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flächen- und Linienzeichen (unter den Zeichen)
  const shapeRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const s = sm.current;
    const x = exLater;
    if (!s || !x) { shapeRef.current?.remove(); shapeRef.current = null; return; }
    return afterPaint(() => {
      shapeRef.current?.remove();
      const g = shapeLayer(x.events ?? [], {
        t: tLater, from: fromLater, flags, selectedId: selEvent, sheets: x.sheets, areas: x.areas, quiet: !experte,
        onClick: (e) => { setSideView("journal"); selectEventRef.current(e.id); },
      });
      g.addTo(s.map);
      shapeRef.current = g;
    });
  }, [exLater?.events, exLater?.sheets, exLater?.areas, tLater, fromLater, flags, selEvent, mapReady, experte]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fotos an Planquadraten (Experte «Fotos»): Kamera-Symbol, Klick öffnet den Betrachter
  const attRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const s = sm.current;
    attRef.current?.remove();
    attRef.current = null;
    if (!s || !ex || flags.anhaenge === false || !(ex.attachments ?? []).some((a) => a.cell)) return;
    attRef.current = attachmentLayer(ex, (list) => openViewer(list, 0, `Fotos an ${list[0]!.cell}`)).addTo(s.map);
  }, [ex?.attachments, ex?.sheets, flags.anhaenge, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hinweise auf der Karte: Basis nur der gewählte, Experte nach Ebene
  const hintRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const s = sm.current;
    hintRef.current?.remove();
    hintRef.current = null;
    if (!s || !ex || !(flags.hinweise || redVisible)) return;
    const g = hintLayer(s.map, {
      hints, ex: exLater ?? ex, t: tLater, selectedId: selHint, focus: hintFocus, onlySelected: !experte,
      onClick: (h) => {
        // Handy: Blatt über der Karte statt Seitensprung (MapTipSheet)
        if (!present && tipOnMap()) { setSelHint(h.id); showMapTip(hintTip(h, () => { showRed(); setSelHint(h.id); })); return; }
        if (present) setPresentHints(true); else showRed();
        setSelHint(h.id);
      },
    });
    g.addTo(s.map);
    hintRef.current = g;
  }, [hints, selHint, hintFocus, flags.hinweise, redVisible, present, presentHints, experte, ex?.hintDecisions, ex?.events, ex?.sheets, ex?.areas, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mögliche Aktionen Rot auf der Karte: Basis nur die gewählte
  const coaRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const s = sm.current;
    coaRef.current?.remove();
    coaRef.current = null;
    if (!s || !ex || !lageRot.coas.length || !(flags.aktionen || coaFocus)) return;
    const g = coaLayer(s.map, {
      coas: flags.aktionen ? lageRot.coas : lageRot.coas.filter((c) => c === coaSel), ex: exLater ?? ex, t: tLater, selectedId: selCoa, focus: coaFocus, onlySelected: !experte,
      onClick: (c) => {
        if (!present && tipOnMap()) { setSelHint(null); setSelCoa(c.id); showMapTip(coaTip(c, ex, tNow, () => { showRed(); setSelHint(null); setSelCoa(c.id); })); return; }
        if (present) setPresentHints(true); else showRed();
        setSelHint(null); setSelCoa(c.id);
      },
    });
    g.addTo(s.map);
    coaRef.current = g;
  }, [lageRot.coas, selCoa, coaFocus, flags.aktionen, flags.hinweise, flags.nai, present, experte, mapReady, hints]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectCoa = (id: string | null) => { setSelCoa(id); if (id) setSelHint(null); };
  /** Indikator-Hinweis einer Möglichkeit: Hinweis zeigen; liegt er ausserhalb «Zeige letzte», seine letzte Meldung */
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
      map.flyTo(toLatLng(e.pos), Math.max(map.getZoom(), 20), { duration: 0.6 });
    }
  };
  /** Meldung wählen: in LIVE ändert sich die Zeit nie; im Rückblick springt sie auf eine spätere Meldung (R7) */
  const selectEvent = (id: string | null) => {
    setSelEvent(id);
    const e = (ex?.events ?? []).find((x) => x.id === id);
    if (e && zeit.zeit.kind === "rueckblick" && e.t > zeit.zeit.t) zeit.lookBack(e.t);
    if (e) focusEvent(e);
  };
  const selectEventRef = useRef(selectEvent);
  selectEventRef.current = selectEvent;
  const correct = (id: string) => {
    setSideView("journal");
    if (lage && requestCorrection(id)) return;
    pendingCorr.current = id;
    setModus("lage");
  };
  useEffect(() => {
    if (!lage || !pendingCorr.current) return;
    const id = window.setTimeout(() => { if (pendingCorr.current && requestCorrection(pendingCorr.current)) pendingCorr.current = null; }, 0);
    return () => window.clearTimeout(id);
  });

  const exportJournal = async (kind: "csv" | "pdf") => {
    if (!ex) return;
    if (kind === "csv") { downloadText(`Lagejournal_${safeFileName(ex.name)}.csv`, journalToCsv(ex.events ?? [], ex.days), "text/csv;charset=utf-8"); return; }
    try {
      const { journalPdf } = await import("./journalpdf");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(journalPdf(ex, ex.sheets[0]?.classification ?? "INTERN", hints, { lage: lageRot, t: tNow }, kiPdfNote(ex, KI_PURPOSE_LABEL)));
      a.download = `Lagejournal_${safeFileName(ex.name)}.pdf`;
      a.click();
    } catch (e) {
      say("PDF konnte nicht erstellt werden: " + (e as Error).message + ".");
    }
  };
  const exportHints = () => { if (ex) downloadText(`Hinweise_${safeFileName(ex.name)}.csv`, hintsToCsv(ex, hints) + lageRotCsv(ex, lageRot, tNow), "text/csv;charset=utf-8"); };

  const fitAll = (x: Exercise) => {
    const pts: LV95[] = [];
    x.sheets.forEach((s) => { const b = sheetBounds(s); pts.push({ e: b.minE, n: b.minN }, { e: b.maxE, n: b.maxN }); });
    x.areas.forEach((a) => pts.push(...a.ring));
    if (!pts.length || !sm.current) return;
    const b = { minE: Math.min(...pts.map((q) => q.e)), minN: Math.min(...pts.map((q) => q.n)), maxE: Math.max(...pts.map((q) => q.e)), maxN: Math.max(...pts.map((q) => q.n)) };
    flyToBoundsSharp(sm.current.map, b, { duration: 0 });
  };
  // Beim Laden einpassen – erst wenn das Layout steht
  useEffect(() => {
    if (!ex || !sm.current) return;
    const id = window.setTimeout(() => { sm.current?.map.invalidateSize(); if (exRef.current) fitAll(exRef.current); }, 350);
    return () => window.clearTimeout(id);
  }, [ex?.id, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps
  // Modus/Experte gewechselt: Spalten- und Bandhöhe ändern sich
  useEffect(() => { const id = window.setTimeout(() => sm.current?.map.invalidateSize({ pan: false }), 60); return () => window.clearTimeout(id); }, [aw.modus, aw.experte]);

  const exRef = useRef<Exercise | null>(null);
  exRef.current = ex;
  // gelöschte Raster/NAI/Bilder bekommen eine Löschmarke (tauchen beim Zusammenführen nicht wieder auf)
  const update = (f: (x: Exercise) => Exercise) => setEx((x) => (x ? markRemovals(x, f(structuredClone(x))) : x));
  // Sofort speichern (jede Änderung, auch beim Verlassen der Seite) und mit anderen Fenstern abgleichen;
  // leere Ersatz-Übung bei blockierter Datenbank nicht als «aktuelle Übung» speichern
  useExerciseStore({ ex, exRef, setEx, setSaved, say,
    skip: (x) => fallbackId.current === x.id && !(x.events ?? []).length && !x.sheets.length && !x.areas.length });
  /** andere Übung zeigen: neu (alles schreiben), Beispiel (ersetzen) oder gespeichert */
  const switchTo = (x: Exercise, how: "neu" | "ersetzen") => {
    void persister.writeAll(x, how === "ersetzen");
    void requestPersist();
    setEx(x); setSelSheet(null); setSelArea(null); setSelEvent(null); setSelHint(null); setSelCoa(null);
  };
  const loadDemo = () => { switchTo(demoExercise(), "ersetzen"); setModus("lage"); say("Beispiel geladen (fiktiv, Raum Bern)"); };
  const openSaved = async (id: string) => {
    const r = await openStored(id).catch(() => null);
    if (!r) { say("Übung konnte nicht geöffnet werden."); return; }
    setEx(r.ex); setSelSheet(null); setSelArea(null); setSelEvent(null); setSelHint(null); setSelCoa(null);
    void requestPersist();
    setDialog(null);
  };
  // Rückgängig für Löschen (Raster, NAI, Bilder, Trupps, Übungen); Ergebnis von «Öffnen»
  const undo = useUndo();
  const [mergeInfo, setMergeInfo] = useState<MergeInfo | null>(null);
  // Speicher freigeben: Anhänge gelöschter Meldungen, verwaiste Fotos/Memos (still)
  useAttachmentGc(ex, update);
  // Zeichen auf der Karte verschoben → Ort der Meldung korrigieren (mit Rückgängig)
  const mover = useMoveEvent(update, device, ex);

  // ---------- Datei ----------
  // mit Anhängen (Fotos, Memos) als .lage.zip, sonst .lage.json
  const saveFile = async (): Promise<boolean> => {
    // neuester Stand (auch, was wegen eines Speicherfehlers nicht in der Datenbank ist)
    const cur = exRef.current;
    if (!cur) return false;
    try {
      if (!cur.attachments?.length) { downloadText(`${safeFileName(cur.name)}.lage.json`, exerciseToFile(cur)); return true; }
      const { exerciseFile, sizeText } = await import("./exportZip");
      const r = await exerciseFile(cur, safeFileName(cur.name), getBlob);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(r.blob); a.download = r.name; a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      say(`Gespeichert als ZIP mit ${r.files} ${r.files === 1 ? "Anhang" : "Anhängen"} (${sizeText(r.blob.size)})${r.missing ? ` – ${r.missing} nicht auf diesem Gerät` : ""}`);
      return true;
    } catch (e) {
      say("Datei konnte nicht erstellt werden: " + (e as Error).message);
      return false;
    }
  };
  /**
   * Öffnen = Zusammenführen: gibt es die Übung (gleiche ID) hier schon, gehen keine Meldungen verloren
   * (pro Meldung gilt die höhere Revision; Raster/NAI/Anhänge/Entscheide vereinigt). «Ersetzen» nur ausdrücklich.
   */
  const openFile = async () => {
    const f = await pickFile(".json,.lage.json,.zip,.lage.zip,application/json,application/zip");
    if (!f) return;
    try {
      const { exerciseFromAny } = await import("./exportZip");
      // Anhang nicht ablegbar (Speicher voll): Übung trotzdem öffnen, Fehler zeigt das rote Band
      const { ex: file, files } = await exerciseFromAny(f, (id, b) => putAttachmentBlob(id, b).catch(() => { /* gemeldet */ }));
      forgetBlobUrls();
      const att = files ? ` (${files} ${files === 1 ? "Anhang" : "Anhänge"})` : "";
      const cur = exRef.current;
      const local = cur?.id === file.id ? cur : await peekStored(file.id);
      void requestPersist();
      setSelSheet(null);
      if (!local) {
        switchTo(file, "neu");
        const n = (file.events ?? []).filter((e) => !e.deleted).length;
        setMergeInfo({ name: file.name, text: `${n} ${n === 1 ? "Meldung" : "Meldungen"}, neu auf diesem Gerät${att}`, nurHier: 0, replace: null });
        return;
      }
      const { ex: merged, report } = mergeExercise(local, file);
      void persister.writeAll(merged);
      // inzwischen hier Eingetragenes bleibt (nochmals zusammenführen)
      setEx((x) => (x && x.id === merged.id && x !== local ? mergeExercise(x, merged).ex : merged));
      setMergeInfo({
        name: merged.name, text: mergeReportText(report) + att, nurHier: report.nurHier,
        replace: () => { switchTo(file, "ersetzen"); setMergeInfo(null); say(`«${file.name}» durch die Datei ersetzt`); },
        // abweichendes Raster/NAI: pro Element hiesige behalten oder aus der Datei übernehmen (Meldungen bleiben)
        diffs: report.diffs,
        choose: (d, c) => update((x) => (x.id === merged.id ? takeHullItems(x, c === "datei" ? file : local, [d]) : x)),
        // gleiche Revision, anderer Inhalt (K3): eine Fassung gewinnt, die andere bleibt in den Fassungen der Meldung
        conflictIds: report.conflictIds ?? [],
        onShowConflict: (id) => { setModus("lage"); setSideView("journal"); selectEventRef.current(id); },
      });
    } catch (e) {
      say((e as Error).message);
    }
  };

  const togglePresent = (on: boolean) => {
    setPresent(on);
    // Präsentation beendet (Esc, Knopf, Vollbild verlassen): sofort LIVE, der Beamer zeigt nie eine alte Lage (M5)
    if (!on) zeit.goLive("taste");
    try {
      if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* egal */ }
    window.setTimeout(() => sm.current?.map.invalidateSize(), 80);
  };
  const fsOn = useRef(false);
  // Präsentation: Esc beendet, ←/→ vorherige/nächste Meldung (setzt die Lagezeit über den Rückblick)
  useEffect(() => {
    if (!present) return;
    const key = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // Esc beendet sofort (auch wenn ein Stapel auf der Karte aufgefächert ist – Fang-Phase vor der Lageebene)
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); togglePresent(false); return; }
      if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        const list = (ex?.events ?? []).filter((e) => !e.deleted).sort(compareEvents);
        if (!list.length) return;
        const i = list.findIndex((e) => e.id === selEvent);
        const j = i < 0 ? (ev.key === "ArrowRight" ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, i + (ev.key === "ArrowRight" ? 1 : -1)));
        const e = list[j]!;
        setSelEvent(e.id); zeit.lookBack(e.t); focusEvent(e);
        ev.preventDefault();
      }
    };
    // Esc im Vollbild schluckt der Browser (kein keydown): Vollbild verlassen beendet die Präsentation
    const fs = () => { if (!document.fullscreenElement) { if (fsOn.current) { fsOn.current = false; togglePresent(false); } window.setTimeout(() => sm.current?.map.invalidateSize(), 80); } else fsOn.current = true; };
    window.addEventListener("keydown", key, true);
    document.addEventListener("fullscreenchange", fs);
    return () => { window.removeEventListener("keydown", key, true); document.removeEventListener("fullscreenchange", fs); };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  // Experte aus: Präsentation beenden
  useEffect(() => { if (!experte && present) togglePresent(false); }, [experte]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Meldung am Kartenpunkt (für «Korrigieren» im Kontextmenü): nächstes sichtbares Zeichen innerhalb 22 px */
  const eventNear = (_pos: LV95, pt: { x: number; y: number }) => {
    const map = sm.current?.map;
    if (!map || !ex) return null;
    let best: { e: LageEvent; d: number } | null = null;
    for (const e of ex.events ?? []) {
      if (e.deleted || !e.pos || e.t > tNow || (winFrom && e.t < winFrom)) continue;
      const q = map.latLngToContainerPoint(toLatLng(e.pos));
      const d = Math.hypot(q.x - pt.x, q.y - pt.y);
      if (d <= 22 && (!best || d < best.d - 4 || (Math.abs(d - best.d) <= 4 && e.t > best.e.t))) best = { e, d };
    }
    return best ? { id: best.e.id, label: `${best.e.t.slice(11, 16)} ${best.e.melder ?? best.e.unit}`.trim() } : null;
  };

  if (!ex) return (
    <div className="app shell">
      <div className="loading">Wird geladen …</div>
      {dbBlocked && <div className="toast dbblocked" role="alert">Ein anderes Lagejournal-Fenster ist offen – bitte schliessen. Danach geht es hier automatisch weiter.</div>}
    </div>
  );
  const cell = cursor ? cellAtAny(ex.sheets, cursor) : null;
  const map = mapReady ? sm.current?.map ?? null : null;
  const hasEvents = (ex.events ?? []).some((e) => !e.deleted);
  // Meldungsband nur für eine Meldung bis zur Lagezeit (Rückblick zeigt nie eine spätere, M4)
  const selEv = (ex.events ?? []).find((e) => e.id === selEvent && !e.deleted && e.t.slice(0, 16) <= tNow) ?? null;

  const menu = (
    <WorkspaceMenu exName={ex.name} aw={aw} setModus={setModus} setExperte={setExperte} offlineReady={offline.ready}
      onRename={(name) => update((x) => { x.name = name; return x; })}
      onSwitch={() => setDialog("uebungen")} onNew={() => { switchTo(newExercise(), "neu"); say("Neue Übung angelegt"); }} onDemo={loadDemo}
      onSaveFile={() => void saveFile()} onOpenFile={() => void openFile()} onPdf={() => void exportJournal("pdf")} onCsv={() => void exportJournal("csv")}
      night={night} onNight={setNight} onPresent={() => togglePresent(true)}
      onSpeech={() => setDialog("sprache")} onHintsCsv={exportHints} onHelp={() => setDialog("hilfe")} onAbout={() => setDialog("ueber")}
      onOpenChange={suspendMenu("menu")} />
  );

  const red = (
    <RedPanel ex={ex} t={tLater} from={null} hints={hints} lage={lageRot}
      variant={experte ? "experte" : "basis"} selHint={selHint} selCoa={selCoa}
      onSelectHint={setSelHint} onSelectCoa={selectCoa} onMapHint={focusHint} onMapCoa={focusCoa}
      onEvent={(id) => { setSideView("journal"); selectEvent(id); }} update={update}
      stand={zeit.zeit.kind === "rueckblick" ? zeit.zeit.t : null} />
  );
  const journal = map ? (
    <JournalPanel ex={ex} map={map} device={device} selected={selEvent} experte={experte} zeit={zeit}
      win={winFrom ? { from: winFrom, to: tNow } : null} onWinClear={() => { zeit.setShowLast(null); zeit.setAb?.(null); }}
      showLast={zeit.showLast} onSelect={selectEvent} reportAt={reportAt}
      onCommitted={(ids) => { mapNow.current = ids; zeit.goLive("eintragen"); }}
      onPrepare={() => { setModus("vorbereiten"); setPrepStep(2); }} onDemo={loadDemo} update={update} say={say} quality={quality}
      between={<SideSwitch view={sideView} onView={setSideView} redLabel={<RedTabLabel badge={badge} />} />}
      tab={hasEvents && sideView !== "offen" ? sideView : "journal"} rot={<div role="tabpanel" aria-label="Was Rot vorhaben könnte" className="sh-redpanel">{red}</div>} />
  ) : <div className="panel"><p className="help">Karte wird geladen …</p></div>;

  const side = lage ? (
    journal
  ) : (
    <PrepareMode ex={ex} map={map} update={update} say={say} offerUndo={undo.offer} offline={offline}
      step={prepStep} onStep={setPrepStep} selSheet={selSheet} onSelectSheet={setSelSheet} selArea={selArea} onSelectArea={setSelArea}
      setDrawing={setDrawing} setBusy={setBusy} onBack={() => setModus("lage")} />
  );

  const band = lage || present ? (
    <TimeBand ex={ex} zeit={zeit} experte={experte || present} lastReport={lastReportUntil(ex.events, zeit.tLive)}
      swim={{
        events: ex.events ?? [], days: ex.days, units: ex.units, selectedId: selEvent, compact: present,
        onSelect: (id) => { setSideView("journal"); const e = (ex.events ?? []).find((x) => x.id === id); setSelEvent(id); if (e) { zeit.lookBack(e.t); focusEvent(e); } },
        extra: present ? <>
          <button className={"swt-chip" + (presentHints ? " on" : "")} aria-pressed={presentHints} onClick={() => { setPresentHints(!presentHints); window.setTimeout(() => sm.current?.map.invalidateSize(), 50); }}>
            Was Rot vorhaben könnte{badge.n ? ` (${badge.n})` : ""}</button>
          <button className="swt-chip" onClick={() => togglePresent(false)}>Präsentation beenden (Esc)</button>
        </> : undefined,
      }} />
  ) : undefined;

  return (
    <KiProvider ex={ex} t={tNow} update={update} say={say}>
      <AppShell aw={aw} lagezeit={zeit.zeit.kind} night={night} present={present}
        header={<Header name={ex.name} product={product} save={saveStatus} offline={offline} menu={menu}
          onFixOffline={() => { setModus("vorbereiten"); setPrepStep(6); }} />}
        bands={<>
          <StatusBands ex={ex} dbBlocked={dbBlocked} onSaveFile={saveFile} />
          {mergeInfo && <MergeBar info={mergeInfo} onClose={() => setMergeInfo(null)} />}
        </>}
        side={side}
        mapTop={lage || present ? <RueckblickBanner zeit={zeit} days={ex.days} /> : undefined}
        map={<>
          <div ref={el} className="map" />
          {map && (
            <>
              <div className="maptools">
                <MapToolbar map={map} basemap={basemap} onBasemap={setBasemap} experte={experte}
                  flags={userFlags} onFlags={setUserFlags} onFitAll={() => fitAll(ex)} canFitAll={ex.sheets.length + ex.areas.length > 0}
                  online={ex.onlineDienste} net={offline.net}
                  showLast={lage ? zeit.showLast : undefined} onShowLast={lage ? zeit.setShowLast : undefined}
                  onOpenChange={suspendMenu("anzeige")} />
              </div>
              <EventBanner event={selEv} days={ex.days} onClose={() => setSelEvent(null)}
                extra={(() => { if (!selEv?.attachments?.length) return null; const all = attachmentsOf(ex, selEv.attachments); const fotos = all.filter((a) => a.kind === "foto"); const memos = all.filter((a) => a.kind === "audio"); return <>{fotos.length ? <AttachmentChips list={fotos} size={22} /> : null}{memos.length ? <RowMemos list={memos} /> : null}</>; })()}
                onEdit={present || (lage && sideView === "journal") ? undefined : (e) => correct(e.id)} />
              {flags.legende && <Legend events={exLater?.events ?? ex.events ?? []} t={tLater} flags={flags} areas={ex.areas} selectedId={selEvent} from={fromLater} />}
              <MapContextMenu map={map} sheets={ex.sheets} eventNear={eventNear} onCorrect={present ? undefined : correct}
                onReportHere={(pos) => { setModus("lage"); setSideView("journal"); setReportAt({ pos, n: Date.now() }); }} />
              {!present && <MapTipHost map={map} />}
            </>
          )}
          {drawing && <div className="hint">{drawing} · Esc = Abbrechen</div>}
          {cursor && (
            <div className="status mono" aria-hidden="true">
              {cell ? <><b>{cell.label}</b> · </> : null}{formatLv95(cursor)}
            </div>
          )}
        </>}
        presentAside={present && presentHints ? (
          <aside className="hp-present" aria-label="Was Rot vorhaben könnte">
            <HintsPanel ex={ex} hints={hints} t={tNow} selected={selHint} onSelect={setSelHint} compact
              onMap={focusHint} onEvent={(id) => { const e = (ex.events ?? []).find((x) => x.id === id); setSelEvent(id); if (e) focusEvent(e); }} update={update}
              lead={<LageRotPanel ex={ex} lage={lageRot} t={tNow} selected={selCoa} onSelect={selectCoa} onMap={focusCoa} compact
                onHint={coaHint}
                onEvent={(id) => { const e = (ex.events ?? []).find((x) => x.id === id); setSelEvent(id); if (e) focusEvent(e); }} update={update} />} />
          </aside>
        ) : undefined}
        band={band}>
        {busy && <div className="busy"><div>{busy}</div></div>}
        {toast && <div className="toast" role="status">{toast}</div>}
        {mover.notice}
        {undo.bar}
        <ViewerHost />
        {dialog === "uebungen" && (
          <ExerciseList currentId={ex.id} onOpen={(id) => void openSaved(id)} onClose={() => setDialog(null)} offerUndo={undo.offer}
            onChanged={() => void listExercises().then(setSaved)} />
        )}
        {dialog === "hilfe" && <HelpDialog onClose={() => setDialog(null)} />}
        {dialog === "ueber" && <AboutDialog product={product} tagline={tagline} onClose={() => setDialog(null)} />}
        {dialog === "sprache" && <Dialog title="Spracherkennung" onClose={() => setDialog(null)}><SpeechSettings onClose={() => setDialog(null)} /></Dialog>}
      </AppShell>
    </KiProvider>
  );
}

/** Menü innerhalb des KiProvider (Eintrag «KI …» braucht die KI-Einstellungen der Übung) */
function WorkspaceMenu(p: Omit<Parameters<typeof MainMenu>[0], "onKi">) {
  const ki = useKi();
  return <MainMenu {...p} onKi={ki ? ki.openSettings : undefined} />;
}

/** Hilfe: Beispiele (Kap. 4.4, fiktiv, passen zum Beispiel Bern) und Tastenkürzel */
const BEISPIELE: Array<[string, string]> = [
  ["H04 2 Fz in AK7 Rtg N", "Fahrzeuge gesehen"],
  ["1015 H02 Beo Stao bezogen AJ9", "eigener Trupp"],
  ["H03 3 Pers unklar bei NAI 2", "unklar"],
  ["H01 Sperre AF13 auf Hauptstrasse", "Sperre auf der Strasse"],
  ["H05 Kontakt mit Gegner AP11", "Kontakt"],
];
function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Beispiele und Tastenkürzel" onClose={onClose}>
      <p className="dlg-p">Eine Meldung ist eine Zeile: Zeit · Trupp · was · wo. Reihenfolge egal. Ohne Zeit gilt jetzt.</p>
      <h3>Beispiele</h3>
      <ul className="dlg-ex">
        {BEISPIELE.map(([t, d]) => <li key={t}><code>{t}</code><span>{d}</span></li>)}
      </ul>
      <p className="dlg-note">Planquadrate gehen erst mit Führungsraster (Vorbereiten). «neu» heisst: in den letzten 10 Minuten gemeldet.</p>
      <h3>Tastenkürzel</h3>
      <dl className="dlg-keys">
        <dt><kbd>Enter</kbd></dt><dd>eintragen</dd>
        <dt><kbd>Esc</kbd></dt><dd>Feld leeren, Korrektur abbrechen, Fenster schliessen</dd>
        <dt><kbd>↑</kbd></dt><dd>im leeren Feld: letzte eigene Meldung korrigieren</dd>
        <dt><kbd>Ctrl+K</kbd></dt><dd>suchen</dd>
        <dt><kbd>L</kbd></dt><dd>zurück zu LIVE</dd>
        <dt><kbd>Ctrl+Z</kbd></dt><dd>Löschen rückgängig machen</dd>
      </dl>
    </Dialog>
  );
}
function AboutDialog({ product, tagline, onClose }: { product: string; tagline: string; onClose: () => void }) {
  return (
    <Dialog title={`Über ${product}`} onClose={onClose}>
      <p className="dlg-p"><b>{product}</b> – {tagline} · Version {APP_VERSION}</p>
      <p className="dlg-p">Daten bleiben auf diesem Gerät. Jede Änderung wird sofort gespeichert. Für ein anderes Gerät: Menü → «Datei für anderes Gerät …».</p>
      <p className="dlg-note">Karten: © swisstopo. Ortsnamen und Strassen nur, wenn die Online-Dienste der Übung eingeschaltet sind. KI nur nach ausdrücklichem Einschalten.</p>
    </Dialog>
  );
}
