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
 */
import { jsPDF } from "jspdf";
import {
  ART_LABEL, artOf, isLage, kindLabel, lvzIndex, nrLabel, placeLabel, schichtenIm, vermerkeOf,
  type Exercise, type Hint, type LageEvent,
} from "@lage/core";
import { appendHintsPdf } from "./hintsExport";
import type { LageRotState } from "./lageRot";
import { appendLageRotPdf, pdfPageNumbers } from "./lageRotExport";
import { safePdf } from "./pdfSafe";
import { pdfInfo } from "./perf";
import type { JournalDruck } from "./shell/contracts";
import { datum, eintraegeIm, grenzen, localHhmm, schichtAm, spanne, tagZeile, umfangText, type JournalUmfang } from "./print/umfang";

export { tagZeile, umfangText, wochentagOf, type JournalUmfang } from "./print/umfang";

// ---------- Zeilen

export type JournalPdfFill = "feind" | "unklar" | "eigen" | null;
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
  { h: "Nr", w: 9 }, { h: "Zeit", w: 9 }, { h: "Eing.", w: 9 }, { h: "Art", w: 16 }, { h: "von/an", w: 17 },
  { h: "Meldung", w: 74 }, { h: "Ort", w: 36 }, { h: "Erf.", w: 10 },
] as const;

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
    default: return e.melder ?? "";
  }
}

function fillOf(e: LageEvent): JournalPdfFill {
  if (e.deleted || !isLage(e)) return null;
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
  const line = (r: (typeof hist)[number]) => { const p = placeLabel(r); return `«${r.text}»${p ? ` (${p})` : ""}`; };
  const korr = hist.filter((r) => !r.conflict);
  if (korr.length && !e.deleted) out.push(`Nachtrag ${e.correctedAt ? localHhmm(e.correctedAt) : ""}${e.geaendertVon ? ` ${e.geaendertVon}` : ""}: vorher ${korr.map(line).join(" | ")}`.replace(/ {2,}/g, " "));
  const konf = hist.filter((r) => r.conflict);
  if (konf.length) out.push(`Konflikt, nicht übernommen: ${konf.map(line).join(" | ")}`);
  return out;
}

