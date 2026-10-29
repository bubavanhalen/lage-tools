/**
 * Zustand und Ablauf des Meldungsfelds (Spez. MVP 1, Kap. 3.2/3.3) – alles ausser dem Aussehen (EntryBox.tsx).
 *
 * Neu eintragen (aus MVP 0 übernommen): Text → `parseMeldung` → Vorschau; Zeit «jetzt» erst bei Enter; Ortsname online
 * nachschlagen; Strassenwahl; Zeichen/Einordnung von Hand; Fläche zeichnen (Experte); Foto/Sprache/KI; Entwurf pro
 * Fenster überlebt Neuladen (`draftPersist`); Esc verwirft mit Rückgängig.
 * Zustand (`entryState`, Kern): bereit → Enter trägt ein; bitte prüfen → 1. Enter fragt, 2. Enter (ohne Textänderung)
 * trägt ein; geht nicht (`draft.problems`) → Enter trägt nie ein.
 *
 * MVP 3 (Spez. MVP 3, Kap. 2.2, 2.3, 3.1, 3.3): Art von Hand (Auswahl «Was ist es?», `artOverride` → `ctx.art`, gilt bis
 * der Text gelöscht wird), Kürzel-Abfrage beim ersten Enter ohne Kürzel (`schicht`), laufende Nummer beim Erfassen
 * (`onNr`, sonst `takeNr`), `erfasstVon`, Messpunkt `lt:enter`, Wahl des Ziels bei mehreren Aufhebungs-Kandidaten,
 * Vorschlag «Als T2 07:26 eintragen» (Tag fremd). Text von aussen ins Feld: `prefillEntry` (Offen, «Antwort eintragen»).
 *
 * Korrigieren = Eintragen: Feld enthält den Meldungstext, «jetzt» = Zeit der Meldung, Trupp fällt auf den der Meldung
 * zurück. Ohne Textänderung bleiben Ort, Zeichen, Strasse; mit Textänderung gilt die neue Erkennung, ausser der Text
 * nennt keinen Ort (dann bleibt der bisherige, auch «Karte»). Speichern über `correctEvent` (alte Fassung in
 * `history`), Leiste «Korrigiert: NAI 2 → AK9 · Rückgängig». Angefangener Entwurf wird geparkt und zurückgelegt;
 * Korrekturzustand überlebt Neuladen. Konflikt mit anderem Fenster (MVP 0): Revision beim Start merken, Band
 * «In einem anderen Fenster geändert/gelöscht – Trotzdem speichern / Verwerfen»; gelöschte Meldungen nicht korrigierbar.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  artOf, catalogEntry, cellAtAny, cellBounds, clockDay, correctEvent, correctionSummary, entryState, findCells, isPlaceName,
  lastPosition, normalizeMelder, onlineAllowed, parseMeldung, placeLabel, sheetBounds, undoCorrection,
  type Attachment, type Bounds, type Draft, type EntryArt, type EntryState, type Exercise, type Kind, type LageEvent, type LV95, type Side,
} from "@lage/core";
import { pickPoint, toLatLng, toLv95 } from "@lage/map";
import { addEvents, buildEvent, commitTexts, correctionPatch, isLageDraft, rememberUnits, takeNr } from "../commit";
import { useDraftPersist, windowId } from "../draftPersist";
import { placeFromText, reparseEdit } from "../editReparseCore";
import { editConflict } from "../persist";
import { eventRoadTarget, baseWhere, roadOutside, useRoadChoice, type RoadPick, type RoadTargetInfo } from "../RoadChoice";
import { takeDrawing } from "../ShapeDraw";
import { makeChoice, pickerEntry, type SymbolChoice } from "../SymbolPicker";
import { useNow } from "../useNow";
import { useVoice } from "../VoiceInput";
import { deleteAttachmentBlob } from "../attachmentStore";
import { DELETED_EVENT } from "../journal/actions";
import { kindOfEvent } from "../journal/filter";
import { offerUndo } from "../journal/journalUndo";
import { kuerzelNorm, PERF_MARK, type EntryBoxProps } from "../shell/contracts";
import type { NichtMeldung } from "./ArtSwitch";
import { ART_NAME } from "./labels";
import { entryOptions, lastReportOf } from "./stateOptions";
import { withTrupp } from "./trupp";

export { lastMelder, truppOrder, withTrupp } from "./trupp";

export type EntryMode = { art: "neu" } | { art: "korrektur"; id: string };

/** Laptop: Autofokus; Touch nie (sonst springt die Seite und die Tastatur geht auf) */
export const wideScreen = () => typeof window !== "undefined" && window.innerWidth >= 860 && !window.matchMedia?.("(pointer: coarse)").matches;

