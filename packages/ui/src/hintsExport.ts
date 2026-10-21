/**
 * Hinweise mit Entscheid exportieren: CSV «Hinweise» und Anhang im Journal-PDF.
 */
import type { jsPDF } from "jspdf";
import type { Exercise, Hint } from "@lage/core";
import { decisionOf, decisionRec, GROUP_LABEL, groupOf, LEVEL_LABEL, ruleOf } from "./hintsData";

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
      titel: h.title, text: h.text, prognose: h.next ? `${dayOf(h.next, ex.days)} ${h.next.slice(11, 16)}` : "",
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

/** Anhang «Hinweise» an ein Journal-PDF (A4 hoch, neue Seite). `page` = bisherige Seitenzahl. */
export function appendHintsPdf(doc: jsPDF, ex: Exercise, hints: Hint[], classification: string, page: number): void {
  if (!hints.length) return;
  const W = 210, M = 12;
  const cols = [{ h: "Tag", w: 10 }, { h: "Zeit", w: 12 }, { h: "Stufe", w: 15 }, { h: "Regel", w: 12 }, { h: "Hinweis / Begründung / Auslöser", w: 103 }, { h: "Entscheid", w: 34 }];
  let y = 0;
  const header = () => {
    doc.addPage(); page++;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(0);
    doc.text(`Anhang: Hinweise zu Rot – ${ex.name}`, M, 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(classification, W - M, 10, { align: "right" });
    doc.text(`Seite ${page} · Hinweise, keine Fakten – Entscheid durch Zfhr`, W - M, 14, { align: "right" });
    y = 22;
    doc.setFillColor(29, 29, 29); doc.rect(M, y - 4, W - 2 * M, 6, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold");
    let x = M + 1;
    for (const c of cols) { doc.text(c.h, x, y); x += c.w; }
    doc.setTextColor(0); doc.setFont("helvetica", "normal");
    y += 5;
  };
  header();
  for (const r of rows(ex, hints)) {
    const main = [`${r.titel}`, r.text, ...(r.prognose ? [`Prognose: ${r.prognose}`] : []), ...r.ausloeser.map((a) => `· ${a}`), ...(r.quelle ? [`Quelle: ${r.quelle}`] : [])].join("\n");
    const cells = [r.tag, r.zeit, r.stufe, r.regel, main, `${r.entscheid}${r.um ? `\n${r.um}` : ""}`];
    const lines = cells.map((c, i) => doc.splitTextToSize(c, cols[i]!.w - 2) as string[]);
    const h = Math.max(...lines.map((l) => l.length)) * 3.6 + 1.6;
    if (y + h > 285) header();
    if (r.stufe === LEVEL_LABEL.hoch) { doc.setFillColor(253, 232, 235); doc.rect(M, y - 3.2, W - 2 * M, h, "F"); }
    else if (r.stufe === LEVEL_LABEL.mittel) { doc.setFillColor(252, 244, 214); doc.rect(M, y - 3.2, W - 2 * M, h, "F"); }
    let x = M + 1;
    lines.forEach((l, i) => {
      if (i === 4) { doc.setFont("helvetica", "bold"); doc.text(l[0] ?? "", x, y); doc.setFont("helvetica", "normal"); doc.text(l.slice(1), x, y + 3.6); }
      else doc.text(l, x, y);
      x += cols[i]!.w;
    });
    doc.setDrawColor(210); doc.line(M, y - 3.2 + h, W - M, y - 3.2 + h);
    y += h;
  }
}