/** Zeilen des Journal-PDF im Umfang (rein): Tageszeilen und Einträge, chronologisch */
export function journalPdfRows(ex: Exercise, umfang: Pick<JournalUmfang, "from" | "to">, o: { ohneGestrichene?: boolean } = {}): JournalPdfRow[] {
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
    const ort = art === "meldung" && !e.hebtAuf
      ? [e.where, ...(e.cells ?? []).filter((c) => c !== e.where)].filter(Boolean).join(", ")
      : (e.orte ?? []).join(", ") || (e.hebtAuf ? placeLabel(e) : "");
    out.push({
      kind: "eintrag",
      id: e.id,
      cells: [
        nrLabel(e, ex),
        e.t.slice(11, 16),
        e.tReported ? e.tReported.slice(11, 16) : "",
        art === "meldung" ? (e.notiz ? "Notiz" : kindText(e)) : ART_KURZ[art],
        vonAn(e),
        (v.dringend ? "! " : "") + (e.via === "ki" ? `${e.text} [KI]` : e.text),
        ort,
        e.erfasstVon ?? "",
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
  const im = schichtenIm(ex, from, to).filter((s) => s !== vorher && s.t > from);
  const out: string[] = [];
  let k = vorher?.an ?? null, a = from;
  // vor dem ersten Wechsel unbekannt geführt: Lücke zeigen (Unterschrift nachtragen)
  if (!vorher && im[0] && im[0].art === "beginn" && im[0].t > from) { out.push(`Geführt von: ________ (${spanne(from, im[0].t, ex.days)})`); a = im[0].t; }
  for (const s of im) {
    if (k || s.art === "uebergabe") out.push(`Geführt von: ${k ?? s.von ?? "________"} (${spanne(a, s.t, ex.days)})${s.art === "uebergabe" ? ` · übergeben an: ${s.an}` : ""}`);
    k = s.an; a = s.t;
  }
  out.push(`Geführt von: ${k ?? "________"} (${spanne(a, to, ex.days)})`);
  return out;
}

// ---------- Layout

const W = 210, M = 10, FS = 7.5, LH = 3.4, TOP = 25, BOTTOM = 284;
const FILL: Record<NonNullable<JournalPdfFill>, [number, number, number]> = { feind: [253, 232, 235], unklar: [252, 244, 214], eigen: [232, 240, 252] };

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
    doc.text(doc.splitTextToSize(`Lagejournal – ${ex.name} · ${kopf}`, W - 2 * M - 40) as string[], M, 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(o.klassifizierung, W - M, 9, { align: "right" });
    doc.text(erstellt, W - M, 13, { align: "right" });
    if (ex.days.length) doc.text(ex.days.map((d, i) => `T${i + 1} = ${datum(d)}`).join(" · "), M, 20);
    y = TOP;
    doc.setFillColor(29, 29, 29); doc.rect(M, y - 3.4, W - 2 * M, 4.8, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(FS);
    let x = M + 0.8;
    for (const c of JOURNAL_COLS) { doc.text(c.h, x, y); x += c.w; }
    doc.setTextColor(0); doc.setFont("helvetica", "normal");
    y += 4.2;
  };
  const newPage = () => { doc.addPage(); header(); };
  header();
  doc.setFontSize(FS);
  for (const r of rows) {
    if (r.kind === "tag") {
      if (y + LH * 2.4 > BOTTOM) newPage();
      doc.setFont("helvetica", "bold"); doc.setFontSize(FS + 0.5);
      doc.setFillColor(236, 236, 236); doc.rect(M, y - 2.8, W - 2 * M, LH + 0.6, "F");
      doc.text(r.text, M + 0.8, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(FS);
      y += LH + 0.8;
      continue;
    }
    doc.setFont("helvetica", r.dringend ? "bold" : "normal");
    const lines = r.cells.map((c, i) => doc.splitTextToSize(c, JOURNAL_COLS[i]!.w - 1.4) as string[]);
    doc.setFont("helvetica", "normal"); doc.setFontSize(FS - 0.8);
    const verm = r.vermerke.length ? doc.splitTextToSize(r.vermerke.join(" · "), JOURNAL_COLS[5].w - 1.4) as string[] : [];
    doc.setFontSize(FS);
    const n = Math.max(...lines.map((l, i) => l.length + (i === 5 ? verm.length : 0)), 1);
    const h = n * LH + 0.6;
    if (y + h > BOTTOM) newPage();
    if (r.fill) { doc.setFillColor(...FILL[r.fill]); doc.rect(M, y - 2.6, W - 2 * M, h, "F"); }
    if (r.gestrichen) doc.setTextColor(120);
    let x = M + 0.8;
    lines.forEach((l, i) => {
      doc.setFont("helvetica", r.dringend && (i === 5 || i === 0) ? "bold" : "normal");
      doc.text(l, x, y);
      // gestrichen: Meldung durchstreichen (Vermerke nicht)
      if (r.gestrichen && i === 5) {
        doc.setDrawColor(120); doc.setLineWidth(0.15);
        l.forEach((ln, k) => { const w = doc.getTextWidth(ln); doc.line(x, y + k * LH - 0.9, x + w, y + k * LH - 0.9); });
      }
      if (i === 5 && verm.length) {
        doc.setFont("helvetica", "italic"); doc.setFontSize(FS - 0.8); doc.setTextColor(r.gestrichen ? 120 : 60);
        doc.text(verm, x, y + l.length * LH);
        doc.setFontSize(FS); doc.setTextColor(r.gestrichen ? 120 : 0);
      }
      x += JOURNAL_COLS[i]!.w;
    });
    doc.setFont("helvetica", "normal"); doc.setTextColor(0);
    doc.setDrawColor(215); doc.setLineWidth(0.1); doc.line(M, y - 2.6 + h, W - M, y - 2.6 + h);
    y += h;
  }
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
    doc.setFont("helvetica", tail[i]!.italic ? "italic" : "normal"); doc.setFontSize(7.5); doc.setTextColor(80);
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
    o = { umfang: { art: "alles", from: g.from, to: lageRot?.t && lageRot.t > g.to ? lageRot.t : g.to }, anhang: { lageRot: !!lageRot, hinweise: !!(b as Hint[] | undefined)?.length, ohneGestrichene: false }, klassifizierung: a ?? "INTERN", kuerzel: null };
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
