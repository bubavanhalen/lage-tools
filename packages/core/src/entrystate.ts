/**
 * Zustand des Meldungsfelds (Spez. MVP 1, Kap. 3.2): «bereit» (grün), «bitte prüfen» (gelb, Enter fragt einmal),
 * «geht nicht» (rot, Enter trägt nicht ein). Reine Funktion über dem Entwurf (`parseMeldung`) und dem Umfeld.
 *
 * - «geht nicht» = `draft.problems` (MVP 0: unbekanntes Planquadrat/NAI, ungültige Zeit, unbekannter Trupp, zwei Orte).
 *   Ausnahme: Planquadrat ohne Führungsraster ist nur «bitte prüfen» (Ort fehlt dann). «Ort auf Karte setzen» löst
 *   Ortsprobleme, nie Zeit-/Trupp-Probleme.
 * - «bitte prüfen» = Trupp fehlt, Ort fehlt/nur angenommen/wird gesucht/offline, Zeit > 10 min in der Zukunft.
 * Texte nach Kap. 2.4 und 4.6; `hint` = was tun, `ask` = Frage beim ersten Enter («Nochmals Enter»).
 *
 * Signatur und Codes sind Vertrag (packages/ui/src/shell/contracts.ts); Felder `hint`, `ask`, `problem` und die
 * Optionen `hasPos`, `sheets`, `areas` sind Ergänzungen von Paket B.
 */
import type { Draft, DraftProblem } from "./journal";
import type { Area } from "./model";
import type { RasterSheet } from "./raster";

export type EntryLevel = "bereit" | "pruefen" | "geht-nicht";
export type EntryReasonCode = "melder" | "ort" | "ort-bei-trupp" | "zukunft" | "einordnung" | "ort-suche" | "ort-offline" | "kein-raster" | "problem";

export interface EntryReason {
  code: EntryReasonCode;
  /** Klartext für die Zustandszeile, z. B. «Wer meldet? fehlt» */
  text: string;
  /** betroffene Textstelle (unterstreichen), z. B. «AK77» */
  token?: string;
  /** was tun, z. B. «Trupp oben antippen oder an den Anfang schreiben.» */
  hint?: string;
  /** nur «bitte prüfen»: Frage nach dem ersten Enter, z. B. «Ohne Trupp eintragen? Nochmals Enter.» */
  ask?: string;
  /** nur «geht nicht»: Art des Problems im Entwurf (z. B. «melder» → «als neuen Trupp aufnehmen» anbieten) */
  problem?: DraftProblem["kind"];
}

export interface EntryState {
  level: EntryLevel;
  /** wichtigster Grund zuerst; «geht nicht» vor «bitte prüfen» */
  reasons: EntryReason[];
}

export interface EntryStateOptions {
  /** Übung hat mindestens ein Führungsraster */
  hasRaster: boolean;
  /** Netz vorhanden und Ortssuche erlaubt */
  online: boolean;
  /** Ortsname wird gerade nachgeschlagen */
  placePending: boolean;
  /** Ort von Hand auf der Karte gesetzt (löst alle Ortsgründe) */
  manualPos: boolean;
  now: Date;
  /**
   * Ort ist anderweitig bekannt (Ortsname nachgeschlagen, bisheriger Ort einer Korrektur): kein «Ort fehlt» – löst aber
   * keine Probleme («AK77» bleibt «geht nicht»).
   */
  hasPos?: boolean;
  /** Raster und NAI der Übung – für «gibt es nicht im Raster BERN (AA–AU, 1–15)» */
  sheets?: RasterSheet[];
  areas?: Area[];
}

/** «AK7», «AK 77 C» – Planquadrat-ähnliche Textstelle */
const PQ_TOKEN = /^[A-Z]{2}\s?\d{1,3}(?:\s?[ABCD])?$/;
/** Zeit mehr als 10 min nach jetzt → «bitte prüfen» */
const FUTURE_MS = 10 * 60000;

const hhmm = (t: string) => t.slice(11, 16);

/** Bereich eines Rasters in Worten, z. B. «BERN (AA–AU, 1–15)» */
export function rasterRange(s: RasterSheet): string {
  const letters = s.labelOrder === "col-row" ? s.colLabels : s.rowLabels;
  const nums = s.labelOrder === "col-row" ? s.rowLabels : s.colLabels;
  const span = (l: string[]) => (l.length ? (l.length === 1 ? l[0]! : `${l[0]}–${l[l.length - 1]}`) : "");
  return `${s.name} (${span(letters)}, ${span(nums)})`;
}

/** vorhandene NAI in Worten, z. B. «NAI 1–3» bzw. «NAI 1, NAI 4» */
export function naiRange(areas: Area[]): string {
  const names = areas.filter((a) => a.kind === "nai" || a.kind === "other").map((a) => a.name);
  if (!names.length) return "keine";
  const m = names.map((n) => /^(.*?)\s*(\d+)$/.exec(n));
  const head = m[0]?.[1];
  if (m.every((x) => x && x[1] === head)) {
    const nums = m.map((x) => +x![2]!).sort((a, b) => a - b);
    const run = nums.every((n, i) => i === 0 || n === nums[i - 1]! + 1);
    if (run && nums.length > 2) return `${head} ${nums[0]}–${nums[nums.length - 1]}`;
  }
  return names.join(", ");
}

