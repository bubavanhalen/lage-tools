/**
 * Zustand des Meldungsfelds (Spez. MVP 1, Kap. 3.2): «bereit» (grün), «bitte prüfen» (gelb, Enter fragt einmal),
 * «geht nicht» (rot, Enter trägt nicht ein). Reine Funktion über dem Entwurf (`parseMeldung`) und dem Umfeld.
 *
 * - «geht nicht» = `draft.problems` (MVP 0: unbekanntes Planquadrat/NAI, ungültige Zeit, Trupp wie «H13», zwei Orte).
 *   Ausnahme: Planquadrat ohne Führungsraster ist nur «bitte prüfen» (Ort fehlt dann). «Ort auf Karte setzen» löst
 *   Ortsprobleme, nie Zeit-/Trupp-Probleme.
 *   Dazu (MVP 1 Nachbesserung): Zeit > 10 min in der Zukunft **ohne** ausdrückliche Tagesangabe (Code `zukunft`,
 *   «15:35 liegt in der Zukunft – meintest du 07:35?»). Gilt nur, wenn der Tag der Meldung höchstens einen Tag von der
 *   Geräteuhr entfernt ist (Übung läuft jetzt); eine Übung in der Zukunft (Beispiel 2030) bleibt bedienbar.
 * - «bitte prüfen» = Trupp fehlt, Trupp unbekannt bei vorbereiteten Trupps (`trupp-neu`), Ort fehlt/nur angenommen/
 *   wird gesucht/offline, Zeit > 10 min in der Zukunft mit Tagesangabe («T3 0715»), Rückfrage/Auftrag/Frage (`notiz`,
 *   «Als Notiz ohne Zeichen?»), unbekanntes Wort statt einer Art (`was`, «Was gesehen? «schützenpnzr» nicht erkannt»).
 * Texte nach Kap. 2.4 und 4.6; `hint` = was tun, `ask` = Frage beim ersten Enter («Nochmals Enter»).
 *
 * Signatur und Codes sind Vertrag (packages/ui/src/shell/contracts.ts); Felder `hint`, `ask`, `problem` und die
 * Optionen `hasPos`, `sheets`, `areas` sind Ergänzungen von Paket B.
 */
import type { Draft, DraftProblem } from "./journal";
import { sameUnitName } from "./erkennung";
import { ART_LABEL } from "./arten";
import { zeitMs } from "./clock";
import { catalogEntry } from "./catalog";
import type { Area } from "./model";
import type { RasterSheet } from "./raster";

