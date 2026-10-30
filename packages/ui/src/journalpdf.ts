/**
 * Lagejournal als PDF (A4 hoch, Spez. MVP 3, Kap. 3.9): kompakte Tabelle **Nr · Zeit · Eing. · Art · von/an ·
 * Meldung (+ Vermerke, Nachtrag) · Ort · Erf.** für einen Umfang (Schicht, Tag, ganze Übung, Zeitraum), Tageszeile
 * «T2 · Mittwoch 15.05.2030» statt Spalte «Tag», Kopf mit Umfang und Klassifizierung, Fuss «Seite n von m»,
 * Visum auf der letzten Seite, Anhänge Lage Rot (kompakt) und Hinweise aus dem Zeitraum.
 *
 * - Zeilen rein und testbar: `journalPdfRows(ex, umfang)`; Seiten zählen ohne Datei: `journalPdfSeiten` (Dialog «ca. n
 *   Seiten», dieselbe Rechnung wie das PDF).
 * - Journalführung: gestrichene Einträge bleiben («gestrichen 07:22 von BSP», grau, durchgestrichen), korrigierte tragen
 *   «Nachtrag 07:34 MU: vorher «…»». Meldungen aus einem KI-Vorschlag (`via: "ki"`) sind mit «[KI]» markiert.
 * - Alte Signatur `journalPdf(ex, classification, hints, lageRot, kiNote)` bleibt als dünne Hülle (ganze Übung).
 * - MVP 3.5 (Spez. MVP 3.5, Kap. 2.9, D8): Farbe **nur** in der Spalte «Art» (Feind/Unklar/Eigene/Ausgang), Zeilen weiss;
 *   «Erf.» immer gefüllt (Kürzel oder «–»); Ort nie doppelt («AM5 · auf Kornhausstrasse»); dringend als Vektorzeichen
 *   ⚠ in der Spalte «Nr» (nie «! »); das Visum steht nie allein auf einer Seite (die letzten 3 Zeilen wandern mit);
 *   Ausgang als Art «Ausgang an Bat»; Art-Korrektur «vorher: Orientierung Bat «…»». Zeitvergleiche über `zeitCmp`.
 */
import { jsPDF } from "jspdf";
import { zeitText,
  ART_LABEL, artOf, artText, isLage, kindLabel, lvzIndex, nrLabel, placeLabel, schichtenIm, vermerkeOf, zeitCmp,
  type EventRevision, type Exercise, type Hint, type LageEvent,
} from "@lage/core";
import { appendHintsPdf } from "./hintsExport";
import type { LageRotState } from "./lageRot";
import { appendLageRotPdf, pdfPageNumbers } from "./lageRotExport";
import { glyphWarn, safePdf } from "./pdfSafe";
import { pdfInfo } from "./perf";
import type { JournalDruck } from "./shell/contracts";
import { datum, eintraegeIm, grenzen, localHhmm, schichtAm, spanne, tagZeile, umfangText, type JournalUmfang } from "./print/umfang";

export { tagZeile, umfangText, wochentagOf, type JournalUmfang } from "./print/umfang";

// ---------- Zeilen

export type JournalPdfFill = "feind" | "unklar" | "eigen" | "ausgang" | null;
export type JournalPdfRow =
  | { kind: "tag"; text: string }
  | {
    kind: "eintrag";
    id: string;
    /** Nr · Zeit · Eing. · Art · von/an · Meldung · Ort · Erf. */
    cells: [string, string, string, string, string, string, string, string];
    /** Vermerke und Nachtrag (unter der Meldung, kleiner) */
    vermerke: string[];
    fill: JournalPdfFill;
    dringend: boolean;
    gestrichen: boolean;
  };

export const JOURNAL_COLS = [
  // Art 17.5 mm: «Orientierung» (8 pt, 15.4 mm) passt in eine Zeile – vorher «Orientierun-g» (Review 6, Einsatz N)
  { h: "Nr", w: 9 }, { h: "Zeit", w: 9 }, { h: "Eing.", w: 9 }, { h: "Art", w: 17.5 }, { h: "von/an", w: 17 },
  { h: "Meldung", w: 72.5 }, { h: "Ort", w: 36 }, { h: "Erf.", w: 10 },
] as const;

/**
 * Zeilen der Spalte «Art»: Wörter nie trennen. Ein Wort, das nicht in die Spalte passt, wird gekürzt («Verbindungs-
 * kontrolle» → «Vbk» steht schon so in ART_KURZ; sonst Punkt-Abkürzung «Orient.»), nie «Orientierun-g».
 */