/** Klartext und Ausweg für ein Problem im Entwurf (Kap. 4.6) */
function problemReason(p: DraftProblem, o: EntryStateOptions): EntryReason {
  const base = { code: "problem" as const, token: p.token, problem: p.kind };
  if (p.kind === "ort" && p.token) {
    if (/^(NAI|BNB)\s/i.test(p.token)) {
      return { ...base, text: `«${p.token}» gibt es nicht (vorhanden: ${naiRange(o.areas ?? [])}).`, hint: "NAI korrigieren oder Ort auf Karte setzen." };
    }
    if (PQ_TOKEN.test(p.token) && o.sheets?.length) {
      const where = o.sheets.length === 1 ? `im Raster ${rasterRange(o.sheets[0]!)}` : `in den Rastern ${o.sheets.map(rasterRange).join(", ")}`;
      return { ...base, text: `«${p.token}» gibt es nicht ${where}.`, hint: "Planquadrat korrigieren oder Ort auf Karte setzen." };
    }
    return { ...base, text: `${p.text}.`, hint: "Ort korrigieren oder Ort auf Karte setzen." };
  }
  if (p.kind === "zeit") {
    const bad = p.token && /ist keine gültige Uhrzeit$/.test(p.text);
    return { ...base, text: bad ? `«${p.token}» ist keine Uhrzeit.` : `${p.text}.`, hint: "Zeit im Text korrigieren, z. B. 0715." };
  }
  if (p.kind === "melder") return { ...base, text: `${p.text}`, hint: "Trupp im Text korrigieren oder als neuen Trupp aufnehmen." };
  return { ...base, text: `${p.text}.`, hint: "Eine Meldung pro Ort eintragen." };
}

export function entryState(d: Draft, o: EntryStateOptions): EntryState {
  const stop: EntryReason[] = [];
  const check: EntryReason[] = [];

  // Probleme der Erkennung sperren – ausser Planquadrat ohne Führungsraster (nur prüfen, Ort fehlt dann)
  let pqOhneRaster = false;
  for (const p of d.problems ?? []) {
    if (p.kind === "ort" && !o.hasRaster && p.token && PQ_TOKEN.test(p.token)) {
      pqOhneRaster = true;
      if (!o.manualPos) {
        check.push({
          code: "kein-raster", token: p.token,
          text: `Planquadrat ${p.token} unbekannt – noch kein Führungsraster.`,
          hint: "Ohne Ort eintragen oder Ort auf Karte setzen.", ask: "Ohne Ort eintragen? Nochmals Enter.",
        });
      }
      continue;
    }
    if (p.kind === "ort" && o.manualPos) continue; // Ort von Hand gesetzt: Ortsproblem gelöst
    stop.push(problemReason(p, o));
  }

  if (!d.melder.trim()) {
    check.push({ code: "melder", text: "Wer meldet? fehlt", hint: "Trupp oben antippen oder an den Anfang schreiben.", ask: "Ohne Trupp eintragen? Nochmals Enter." });
  }

  const hasPlace = o.manualPos || !!o.hasPos || !!d.pos;
  const ortAsk = "Ohne Ort eintragen? Nochmals Enter.";
  if (!hasPlace && !pqOhneRaster && !stop.some((r) => r.problem === "ort" || r.problem === "orte")) {
    if (d.placeQuery && o.placePending) {
      check.push({ code: "ort-suche", text: `Ort «${d.placeQuery}» wird gesucht …`, token: d.placeQuery, hint: "Kurz warten, Planquadrat angeben oder Ort auf Karte setzen.", ask: ortAsk });
    } else if (d.placeQuery && !o.online) {
      check.push({ code: "ort-offline", text: "Ortsnamen gehen nur mit Netz.", token: d.placeQuery, hint: "Planquadrat angeben oder Ort auf Karte setzen.", ask: ortAsk });
    } else if (d.placeQuery) {
      check.push({ code: "ort", text: `Ort «${d.placeQuery}» nicht gefunden`, token: d.placeQuery, hint: "Planquadrat oder NAI angeben oder Ort auf Karte setzen.", ask: ortAsk });
    } else {
      check.push({ code: "ort", text: "Ort fehlt", hint: "Planquadrat oder NAI dazuschreiben oder Ort auf Karte setzen.", ask: ortAsk });
    }
  } else if (!o.manualPos && !o.hasPos && d.where?.kind === "melder") {
    check.push({ code: "ort-bei-trupp", text: `Ort nur «${d.where.label}» angenommen`, hint: "Genauen Ort nennen oder Ort auf Karte setzen.", ask: "So eintragen? Nochmals Enter." });
  }

  const dt = Date.parse(d.t) - o.now.getTime();
  if (dt > FUTURE_MS) {
    check.push({ code: "zukunft", text: `${hhmm(d.t)} liegt in der Zukunft – meinst du gestern?`, hint: "Zeit prüfen oder den Tag dazuschreiben, z. B. T1 2315.", ask: "Trotzdem so eintragen? Nochmals Enter." });
  }

  if (stop.length) return { level: "geht-nicht", reasons: [...stop, ...check] };
  if (check.length) return { level: "pruefen", reasons: check };
  return { level: "bereit", reasons: [] };
}