export type EntryLevel = "bereit" | "pruefen" | "geht-nicht";
export type EntryReasonCode = "melder" | "ort" | "ort-bei-trupp" | "zukunft" | "einordnung" | "ort-suche" | "ort-offline" | "kein-raster" | "problem" | "trupp-neu" | "notiz" | "was"
  /**
   * MVP 3 (Spez. MVP 3, Kap. 3.1; Paket A setzt um): `art-schwach` schwacher Art-Hinweis («Als Rückfrage ohne Zeichen?»,
   * ersetzt `notiz`, das als Alias bleibt) · `an` Empfänger fehlt · `bezug` unbekannte Nummer · `aufheben` kein/mehrere
   * Ziele · `tag-fremd` heute ist kein Tag der Übung (E17). Alle gelb.
   */
  | "art-schwach" | "an" | "bezug" | "aufheben" | "tag-fremd"
  /**
   * MVP 3 Fix 3 (gelb): `unscharf` Art/Aufheben nur aus einem unscharfen Wort («Auftrag gemeint? «Auftarg»») · `sichtung`
   * Antwort mit Sichtung und Ort («Sichtung in der Antwort – als Meldung eintragen?»).
   */
  | "unscharf" | "sichtung"
  /**
   * MVP 3.5 (Spez. MVP 3.5, Kap. 3.3, 4; Paket C setzt um, Texte Kap. 4): gelb `kein-zeichen` (Verneinung/Abgang,
   * 2. Enter = Notiz) · `seite` («H01 selbst nach AC5?») · `zwei-orte` (Knopf «Als zwei Einträge») · `ort-online-aus`
   * (Ortsnamen sind aus) · `bezug-wahl`/`auftrag-wahl` (Knöpfe aus `choices`, Paket D liefert die Kandidaten); rot
   * `zeit-fehlt` (Uhr vorgestellt, Vorschlag in `suggest`). `was` wird auch ohne Anzahl gesetzt, `trupp-neu`
   * unabhängig von `unitsPrepared`.
   */
  | "kein-zeichen" | "seite" | "zwei-orte" | "ort-online-aus" | "bezug-wahl" | "auftrag-wahl" | "zeit-fehlt";

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
  /**
   * Vorschlag zum Übernehmen: `zukunft` → Zeit «0735» (hhmm), `was` → Katalogschlüssel (z. B. «spz»), `trupp-neu` →
   * Name des neuen Trupps («H07», für den Knopf «neu anlegen»)
   */
  suggest?: string;
  /** (MVP 3.5) Wahl-Knöpfe für `bezug-wahl`/`auftrag-wahl`: ID (bzw. «keiner») und Beschriftung «64a 07:37 H02 3 Fz AK9» */
  choices?: Array<{ id: string; label: string }>;
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
  /** bekannte eigene Trupps (z. B. `ex.units.blau`) – für `trupp-neu` */
  knownUnits?: string[];
  /**
   * Trupps sind vorbereitet (Übung hat ihre Trupps vor der ersten Meldung angelegt): ein Melder, der nicht in
   * `knownUnits` steht, ist gelb «H07 ist kein Trupp dieser Übung – neu anlegen?». Ohne (false/fehlt) wird weiter gelernt.
   */
  unitsPrepared?: boolean;
  /** Übungstage (ISO-Datum) – für den Tipp «T1 1535» bei einer Zeit in der Zukunft */
  days?: string[];
  /** (MVP 3) Tag folgt der Uhr (`clockDay(...).follow`) – sonst ohne Tagesangabe `tag-fremd` (E17) */
  follow?: boolean;
  /** (MVP 3) Zeit der letzten Meldung (ISO lokal) – Vorschlag «Als T2 07:26 eintragen» (letzte + 1 min) */
  lastReport?: string | null;
  /** (MVP 3.5, A1.5) Ortsnamen: an, aus (Online-Dienst der Übung aus → `ort-online-aus`), an aber kein Netz */
  ortsnamen?: "an" | "aus" | "kein-netz";
  /** (MVP 3.5) IANA-Zone für Zeitvergleiche (fehlt → Gerät) */
  zone?: string;
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

