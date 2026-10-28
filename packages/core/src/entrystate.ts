/**
 * Zustand des Meldungsfelds (Spez. MVP 1, Kap. 3.2): «bereit» (grün), «bitte prüfen» (gelb, Enter fragt einmal),
 * «geht nicht» (rot, Enter trägt nicht ein). Reine Funktion über dem Entwurf (`parseMeldung`) und dem Umfeld.
 *
 * Erste Fassung (Phase 0). Paket B verfeinert Gründe und Texte; Signatur und Codes sind Vertrag
 * (packages/ui/src/shell/contracts.ts).
 */
import type { Draft } from "./journal";

export type EntryLevel = "bereit" | "pruefen" | "geht-nicht";
export type EntryReasonCode = "melder" | "ort" | "ort-bei-trupp" | "zukunft" | "einordnung" | "ort-suche" | "ort-offline" | "kein-raster" | "problem";

export interface EntryReason {
  code: EntryReasonCode;
  /** Klartext für die Zustandszeile, z. B. «Wer meldet? fehlt» */
  text: string;
  /** betroffene Textstelle (unterstreichen), z. B. «AK77» */
  token?: string;
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
}

/** «AK7», «AK 77 C» – Planquadrat-ähnliche Textstelle */
const PQ_TOKEN = /^[A-Z]{2}\s?\d{1,3}(?:\s?[ABCD])?$/;
/** Zeit mehr als 10 min nach jetzt → «bitte prüfen» */
const FUTURE_MS = 10 * 60000;

const hhmm = (t: string) => t.slice(11, 16);

export function entryState(d: Draft, o: EntryStateOptions): EntryState {
  const stop: EntryReason[] = [];
  const check: EntryReason[] = [];

  // Probleme der Erkennung sperren – ausser Planquadrat ohne Führungsraster (nur prüfen, Ort fehlt dann)
  let pqOhneRaster = false;
  for (const p of d.problems ?? []) {
    if (p.kind === "ort" && !o.hasRaster && p.token && PQ_TOKEN.test(p.token)) {
      pqOhneRaster = true;
      check.push({ code: "kein-raster", text: `Planquadrat ${p.token} unbekannt – noch kein Führungsraster. Ohne Ort eintragen oder Ort auf Karte setzen.`, token: p.token });
      continue;
    }
    if (p.kind === "ort" && o.manualPos) continue; // Ort von Hand gesetzt: Ortsproblem gelöst
    stop.push({ code: "problem", text: p.text, token: p.token });
  }

  if (!d.melder.trim()) check.push({ code: "melder", text: "Wer meldet? fehlt" });

  const hasPlace = o.manualPos || !!d.pos;
  if (!hasPlace && !pqOhneRaster && !stop.some((r) => r.token)) {
    if (d.placeQuery && o.placePending) check.push({ code: "ort-suche", text: `Ort «${d.placeQuery}» wird gesucht …`, token: d.placeQuery });
    else if (d.placeQuery && !o.online) check.push({ code: "ort-offline", text: "Ortsnamen gehen nur mit Netz. Planquadrat angeben oder Ort auf Karte setzen.", token: d.placeQuery });
    else if (d.placeQuery) check.push({ code: "ort", text: `Ort «${d.placeQuery}» nicht gefunden`, token: d.placeQuery });
    else check.push({ code: "ort", text: "Ort fehlt" });
  } else if (!o.manualPos && d.where?.kind === "melder") {
    check.push({ code: "ort-bei-trupp", text: `Ort nur «${d.where.label}» angenommen` });
  }

  const dt = Date.parse(d.t) - o.now.getTime();
  if (dt > FUTURE_MS) check.push({ code: "zukunft", text: `${hhmm(d.t)} liegt in der Zukunft – meinst du gestern?` });

  if (d.kindFrom === "vorgabe") check.push({ code: "einordnung", text: "Feind, Eigene oder Unklar? Nicht erkannt – bitte wählen." });

  if (stop.length) return { level: "geht-nicht", reasons: [...stop, ...check] };
  if (check.length) return { level: "pruefen", reasons: check };
  return { level: "bereit", reasons: [] };
}