const kindOfAff = (a: Draft["aff"]): Kind => (a === "F" ? "eigen" : a === "H" ? "feind" : "unklar");
const affOfKind = (k: Kind, cur: Draft["aff"]): Draft["aff"] => (k === "eigen" ? "F" : k === "feind" ? "H" : cur === "N" ? "N" : "U");
/** Ort nur ersatzweise (letzte Lage bzw. beim Melder) – ein nachgeschlagener Ortsname geht vor */
const fallbackWhere = (k: string | undefined) => k === "zuletzt" || k === "melder";
const normText = (t: string) => t.replace(/\s+/g, " ").trim();

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

// ---------- Korrekturzustand pro Übung und Fenster (überlebt Neuladen)

interface StoredKorr { id: string; base: LageEvent; parked: string; at: number }
const KORR_KEY = (exId: string) => `lage-tools.korrektur.${exId}.${windowId()}`;
function loadKorr(exId: string): StoredKorr | null {
  try { const r = localStorage.getItem(KORR_KEY(exId)); return r ? (JSON.parse(r) as StoredKorr) : null; } catch { return null; }
}
function saveKorr(exId: string, k: StoredKorr | null): void {
  try { if (k) localStorage.setItem(KORR_KEY(exId), JSON.stringify(k)); else localStorage.removeItem(KORR_KEY(exId)); } catch { /* Speicher gesperrt */ }
}

/**
 * Korrektur direkt anfordern (ohne Umweg über Props, gleiche Darstellung wie der Klick): Liste «Korrigieren»,
 * Meldungsband, Kontextmenü. false = kein Meldungsfeld eingehängt (dann Prop `correct` verwenden).
 */
let korrHandler: ((id: string) => void) | null = null;
export function requestCorrection(id: string): boolean {
  if (!korrHandler) return false;
  korrHandler(id);
  return true;
}

/**
 * Text ins Meldungsfeld setzen (MVP 3: «Antwort eintragen» → «Antwort zu 57: », «Vbk eintragen» → «H03 Vbk »), Fokus
 * ans Ende. Ein angefangener Text wird nicht überschrieben, sondern dahinter gesetzt. false = kein Feld eingehängt.
 */
let prefillHandler: ((text: string) => void) | null = null;
export function prefillEntry(text: string): boolean {
  if (!prefillHandler) return false;
  prefillHandler(text);
  return true;
}

/** Messpunkt P1 «lt:enter» (Spez. 3.12) – nie ein Fehler, wenn die Messung fehlt */
function markEnter(): void {
  try { performance.mark(PERF_MARK.enter); } catch { /* ohne Performance-API */ }
}