const pad2 = (n: number) => String(n).padStart(2, "0");
const hhmmOf = (min: number) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
const localDayOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00`) - Date.parse(`${b}T12:00`)) / 86400000);

/**
 * Wahrscheinlich gemeinte Zeit zu einer Zeit in der Zukunft («1535» um 07:30 → 07:35): gleiche Minuten in der Stunde
 * der Uhr bzw. eine Stunde davor, sonst 12 h früher («2015» um 08:30 → 08:15) – nur, wenn sie nicht selbst in der
 * Zukunft liegt (höchstens 10 min) und höchstens 12 h zurück. Sonst nichts.
 */
export function futureGuess(minutes: number, now: Date): number | undefined {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const mm = minutes % 60;
  const h = Math.floor(minutes / 60);
  const cands = [Math.floor(nowMin / 60) * 60 + mm, (Math.floor(nowMin / 60) - 1) * 60 + mm, h >= 12 ? minutes - 720 : -1];
  const ok = (c: number) => c >= 0 && c !== minutes && c - nowMin <= 10 && nowMin - c <= 720;
  return cands.find(ok);
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

  // (MVP 3) Nicht-Meldung (Auftrag, Orientierung, Rückfrage, Vbk, Notiz): kein Zeichen, keine Verschiebung – Ort nie nötig
  const art = d.art ?? (d.kindHint === "notiz" ? "notiz" : "meldung");
  const note = art !== "meldung" || d.kindHint === "notiz";
  const lift = !!d.hebtAuf;
  // unsicheres Wort: immer zuerst und immer gelb (nie grün ein Zeichen, nie eine Trupp-Verschiebung)
  if (d.unscharf) check.push(unscharfReason(d, note, lift));
  if (note && d.notizGrund) check.push(notizGrundReason(d));
  else if (note && !d.unscharf && art === "auftrag" && d.an && d.artStark === false) {
    // (MVP 3.5, Kap. 4) schwacher Auftrag von oben («Kdt: H05 sofort Stellungswechsel nach AR12»): der Trupp bleibt
    check.push({ code: "art-schwach", text: `Auftrag an ${d.an}?`, hint: "Ist es eine Lage: Feind, Eigene oder Unklar wählen.", ask: `Nochmals Enter trägt als Auftrag ein (${d.an} bleibt, wo er ist).` });
  } else if (note && !d.unscharf && (d.kindHint === "notiz" || d.artStark === false)) {
    // schwacher Hinweis («… ?», «befohlen»): einmal fragen (Code `art-schwach`; MVP 1 hiess er `notiz`)
    const w = ART_LABEL[art === "meldung" ? "notiz" : art];
    check.push({ code: "art-schwach", text: `Als ${w} ohne Zeichen?`, hint: `Nochmals Enter trägt als ${w} ein. Ist es eine Lage: Feind, Eigene oder Unklar wählen.`, ask: `Als ${w} ohne Zeichen eintragen? Nochmals Enter.` });
  }
  if (note) {
    if (art === "auftrag" && !d.an) check.push({ code: "an", text: "An wen? Trupp nennen, z. B. «Auftrag an H01».", hint: "Trupp im Text nennen oder so eintragen.", ask: "Ohne Empfänger eintragen? Nochmals Enter." });
    if (art === "vbk" && !d.melder.trim()) check.push({ code: "melder", text: "Mit welchem Trupp? Trupp oben antippen.", hint: "Trupp oben antippen oder an den Anfang schreiben.", ask: "Ohne Trupp eintragen? Nochmals Enter." });
  } else if (!d.melder.trim() && !d.truppNeu && !(d.bezug && d.bezugArt === "antwort")) {
    check.push({ code: "melder", text: "Wer meldet? fehlt", hint: "Trupp oben antippen oder an den Anfang schreiben.", ask: "Ohne Trupp eintragen? Nochmals Enter." });
  }
  if (note && d.sichtung) {
    check.push({ code: "sichtung", text: "Sichtung in der Antwort – als Meldung eintragen?", hint: "Ja: bei «Was ist es?» Feind, Eigene oder Unklar wählen. Nochmals Enter trägt die Antwort ohne Zeichen ein.", ask: "Als Antwort ohne Zeichen eintragen? Nochmals Enter." });
  }
  // (MVP 3.5, D2 – Paket D) mehrere mögliche Bezüge: gelb mit je einem Knopf («64a …», «Nr 66 …», «keiner»)
  if (d.wahl && d.bezugKandidaten?.length) {
    const auftrag = d.wahl.grund === "auftrag-wahl";
    check.push({
      code: d.wahl.grund, text: d.wahl.text, choices: d.wahl.choices,
      hint: auftrag ? "Den erledigten Auftrag antippen – oder «keiner»." : "Die gemeinte Nummer antippen.",
      ask: auftrag ? "Ohne Abschluss eintragen? Nochmals Enter." : "Ohne Bezug eintragen? Nochmals Enter.",
    });
  }
  if (d.bezugFehlt && d.bezugNr) {
    check.push({ code: "bezug", token: d.bezugNr, text: `Nr ${d.bezugNr} gibt es nicht – ohne Bezug eintragen?`, hint: "Nummer prüfen (steht unter der Zeit in der Liste).", ask: "Ohne Bezug eintragen? Nochmals Enter." });
  }
  // Aufheben zeichnet nie neu (Entscheid): mehrere Ziele → rot, bis eines gewählt ist; keines bei gewählter Einordnung → rot
  if (!note && !lift && d.hebtAufKandidaten) stop.push(aufhebReason(d));
  // (MVP 3.5, C12) unbekannter Trupp – immer gelb, auch ohne vorbereitete Trupps (`Draft.truppNeu`, Melder leer); das zweite
  // Enter trägt ohne Trupp ein, nur der Knopf legt ihn an (nicht bei «H13» – das sperrt schon als Problem)
  const m = d.truppNeu ?? (o.unitsPrepared && o.knownUnits ? d.melder.trim() : "");
  if (m && (d.truppNeu || !o.knownUnits!.some((u) => sameUnitName(u, m))) && !(d.problems ?? []).some((p) => p.kind === "melder")) {
    check.push({ code: "trupp-neu", token: m, suggest: m, text: `${m} ist kein Trupp dieser Übung.`, hint: `Trupp im Text korrigieren oder «${m} als Trupp aufnehmen».`, ask: "Nochmals Enter trägt ohne Trupp ein." });
  }
  if (d.unknownWord && !note && !lift) {
    // (MVP 3.5, C1) Vorschlag = Ersatzwort («Personen»), Knopf «‹Wort› übernehmen» (E)
    const u = d.unknownWord;
    const wort = u.suggestLabel;
    check.push({
      code: "was", token: u.token, ...(wort ? { suggest: wort } : {}),
      text: wort ? `Was gesehen? «${u.token}» – meinst du «${wort}»?` : `Was gesehen? «${u.token}» nicht erkannt`,
      hint: wort ? `Wort korrigieren (z. B. «${wort}») oder so eintragen (Art unklar).` : "Wort korrigieren oder so eintragen (Art unklar).",
      ask: `Nochmals Enter trägt «${u.count !== undefined ? `${u.count} ` : ""}?» als Unklar ein.`,
    });
  }
  // (MVP 3.5, C5) eigener Trupp ohne Standortverb an einen Ort: «H01 selbst nach AC5?»
  if (d.seiteFrage && !note && !lift) {
    const { trupp, ort } = d.seiteFrage;
    check.push({ code: "seite", token: ort, text: `${trupp} selbst nach ${ort}?`, hint: "Ist es der Feind: Feind wählen.", ask: `Nochmals Enter: ${trupp} nach ${ort}. Ist es der Feind: Feind wählen.` });
  }
  // (MVP 3.5, C6) zwei Orte: Bewegung des Trupps und Sichtung – Knopf «Als zwei Einträge» (E, `Draft.teile`)
  if (d.zweiOrte && !note && !lift) {
    const z = d.zweiOrte;
    check.push({
      code: "zwei-orte", text: `Zwei Orte – ${z.seite} in ${z.sicht}, ${z.trupp} nach ${z.ziel}?`, hint: "«Als zwei Einträge» trägt beide ein.",
      ask: `Nochmals Enter: nur ${z.seite === "Feind" ? "den Feind" : "die Sichtung"} in ${z.sicht} eintragen (${z.trupp} bleibt${z.bleibt ? ` in ${z.bleibt}` : ", wo er ist"}).`,
    });
  }

  const hasPlace = o.manualPos || !!o.hasPos || !!d.pos;
  const ortAsk = "Ohne Ort eintragen? Nochmals Enter.";
  if (note || lift || d.ohneZeichen) {
    // Nicht-Meldung bzw. Aufhebung: ohne Ort; (MVP 3.5, C7/C11) eigene Verwundete, Begehren: Trupp bleibt, Ort nicht nötig
  } else if (!hasPlace && !pqOhneRaster && !stop.some((r) => r.problem === "ort" || r.problem === "orte")) {
    if (d.placeQuery && !o.placePending && o.ortsnamen === "aus") {
      // (MVP 3.5, K2) Online-Dienst «Ortsnamen» dieser Übung ist aus: nichts geht ans Netz
      check.push({ code: "ort-online-aus", text: `Ort «${d.placeQuery}» – Ortsnamen sind aus (nichts geht ans Netz).`, token: d.placeQuery, hint: "Planquadrat dazuschreiben oder Ort auf Karte setzen.", ask: "Nochmals Enter: ohne Ort eintragen." });
    } else if (d.ortUnbekannt && !d.placeQuery) {
      // (MVP 3.5, C13) genannter Ort ohne Treffer: kein Ersatzort
      check.push({ code: "ort", text: `Ort «${d.ortUnbekannt}» unbekannt`, token: d.ortUnbekannt, hint: "Planquadrat oder NAI dazuschreiben oder Ort auf Karte setzen.", ask: ortAsk });
    } else if (d.placeQuery && o.placePending) {
      check.push({ code: "ort-suche", text: `Ort «${d.placeQuery}» wird gesucht …`, token: d.placeQuery, hint: "Kurz warten, Planquadrat angeben oder Ort auf Karte setzen.", ask: ortAsk });
    } else if (d.placeQuery && !o.online) {
      check.push({ code: "ort-offline", text: "Ortsnamen gehen nur mit Netz.", token: d.placeQuery, hint: "Planquadrat angeben oder Ort auf Karte setzen.", ask: ortAsk });
    } else if (d.placeQuery) {
      check.push({ code: "ort", text: `Ort «${d.placeQuery}» nicht gefunden`, token: d.placeQuery, hint: "Planquadrat oder NAI angeben oder Ort auf Karte setzen.", ask: ortAsk });
    } else {
      check.push({ code: "ort", text: "Ort fehlt", hint: "Planquadrat oder NAI dazuschreiben oder Ort auf Karte setzen.", ask: ortAsk });
    }
  } else if (!o.manualPos && !o.hasPos && d.where?.kind === "melder" && !d.amTrupp) {
    check.push({ code: "ort-bei-trupp", text: `Ort nur «${d.where.label}» angenommen`, hint: "Genauen Ort nennen oder Ort auf Karte setzen.", ask: "So eintragen? Nochmals Enter." });
  }

  // Zeit in der Zukunft: ohne Tagesangabe «geht nicht» (verschöbe sonst LIVE und das ganze Lagebild), mit Tag nur prüfen.
  // Nur wenn die Meldung zur laufenden Übung gehört (Tag höchstens 1 Tag von der Uhr) – nicht in einer Übung in der Zukunft.
  // (MVP 3.5, S23) Zeitpunkt mit Offset (doppelte Stunde richtig)
  if (d.zeitFehlt) {
    const z = d.zeitFehlt;
    stop.push({ code: "zeit-fehlt", ...(d.timeToken ? { token: d.timeToken } : {}), suggest: z.vorschlag, text: `${z.zeit} gibt es heute nicht (Uhr um ${z.von} auf ${z.bis} vorgestellt).`, hint: `Zeit korrigieren, z. B. ${z.vorschlag}.` });
  }
  const dt = d.zeitFehlt ? 0 : zeitMs({ t: d.t, tOffset: d.tOffset }, o.zone) - o.now.getTime();
  if (dt > FUTURE_MS && Math.abs(dayDiff(d.day, localDayOf(o.now))) <= 1) {
    const g = d.dayFromText ? undefined : futureGuess(d.minutes, o.now);
    const ti = o.days?.indexOf(d.day) ?? -1;
    const tag = ti > 0 ? `T${ti} ${hhmm(d.t).replace(":", "")}` : `T1 ${hhmm(d.t).replace(":", "")}`;
    if (d.dayFromText) {
      check.push({ code: "zukunft", text: `${hhmm(d.t)} liegt in der Zukunft.`, hint: "Zeit und Tag prüfen.", ask: "Trotzdem so eintragen? Nochmals Enter." });
    } else {
      stop.push({
        code: "zukunft", ...(d.timeToken ? { token: d.timeToken } : {}), ...(g !== undefined ? { suggest: hhmmOf(g).replace(":", "") } : {}),
        text: `${hhmm(d.t)} liegt in der Zukunft${g !== undefined ? ` – meintest du ${hhmmOf(g)}?` : "."}`,
        hint: `Zeit korrigieren${g !== undefined ? ` (z. B. ${hhmmOf(g).replace(":", "")})` : ""}. War es gestern: Tag dazuschreiben, z. B. «${tag}».`,
      });
    }
  }

  // (MVP 3, E17) Tag folgt nicht der Uhr und heute ist kein Tag der Übung: nie still auf einen erfundenen Zeitpunkt
  if (o.follow === false && o.days?.length && !d.dayFromText && !o.days.includes(localDayOf(o.now))) check.push(tagFremd(d, o));

  if (stop.length) return { level: "geht-nicht", reasons: [...stop, ...check] };
  if (check.length) return { level: "pruefen", reasons: check };
  return { level: "bereit", reasons: [] };
}

const dm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.`;