export function artZeilen(doc: { getTextWidth(t: string): number }, c: string, w: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const wort of c.split(/\s+/).filter(Boolean)) {
    let wt = wort;
    while (doc.getTextWidth(wt) > w && wt.length > 4) wt = wt.replace(/\.?$/, "").slice(0, -1) + ".";
    const probe = cur ? `${cur} ${wt}` : wt;
    if (cur && doc.getTextWidth(probe) > w) { out.push(cur); cur = wt; } else cur = probe;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

/** wie `kindText` (journalLayer.ts, ohne Leaflet): Zugehörigkeit N heisst «Neutral» */
const kindText = (e: LageEvent) => (e.side !== "blau" && e.side !== "ul" && e.aff === "N" ? "Neutral" : kindLabel(e));

const ART_KURZ: Record<ReturnType<typeof artOf>, string> = { ...ART_LABEL, vbk: "Vbk" };

function vonAn(e: LageEvent): string {
  switch (artOf(e)) {
    case "meldung": {
      const own = e.side === "blau";
      const el = own ? (e.unit && e.unit !== e.melder ? e.unit : "") : e.unit && e.unit !== e.melder ? e.unit : "";
      return [e.melder ?? (own ? e.unit : ""), el].filter(Boolean).join(" · ");
    }
    case "auftrag": return e.an ? `an ${e.an}` : "";
    case "rueckfrage": return e.an ? `an ${e.an}` : e.melder ? `von ${e.melder}` : "";
    case "orientierung": return e.quelle ?? "";
    // Ausgang: Empfänger steht in der Art («Ausgang an Bat»)
    case "ausgang": return "";
    default: return e.melder ?? "";
  }
}

function fillOf(e: LageEvent): JournalPdfFill {
  if (e.deleted) return null;
  if (artOf(e) === "ausgang") return "ausgang";
  if (!isLage(e)) return null;
  if (e.side === "blau") return "eigen";
  if (e.side === "rot") return e.aff === "U" ? "unklar" : "feind";
  return null;
}

/** Vermerke und Nachtrag einer Zeile («dringend», «Massnahme: …», «weitergemeldet Bat 07:15», «Nachtrag 07:34 MU: …») */
function vermerkeText(e: LageEvent, ex: Exercise, byId: Map<string, LageEvent>, idx: ReturnType<typeof lvzIndex>): string[] {
  const out: string[] = [];
  const v = vermerkeOf(e, idx);
  const nr = (id: string) => { const x = byId.get(id); return x ? nrLabel(x, ex) : "?"; };
  if (e.deleted) out.push(`gestrichen ${localHhmm(e.updatedAt)}${e.geaendertVon ? ` von ${e.geaendertVon}` : ""}`);
  if (v.dringend) out.push("dringend");
  if (artOf(e) === "auftrag" && e.frist) out.push(`bis ${e.frist.slice(11, 16)}`);
  if (v.massnahme) out.push(`Massnahme: ${v.massnahme}`);
  if (v.weiter) out.push(`weitergemeldet ${v.weiter.an} ${v.weiter.um.slice(11, 16) || v.weiter.um}`);
  if (v.quittiert) out.push(`quittiert ${v.quittiert.t.slice(11, 16)} (Nr ${nr(v.quittiert.id)})`);
  if (v.beantwortet) out.push(`beantwortet ${v.beantwortet.t.slice(11, 16)} (Nr ${nr(v.beantwortet.id)})`);
  if (v.status === "erledigt") out.push(`erledigt${v.erledigtUm ? ` ${localHhmm(v.erledigtUm)}` : ""}`);
  else if (v.status === "offen" && (artOf(e) === "auftrag" || artOf(e) === "rueckfrage" || e.lvz?.status)) out.push("offen");
  if (v.aufgehoben) out.push(`aufgehoben ${v.aufgehoben.t.slice(11, 16)} (Nr ${nr(v.aufgehoben.id)})`);
  if (e.hebtAuf) out.push(`hebt Nr ${nr(e.hebtAuf)} auf`);
  if (e.bezug && !e.hebtAuf && e.bezugArt !== "quittung") out.push(`${e.bezugArt === "antwort" ? "Antwort auf" : e.bezugArt === "ausgefuehrt" ? "ausgeführt:" : "zu"} Nr ${nr(e.bezug)}`);
  const hist = (e.history ?? []).filter((r) => !r.deleted);
  // Art-Korrektur: alte Art vor dem Text («vorher: Orientierung Bat «…»»), nur wenn sie anders war
  const artVon = (r: EventRevision) => artText({ ...e, ...r, art: r.art ?? (artOf(e) === "meldung" ? undefined : "meldung"), notiz: r.art ? r.art !== "meldung" : false } as LageEvent);
  const line = (r: (typeof hist)[number]) => {
    const p = placeLabel(r);
    const alt = (r.art ?? "meldung") !== artOf(e) ? `${artVon(r)} ` : "";
    return `${alt}«${r.text}»${p ? ` (${p})` : ""}`;
  };
  const korr = hist.filter((r) => !r.conflict);
  if (korr.length && !e.deleted) out.push(`Nachtrag ${e.correctedAt ? localHhmm(e.correctedAt) : ""}${e.geaendertVon ? ` ${e.geaendertVon}` : ""}: vorher ${korr.map(line).join(" | ")}`.replace(/ {2,}/g, " "));
  const konf = hist.filter((r) => r.conflict);
  if (konf.length) out.push(`Konflikt, nicht übernommen: ${konf.map(line).join(" | ")}`);
  return out;
}

/** PQ-Token einer Ortsangabe («AM5», «AM5 C» → «AM5») */
const pqOf = (s: string) => s.match(/\b[A-Z]{2}\s?\d{1,3}\b/g)?.map((x) => x.replace(/\s/, "")) ?? [];
/** Ort einer Meldung, jedes Planquadrat nur einmal: «AM5 C · auf Kornhausstrasse», «NAI 2 · AN6» */
export function ortOhneDoppel(e: Pick<LageEvent, "where" | "cells" | "nai" | "road">): string {
  const teile: string[] = [];
  const gesehen = new Set<string>();
  const dazu = (s?: string) => {
    if (!s || teile.includes(s)) return;
    const pq = pqOf(s);
    if (pq.length && pq.every((x) => gesehen.has(x))) return;
    pq.forEach((x) => gesehen.add(x));
    teile.push(s);
  };
  dazu(e.where);
  for (const c of e.cells ?? []) dazu(c);
  if (e.nai && !(e.where ?? "").includes(e.nai)) dazu(e.nai);
  if (e.road && !teile.some((t) => t.includes(e.road!))) teile.push(`auf ${e.road}`);
  return teile.join(" · ");
}

/** Zeilen des Journal-PDF im Umfang (rein): Tageszeilen und Einträge, chronologisch */
export function journalPdfRows(ex: Exercise, umfang: Pick<JournalUmfang, "from" | "to" | "at">, o: { ohneGestrichene?: boolean } = {}): JournalPdfRow[] {
  const all = ex.events ?? [];
  const idx = lvzIndex(all);
  const byId = new Map(all.map((e) => [e.id, e]));
  const out: JournalPdfRow[] = [];
  let tag = "";
  for (const e of eintraegeIm(ex, umfang, o.ohneGestrichene)) {
    const d = e.t.slice(0, 10);
    if (d !== tag) { tag = d; out.push({ kind: "tag", text: tagZeile(d, ex.days) }); }
    const art = artOf(e);
    const v = vermerkeOf(e, idx);
    const ort = art === "meldung" && !e.hebtAuf ? ortOhneDoppel(e) : (e.orte ?? []).join(", ") || (e.hebtAuf ? placeLabel(e) : "");
    out.push({
      kind: "eintrag",
      id: e.id,
      cells: [
        nrLabel(e, ex),
        // MVP 3.5 (S23, Paket E): in der doppelten Stunde «02:45 MESZ» / «02:10 MEZ»
        zeitText(e),
        e.tReported ? e.tReported.slice(11, 16) : "",
        art === "meldung" ? (e.notiz ? "Notiz" : kindText(e)) : art === "ausgang" ? artText(e) : ART_KURZ[art],
        vonAn(e),
        e.via === "ki" ? `${e.text} [KI]` : e.text,
        ort,
        e.erfasstVon || "–",
      ],
      vermerke: vermerkeText(e, ex, byId, idx),
      fill: fillOf(e),
      dringend: v.dringend,
      gestrichen: !!e.deleted,
    });
  }
  return out;
}

/**
 * Visum (letzte Seite): «Geführt von: BSP (T2 06:00–07:31) · übergeben an: MU» je Schicht im Zeitraum (aus
 * `ex.schichten`), danach «Visum: ________».
 */
export function visumZeilen(ex: Exercise, from: string, to: string): string[] {
  const vorher = schichtAm(ex, from);
  const im = schichtenIm(ex, from, to).filter((s) => s !== vorher && zeitCmp(s.t, from) > 0);
  const out: string[] = [];
  let k = vorher?.an ?? null, a = from;
  // vor dem ersten Wechsel unbekannt geführt: Lücke zeigen (Unterschrift nachtragen)
  if (!vorher && im[0] && im[0].art === "beginn" && zeitCmp(im[0].t, from) > 0) { out.push(`Geführt von: ________ (${spanne(from, im[0].t, ex.days)})`); a = im[0].t; }
  for (const s of im) {
    if (k || s.art === "uebergabe") out.push(`Geführt von: ${k ?? s.von ?? "________"} (${spanne(a, s.t, ex.days)})${s.art === "uebergabe" ? ` · übergeben an: ${s.an}` : ""}`);
    k = s.an; a = s.t;
  }
  out.push(`Geführt von: ${k ?? "________"} (${spanne(a, to, ex.days)})`);
  return out;
}

// ---------- Layout

/** Schrift nie unter 8 pt (Prüfung N) */
const W = 210, M = 10, FS = 8, LH = 3.6, BOTTOM = 284;
const FILL: Record<NonNullable<JournalPdfFill>, [number, number, number]> = { feind: [253, 232, 235], unklar: [252, 244, 214], eigen: [232, 240, 252], ausgang: [232, 232, 232] };
/** so viele letzte Zeilen wandern mit dem Visum auf die nächste Seite (nie allein, Kap. 2.9) */
const VISUM_MIT = 3;
const colX = (i: number) => M + JOURNAL_COLS.slice(0, i).reduce((s, c) => s + c.w, 0);

export interface JournalPdfExtra {
  /** Hinweise zu Rot (alle zur Lagezeit), Anhang nur aus dem Zeitraum oder offen */
  hints?: Hint[];
  /** Lage Rot zur Lagezeit `t` */
  lageRot?: { lage: LageRotState; t: string };
  /** Vermerk zur KI unter dem Journal (`kiPdfNote`) */
  kiNote?: string | null;
  /** erstellt um (Standard jetzt) */
  now?: Date;
}

function layout(ex: Exercise, o: JournalDruck, extra: JournalPdfExtra): jsPDF {
  const doc = safePdf(new jsPDF({ unit: "mm", format: "a4" })); // Klartext statt Pfeile: Standardschrift kann nur WinAnsi
  const umfang = { ...o.umfang, from: o.umfang.from ?? grenzen(ex).from };
  const rows = journalPdfRows(ex, umfang, { ohneGestrichene: o.anhang.ohneGestrichene });
  const kopf = umfangText(ex, umfang);
  const now = extra.now ?? new Date();
  const erstellt = `erstellt ${now.toLocaleDateString("de-CH")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}${o.kuerzel ? ` von ${o.kuerzel}` : ""}`;
  let y = 0;
  const header = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(0);
    // Titel darf umbrechen: Tageszeile und Tabellenkopf rücken darunter (nie überlappt, Prüfung N)
    const titel = doc.splitTextToSize(`Lagejournal – ${ex.name} · ${kopf}`, W - 2 * M - 46) as string[];
    doc.text(titel, M, 12);
    const unten = 12 + (titel.length - 1) * 4.6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(o.klassifizierung, W - M, 9, { align: "right" });
    doc.text(erstellt, W - M, 13, { align: "right" });
    if (ex.days.length) doc.text(doc.splitTextToSize(ex.days.map((d, i) => `T${i + 1} = ${datum(d)}`).join(" · "), W - 2 * M) as string[], M, unten + 6);
    y = unten + 13;
    // Kopfzeile ohne Füllung (Farbe nur in der Spalte «Art»): fett, Linie darunter
    doc.setTextColor(0); doc.setFont("helvetica", "bold"); doc.setFontSize(FS);
    let x = M + 0.8;
    for (const c of JOURNAL_COLS) { doc.text(c.h, x, y); x += c.w; }
    doc.setDrawColor(0); doc.setLineWidth(0.35); doc.line(M, y + 1.4, W - M, y + 1.4);
    doc.setFont("helvetica", "normal");
    y += 4.8;
  };
  const newPage = () => { doc.addPage(); header(); };
  header();
  doc.setFontSize(FS);
  // Höhe je Zeile vorab (für «Visum nie allein»)
  const mass = rows.map((r) => {
    if (r.kind === "tag") return { lines: [] as string[][], verm: [] as string[], h: LH + 0.8 };
    doc.setFont("helvetica", r.dringend ? "bold" : "normal"); doc.setFontSize(FS);
    // Spalte «Nr» bei dringend: Platz für das Vektorzeichen ⚠
    // Zeit: «02:45 MESZ» (doppelte Stunde) als zwei Zeilen «02:45» / «MESZ», nie mitten im Wort getrennt (Paket E)
    // Art (Spalte 3): nur an Leerschlägen umbrechen, nie mitten im Wort («Verbindungskontrolle» → kleinere Schrift)
    const lines = r.cells.map((c, i) => (i === 1 ? c.split(" ") : i === 3 ? artZeilen(doc, c, JOURNAL_COLS[3].w - 1.4) : doc.splitTextToSize(c, JOURNAL_COLS[i]!.w - 1.4 - (i === 0 && r.dringend ? 3 : 0)) as string[]));
    doc.setFont("helvetica", "italic");
    const verm = r.vermerke.length ? doc.splitTextToSize(r.vermerke.join(" · "), JOURNAL_COLS[5].w - 1.4) as string[] : [];
    doc.setFont("helvetica", "normal");
    const n = Math.max(...lines.map((l, i) => l.length + (i === 5 ? verm.length : 0)), 1);
    return { lines, verm, h: n * LH + 0.6 };
  });
  const visumNeed = (() => {
    const kl = extra.kiNote ? (doc.splitTextToSize(extra.kiNote, W - 2 * M) as string[]).length * 3.6 + 3 : 0;
    doc.setFontSize(9);
    const vl = visumZeilen(ex, umfang.from, umfang.to).reduce((s2, v) => s2 + (doc.splitTextToSize(v, W - 2 * M) as string[]).length * 4.4 + 1, 0);
    doc.setFontSize(FS);
    return kl + vl + 14;
  })();
  let ersteDerLetzten = -1;
  for (let i = rows.length - 1, n = 0; i >= 0; i--) { if (rows[i]!.kind === "eintrag") { ersteDerLetzten = i; if (++n >= VISUM_MIT) break; } }
  const restHoehe = ersteDerLetzten >= 0 ? mass.slice(ersteDerLetzten).reduce((s2, m) => s2 + m.h, 0) : 0;
  rows.forEach((r, ri) => {
    // die letzten Zeilen samt Visum zusammen (passt alles auf eine leere Seite)
    if (ri === ersteDerLetzten && y + restHoehe + visumNeed > BOTTOM && restHoehe + visumNeed < BOTTOM - 40) newPage();
    if (r.kind === "tag") {
      if (y + LH * 2.4 > BOTTOM) newPage();
      doc.setFont("helvetica", "bold"); doc.setFontSize(FS + 0.5);
      doc.text(r.text, M + 0.8, y);
      doc.setDrawColor(150); doc.setLineWidth(0.2); doc.line(M, y + 1.1, W - M, y + 1.1);
      doc.setFont("helvetica", "normal"); doc.setFontSize(FS);
      y += LH + 0.8;
      return;
    }
    const { lines, verm, h } = mass[ri]!;
    if (y + h > BOTTOM) newPage();
    // Farbe nur in der Spalte «Art» (Feind/Unklar/Eigene/Ausgang)
    if (r.fill) { doc.setFillColor(...FILL[r.fill]); doc.rect(colX(3) + 0.4, y - 2.6, JOURNAL_COLS[3].w - 0.4, h, "F"); }
    if (r.gestrichen) doc.setTextColor(120);
    let x = M + 0.8;
    lines.forEach((l, i) => {
      doc.setFont("helvetica", r.dringend && (i === 5 || i === 0) ? "bold" : "normal");
      doc.text(l, x, y);
      if (i === 0 && r.dringend && l[0]) glyphWarn(doc, x + doc.getTextWidth(l[0]) + 0.6, y);
      // gestrichen: Meldung durchstreichen (Vermerke nicht)
      if (r.gestrichen && i === 5) {
        doc.setDrawColor(120); doc.setLineWidth(0.15);
        l.forEach((ln, k) => { const w = doc.getTextWidth(ln); doc.line(x, y + k * LH - 0.9, x + w, y + k * LH - 0.9); });
      }
      if (i === 5 && verm.length) {
        doc.setFont("helvetica", "italic"); doc.setFontSize(FS); doc.setTextColor(r.gestrichen ? 120 : 60);
        doc.text(verm, x, y + l.length * LH);
        doc.setFontSize(FS); doc.setTextColor(r.gestrichen ? 120 : 0);
      }
      x += JOURNAL_COLS[i]!.w;
    });
    doc.setFont("helvetica", "normal"); doc.setTextColor(0);
    doc.setDrawColor(215); doc.setLineWidth(0.1); doc.line(M, y - 2.6 + h, W - M, y - 2.6 + h);
    y += h;
  });
  if (!rows.length) { doc.setFontSize(9); doc.text("Keine Einträge in diesem Umfang.", M, y + 2); y += 8; }
  // KI-Vermerk und Visum (letzte Seite des Journals)
  const tail: Array<{ text: string; italic?: boolean }> = [];
  if (extra.kiNote) tail.push({ text: extra.kiNote, italic: true });
  const visum = visumZeilen(ex, umfang.from, umfang.to);
  const vl = visum.map((s) => doc.splitTextToSize(s, W - 2 * M) as string[]);
  const kl = tail.map((t) => doc.splitTextToSize(t.text, W - 2 * M) as string[]);
  const need = kl.reduce((s, l) => s + l.length * 3.6 + 3, 0) + vl.reduce((s, l) => s + l.length * 4.4 + 1, 0) + 14;
  if (y + need > BOTTOM) newPage();
  y += 3;
  kl.forEach((l, i) => {
    doc.setFont("helvetica", tail[i]!.italic ? "italic" : "normal"); doc.setFontSize(8); doc.setTextColor(80);
    doc.text(l, M, y + 2); y += l.length * 3.6 + 3;
  });
  doc.setFont("helvetica", "normal"); doc.setTextColor(0); doc.setFontSize(9);
  doc.setDrawColor(0); doc.setLineWidth(0.3); doc.line(M, y, W - M, y);
  y += 5;
  for (const l of vl) { doc.text(l, M, y); y += l.length * 4.4 + 1; }
  y += 3;
  doc.text("Visum: ________________________", M, y);
  // Anhänge (neue Seite je Anhang)
  let page = doc.getNumberOfPages();
  if (o.anhang.lageRot && extra.lageRot) page = appendLageRotPdf(doc, ex, extra.lageRot.lage, extra.lageRot.t, o.klassifizierung, page, { kompakt: true });
  if (o.anhang.hinweise && extra.hints?.length) appendHintsPdf(doc, ex, extra.hints, o.klassifizierung, page, { nur: { from: umfang.from, to: umfang.to } });
  // «Seite n von m» und Klassifizierung als Fusszeile auf allen Seiten
  pdfPageNumbers(doc, o.klassifizierung);
  return doc;
}