export function useEntryDraft(p: EntryBoxProps & { onCorrecting?: (id: string | null) => void }) {
  const { ex, map, device, experte, update, say, onCommitted } = p;
  const events = ex.events ?? [];
  const now = useNow();
  const clk = clockDay(ex.days, now);
  const day = clk.day;

  const [text, setTextState] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fitInput = useCallback(() => requestAnimationFrame(() => { const t = inputRef.current; if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 120) + "px"; } }), []);
  useDraftPersist(ex.id, text, setTextState, fitInput);

  const [mode, setMode] = useState<EntryMode>({ art: "neu" });
  const korr = useRef<StoredKorr | null>(null);
  const [manualPos, setManualPos] = useState<LV95 | null>(null);
  const [kindOverride, setKindOverride] = useState<Kind | null>(null);
  /** (MVP 3) Art von Hand: «meldung» = Feind/Eigene/Unklar gewählt, sonst Nicht-Meldung aus «Andere ▾» */
  const [artOverride, setArtOverride] = useState<EntryArt | null>(null);
  const [artMenu, setArtMenu] = useState(false);
  /** (MVP 3) gewähltes Ziel, wenn mehrere Sperren o. ä. aufgehoben werden könnten */
  const [liftPick, setLiftPick] = useState<string | null>(null);
  /** (MVP 3) Kürzel-Abfrage (Kap. 2.3) */
  const [askKuerzel, setAskKuerzel] = useState(false);
  const [kuerzelText, setKuerzelText] = useState("");
  const [kuerzelErr, setKuerzelErr] = useState(false);
  const kuerzelRef = useRef<HTMLInputElement>(null);
  const [symOverride, setSymOverride] = useState<SymbolChoice | null>(null);
  const [roadPick, setRoadPick] = useState<RoadPick | null>(null);
  const [shapeDraft, setShapeDraft] = useState<LageEvent["shape"]>(undefined);
  const [found, setFound] = useState<{ q: string; name: string; pos: LV95 } | null>(null);
  const [lookup, setLookup] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pendingAtt, setPendingAtt] = useState<Attachment | null>(null);
  /** «bitte prüfen»: Text, zu dem das erste Enter gefragt hat */
  const [armed, setArmed] = useState<string | null>(null);
  /** «geht nicht» + Enter: Zustandszeile erneut ansagen / Konfliktband hervorheben */
  const [announce, setAnnounce] = useState(0);
  const [nudge, setNudge] = useState(0);
  /**
   * Rückmeldung direkt unter dem Feld (statt Toast über dem LIVE-Band): «Eingetragen – ohne Ort …», «Korrektur beendet».
   * Verschwindet nach 6 s oder beim nächsten Tippen; `role="status"` sagt sie an.
   */
  const [notice, setNotice] = useState<{ t: string; n: number } | null>(null);
  const tell = useCallback((t: string) => setNotice((o) => ({ t, n: (o?.n ?? 0) + 1 })), []);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice((o) => (o?.n === notice.n ? null : o)), 6000);
    return () => window.clearTimeout(id);
  }, [notice]);
  const kiTaken = useRef(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on); window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);

  /**
   * Zuletzt angetippter Trupp-Chip: gilt weiter, wenn der Text danach ganz ersetzt wird und keinen Trupp mehr nennt
   * (z. B. Feld markiert und neu getippt, Diktat) – beim Eintragen kommt er als Text an den Anfang. Gelöscht mit dem Feld.
   */
  const [chosen, setChosen] = useState<string | null>(null);
  const resetExtras = () => { setChosen(null); setManualPos(null); setKindOverride(null); setArtOverride(null); setLiftPick(null); setArtMenu(false); setSymOverride(null); setRoadPick(null); setShapeDraft(undefined); setFound(null); setArmed(null); setAskKuerzel(false); setKuerzelErr(false); };
  const setText = useCallback((t: string) => {
    setTextState(t);
    if (t) setNotice(null);
    if (!t) { setChosen(null); setManualPos(null); setKindOverride(null); setArtOverride(null); setLiftPick(null); setSymOverride(null); setRoadPick(null); setShapeDraft(undefined); setAskKuerzel(false); kiTaken.current = false; }
  }, []);
  useEffect(() => { setArmed(null); }, [text]);

  // ---------- Korrektur: Start, Ende, Neuladen
  const korrId = mode.art === "korrektur" ? mode.id : null;
  const base = korrId ? korr.current?.base ?? null : null;
  const cur = korrId ? events.find((e) => e.id === korrId) : undefined;
  // synchron (vor dem Zeichnen): die Liste zeigt «wird korrigiert» nie einen Augenblick zu lang
  useLayoutEffect(() => { p.onCorrecting?.(korrId); }, [korrId]); // eslint-disable-line react-hooks/exhaustive-deps

  const endKorr = useCallback((restore = true) => {
    const k = korr.current;
    korr.current = null;
    saveKorr(ex.id, null);
    setMode({ art: "neu" });
    resetExtras();
    setTextState(restore && k ? k.parked : "");
    fitInput();
    if (wideScreen()) inputRef.current?.focus();
  }, [ex.id, fitInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const startKorr = useCallback((id: string) => {
    const e = (ex.events ?? []).find((x) => x.id === id);
    if (!e) return;
    if (e.deleted) { tell("Gelöschte Meldung – zuerst «Rückgängig», dann korrigieren."); return; }
    const parked = korr.current ? korr.current.parked : text;
    korr.current = { id, base: e, parked, at: Date.now() };
    saveKorr(ex.id, korr.current);
    setMode({ art: "korrektur", id });
    resetExtras();
    setTextState(e.text);
    fitInput();
    requestAnimationFrame(() => {
      const t = inputRef.current;
      if (!t) return;
      if (wideScreen()) { t.focus({ preventScroll: true }); t.setSelectionRange(t.value.length, t.value.length); }
      t.closest(".ebox")?.scrollIntoView({ block: "nearest" });
    });
  }, [ex.events, ex.id, text, tell, fitInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const startRef = useRef(startKorr);
  startRef.current = startKorr;
  useEffect(() => { const h = (id: string) => startRef.current(id); korrHandler = h; return () => { if (korrHandler === h) korrHandler = null; }; }, []);
  const prefillRef = useRef<(t: string) => void>(() => {});
  prefillRef.current = (t: string) => {
    if (korr.current) endKorr(true);
    const cur = (inputRef.current?.value ?? "").trim();
    const next = t;
    setText(next);
    // nichts geht verloren: ein angefangener Text kommt mit Rückgängig zurück
    if (cur && cur !== t.trim()) offerUndo("Angefangene Meldung ersetzt", () => { setTextState(cur); fitInput(); inputRef.current?.focus(); });
    fitInput();
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus({ preventScroll: true }); el.setSelectionRange(next.length, next.length); el.closest(".ebox")?.scrollIntoView({ block: "nearest" }); } });
  };
  useEffect(() => { const h = (t: string) => prefillRef.current(t); prefillHandler = h; return () => { if (prefillHandler === h) prefillHandler = null; }; }, []);

  // Korrekturzustand nach Neuladen / Übungswechsel
  useEffect(() => {
    korr.current = null;
    const k = loadKorr(ex.id);
    if (k && (ex.events ?? []).some((e) => e.id === k.id)) { korr.current = k; setMode({ art: "korrektur", id: k.id }); }
    else { if (k) saveKorr(ex.id, null); setMode({ art: "neu" }); }
    resetExtras();
  }, [ex.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (p.correct) startKorr(p.correct.id); }, [p.correct?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (p.reportAt) { setManualPos(p.reportAt.pos); inputRef.current?.focus(); } }, [p.reportAt?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // in diesem Fenster gelöscht (Liste): laufende Korrektur dieser Meldung abbrechen
  useEffect(() => {
    const h = (ev: Event) => { if (korr.current && (ev as CustomEvent<string>).detail === korr.current.id) { endKorr(); tell("Korrektur abgebrochen – die Meldung wurde gelöscht."); } };
    window.addEventListener(DELETED_EVENT, h);
    return () => window.removeEventListener(DELETED_EVENT, h);
  }, [endKorr, tell]);

  // anderes Fenster hat geändert/gelöscht (MVP 0): nie still überschreiben
  const conflict = base ? (editConflict(ex.id, base, cur) ?? (!cur || cur.deleted ? "geloescht" : null)) : null;

  // ---------- Erkennung
  const ctx = useMemo(() => ({
    sheets: ex.sheets, areas: ex.areas, units: ex.units, places: ex.places ?? [], kind: kindOverride ?? undefined, days: ex.days, day, now, dayFromClock: clk.follow,
    lastPos: (u: string, s: Side) => lastPosition(events, s, u),
    ...(artOverride ? { art: artOverride } : {}),
    events, ex,
  }), [ex, kindOverride, artOverride, day, events, now, clk.follow]);
  /** Text, der gelesen wird (mit angetipptem Trupp, wenn der Text keinen nennt) */
  const srcText = useMemo(() => {
    if (base || !chosen || !text.trim()) return text;
    const d0 = parseMeldung(text, ctx);
    return d0.melder || d0.problems?.some((x) => x.kind === "melder") ? text : withTrupp(text, chosen);
  }, [text, ctx, base, chosen]);
  /** Korrektur: eine Nicht-Meldung bleibt Nicht-Meldung, bis die Art von Hand geändert wird (zeichnet nie plötzlich) */
  const korrArt: EntryArt | undefined = artOverride ?? (base && artOf(base) !== "meldung" ? artOf(base) : undefined);
  const draft0: Draft | null = useMemo(() => {
    if (!text.trim()) return null;
    if (!base) return parseMeldung(srcText, ctx);
    const d = reparseEdit(base, text, ex, kindOverride ?? undefined, korrArt);
    if (!d) return null;
    // Trupp der Meldung, wenn der Text keinen nennt
    if (!d.melder && base.melder) return { ...d, melder: base.melder, unit: d.side === "blau" && !d.unit ? base.melder : d.unit };
    return d;
  }, [text, srcText, ctx, base, ex, kindOverride, korrArt]);
  /** mehrere Aufhebungs-Ziele: das gewählte gilt (der Grund «aufheben» entfällt dann) */
  const draft: Draft | null = useMemo(() => {
    if (!draft0 || !liftPick || !draft0.hebtAufKandidaten?.includes(liftPick)) return draft0;
    return { ...draft0, hebtAuf: liftPick, hebtAufKandidaten: [liftPick] };
  }, [draft0, liftPick]);
  /** Nicht-Meldung (Auftrag, Rückfrage …): kein Zeichen, kein Ort */
  const nichtLage = !!draft && !isLageDraft(draft);

  const textChanged = !!base && normText(text) !== normText(base.text);
  /** Korrektur: Ort der Meldung bleibt (Text unverändert oder nennt keinen eigenen Ort) */
  const keepPlace = !!base && !manualPos && (!textChanged || (!placeFromText(draft) && !draft?.placeQuery && !(draft?.problems ?? []).some((x) => x.kind === "ort" || x.kind === "orte")));
  /** Korrektur: Zeichen/Einordnung bleiben (Text unverändert, nichts von Hand gewählt) */
  const keepSymbol = !!base && !textChanged && !symOverride && !kindOverride && !artOverride;

  // Ortsname online nachschlagen (nur wenn sonst kein Ort erkannt wurde, nur echte Ortsnamen, nur wenn erlaubt)
  const q = draft?.placeQuery;
  const wantsLookup = !!q && !keepPlace && !(draft?.pos && !fallbackWhere(draft.where?.kind)) && online && isPlaceName(q) && onlineAllowed(ex, "ortssuche") && !draft?.problems?.some((x) => x.kind === "ort");
  useEffect(() => {
    if (!wantsLookup || !q) { setFound(null); setLookup(null); return; }
    if (found?.q === q) return;
    const ctl = new AbortController();
    setLookup(q);
    const t = window.setTimeout(async () => {
      try {
        const r = await lookupPlace(q, exerciseBox(ex, map), ctl.signal);
        setFound(r ? { q, ...r } : null);
      } catch { /* offline */ }
      if (!ctl.signal.aborted) setLookup(null);
    }, 600);
    return () => { ctl.abort(); window.clearTimeout(t); };
  }, [q, wantsLookup, ex.onlineDienste?.ortssuche]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Zeichen und Einordnung
  const baseChoice = useMemo(() => (base ? makeChoice(pickerEntry(base.sym) ?? pickerEntry("einheit")!, base.side === "blau" ? "F" : base.aff === "F" ? "H" : base.aff, base.echelon, base.status) : null), [base]);
  const autoEntry = draft ? pickerEntry(draft.sym) ?? pickerEntry("einheit")! : null;
  const choice: SymbolChoice | null = !draft ? null : symOverride ?? (keepSymbol && baseChoice ? baseChoice : makeChoice(autoEntry!, draft.aff, draft.echelon, draft.status));
  const effKind: Kind | null = !draft ? null : symOverride ? kindOfAff(symOverride.aff) : keepSymbol && base ? kindOfEvent(base) : draft.kind;
  const setKind = (k: Kind) => {
    setKindOverride(k);
    setArtOverride("meldung");
    if (symOverride) setSymOverride(makeChoice(pickerEntry(symOverride.key) ?? pickerEntry("einheit")!, affOfKind(k, symOverride.aff), symOverride.echelon, symOverride.status));
  };

  /** Nicht-Meldung von Hand wählen (Menü «Andere ▾»): Zeichen und Ort fallen weg */
  const setArt = (a: NichtMeldung) => { setArtOverride(a); setKindOverride(null); setSymOverride(null); setManualPos(null); setRoadPick(null); setShapeDraft(undefined); };

  // ---------- Strasse (Hindernisse, Checkpoint …)
  const roadTarget: RoadTargetInfo | null = (() => {
    if (!draft || !choice || manualPos || nichtLage || draft.hebtAuf) return null;
    if (keepPlace && base) return eventRoadTarget(base, ex, choice.key);
    const ce = catalogEntry(choice.key);
    if (ce?.placement !== "strasse" && !draft.roadHint) return null;
    const hint = draft.roadHint;
    if (draft.where?.kind === "raster" && draft.cells?.[0]) {
      const c = findCells(draft.cells[0], ex.sheets)[0];
      const sh = c && ex.sheets.find((x) => x.id === c.sheetId);
      if (c && sh) return { key: `${choice.key}|${draft.cells[0]}|${hint ?? ""}`, target: cellBounds(sh, c.col, c.row, c.quadrant) as Bounds, along: choice.key === "hinterhalt", hint };
    }
    if (draft.where?.kind === "nai" && draft.nai) {
      const a = ex.areas.find((x) => x.name === draft.nai);
      if (a) return { key: `${choice.key}|${a.id}|${hint ?? ""}`, target: a.ring, along: choice.key === "hinterhalt", hint };
    }
    return null;
  })();
  const roadRes = useRoadChoice(roadTarget, text, roadPick);
  // Korrektur ohne neue Wahl: gespeicherte Strasse zeigen, nichts neu bestimmen
  const storedRoad = keepPlace && base && !roadPick && base.road ? roadRes.auto?.candidates?.find((c) => c.road === base.road) : undefined;
  const roadShown = storedRoad ? { ...roadRes, pl: storedRoad, chosen: storedRoad } : roadRes;
  const road = roadTarget && (!keepPlace || roadPick) ? roadRes.pl : null;

  // ---------- Ort
  const foundPos = found && draft?.placeQuery === found.q && (!draft.pos || fallbackWhere(draft.where?.kind)) ? found.pos : undefined;
  const effPos0: LV95 | undefined = manualPos ?? (keepPlace && base ? base.pos : foundPos ?? draft?.pos);
  const effWhere0: string | undefined = manualPos ? "Karte" : keepPlace && base ? (roadPick ? baseWhere(base.where) : base.where) : foundPos ? found!.name : draft?.where?.label;
  const effPos = road ? road.pos : effPos0;
  const effWhere = road ? `${effWhere0} · auf ${road.road ?? "Strasse"}` : effWhere0;
  const manualCell = manualPos ? cellAtAny(ex.sheets, manualPos)?.label : undefined;
  /** Ort in Worten für «Ort: …» */
  const placeText = manualPos ? (manualCell ? `Karte (${manualCell})` : "Karte") : keepPlace && base && !roadPick ? placeLabel(base) : effWhere ?? "";
  const oldPlace = base ? placeLabel(base) || "ohne Ort" : null;

  // gleiche Regeln wie Foto-/Sprach-Übersicht (entryOptions); Korrektur: Trupp der Meldung gilt als bekannt
  const lastReport = useMemo(() => lastReportOf(ex), [events]); // eslint-disable-line react-hooks/exhaustive-deps
  const state: EntryState | null = draft ? entryState(draft, entryOptions(ex, {
    online: online && onlineAllowed(ex, "ortssuche"),
    placePending: !!q && lookup === q,
    manualPos: !!manualPos,
    hasPos: !!foundPos || (keepPlace && !!base?.pos),
    alsoKnown: base?.melder,
    follow: !!base || clk.follow,
    lastReport,
  })) : null;

  const pickOnMap = async () => {
    setPicking(true);
    const pt = await pickPoint(map);
    setPicking(false);
    if (pt) { setManualPos(pt); setRoadPick(null); }
    inputRef.current?.focus();
  };

  // ---------- Trupps
  const chooseTrupp = (name: string) => {
    const next = withTrupp(text, name, draft?.melder);
    if (!korr.current) setChosen(name);
    setTextState(next);
    fitInput();
    requestAnimationFrame(() => { const t = inputRef.current; if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(next.length, next.length); } });
  };
  /** neuen Trupp aufnehmen («h6» → «H06» wie die vorhandenen); gibt den Namen zurück, wie er aufgenommen wurde */
  const addUnit = (name: string): string => {
    const n = normalizeMelder(name.trim(), ex.units.blau);
    if (!n) return n;
    update((x) => { if (!x.units.blau.some((u) => u.toLowerCase() === n.toLowerCase())) x.units = { ...x.units, blau: [...x.units.blau, n] }; return x; });
    return n;
  };

  // ---------- Eintragen / Korrektur speichern
  const commitNew = (d: Draft, drawn: LageEvent["shape"] | null, kuerzel?: string | null) => {
    markEnter();
    // Zeit «jetzt» erst jetzt (Enter) festlegen; eine getippte Zeit hat Vorrang
    const at = new Date();
    const clkAt = clockDay(ex.days, at);
    const fresh = parseMeldung(srcText, { ...ctx, now: at, day: clkAt.day, dayFromClock: clkAt.follow });
    const dNow: Draft = { ...d, minutes: fresh.minutes, day: fresh.day, t: fresh.t };
    const sd = drawn ?? shapeDraft;
    const ev = buildEvent(dNow, device, ex, {
      pos: effPos, where: effWhere, whereKind: manualPos ? "karte" : "ort",
      sym: symOverride ? { ...symOverride, desc: d.desc } : undefined,
      road,
      roadCell: roadOutside(road, effWhere0 ?? "", ex.sheets)?.cell,
      roadNone: !!(roadTarget && roadPick?.none),
      shape: sd,
      attachments: pendingAtt ? [pendingAtt.id] : undefined,
      source: pendingAtt ? { kind: pendingAtt.kind === "audio" ? "audio" : "image", ref: pendingAtt.id } : undefined,
      via: kiTaken.current ? "ki" : undefined,
      // laufende Nummer beim Erfassen (Gerätezähler, alle Fenster), Kürzel der Schicht
      nr: p.onNr ? p.onNr() : takeNr(ex),
      kuerzel: kuerzel !== undefined ? kuerzel : p.schicht?.kuerzel ?? null,
    }, at);
    const lage = isLageDraft(d) && !d.hebtAuf;
    if (lage && manualPos && !sd) { ev.cells = manualCell ? [manualCell] : undefined; ev.nai = undefined; }
    kiTaken.current = false;
    update((x) => addEvents(x, [ev], { place: found && foundPos ? found : undefined, attachments: pendingAtt ? [pendingAtt] : undefined }));
    setPendingAtt(null);
    setTextState("");
    resetExtras();
    afterCommit(ev);
    const art = artOf(ev);
    if (art !== "meldung") tell(`Als ${ART_NAME[art]} eingetragen – kein Zeichen, nichts auf der Karte.`);
    else if (ev.hebtAuf) tell("Eingetragen – das Aufgehobene verschwindet ab jetzt von der Karte.");
    else if (!ev.pos) tell("Eingetragen – ohne Ort. Später mit Korrigieren setzen.");
  };

  const afterCommit = (ev: Pick<LageEvent, "id" | "pos">) => {
    onCommitted([ev.id]);
    if (ev.pos && !map.getBounds().contains(toLatLng(ev.pos))) map.panTo(toLatLng(ev.pos));
    fitInput();
    if (wideScreen()) inputRef.current?.focus();
  };

  const saveKorrektur = (d: Draft, force: boolean, drawn: LageEvent["shape"] | null) => {
    const b = korr.current?.base;
    const now0 = cur ?? b;
    if (!b || !now0) return;
    const sd = drawn ?? shapeDraft;
    const cand = buildEvent(d, device, ex, {
      pos: effPos, where: effWhere, whereKind: manualPos ? "karte" : "ort",
      sym: symOverride ? { ...symOverride, desc: d.desc } : undefined,
      road: keepPlace ? null : road,
      roadCell: keepPlace ? undefined : roadOutside(road, effWhere0 ?? "", ex.sheets)?.cell,
      roadNone: !keepPlace && !!(roadTarget && roadPick?.none),
      shape: sd,
      via: kiTaken.current ? "ki" : now0.via,
    });
    if (manualPos && !sd && isLageDraft(d) && !d.hebtAuf) { cand.cells = manualCell ? [manualCell] : undefined; cand.nai = undefined; }
    const patch = correctionPatch(now0, cand, { keepPlace: keepPlace && !sd, keepSymbol, keepTime: !textChanged || !d.timeFromText });
    // Korrektur ohne neuen Text, aber mit neuer Strassenwahl
    if (keepPlace && roadPick && roadTarget) {
      const w = baseWhere(b.where);
      if (roadPick.none || !roadRes.pl) Object.assign(patch, { roadNone: !!roadPick.none, road: undefined, angle: undefined, where: w });
      else {
        const out = roadOutside(roadRes.pl, w, ex.sheets);
        Object.assign(patch, { pos: roadRes.pl.pos, where: `${w}${roadRes.pl.road ? ` · auf ${roadRes.pl.road}` : ""}`, angle: roadRes.pl.angle, road: roadRes.pl.road, roadNone: undefined, ...(out?.cell ? { cells: [out.cell] } : {}) });
      }
    }
    const restoreDeleted = force && !!now0.deleted;
    if (restoreDeleted) patch.deleted = false;
    if (!Object.keys(patch).length) { endKorr(); tell("Keine Änderung – Korrektur beendet."); return; }
    // (MVP 3) Kürzel der Korrektur; die alte Fassung behält ihres in `history`
    if (p.schicht?.kuerzel) patch.geaendertVon = p.schicht.kuerzel;
    const id = b.id;
    const before = now0;
    update((x) => {
      const hold: { ev?: LageEvent } = {};
      x.events = (x.events ?? []).map((y) => { if (y.id !== id) return y; hold.ev = correctEvent(y, patch, device); return hold.ev; });
      if (hold.ev) rememberUnits(x, hold.ev);
      return x;
    });
    const summary = correctionSummary(before, { ...before, ...patch } as LageEvent);
    offerUndo(`Korrigiert: ${summary}`, () => update((x) => { x.events = (x.events ?? []).map((y) => (y.id === id ? undoCorrection(y, before, device) : y)); return x; }));
    if (restoreDeleted) tell("Meldung wiederhergestellt (war in einem anderen Fenster gelöscht) – mit dieser Korrektur gespeichert.");
    kiTaken.current = false;
    endKorr();
    afterCommit({ id, pos: (patch.pos ?? before.pos) as LV95 | undefined });
  };

  /** Enter bzw. Knopf «Eintragen» / «Korrektur speichern» */
  const submit = (force = false) => {
    const korrNow = !!korr.current;
    if (korrNow && conflict && !force) { setNudge((n) => n + 1); return; }
    if (!draft || !state) {
      if (korrNow) tell("Text fehlt – Esc bricht die Korrektur ab.");
      return;
    }
    const dirty = textChanged || !!kindOverride || !!artOverride || !!symOverride || !!manualPos || !!roadPick || !!shapeDraft;
    if (korrNow && !dirty && !force) { endKorr(); tell("Keine Änderung – Korrektur beendet."); return; }
    // nie still falsch: «geht nicht» trägt nie ein
    if (state.level === "geht-nicht") { setAnnounce((n) => n + 1); inputRef.current?.focus(); return; }
    // Fläche/Linie wird noch gezeichnet: zuerst abschliessen (Form übernehmen)
    const drawn = takeDrawing(korr.current ? `korr:${korr.current.id}` : "neu");
    if (drawn === "unfertig") { tell("Fläche/Linie noch nicht fertig – weitere Punkte setzen, dann «Fertig» (oder Esc)."); return; }
    if (drawn) setShapeDraft(drawn);
    if (state.level === "pruefen" && armed !== text && !askKuerzel) { setArmed(text); setAnnounce((n) => n + 1); return; }
    if (korrNow) { setArmed(null); saveKorrektur(draft, force, drawn); return; }
    // (MVP 3) einmal pro Gerät und Übung: «Wer erfasst?» – die Meldung bleibt im Feld (Kap. 2.3)
    const sch = p.schicht;
    if (askKuerzel) {
      const v = kuerzelText.trim();
      const k = v ? kuerzelNorm(v) : null;
      if (v && !k) { setKuerzelErr(true); kuerzelRef.current?.focus(); return; }
      if (k && sch) sch.setKuerzel(k, { neu: true });
      sch?.setGefragt();
      setAskKuerzel(false); setKuerzelErr(false); setKuerzelText("");
      setArmed(null);
      commitNew(draft, drawn, k);
      return;
    }
    if (sch && !sch.kuerzel && !sch.gefragt) { setAskKuerzel(true); setKuerzelErr(false); return; }
    setArmed(null);
    commitNew(draft, drawn);
  };
  /** Kürzel-Abfrage schliessen (Esc): zurück ins Meldungsfeld, nichts eingetragen */
  const cancelKuerzel = () => { setAskKuerzel(false); setKuerzelErr(false); inputRef.current?.focus(); };

  /** Esc: Korrektur abbrechen bzw. Feld leeren mit Rückgängig */
  const escape = () => {
    if (korr.current) { endKorr(); return; }
    if (!text) return;
    const old = text;
    setText("");
    resetExtras();
    fitInput();
    offerUndo("Meldung verworfen", () => { setTextState(old); fitInput(); inputRef.current?.focus(); });
  };

  /** ↑ im leeren Feld: letzte selbst eingetragene Meldung korrigieren */
  const correctLast = (): boolean => {
    const live = events.filter((x) => !x.deleted);
    const own = live.filter((x) => x.device === device);
    const last = (own.length ? own : live).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!last) return false;
    startKorr(last.id);
    return true;
  };

  const takeKi = (kurz: string) => {
    kiTaken.current = true;
    setTextState(kurz);
    resetExtras();
    fitInput();
    inputRef.current?.focus();
  };

  // ---------- Foto, Sprache
  const commitBatch = (texts: string[], a: Attachment) => {
    const evs = commitTexts(texts, { ex, device, update, day, attachment: a, onNr: p.onNr, kuerzel: p.schicht?.kuerzel ?? null });
    if (evs.length) onCommitted(evs.map((x) => x.id));
  };
  const voice = useVoice({
    ex, update, say, text, setText: (t: string) => { setTextState(t); fitInput(); }, day, input: inputRef, onAttach: setPendingAtt, pendingId: pendingAtt?.id,
    onDetach: (id) => setPendingAtt((x) => (x?.id === id ? null : x)),
    onCommit: commitBatch,
  });
  const removePending = () => { if (pendingAtt?.kind === "foto") void deleteAttachmentBlob(pendingAtt.id); setPendingAtt(null); };

  return {
    ex, map, experte, text, setText, inputRef, fitInput, mode, base, cur, conflict, nudge,
    draft, state, armed, announce, textChanged, keepPlace, keepSymbol,
    manualPos, setManualPos, picking, pickOnMap, effPos, effWhere, effWhere0, placeText, oldPlace,
    choice, effKind, setKind, symOverride, setSymOverride, kindOverride,
    artOverride, setArt, artMenu, setArtMenu, nichtLage, liftPick, setLiftPick,
    askKuerzel, kuerzelText, setKuerzelText, kuerzelErr, kuerzelRef, cancelKuerzel,
    roadTarget, roadShown, roadPick, setRoadPick, road,
    shapeDraft, setShapeDraft, pendingAtt, setPendingAtt, removePending,
    chooseTrupp, addUnit, submit, escape, correctLast, startKorr, endKorr, takeKi,
    voice, commitBatch, day, online, notice: notice?.t ?? null, tell,
  };
}

export type EntryDraft = ReturnType<typeof useEntryDraft>;