/** «Heute (29.10.) ist kein Tag dieser Übung (T1 14.05.–T2 15.05.2030).» mit Vorschlag letzte Meldung + 1 min */
function tagFremd(d: Draft, o: EntryStateOptions): EntryReason {
  const days = o.days!;
  const first = days[0]!, last = days[days.length - 1]!;
  const range = days.length === 1 ? `T1 ${dm(first)}${first.slice(0, 4)}` : `T1 ${dm(first)}–T${days.length} ${dm(last)}${last.slice(0, 4)}`;
  let suggest: string | undefined;
  if (o.lastReport) {
    const ms = Date.parse(o.lastReport) + 60000;
    const x = new Date(ms);
    const day = localDayOf(x);
    const i = days.indexOf(day);
    if (i >= 0) suggest = `T${i + 1} ${pad2(x.getHours())}${pad2(x.getMinutes())}`;
  }
  const ti = days.indexOf(d.day);
  const jetzt = `${ti >= 0 ? `T${ti + 1}` : dm(d.day)} ${hhmm(d.t)}`;
  return {
    code: "tag-fremd", text: `Heute (${dm(localDayOf(o.now))}) ist kein Tag dieser Übung (${range}).`,
    hint: `Tag und Zeit dazuschreiben, z. B. «${suggest ?? `T${days.length} 0700`}».`, ask: `Trotzdem auf ${jetzt} eintragen? Nochmals Enter.`,
    ...(suggest ? { suggest } : {}),
  };
}

