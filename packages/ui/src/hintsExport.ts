/**
 * Hinweise mit Entscheid exportieren: CSV «Hinweise» und Anhang im Journal-PDF.
 */
import type { jsPDF } from "jspdf";
import { zeitBis, zeitCmp, type Exercise, type Hint } from "@lage/core";
import { decisionOf, decisionRec, GROUP_LABEL, groupOf, isOpen, LEVEL_LABEL, ruleOf } from "./hintsData";
import { glyphBreite, safePdf, textMitGlyph } from "./pdfSafe";

const csvCell = (v: string) => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const dayOf = (t: string, days: string[]) => { const i = days.indexOf(t.slice(0, 10)); return i >= 0 ? `T${i + 1}` : t.slice(0, 10); };
const DECISION: Record<string, string> = { neu: "offen", bestaetigt: "bestätigt", verworfen: "verworfen" };

function rows(ex: Exercise, hints: Hint[]) {
  const by = new Map((ex.events ?? []).map((e) => [e.id, e]));
  return [...hints].sort((a, b) => a.t.localeCompare(b.t) || a.rule.localeCompare(b.rule)).map((h) => {
    const r = ruleOf(h.rule);
    const d = decisionRec(ex, h);
    const trig = h.events.map((id) => by.get(id)).filter((e) => !!e && !e.deleted)
      .map((e) => `${e!.t.slice(11, 16)} ${e!.melder ?? ""} ${e!.text}`.replace(/\s+/g, " ").trim());
    return {
      tag: dayOf(h.t, ex.days), zeit: h.t.slice(11, 16), stufe: LEVEL_LABEL[h.level], regel: h.rule, gruppe: GROUP_LABEL[groupOf(h)],
      titel: h.title, text: h.text, bundled: h.bundled ?? 1, h, prognose: h.next ? `${dayOf(h.next, ex.days)} ${h.next.slice(11, 16)}` : "",
      ort: [...(h.cells ?? []), h.nai ?? "", h.unit ?? ""].filter(Boolean).join(" "),
      ausloeser: trig, entscheid: DECISION[decisionOf(ex, h)]!, um: d?.at ? `${dayOf(d.at, ex.days)} ${d.at.slice(11, 16)}` : "", quelle: r?.source ?? "",
    };
  });
}

export function hintsToCsv(ex: Exercise, hints: Hint[]): string {
  const head = ["Tag", "Zeit", "Stufe", "Regel", "Gruppe", "Hinweis", "Begründung", "Prognose", "Ort / Element", "Auslöser", "Entscheid", "Entschieden um", "Quelle"];
  const body = rows(ex, hints).map((r) => [r.tag, r.zeit, r.stufe, r.regel, r.gruppe, r.titel, r.text, r.prognose, r.ort, r.ausloeser.join(" | "), r.entscheid, r.um, r.quelle]);
  return "﻿" + [head, ...body].map((r) => r.map(csvCell).join(";")).join("\r\n");
}

/**
 * Anhang «Hinweise» an ein Journal-PDF (A4 hoch, neue Seite). `page` = bisherige Seitenzahl.
 * `nur` (Journal-PDF mit Umfang, Spez. MVP 3, Kap. 3.9): nur Hinweise mit Zeit im Zeitraum oder noch offen, kompakt
 * auf **höchstens eine Seite** (was nicht passt: «+ n weitere …»). Gebündelte gleiche Hinweise als eine Zeile «· 14×».
 */
