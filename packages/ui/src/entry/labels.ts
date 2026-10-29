/**
 * Klartext-Hilfen für Meldungsfeld, Liste und Foto-/Sprach-Übersicht (Spez. MVP 1, Kap. 4.1; Nachbesserung M1):
 * Kürzel erklären («T2» = Übungstag 2 mit Datum), «Fehlt noch: was gesehen» statt «Wer», kein «Einheit (allg.)»,
 * Vorschläge der Erkennung in den Text übernehmen. Reine Funktionen, ohne Browser testbar.
 */
import { artOf, findByNr, nrLabel, parseLocalIso, vermerkeOf, type EntryArt, type Exercise, type LageEvent, type LvzIndex, type MeldeFelder } from "@lage/core";

/** «T2 = Übungstag 2 · Mi., 15.05.2030» (Tooltip/Titel zu «T2»); ausserhalb der Übungstage nur das Datum */
export function dayTitle(t: string, days: string[]): string {
  const day = t.slice(0, 10);
  const d = new Date(`${day}T12:00:00`);
  const date = Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  const i = days.indexOf(day);
  return i >= 0 ? `T${i + 1} = Übungstag ${i + 1} · ${date}` : date;
}

/** fehlende Angaben in Worten: «Wer» (aus der Qualitätsprüfung) heisst hier «was gesehen» */
export const missLabel = (m: string): string => (m === "Wer" ? "was gesehen" : m);

/**
 * Text für das Zeichen, wenn nur das allgemeine Zeichen «Einheit» erkannt wurde (Spez. 4.1: «Einheit (allg.)» gibt es
 * nicht mehr): eigene Meldung → «Trupp H04», sonst «Gesehen: ?». `null` = es gibt einen besseren Text.
 */