/**
 * Aufheben mit mehreren Zielen: «Zwei Sperren in AG13 – welche?» (rot, bis gewählt). Ohne Ziel bei gewählter
 * Einordnung: «Keine aktive Sperre in AA1 – Aufheben zeichnet nie.» (rot). Aufheben erzeugt nie ein neues Zeichen.
 */
function aufhebReason(d: Draft): EntryReason {
  const c = catalogEntry(d.sym);
  const wort = c?.noun ?? c?.name.replace(/\s*\(.*?\)\s*/g, " ").split(" / ")[0]!.trim() ?? "Sperre";
  const ort = d.where?.label ?? d.cells?.[0] ?? d.nai ?? "";
  const bei = ort ? ` in ${ort}` : "";
  const n = d.hebtAufKandidaten?.length ?? 0;
  if (!n) {
    const kein = c?.g === "m" ? "Kein aktiver" : c?.g === "n" ? "Kein aktives" : "Keine aktive";
    return { code: "aufheben", text: `${kein} ${wort}${bei} – Aufheben zeichnet nie ein neues Zeichen.`, hint: "Ort prüfen, «Notiz» wählen oder das Wort «aufgehoben» aus dem Text nehmen." };
  }
  return { code: "aufheben", text: `${n === 2 ? "Zwei" : n} ${c?.pl ?? wort}${bei} – welche aufheben?`, hint: "Die gemeinte Meldung unten wählen." };
}