/** Journal-PDF im Umfang `o` (Spez. MVP 3, Kap. 3.9); setzt `window.__ltPdfInfo` */
export function journalPdf(ex: Exercise, o: JournalDruck, extra?: JournalPdfExtra): Blob;
/** alte Signatur (MVP 1): ganze Übung, Anhänge wenn übergeben */
export function journalPdf(ex: Exercise, classification?: string, hints?: Hint[], lageRot?: { lage: LageRotState; t: string }, kiNote?: string | null): Blob;
export function journalPdf(ex: Exercise, a?: JournalDruck | string, b?: JournalPdfExtra | Hint[], lageRot?: { lage: LageRotState; t: string }, kiNote?: string | null): Blob {
  let o: JournalDruck, extra: JournalPdfExtra;
  if (typeof a === "object") { o = a; extra = (b as JournalPdfExtra | undefined) ?? {}; }
  else {
    const g = grenzen(ex);
    o = { umfang: { art: "alles", from: g.from, to: lageRot?.t && zeitCmp(lageRot.t, g.to) > 0 ? lageRot.t : g.to }, anhang: { lageRot: !!lageRot, hinweise: !!(b as Hint[] | undefined)?.length, ohneGestrichene: false }, klassifizierung: a ?? "INTERN", kuerzel: null };
    extra = { hints: b as Hint[] | undefined, lageRot, kiNote };
  }
  const doc = layout(ex, o, extra);
  pdfInfo(doc, "a4", false);
  return doc.output("blob");
}

/** Seiten des Journal-PDF (gleiche Rechnung wie `journalPdf`, ohne Datei) – für «ca. n Seiten» im Dialog */
export function journalPdfSeiten(ex: Exercise, o: JournalDruck, extra: JournalPdfExtra = {}): number {
  return layout(ex, o, extra).getNumberOfPages();
}