export function genericWhat(sym: string, side: string, who?: string): string | null {
  if (sym !== "einheit") return null;
  if (side === "blau") return who ? `Trupp ${who}` : "Eigener Trupp";
  return "Gesehen: ?";
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Vorschlag übernehmen: Textstelle `token` durch `by` ersetzen (erste Fundstelle, ganzes Wort). Zeiten passen auch
 * mit Doppelpunkt/Punkt («15:35» ↔ «1535»). Unverändert, wenn die Stelle nicht vorkommt.
 */
export function replaceToken(text: string, token: string, by: string): string {
  const t = token.trim();
  if (!t) return text;
  const time = /^(\d{1,2}):?(\d{2})$/.exec(t);
  const re = time
    ? new RegExp(`(^|[^\\d])${time[1]!.padStart(2, "0").replace(/^0/, "0?")}[:.]?${time[2]}(?!\\d)`)
    : new RegExp(`(^|[\\s(«"'])${esc(t)}(?=$|[\\s,.;:!?)»"'])`, "i");
  if (!re.test(text)) return text;
  return text.replace(re, (_m, pre: string) => `${pre}${by}`);
}

// ---------- MVP 3: Arten, Vermerke, Formulare (Spez. MVP 3, Kap. 2.1, 2.2, 4) ----------


/** Form und Wort je Art in der Liste (Regel «jede Farbe hat eine Form»): Meldungen wie MVP 1, sonst ✎ bzw. ⇄ in Tinte */
export type ZeilenForm = "feind" | "eigen" | "unklar" | "neutral" | "notiz" | "vbk" | "aufheb";
export function formOf(e: Pick<LageEvent, "side" | "aff" | "notiz" | "art" | "hebtAuf">): ZeilenForm {
  const art = artOf(e);
  if (art === "vbk") return "vbk";
  if (art !== "meldung") return "notiz";
  if (e.hebtAuf) return "aufheb";
  return e.side === "blau" ? "eigen" : e.aff === "N" ? "neutral" : e.aff === "U" ? "unklar" : "feind";
}
export const FORM_ZEICHEN: Record<ZeilenForm, string> = { feind: "◆", eigen: "●", unklar: "■", neutral: "▲", notiz: "✎", vbk: "⇄", aufheb: "✕" };

/** «07:40» aus ISO lokal bzw. ISO UTC (mit «Z») */
export function hm(t: string | undefined): string {
  if (!t) return "";
  if (/Z$|[+-]\d{2}:\d{2}$/.test(t)) { const d = new Date(t); return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
  return t.slice(11, 16);
}

/** Eingang mindestens 5 min nach der Ereigniszeit → «Eingang 07:40» (Liste), sonst null */
export function eingangText(e: Pick<LageEvent, "t" | "tReported">): string | null {
  if (!e.tReported) return null;
  const d = parseLocalIso(e.tReported).getTime() - parseLocalIso(e.t).getTime();
  return d >= 5 * 60000 ? `Eingang ${e.tReported.slice(11, 16)}` : null;
}

/**
 * Zeile 2 der Liste: Vermerke und Bezüge in Klartext (Kap. 4 «Zeile»): «bis 12:00», «offen», «dringend»,
 * «Massnahme: …», «weitergemeldet Bat 07:15», «erledigt 07:40», «quittiert 07:31», «beantwortet 07:35 (Nr 60)»,
 * «aufgehoben 07:40 (Nr 58)», «hebt Nr 31 auf», «Antwort auf Nr 57».
 */
export function vermerkTeile(e: LageEvent, ex: Pick<Exercise, "events">, idx: LvzIndex): Array<{ k: string; t: string; stark?: boolean }> {
  const v = vermerkeOf(e, idx);
  const art = artOf(e);
  const out: Array<{ k: string; t: string; stark?: boolean }> = [];
  const nrVon = (id: string) => { const x = (ex.events ?? []).find((y) => y.id === id); return x ? nrLabel(x, ex) : ""; };
  if (art === "auftrag" && e.frist) out.push({ k: "frist", t: `bis ${e.frist.slice(11, 16)}` });
  if (v.dringend) out.push({ k: "dringend", t: "dringend", stark: true });
  if (v.massnahme) out.push({ k: "massnahme", t: `Massnahme: ${v.massnahme}` });
  if (v.weiter) out.push({ k: "weiter", t: `weitergemeldet ${v.weiter.an}${v.weiter.um ? ` ${v.weiter.um.slice(11, 16)}` : ""}` });
  if (v.quittiert) out.push({ k: "quittiert", t: `quittiert ${hm(v.quittiert.t)}` });
  if (v.beantwortet) { const n = nrVon(v.beantwortet.id); out.push({ k: "beantwortet", t: `beantwortet ${hm(v.beantwortet.t)}${n ? ` (Nr ${n})` : ""}` }); }
  if (v.status === "erledigt") out.push({ k: "status", t: v.erledigtUm ? `erledigt ${hm(v.erledigtUm)}` : "erledigt" });
  else if (v.status === "offen" && (art === "auftrag" || art === "rueckfrage" || e.lvz?.status)) out.push({ k: "status", t: "offen" });
  if (v.aufgehoben) { const n = nrVon(v.aufgehoben.id); out.push({ k: "aufgehoben", t: `aufgehoben ${hm(v.aufgehoben.t)}${n ? ` (Nr ${n})` : ""}` }); }
  if (e.hebtAuf) { const n = nrVon(e.hebtAuf); out.push({ k: "hebtauf", t: n ? `hebt Nr ${n} auf` : "hebt auf" }); }
  if (e.bezug && !e.hebtAuf) {
    const n = nrVon(e.bezug);
    const w = e.bezugArt === "antwort" ? "Antwort auf" : e.bezugArt === "quittung" ? "Quittung zu" : e.bezugArt === "ausgefuehrt" ? "ausgeführt zu" : "zu";
    if (n) out.push({ k: "bezug", t: `${w} Nr ${n}` });
  }
  return out;
}

/** «A 10:20» – Zeit «1020» lesbar */
const zeitLesbar = (s: string) => s.replace(/^(\d{2})(\d{2})$/, "$1:$2");

/**
 * Zeile «gelesen als AEIOU: A 10:20 · E 3 Pers bewaffnet · I Rtg W · O AF8 C · U nicht ausgewertet» bzw.
 * «gelesen als Meldezettel: Wann 07:20 · Melder H03 · Was … · Wo AF8» (Kap. 2.2, 4).
 */
export function felderText(f: MeldeFelder): string {
  if (f.schema === "aeiou") {
    const teile = [
      f.wann ? `A ${zeitLesbar(f.wann)}` : "", f.was || f.wer ? `E ${[f.wer, f.was].filter(Boolean).join(" ")}` : "",
      f.wie ? `I ${f.wie}` : "", f.wo ? `O ${f.wo}` : "", f.umwelt !== undefined ? "U nicht ausgewertet" : "",
    ].filter(Boolean);
    return `gelesen als AEIOU: ${teile.join(" · ")}${f.melder ? ` · Melder ${f.melder}` : ""}`;
  }
  const teile = [
    f.wann ? `Wann ${zeitLesbar(f.wann)}` : "", f.melder ? `Melder ${f.melder}` : "", f.wer ? `Wer ${f.wer}` : "", f.was ? `Was ${f.was}` : "",
    f.wie ? `Wie ${f.wie}` : "", f.wo ? `Wo ${f.wo}` : "", f.umwelt !== undefined ? "Bem nicht ausgewertet" : "",
  ].filter(Boolean);
  return `gelesen als Meldezettel: ${teile.join(" · ")}`;
}

/** Name der Art im vierten Segment und im Menü «Andere» */
export const ART_NAME: Record<Exclude<EntryArt, "meldung">, string> = {
  auftrag: "Auftrag", orientierung: "Orientierung", rueckfrage: "Rückfrage", vbk: "Verbindungskontrolle", notiz: "Notiz",
};

/** Bezug «zu 42» → Meldung (für «Antwort auf Nr 57» in der Vorschau) */
export function bezugLabel(ex: Pick<Exercise, "events">, id: string | undefined, nr: string | undefined): string | null {
  if (id) { const e = (ex.events ?? []).find((x) => x.id === id); if (e) return nrLabel(e, ex); }
  if (nr) { const e = findByNr(ex, nr); if (e) return nrLabel(e, ex); }
  return null;
}