/**
 * Unscharfes Wort (MVP 3 Fix 3): «Auftrag gemeint? «Auftarg»», «Aufheben gemeint? «aufgehobn»» – was Enter dann tut,
 * steht im Hinweis (Auftrag/Antwort/Orientierung ohne Zeichen; Aufheben ohne neues Zeichen; sonst Meldung mit Zeichen).
 */
function unscharfReason(d: Draft, note: boolean, lift: boolean): EntryReason {
  const u = d.unscharf!;
  const base = { code: "unscharf" as const, token: u.token, text: `${u.wort} gemeint? «${u.token}»` };
  const sonst = "Sonst Wort korrigieren oder bei «Was ist es?» die Art wählen.";
  if (note && d.art !== "notiz") {
    const bleibt = d.art === "auftrag" && d.an ? `, ${d.an} bleibt, wo er ist` : "";
    return { ...base, hint: `Nochmals Enter trägt als ${ART_LABEL[d.art]} ein (kein Zeichen${bleibt}). ${sonst}`, ask: `Als ${ART_LABEL[d.art]} ohne Zeichen eintragen? Nochmals Enter.` };
  }
  if (note && d.bezugArt === "antwort") return { ...base, hint: `Nochmals Enter trägt als Antwort ein (kein Zeichen). ${sonst}`, ask: "Als Antwort ohne Zeichen eintragen? Nochmals Enter." };
  if (note) return { ...base, hint: "Nochmals Enter trägt als Notiz ein (kein Zeichen). Sonst Wort korrigieren.", ask: "Als Notiz ohne Zeichen eintragen? Nochmals Enter." };
  if (lift) return { ...base, hint: "Nochmals Enter hebt das Zeichen auf (kein neues Zeichen). Sonst Wort korrigieren.", ask: "Zeichen aufheben? Nochmals Enter." };
  return { ...base, hint: `Nochmals Enter trägt die Meldung mit Zeichen ein. Ist «${u.token}» gemeint als «${u.wort.toLowerCase()}»: Wort korrigieren.`, ask: "Mit Zeichen eintragen? Nochmals Enter." };
}

