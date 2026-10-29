/**
 * Klartext-Hilfen für Meldungsfeld, Liste und Foto-/Sprach-Übersicht (Spez. MVP 1, Kap. 4.1; Nachbesserung M1):
 * Kürzel erklären («T2» = Übungstag 2 mit Datum), «Fehlt noch: was gesehen» statt «Wer», kein «Einheit (allg.)»,
 * Vorschläge der Erkennung in den Text übernehmen. Reine Funktionen, ohne Browser testbar.
 */
import { artOf, correctionSummary, findByNr, kindLabel, nrLabel, parseLocalIso, readArt, vermerkeOf, type EntryArt, type Exercise, type LageEvent, type LvzIndex, type MeldeFelder } from "@lage/core";

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
export const FORM_ZEICHEN: Record<ZeilenForm, string> = { feind: "◆", eigen: "●", unklar: "■", neutral: "▲", notiz: "✎", vbk: "⇄", aufheb: "⊘" };

/**
 * Zeit mit Tag, wenn sie nicht am Tag `heute` liegt (Prüfung M3): «07:06» bzw. «T1 07:06» (ausserhalb der Übungstage
 * «14.05. 07:06»). Nach dem Schichtwechsel ist so klar, von welchem Tag ein Punkt stammt.
 */
export function zeitKurz(t: string, heute: string | null | undefined, days: string[]): string {
  const hh = t.slice(11, 16);
  if (!heute || t.slice(0, 10) === heute.slice(0, 10)) return hh;
  const i = days.indexOf(t.slice(0, 10));
  return `${i >= 0 ? `T${i + 1}` : `${t.slice(8, 10)}.${t.slice(5, 7)}.`} ${hh}`;
}

/** im Text die Zeit `t` («07:06») durch «T1 07:06» ersetzen, wenn `t` nicht am Tag `heute` liegt (erste Fundstelle) */
export function textMitTag(text: string, t: string, heute: string | null | undefined, days: string[]): string {
  const mit = zeitKurz(t, heute, days);
  const hh = t.slice(11, 16);
  if (mit === hh) return text;
  const re = new RegExp(`(^|[^\\d:T])${hh.replace(":", "\\:")}(?![\\d:])`);
  return text.replace(re, (_m, pre: string) => `${pre}${mit}`);
}

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

/** Anzeigetext ohne vorangestellten Melder («H01 4 Pers …» → «4 Pers …»), der Melder steht separat */
export function displayText(e: Pick<LageEvent, "melder" | "text">): string {
  const m = e.melder;
  if (!m) return e.text;
  const re = new RegExp("^" + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*") + "\\s*(?:meldet\\s*)?[:,]?\\s*", "i");
  const t = e.text.replace(re, "");
  // Originaltext bleibt (keine Grossschreibung: «um 0723 …», «keine Verbindung» wie getippt)
  return t || e.text;
}

/** Vbk-Text, der nur aus dem besteht, was «Verbindung H03 gut» schon sagt */
const VBK_LEER = /^\s*(?:(?:vbk|verbindung(?:skontrolle)?|keine|kein|gut|schlecht|i\s*o|io|ok|laut|und|klar|mit|zu|von)\s*)*$/i;

/**
 * Text einer Nicht-Meldung ohne den Art-Hinweis, den die Art schon ausschreibt («Auftrag an H01: Beo NAI 1» →
 * «Beo NAI 1» neben «✎ Auftrag an H01»). Vbk und Quittung behalten den Text (der Hinweis steht nicht vorne).
 */
export function nichtLageText(e: Pick<LageEvent, "melder" | "text" | "art" | "notiz" | "bezugArt">, blau: string[]): string {
  const t = displayText(e);
  const art = artOf(e);
  // Vbk: «keine Verbindung» neben «⇄ Verbindung H03 keine» wäre doppelt – nur zeigen, was die Art nicht schon sagt
  if (art === "vbk") return VBK_LEER.test(t.replace(/[.:,;!-]/g, " ")) ? "" : t;
  if (art === "meldung" || e.bezugArt === "quittung") return t;
  // Notiz nur mit «Notiz:»/«NB:»/«Bem:» vorne (eine Quittung o. ä. behält den ganzen Text)
  if (art === "notiz" && !/^(notiz|nb|bem)\s*:/i.test(t)) return t;
  const rest = readArt(t, { blau }).rest.trim();
  if (!rest || rest.length >= t.length || !t.endsWith(rest)) return t;
  return rest || t;
}


/** Art in einem Wort für die Rückgängig-Leiste der Korrektur («Feind», «Rückfrage», «Verbindung») */
function artWort(e: LageEvent): string {
  const a = artOf(e);
  if (a === "meldung") return e.hebtAuf ? "Aufhebung" : e.side !== "blau" && e.side !== "ul" && e.aff === "N" ? "Neutral" : kindLabel({ side: e.side, aff: e.aff });
  return a === "vbk" ? "Verbindung" : ART_NAME[a];
}

/**
 * Text der Leiste «Korrigiert: …» wie `correctionSummary` (Kern), aber mit der Art statt «Notiz»: eine Korrektur
 * Feind → Rückfrage heisst «Feind → Rückfrage» (nicht «Feind → Notiz»).
 */
export function korrekturText(before: LageEvent, after: LageEvent): string {
  const s = correctionSummary(before, after);
  const wb = artWort(before), wa = artWort(after);
  if (wb === wa) return s;
  const kb = kindLabel(before), ka = kindLabel(after);
  const teile = s.split(" · ").filter((x) => x !== `${kb} → ${ka}` && x !== `${wb} → ${wa}` && x !== "Text geändert" && x !== "Zeichen geändert");
  return [`${wb} → ${wa}`, ...teile].slice(0, 2).join(" · ");
}

/**
 * Tablet (Finger): «Nochmals Enter» heisst dort wie der Knopf – «Trotzdem eintragen» bzw. in der Korrektur «Korrektur
 * speichern» (MVP 3 Fix 3). Auf dem Laptop bleibt der Text, wie er ist.
 */
export function knopfText(s: string, o: { coarse: boolean; korr?: boolean }): string {
  if (!o.coarse) return s;
  const k = o.korr ? "Korrektur speichern" : "Trotzdem eintragen";
  return s.replace(/Nochmals Enter\./g, `Nochmals «${k}» tippen.`).replace(/Nochmals Enter/g, `«${k}»`);
}