export function appendHintsPdf(doc: jsPDF, ex: Exercise, hints: Hint[], classification: string, page: number, o: { nur?: { from: string | null; to: string } } = {}): void {
  const nur = o.nur;
  const list = nur ? hints.filter((h) => (zeitBis(h.t, nur.to) && (!nur.from || zeitBis(nur.from, h.until ?? h.last ?? h.t))) || isOpen(ex, h, nur.to)) : hints;
  if (!list.length) return;
  safePdf(doc); // «N↔S» → «N–S», «→» → «nach» (Standardschrift nur WinAnsi)
  const k = !!nur;
  const W = 210, M = 12, LH = k ? 3.5 : 3.7;
  const cols = [{ h: "Tag", w: 10 }, { h: "Zeit", w: 12 }, { h: "Stufe", w: 15 }, { h: "Regel", w: 12 }, { h: "Hinweis / Begründung / Auslöser", w: 103 }, { h: "Entscheid", w: 34 }];
  let y = 0;
  let voll = false;
  const header = () => {
    if (k && y > 0) { voll = true; return; }
    doc.addPage(); page++;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(0);
    // Titel links (darf umbrechen), Vermerk darunter – nie übereinander (Prüfung N)
    const titel = doc.splitTextToSize(`Anhang: Hinweise zu Rot – ${ex.name}`, W - 2 * M - 22) as string[];
    doc.text(titel, M, 14);
    const unten = 14 + (titel.length - 1) * 5.4;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.text(classification, W - M, 10, { align: "right" });
    const verm = doc.splitTextToSize(`Hinweise, keine Fakten – Entscheid durch Zfhr${nur ? " · nur Hinweise aus dem Zeitraum des Journals und noch offene" : ""}`, W - 2 * M) as string[];
    doc.text(verm, M, unten + 5.5);
    y = unten + 11 + (verm.length - 1) * 3.8;
    // Kopfzeile ohne Füllung (MVP 3.5, Kap. 2.9): fett, Linie darunter
    doc.setTextColor(0); doc.setFont("helvetica", "bold");
    let x = M + 1;
    for (const c of cols) { doc.text(c.h, x, y); x += c.w; }
    doc.setDrawColor(0); doc.setLineWidth(0.35); doc.line(M, y + 1.4, W - M, y + 1.4); doc.setLineWidth(0.2);
    doc.setFont("helvetica", "normal");
    y += 5.5;
  };
  header();
  doc.setFontSize(k ? 8 : 8.5);
  const all = rows(ex, list);
  const layoutRow = (r: (typeof all)[number]) => {
    const titel = r.bundled > 1 ? `${r.titel} · ${r.bundled}×` : r.titel;
    const trig = k ? r.ausloeser.slice(-2) : r.ausloeser;
    const main = [titel, r.text, ...(r.prognose ? [`Prognose: ${r.prognose}`] : []), ...trig.map((a) => `· ${a}`), ...(r.quelle && !k ? [`Quelle: ${r.quelle}`] : [])].join("\n");
    const cells = [r.tag, r.zeit, r.stufe, r.regel, main, `${r.entscheid}${r.um ? `\n${r.um}` : ""}`];
    // Stufe «hoch»: Vektorzeichen ⚠ vor dem Wort (statt farbiger Zeile)
    const lines = cells.map((c, i) => doc.splitTextToSize(c, cols[i]!.w - 2 - (i === 2 && r.h.level === "hoch" ? glyphBreite(doc) : 0)) as string[]);
    return { r, lines, h: Math.max(...lines.map((l) => l.length)) * LH + 1.6 };
  };
  let todo = all.map(layoutRow);
  if (k) {
    // eine Seite: offene und wichtige zuerst, dann neueste; gezeigt in zeitlicher Reihenfolge
    const room = 280 - y - 6;
    const rank = (x: (typeof todo)[number]) => (nur && isOpen(ex, x.r.h, nur.to) ? 4 : 0) + (x.r.h.level === "hoch" ? 2 : x.r.h.level === "mittel" ? 1 : 0);
    const order = todo.map((x, i) => ({ x, i })).sort((a, b) => rank(b.x) - rank(a.x) || zeitCmp(b.x.r.h.t, a.x.r.h.t));
    const keep = new Set<number>();
    let used = 0;
    for (const { x, i } of order) { if (used + x.h > room) continue; used += x.h; keep.add(i); }
    todo = todo.filter((_, i) => keep.has(i));
  }
  let shown = 0;
  for (const { r, lines, h } of todo) {
    if (y + h > (k ? 280 : 285)) header();
    if (voll) break;
    let x = M + 1;
    lines.forEach((l, i) => {
      if (i === 2 && r.h.level === "hoch") { doc.setFont("helvetica", "bold"); textMitGlyph(doc, "warn", l, x, y); doc.setFont("helvetica", "normal"); }
      else if (i === 4) { doc.setFont("helvetica", "bold"); doc.text(l[0] ?? "", x, y); doc.setFont("helvetica", "normal"); doc.text(l.slice(1), x, y + LH); }
      else doc.text(l, x, y);
      x += cols[i]!.w;
    });
    doc.setDrawColor(210); doc.line(M, y - 3.2 + h, W - M, y - 3.2 + h);
    y += h;
    shown++;
  }
  if (shown < all.length) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(80);
    doc.text(`Dazu ${all.length - shown} weitere (ältere bzw. erledigte) Hinweise – vollständig als Tabelle «Hinweise» (CSV) oder in der App`, M, y + 2);
    doc.setFont("helvetica", "normal"); doc.setTextColor(0);
  }
}