/** Meldung wurde Notiz (gelb): «Kein Ziel gefunden – als Notiz eintragen?» bzw. «Kein Zeichen? – als Notiz eintragen?» */
function notizGrundReason(d: Draft): EntryReason {
  const ask = "Als Notiz ohne Zeichen eintragen? Nochmals Enter.";
  if (d.notizGrund === "kein-ziel") {
    return { code: "aufheben", text: "Kein Ziel gefunden – als Notiz eintragen?", hint: "Ort prüfen oder an der gemeinten Zeile «Mehr …» → «Aufgehoben (jetzt)». Nochmals Enter trägt als Notiz ein.", ask };
  }
  if (d.notizGrund === "kein-zeichen") {
    // (MVP 3.5, C3) Verneinung/Abgang: «Kein neues Zeichen? «Feind hat AD7 verlassen».»
    const m = d.melder.trim();
    let satz = d.text.trim();
    if (m) satz = satz.replace(new RegExp(`^${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:,]?\\s*`, "i"), "");
    satz = satz.replace(/\s+(?:rtg|richtung)\.?\s+\S+\s*$/i, "").replace(/[.!\s]+$/, "");
    if (satz.length > 48) satz = `${satz.slice(0, 46).trimEnd()} …`;
    return { code: "kein-zeichen", text: `Kein neues Zeichen? «${satz}».`, hint: "Ist es eine Sichtung: Feind oder Unklar wählen.", ask: "Nochmals Enter trägt als Notiz ein. Ist es eine Sichtung: Feind oder Unklar wählen." };
  }
  return { code: "aufheben", text: "Kein Zeichen? – als Notiz eintragen?", hint: "Nochmals Enter trägt als Notiz ein. Ist es eine Lage: Feind, Eigene oder Unklar wählen.", ask };
}
