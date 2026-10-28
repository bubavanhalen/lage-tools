/**
 * Funk- und Sprechsprache → Kurzmeldung (offline, ohne Abhängigkeiten).
 * Beispiel: «Hotel null vier, zwo Fahrzeuge, Alpha Golf eins drei, Richtung Nord»
 *         → «H04 2 Fz AG13 Rtg N»
 * Danach übernimmt `parseMeldung` wie bei getippten Meldungen.
 *
 * Dazu `splitMeldungen` (mehrere Meldungen aus Foto/Memo trennen) und `cleanOcr` (typische Fehler der Texterkennung).
 * Alle Beispiele fiktiv (Raum Bern).
 */

export interface SpokenResult {
  /** normalisierte Kurzmeldung(en), wie getippt; mehrere Meldungen je Zeile («Ende» trennt) */
  text: string;
  /** erkannte Ersetzungen zur Anzeige (z. B. «Hotel null vier» → «H04»); `to: ""` = entfernt */
  changes: Array<{ from: string; to: string }>;
}

// ---------------------------------------------------------------------------------------------------------------
// Wörterbücher

/** Buchstabieralphabet (NATO) inkl. typischer Schreibweisen der Spracherkennung */
const PHONETIC: Record<string, string> = {
  alpha: "A", alfa: "A", bravo: "B", charlie: "C", charly: "C", charli: "C", delta: "D", echo: "E", foxtrot: "F", foxtrott: "F",
  golf: "G", hotel: "H", india: "I", juliett: "J", juliet: "J", julia: "J", kilo: "K", lima: "L", mike: "M", maik: "M",
  november: "N", oscar: "O", oskar: "O", papa: "P", quebec: "Q", kebec: "Q", romeo: "R", sierra: "S", tango: "T",
  uniform: "U", victor: "V", viktor: "V", whiskey: "W", whisky: "W", "x-ray": "X", xray: "X", "x-rays": "X", yankee: "Y",
  yanky: "Y", zulu: "Z",
};

/** Ziffern und kleine Zahlen (Hochdeutsch und Schweizerdeutsch, wie sie die Spracherkennung schreibt) */
const SMALL: Record<string, number> = {
  null: 0, nul: 0, nuu: 0, nill: 0,
  eins: 1, eis: 1, ein: 1,
  zwei: 2, zwo: 2, zwöi: 2, zwoi: 2, zwee: 2, zwä: 2,
  drei: 3, drü: 3, drüü: 3,
  vier: 4, vieri: 4, vierä: 4,
  fünf: 5, fünef: 5, foif: 5, füf: 5, füüf: 5, föif: 5,
  sechs: 6, sächs: 6, sechsi: 6, sächsi: 6,
  sieben: 7, sibe: 7, sibä: 7, siebe: 7, sibni: 7,
  acht: 8, achti: 8, achtä: 8,
  neun: 9, nüün: 9, nün: 9, nüüni: 9, nüni: 9,
  zehn: 10, zäh: 10, zähni: 10, zehni: 10,
  elf: 11, elfi: 11, öuf: 11, zwölf: 12, zwöuf: 12, zwölfi: 12,
  dreizehn: 13, drizäh: 13, drizehn: 13, vierzehn: 14, vierzäh: 14, fünfzehn: 15, füfzäh: 15, foifzäh: 15, fünfzäh: 15,
  sechzehn: 16, sächzäh: 16, sechzäh: 16, siebzehn: 17, sibezäh: 17, siebzäh: 17, achtzehn: 18, achtzäh: 18,
  neunzehn: 19, nünzäh: 19, nüünzäh: 19, neunzäh: 19,
};
const TENS: Record<string, number> = {
  zwanzig: 20, zwänzg: 20, zwanzg: 20, zwänzig: 20, dreissig: 30, dreißig: 30, drissg: 30, driissg: 30, drissig: 30,
  vierzig: 40, vierzg: 40, fünfzig: 50, füfzg: 50, foifzg: 50, fufzg: 50, fünfzg: 50, sechzig: 60, sächzg: 60, sechzg: 60,
  siebzig: 70, sibezg: 70, siebzg: 70, achtzig: 80, achtzg: 80, neunzig: 90, nünzg: 90, nüünzg: 90, neunzg: 90,
};
/** «ein», «eine», «einen» … nur vor einem zählbaren Wort als Zahl lesen («ein Fz», «eine weisse Drohne») */
const EIN_RE = /^(?:ein|eine|einen|einem|einer)$/i;
/** zählbare Wörter (Personen, Fahrzeuge, Geräte) – vor diesen ist eine kleine Zahl die Anzahl */
const COUNT_NOUN_RE =
  /^(?:fahrzeug(?:e|en)?|fahrzüg|fz|person(?:en)?|persone|pers|mann|leute|männer|frauen|kinder|soldat(?:en)?|sdt|pw|pws|personenwagen|lw|lastwagen|lieferwagen|kastenwagen|transporter|drohnen?|spz|schützenpanzer|kpz|kampfpanzer|panzer|motorr(?:ad|äder)|töffs?|velos?|traktor(?:en)?|autos?|lkws?|busse?|kleinbus(?:se)?|jeeps?|pick-?ups?|geländewagen|duros?|zivilist(?:en)?|zivilperson(?:en)?|bewaffnete[rn]?|gegner|kolonne|kisten?|helikopter|helis?|minenwerfer|mw|mg|maschinengewehre?|stgw|sturmgewehre?|raketenwerfer|lenkwaffen?|kpz|pzaw|halbzug|hz|zug|gruppe|gr|trupp|trp|kompanie|kp|patrouille|pat)$/i;

/** Himmelsrichtungen → Kürzel wie in `parseMeldung` */
const DIRWORD: Record<string, string> = {
  n: "N", nord: "N", norden: "N", no: "NO", ne: "NO", nordost: "NO", nordosten: "NO", o: "O", e: "O", ost: "O", osten: "O",
  so: "SO", se: "SO", südost: "SO", südosten: "SO", s: "S", süd: "S", süden: "S", sw: "SW", südwest: "SW", südwesten: "SW",
  w: "W", west: "W", westen: "W", nw: "NW", nordwest: "NW", nordwesten: "NW",
  // Schweizerdeutsch
  norde: "N", oste: "O", süde: "S", weste: "W", nordoste: "NO", südoste: "SO", südweste: "SW", nordweste: "NW",
};
const WAERTS: Record<string, string> = { nordwärts: "N", ostwärts: "O", südwärts: "S", westwärts: "W" };

/** Armee-Begriffe → Kürzel (ganze Wörter) */
const VOCAB: Record<string, string> = {
  fahrzeug: "Fz", fahrzeuge: "Fz", fahrzeugen: "Fz", fahrzüg: "Fz",
  person: "Pers", personen: "Pers", persone: "Pers",
  gegnerisch: "gn", gegnerische: "gn", gegnerischer: "gn", gegnerischen: "gn", gegnerisches: "gn", gegnerischem: "gn",
  feindlich: "gn", feindliche: "gn", feindlicher: "gn", feindlichen: "gn", feindliches: "gn",
  eigene: "eig", eigener: "eig", eigenen: "eig", eigenes: "eig",
  zivil: "ziv", zivile: "ziv", ziviler: "ziv", zivilen: "ziv", ziviles: "ziv",
  schützenpanzer: "Spz", kampfpanzer: "Kpz", personenwagen: "Pw", lastwagen: "Lw", infanterie: "Inf", halbzug: "Hz",
  maschinengewehr: "Mg", sturmgewehr: "Stgw", panzerabwehr: "Pzaw", minenwerfer: "Mw", soldaten: "Sdt", soldat: "Sdt",
  kommandoposten: "KP", beobachtungsstandort: "Beo Stao", beobachtungsposten: "Beo Posten", standort: "Stao",
  panzergrenadiere: "Pz Gren", kilometer: "km", meter: "m", minuten: "min", minute: "min",
};

/** Elemente mit Nummer: «Detachement zwo» → «Det 2» */
const ELEMENT: Record<string, string> = {
  detachement: "Det", detachment: "Det", detaschement: "Det", detaschment: "Det", det: "Det",
  zug: "Zug", gruppe: "Gr", gr: "Gr", trupp: "Trp", trp: "Trp", patrouille: "Pat", pat: "Pat", patr: "Pat",
  beobachtungsraum: "NAI", nai: "NAI", tag: "T",
};

/** Funkfloskeln und Füllwörter, die nichts zur Meldung beitragen */
const FILLER = new Set([
  "hier", "kommen", "verstanden", "antworten", "antwort", "meldung", "over", "roger", "bitte", "äh", "ähm", "öhm", "ehm", "hm",
  "hmm", "grüessech", "grüezi", "grüessi", "grüessech", "merci", "danke", "vielmal", "vielmals", "tschau", "salü", "hoi", "durchsage",
  "funkspruch", "also", "quittiert", "quittieren",
]);
/** Zögerlaute */
const HESITATION = new Set(["äh", "ähm", "öhm", "ehm", "hm", "hmm", "äähm", "ääh", "eh", "öh"]);
/** «Ende» nach diesen Wörtern ist Teil der Meldung («am Ende der Strasse») */
const ENDE_KEEP = new Set(["am", "zum", "beim", "das", "dem", "ans", "bis", "gegen", "vom", "an"]);

// ---------------------------------------------------------------------------------------------------------------
// Zahlen

/** Zahlwort lesen: «zwo» → 2, «einundzwanzig» → 21, «zwöiezwänzg» → 22, «zweihundertfünfzig» → 250 */
export function spokenNumber(word: string): number | undefined {
  const w = word.toLowerCase().replace(/ß/g, "ss");
  if (/^\d+$/.test(w)) return +w;
  return below1000(w);
}

function below100(w: string): number | undefined {
  if (w in SMALL) return SMALL[w];
  for (const [t, v] of Object.entries(TENS)) {
    if (!w.endsWith(t)) continue;
    const pre = w.slice(0, -t.length);
    if (!pre) return v;
    const unit = pre.endsWith("und") ? pre.slice(0, -3) : pre.endsWith("e") ? pre.slice(0, -1) : null;
    if (unit === null) continue;
    const u = unit === "ein" || unit === "eis" ? 1 : SMALL[unit];
    if (u !== undefined && u >= 1 && u <= 9) return v + u;
  }
  return undefined;
}

function below1000(w: string): number | undefined {
  const i = w.indexOf("hundert");
  if (i < 0) return below100(w);
  const left = w.slice(0, i);
  const right = w.slice(i + 7).replace(/^und/, "");
  const h = !left ? 1 : left === "ein" ? 1 : SMALL[left];
  if (h === undefined || h < 1 || h > 9) return undefined;
  if (!right) return h * 100;
  const r = below100(right);
  return r === undefined ? undefined : h * 100 + r;
}

// ---------------------------------------------------------------------------------------------------------------
// Tokens

interface Tok {
  /** aktueller Text */
  s: string;
  /** Spanne im Original */
  a: number;
  b: number;
  /** Leerzeichen davor */
  sp: boolean;
  /** Satzzeichen */
  p?: boolean;
  /** Zahl (nur Ziffern) */
  n?: boolean;
  /** einzelne Ziffer (gesprochen oder geschrieben) – wird mit Nachbarn zur Ziffernfolge */
  d?: boolean;
  /** Zahl aus einem Zahlwort («acht» → 8), nicht als Ziffer geschrieben */
  w?: boolean;
  /** aus Ziffern zusammengesetzt («null vier» → «04») */
  seq?: boolean;
  /** Uhrzeit HHMM */
  time?: boolean;
  /** Buchstabe aus dem Buchstabieralphabet */
  l?: string;
  /** fertig (nicht weiter umformen) */
  done?: boolean;
  /** entfernt */
  del?: boolean;
  /** Meldungsende («Ende», «Schluss») */
  end?: boolean;
  /** neue Meldung beginnt vor diesem Token */
  brk?: boolean;
  /** davor wurde ein Zögerlaut entfernt («Alpha, äh, Golf») */
  hz?: boolean;
}

const TOK_RE = /[\p{L}\d][\p{L}\d'’\-]*[\p{L}\d]|[\p{L}\d]|\S/gu;

function tokenize(line: string): Tok[] {
  const out: Tok[] = [];
  for (const m of line.matchAll(TOK_RE)) {
    const s = m[0];
    const a = m.index!;
    const sp = a === 0 || /\s/.test(line[a - 1] ?? " ");
    // «Alpha-Golf-13», «Null-Vier»: Teile einzeln lesen (nicht «X-Ray», «Süd-West»)
    const parts = s.split("-");
    const spoken = (w: string) => !!PHONETIC[w.toLowerCase()] || spokenNumber(w) !== undefined;
    // «Zwo-Fahrzeuge», «drei-Personen»: Zahl und zählbares Wort
    const numNoun = parts.length === 2 && spokenNumber(parts[0]!) !== undefined && (COUNT_NOUN_RE.test(parts[1]!) || !!VOCAB[parts[1]!.toLowerCase()]);
    if (parts.length > 1 && !PHONETIC[s.toLowerCase()] && (numNoun || parts.every((w) => w && spoken(w)))) {
      let off = a;
      parts.forEach((w, k) => {
        out.push({ s: w, a: off, b: off + w.length, sp: k === 0 ? sp : true, n: /^\d+$/.test(w) });
        off += w.length + 1;
      });
      continue;
    }
    out.push({ s, a, b: a + s.length, sp, p: !/[\p{L}\d]/u.test(s), n: /^\d+$/.test(s) });
  }
  return out;
}

const low = (t: Tok | undefined) => (t ? t.s.toLowerCase().replace(/ß/g, "ss") : "");
const isNum = (t: Tok | undefined): t is Tok => !!t && !t.del && !!t.n && !t.time;
const live = (toks: Tok[]) => toks.filter((t) => !t.del);

/** mehrere Tokens zu einem zusammenfassen */
function merge(toks: Tok[], i: number, j: number, s: string, extra: Partial<Tok> = {}): Tok {
  const first = toks[i]!;
  const last = toks[j]!;
  const t: Tok = { s, a: first.a, b: last.b, sp: first.sp, ...(first.hz ? { hz: true } : {}), ...extra };
  toks.splice(i, j - i + 1, t);
  return t;
}

/** zählbares Wort in den nächsten `max` Wörtern (Adjektive dazwischen erlaubt: «ein weisser Lieferwagen») */
function countNounAhead(toks: Tok[], i: number, max = 2): boolean {
  for (let k = i; k < toks.length && k <= i + max; k++) {
    const t = toks[k]!;
    if (t.p) return false;
    if (COUNT_NOUN_RE.test(t.s)) return true;
    if (/^[A-ZÄÖÜ]/.test(t.s) && k > i) return false;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Schritte

/** Zahlwörter → Ziffern; «ein Dutzend» → 12, «zwei Dutzend» → 24, «ein halbes Dutzend» → 6; «ein paar» bleibt (unbestimmt) */
function stepNumbers(toks: Tok[]) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.p) continue;
    const w = low(t);
    // Dutzend: Zahl davor (Wort oder Ziffer) mal 12 («ein Dutzend», «2 Dutzend», «ein halbes Dutzend»)
    const dz = low(toks[i + 1]) === "halbes" && DOZEN_RE.test(low(toks[i + 2])) ? 2 : DOZEN_RE.test(low(toks[i + 1])) ? 1 : -1;
    if (dz > 0) {
      const f = EIN_RE.test(w) ? 1 : t.n ? +t.s : spokenNumber(w);
      if (f !== undefined && f >= 1 && f <= 20) {
        merge(toks, i, i + dz, String(dz === 2 ? f * 6 : f * 12), { n: true, w: !t.n, done: true });
        continue;
      }
    }
    if (t.n) {
      if (t.s.length === 1) t.d = true;
      continue;
    }
    if (EIN_RE.test(w)) {
      // «ein Fahrzeug», «eine weisse Drohne» = 1; sonst Artikel («eine Sperre»), «ein paar» = unbestimmt
      if (low(toks[i + 1]) !== "paar" && countNounAhead(toks, i + 1)) Object.assign(t, { s: "1", n: true, d: true, w: true });
      continue;
    }
    const v = spokenNumber(w);
    if (v === undefined) continue;
    Object.assign(t, { s: String(v), n: true, d: v <= 9, w: true });
  }
}

const DOZEN_RE = /^dutzend$/;

/**
 * Ziffernfolgen: «null sieben zwo null» → 0720, «eins drei» → 13; letzte Ziffer vor «Fahrzeuge» bleibt die Anzahl.
 * Getippt (`typed`): nur Zahlwörter untereinander verschmelzen, nie mit einer geschriebenen Ziffer («acht 2 Fz» ≠ 82 Fz).
 * Auch diktiert: eine geschriebene Ziffer direkt vor einem zählbaren Wort nach einem Zahlwort bleibt die Anzahl.
 */
function stepDigits(toks: Tok[], typed = false) {
  for (let i = 0; i < toks.length; i++) {
    if (!toks[i]!.d) continue;
    let j = i;
    while (toks[j + 1]?.d && toks[j + 1]!.sp && (!typed || (!!toks[j + 1]!.w && !!toks[i]!.w))) j++;
    if (j === i) continue;
    // «zwanzig nach acht 2 Fz»: Wort + Ziffer vor zählbarem Wort → die Ziffer ist die Anzahl
    if (!toks[j]!.w && toks[j - 1]!.w && countNounAhead(toks, j + 1, 2)) {
      j--;
      if (j === i) continue;
    }
    // «Hotel null vier null sieben eins fünf …»: Element hat zwei Ziffern, der Rest ist eine neue Folge
    if (low(toks[i - 1]) === "hotel" && j - i >= 3) {
      merge(toks, i, i + 1, toks[i]!.s + toks[i + 1]!.s, { n: true, seq: true });
      continue;
    }
    let end = j;
    // «Hotel null vier zwei Fahrzeuge» → H04 2 Fz, «Detachement zwo zwei Personen» → Det 2 2 Pers
    // (Anzahl wird als ganze Zahl gesprochen; «Hotel null fünf Drohne» bleibt H05)
    const afterElement = !!ELEMENT[low(toks[i - 1])] && j - i === 1;
    if (countNounAhead(toks, j + 1, 2) && (j - i >= 2 || afterElement)) end = j - 1;
    // «Tag zwei null sieben eins fünf» → T2 0715
    let start = i;
    if (/^(?:tag|tango|t)$/i.test(toks[i - 1]?.s ?? "") && end - i === 4) {
      start = i + 1;
      toks[i]!.d = false;
    }
    if (end > start) {
      const s = toks.slice(start, end + 1).map((t) => t.s).join("");
      merge(toks, start, end, s, { n: true, seq: true });
    }
  }
}

const hhmm = (h: number, m: number) => `${String(h % 24).padStart(2, "0")}${String(m).padStart(2, "0")}`;
const numVal = (t: Tok | undefined) => (isNum(t) ? +t.s : NaN);

/** Uhrzeiten: «sieben Uhr zwanzig», «zwanzig nach sieben», «viertel vor acht», «halb acht», «0720 Uhr» */
function stepTimes(toks: Tok[]) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const w = low(t);
    const n1 = toks[i + 1];
    // «0720 Uhr» → 0720
    if (isNum(t) && t.s.length === 4 && low(n1) === "uhr" && validTime(t.s)) {
      merge(toks, i, i + 1, t.s, { n: true, time: true });
      continue;
    }
    if (isNum(t) && t.s.length === 4 && t.seq && validTime(t.s)) { t.time = true; continue; }
    // «7.20 Uhr», «07:20 Uhr» → 0720
    const sepTok = toks[i + 1];
    const mTok = toks[i + 2];
    if (isNum(t) && t.s.length <= 2 && +t.s <= 23 && sepTok && /^[:.]$/.test(sepTok.s) && !sepTok.sp && isNum(mTok) && !mTok.sp
      && mTok.s.length === 2 && +mTok.s < 60 && low(toks[i + 3]) === "uhr") {
      merge(toks, i, i + 3, hhmm(+t.s, +mTok.s), { n: true, time: true });
      continue;
    }
    const prevTok = toks[i - 1];
    if (prevTok?.p && /^[:.]$/.test(prevTok.s) && !t.sp) continue;
    // «7 Uhr 20», «19 Uhr»
    if (isNum(t) && t.s.length <= 2 && +t.s <= 24 && low(n1) === "uhr") {
      const m = toks[i + 2];
      // «neun Uhr 4 Pers»: die Zahl nach «Uhr» ist die Anzahl, nicht die Minute; «dreiundzwanzig Uhr zehn 2 Pers»: Minute 10
      if (isNum(m) && m.s.length <= 2 && +m.s < 60 && (!countNounAhead(toks, i + 3, 2) || isNum(toks[i + 3]))) merge(toks, i, i + 2, hhmm(+t.s, +m.s), { n: true, time: true });
      else merge(toks, i, i + 1, hhmm(+t.s, 0), { n: true, time: true });
      continue;
    }
    // «null acht fünfzehn» → 0815, «sechzehn dreissig» → 1630, «zwanzig zwei zwei» → 2022
    if (spokenClock(toks, i)) continue;
    // «halb acht» → 0730
    if (w === "halb" && isNum(n1) && +n1.s >= 1 && +n1.s <= 24) {
      merge(toks, i, i + 1, hhmm((+n1.s + 23) % 24, 30), { n: true, time: true });
      continue;
    }
    // «zwanzig nach sieben», «viertel vor acht», «fünf vor halb acht»
    const min = w === "viertel" ? 15 : isNum(t) && t.s.length <= 2 ? +t.s : NaN;
    const rel = low(n1);
    if (min >= 1 && min <= 30 && (rel === "nach" || rel === "vor")) {
      const halb = low(toks[i + 2]) === "halb";
      const hTok = toks[i + (halb ? 3 : 2)];
      const h = numVal(hTok);
      if (h >= 1 && h <= 24 && hTok!.s.length <= 2) {
        let total = (halb ? ((h + 23) % 24) * 60 + 30 : h * 60) + (rel === "nach" ? min : -min);
        total = (total + 1440) % 1440;
        merge(toks, i, i + (halb ? 3 : 2), hhmm(Math.floor(total / 60), total % 60), { n: true, time: true });
      }
    }
  }
}

/** «punkt neun Uhr», «genau 0900» → 0900 (Füllwort vor der Zeit fällt weg) */
function stepTimeWords(toks: Tok[]) {
  for (let i = 0; i < toks.length - 1; i++) {
    if (/^(?:punkt|genau|pünktlich)$/.test(low(toks[i])) && toks[i + 1]!.time) toks[i]!.del = true;
  }
}

const validTime = (s: string) => /^(?:[01]\d|2[0-3])[0-5]\d$/.test(s);

/** Wörter vor einer Zeit am Meldungsanfang («Grüessech, LVZ, Zeit acht fünfzehn …») */
const LEAD_WORD_RE = /^(?:zeit|uhrzeit|um|lvz|tag|tango|t\d)$/;
/** Wörter direkt vor einer Zeit mitten im Satz («um acht fünfzehn») */
const TIME_PREP_RE = /^(?:um|zeit|uhrzeit|ab|seit|bis)$/;
/** Elemente, vor denen eine Zeit steht («acht fünfzehn Hotel null vier») */
const MELDER_WORD_RE = /^(?:hotel|detachement|detachment|detaschement|det|zug|gruppe|gr|trupp|trp|patrouille|pat)$/;

/**
 * Uhrzeit aus zwei gesprochenen Zahlen: Ziffernfolge mit führender Null + Zahl 10–59 («null acht fünfzehn» → 0815) überall,
 * sonst Zahl 0–23 + Zahl 0–59 («sechzehn dreissig», «zwanzig zwei zwei», «acht fünfzehn») nur am Meldungsanfang,
 * nach «um»/«Zeit» oder vor einem Melder/Element – nie mitten in Mengen («zwölf zwanzig Personen»).
 */
function spokenClock(toks: Tok[], i: number): boolean {
  const h = toks[i]!;
  const m = toks[i + 1];
  if (!isNum(h) || !isNum(m) || !m.sp || h.s.length > 2 || m.s.length > 2 || +h.s > 23 || +m.s > 59) return false;
  const prev = toks[i - 1];
  // «Hotel null acht fünfzehn Personen», «Detachement zwo zwanzig …», «Alpha Golf eins drei zwanzig»: gehört zum Element
  if (prev && !prev.p && (MELDER_WORD_RE.test(low(prev)) || ELEMENT[low(prev)] || PHONETIC[low(prev)])) return false;
  const after = toks[i + 2];
  if (after && (low(after) === "uhr" || low(after) === "nach" || low(after) === "vor")) return false;
  if (!isNum(after) && countNounAhead(toks, i + 2, 2)) return false;
  const lead0 = !!h.seq && h.s.length === 2 && h.s[0] === "0" && +m.s >= 10 && !m.seq;
  const words = toks.slice(0, i).filter((t) => !t.p && !t.del);
  const atStart = words.every((t, k) => FILLER.has(low(t)) || LEAD_WORD_RE.test(low(t)) || (isNum(t) && /^(?:tag|tango)$/.test(low(words[k - 1]))));
  const afterPrep = TIME_PREP_RE.test(low(words[words.length - 1]));
  let k = i + 2;
  while (toks[k] && (toks[k]!.p || /^(?:hier|von|lvz|meldung)$/.test(low(toks[k])))) k++;
  const nx = toks[k];
  const beforeMelder = !!nx && (/^H\d{1,2}$/.test(nx.s) || (MELDER_WORD_RE.test(low(nx)) && isNum(toks[k + 1])));
  if (!lead0 && !atStart && !afterPrep && !beforeMelder) return false;
  merge(toks, i, i + 1, hhmm(+h.s, +m.s), { n: true, time: true });
  return true;
}

/** «ich buchstabiere Whiskey Alpha Bravo …» → Wort (bzw. weg, wenn das Wort schon davor steht) */
function stepSpelling(toks: Tok[]) {
  for (let i = 0; i < toks.length; i++) {
    if (low(toks[i]) !== "buchstabiere") continue;
    let a = i;
    if (low(toks[i - 1]) === "ich") a = i - 1;
    let j = i + 1;
    while (toks[j]?.p && toks[j]!.s !== ".") j++;
    const k0 = j;
    let letters = "";
    while (toks[j] && (PHONETIC[low(toks[j])] || toks[j]!.p && toks[j]!.s === ",")) {
      if (!toks[j]!.p) letters += PHONETIC[low(toks[j])]!;
      j++;
    }
    for (let k = a; k < k0; k++) toks[k]!.del = true;
    if (!letters) continue;
    const word = letters[0] + letters.slice(1).toLowerCase();
    // Wort davor (vor «ich buchstabiere») gleich? → Buchstabieren entfernen
    let prev = a - 1;
    while (prev >= 0 && (toks[prev]!.p || toks[prev]!.del)) prev--;
    const same = prev >= 0 && low(toks[prev]).replace(/[^a-zäöü]/g, "") === letters.toLowerCase();
    if (same) {
      for (let k = k0; k < j; k++) toks[k]!.del = true;
    } else {
      merge(toks, k0, j - 1, word, { done: true });
    }
  }
}

/** Buchstabieralphabet: «Hotel null vier» → H04, «Alpha Golf eins drei Charlie» → AG13 C, «November Alpha India drei» → NAI 3 */
/** nächstes Token nach `k`; Kommas überspringen, wenn dazwischen ein Zögerlaut entfernt wurde («Alpha, äh, Golf 13») */
function nextHz(toks: Tok[], k: number): number {
  let m = k + 1;
  while (toks[m]?.p && toks[m]!.s === ",") m++;
  return m > k + 1 && toks[m]?.hz ? m : k + 1;
}

/** Quadrant A–D nach einem Planquadrat («… eins drei Charlie», «AK7, Charlie»): Index des Buchstabens oder -1 */
function quadrantAt(toks: Tok[], end: number): number {
  let k = end + 1;
  // «AK7, Charlie»: ein Komma dazwischen
  if (toks[k]?.p && toks[k]!.s === ",") k++;
  const q = toks[k];
  if (!q || q.p || q.done || (k === end + 1 && !q.sp) || !/^[ABCD]$/.test(PHONETIC[low(q)] ?? "")) return -1;
  // nicht Beginn einer neuen Buchstabenfolge («…, Charlie Delta 5»)
  const afterQ = toks[k + 1];
  const alone = !afterQ || !(afterQ.sp && (PHONETIC[low(afterQ)] || isNum(afterQ)));
  return alone ? k : -1;
}

function stepPhonetic(toks: Tok[]) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.p || t.del) continue;
    // getipptes Planquadrat mit gesprochenem Quadranten: «AK7, Charlie» → AK7 C
    if (/^[A-Z]{2}\d{1,2}$/.test(t.s) && !PHONETIC[low(t)]) {
      const qk = quadrantAt(toks, i);
      if (qk >= 0) merge(toks, i, qk, `${t.s} ${PHONETIC[low(toks[qk])]}`, { done: true });
      continue;
    }
    if (t.done || !PHONETIC[low(t)]) continue;
    let j = i;
    let letters = PHONETIC[low(t)]!;
    for (;;) {
      // Quadrant nach Planquadrat («… eins drei Charlie») gehört nicht zur Buchstabenfolge – hier kommen keine Ziffern vor
      // «Alpha, äh, Golf»: Zögern zwischen den Buchstaben (nur ab einem Buchstaben, nicht nach «Hotel»)
      const nx = letters.length === 1 && letters !== "H" ? nextHz(toks, j) : j + 1;
      const n = toks[nx];
      if (!n || !n.sp || n.done || !PHONETIC[low(n)]) break;
      j = nx;
      letters += PHONETIC[low(n)]!;
    }
    const numIdx = nextHz(toks, j);
    const num = toks[numIdx];
    const plan = /^(?:planquadrat|pq)$/i.test(toks[i - 1]?.s ?? "") || (toks[i - 1]?.del && /^(?:planquadrat|pq)$/i.test(toks[i - 1]!.s));
    if (isNum(num) && num.sp && num.s.length <= 3) {
      let s: string;
      if (letters === "NAI") s = `NAI ${+num.s}`;
      else s = letters + num.s;
      let end = numIdx;
      // Quadrant: einzelner Buchstabe A–D direkt danach (nicht Beginn einer neuen Buchstabenfolge)
      const cellLike = (letters.length >= 2 || letters !== "H" || plan) && letters !== "NAI";
      const qk = cellLike ? quadrantAt(toks, end) : -1;
      if (qk >= 0) {
        s += ` ${PHONETIC[low(toks[qk])]}`;
        end = qk;
      } else if (cellLike && toks[end + 1]?.s === "(" && toks[end + 3]?.s === ")" && /^[ABCD]$/.test(PHONETIC[low(toks[end + 2])] ?? "")) {
        // «Alpha Golf eins drei (Charlie)» → AG13 C
        s += ` ${PHONETIC[low(toks[end + 2])]}`;
        end += 3;
      }
      merge(toks, i, end, s, { done: true });
    } else if (letters.length >= 2) {
      merge(toks, i, j, letters, { done: true });
    }
  }
}

/** Elemente und Räume mit Nummer: «Detachement zwo» → Det 2, «Gruppe drei» → Gr 3, «Beobachtungsraum drei» → NAI 3, «Tag zwei» → T2 */
function stepElements(toks: Tok[]) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.p || t.done || t.n) continue;
    const e = ELEMENT[low(t).replace(/\.$/, "")];
    const n = toks[i + 1];
    if (!e || !isNum(n) || n.s.length > 2 || (low(t) === "tag" && +n.s > 9)) continue;
    merge(toks, i, i + 1, e === "T" ? `T${+n.s}` : `${e} ${+n.s}`, { done: true });
  }
}

/** Planquadrat-Wörter entfernen («im Planquadrat AG13» → AG13) */
function stepPlanquadrat(toks: Tok[]) {
  for (let i = 0; i < toks.length; i++) {
    if (!/^(?:planquadrat|planquadrats|pq)$/i.test(toks[i]!.s)) continue;
    toks[i]!.del = true;
    const prev = toks[i - 1];
    if (prev && /^(?:im|in)$/i.test(prev.s) && !prev.del) prev.del = true;
    if (toks[i + 1]?.s === ":") toks[i + 1]!.del = true;
  }
}

/** Koordinaten gesprochen: «2600100 Strich 1199000» → 2'600'100 / 1'199'000 */
function stepCoordinates(toks: Tok[]) {
  const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  for (let i = 0; i < toks.length; i++) {
    const a = toks[i]!;
    if (!isNum(a) || !(/^2\d{6}$/.test(a.s) || /^[4-8]\d{5}$/.test(a.s))) continue;
    let j = i + 1;
    if (toks[j] && (/^(?:strich|schrägstrich|slash|komma)$/i.test(toks[j]!.s) || /^[/,;]$/.test(toks[j]!.s))) j++;
    const b = toks[j];
    if (!isNum(b)) continue;
    const ok = (a.s.length === 7 && /^1\d{6}$/.test(b.s)) || (a.s.length === 6 && /^[0-3]\d{5}$/.test(b.s));
    if (!ok) continue;
    merge(toks, i, j, `${group(a.s)} / ${group(b.s)}`, { done: true });
  }
}

/** Richtungen: «Richtung Nord» → Rtg N, «nach Westen» → Rtg W, «von Osten» → aus Rtg O, «nordwärts» → Rtg N */
function stepDirections(toks: Tok[]) {
  const dirOf = (t: Tok | undefined) => (t && !t.p ? DIRWORD[low(t).replace(/-/g, "")] : undefined);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.p || t.done) continue;
    const w = low(t);
    if (WAERTS[w]) { merge(toks, i, i, `Rtg ${WAERTS[w]}`, { done: true }); continue; }
    if (w === "richtung" || w === "rtg" || w === "fahrtrichtung" || w === "richtig") {
      const from = /^(?:aus|von)$/i.test(toks[i - 1]?.s ?? "") ? i - 1 : low(toks[i - 1]) === "in" ? i - 1 : i;
      const prefix = from < i && low(toks[from]) !== "in" ? "aus " : "";
      const d = dirOf(toks[i + 1]);
      // «Richtung Nord Ost» (zwei Wörter) → Rtg NO
      const d2 = (d === "N" || d === "S") && toks[i + 2]?.sp ? dirOf(toks[i + 2]) : undefined;
      if (d2 === "O" || d2 === "W") merge(toks, from, i + 2, `${prefix}Rtg ${d}${d2}`, { done: true });
      else if (d) merge(toks, from, i + 1, `${prefix}Rtg ${d}`, { done: true });
      else if (w !== "richtig") merge(toks, from, i, `${prefix}Rtg`, { done: true });
      continue;
    }
    if (w === "nach" || w === "gegen" || w === "aus" || w === "von") {
      const d = dirOf(toks[i + 1]);
      // Einzelbuchstaben nur in Kurzschreibweise («nach N»), nicht «nach O» als Wort erzwingen: Grossbuchstaben verlangen
      if (!d || (toks[i + 1]!.s.length <= 2 && toks[i + 1]!.s !== toks[i + 1]!.s.toUpperCase())) continue;
      merge(toks, i, i + 1, `${w === "aus" || w === "von" ? "aus " : ""}Rtg ${d}`, { done: true });
    }
  }
}

/** Armee-Begriffe kürzen («Fahrzeuge» → Fz, «gegnerische» → gn) */
function stepVocab(toks: Tok[]) {
  for (const t of toks) {
    if (t.p || t.done || t.n) continue;
    const v = VOCAB[low(t)];
    if (v) { t.s = v; t.done = true; }
  }
}

/** Funkfloskeln: «hier», «kommen», «LVZ von …», «ich wiederhole», «Ende» (= Meldungsende) */
function stepFiller(toks: Tok[]) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.p || t.done || t.del) continue;
    const w = low(t);
    const prev = live(toks.slice(0, i)).filter((x) => !x.p).pop();
    if ((w === "ende" || w === "schluss") && !ENDE_KEEP.has(low(prev))) {
      t.del = true;
      t.end = true;
      // «Ende der Meldung», «Schluss der Durchsage»
      if (low(toks[i + 1]) === "der" && /^(?:meldung|durchsage|übermittlung)$/i.test(toks[i + 2]?.s ?? "")) {
        toks[i + 1]!.del = true;
        toks[i + 2]!.del = true;
      }
      continue;
    }
    if (w === "grüss" || w === "grüß") { t.del = true; if (low(toks[i + 1]) === "gott") toks[i + 1]!.del = true; continue; }
    if (w === "guten" && /^(?:tag|morgen|abend)$/i.test(toks[i + 1]?.s ?? "")) { t.del = true; toks[i + 1]!.del = true; continue; }
    if (w === "lvz") {
      // «LVZ hier H04», «LVZ von H04», «an LVZ», «für LVZ»: Adressat, kein Melder
      const nx = low(toks[i + 1]);
      const pv = low(toks[i - 1]);
      const first = !live(toks.slice(0, i)).some((x) => !x.p);
      const nextLive = toks.slice(i + 1).find((x) => !x.del && !x.p);
      if (first && nextLive && /^(?:H\d|Det |Zug |Gr |Trp |Pat )/.test(nextLive.s)) { t.del = true; continue; }
      if (nx === "hier" || nx === "von" || nx === "," || pv === "an" || pv === "für" || pv === "von") {
        t.del = true;
        if (nx === "von" || nx === ",") toks[i + 1]!.del = true;
        if (pv === "an" || pv === "für" || pv === "von") toks[i - 1]!.del = true;
      }
      continue;
    }
    // «Erste Meldung …», «Zweite Meldung …»: neue Meldung
    if (w === "meldung" && ORDINAL_RE.test(low(toks[i - 1])) && !toks[i - 1]!.done) {
      toks[i - 1]!.del = true;
      t.del = true;
      const nx = toks.slice(i + 1).find((x) => !x.del && !x.p);
      if (nx) nx.brk = true;
      continue;
    }
    if (w === "meldung" && low(toks[i + 1]) === "von") toks[i + 1]!.del = true;
    // «von H04: …» am Anfang = Absender
    if (w === "von" && !prev && /^H\d/.test(toks.slice(i + 1).find((x) => !x.del && !x.p)?.s ?? "")) { t.del = true; continue; }
    if (FILLER.has(w)) {
      t.del = true;
      if (toks[i + 1]?.s === ":") toks[i + 1]!.del = true;
    }
  }
}

/** «erste Meldung», «zweite Meldung», «nächste Meldung» */
const ORDINAL_RE = /^(?:erste|zweite|dritte|vierte|fünfte|sechste|siebte|achte|neunte|zehnte|nächste|weitere|neue|letzte|andere|1\.|2\.|3\.|4\.|5\.)$/;

/** «zwo Fahrzeuge, ich wiederhole, zwo Fahrzeuge» → 2 Fz */
function stepRepeat(toks: Tok[]) {
  for (let i = 0; i < toks.length; i++) {
    const w = low(toks[i]);
    if (w !== "wiederhole" && w !== "wiederholen") continue;
    toks[i]!.del = true;
    if (low(toks[i - 1]) === "ich") toks[i - 1]!.del = true;
    const before = toks.slice(0, i).filter((t) => !t.del && !t.p);
    const after = toks.slice(i + 1).filter((t) => !t.del && !t.p);
    for (let n = Math.min(before.length, after.length); n >= 1; n--) {
      const b = before.slice(-n).map((t) => t.s.toLowerCase()).join(" ");
      const a = after.slice(0, n).map((t) => t.s.toLowerCase()).join(" ");
      if (a === b) { after.slice(0, n).forEach((t) => (t.del = true)); break; }
    }
  }
}

const CELL_RE = /^[A-Z]{1,3}\d{1,2}(?: [A-D])?$/;

/** «zwei Fahrzeuge, Korrektur, drei Fahrzeuge» → 3 Fz; «AG13, ich korrigiere, AG14» → AG14 */
function stepCorrection(toks: Tok[]) {
  for (let i = 0; i < toks.length; i++) {
    const w = low(toks[i]);
    if (!/^(?:korrektur|korrigiere|korrigiert|berichtige|berichtigung)$/.test(w)) continue;
    toks[i]!.del = true;
    if (low(toks[i - 1]) === "ich") toks[i - 1]!.del = true;
    const before = toks.slice(0, i).filter((t) => !t.del && !t.p);
    const after = toks.slice(i + 1).filter((t) => !t.del && !t.p);
    const a0 = after[0];
    if (!a0) continue;
    const lastIdx = (f: (t: Tok, k: number) => boolean) => { for (let k = before.length - 1; k >= 0; k--) if (f(before[k]!, k)) return k; return -1; };
    let k = -1;
    if (a0.n && !a0.time && after[1]) {
      k = lastIdx((t, j) => !!t.n && !t.time && low(before[j + 1]) === low(after[1]));
      if (k >= 0) { before[k]!.del = true; before[k + 1]!.del = true; continue; }
      k = lastIdx((t) => !!t.n && !t.time);
    } else if (a0.time) k = lastIdx((t) => !!t.time);
    else if (CELL_RE.test(a0.s)) k = lastIdx((t) => CELL_RE.test(t.s));
    else if (/^(?:aus )?Rtg /.test(a0.s)) k = lastIdx((t) => /^(?:aus )?Rtg /.test(t.s));
    else if (/^(?:H\d|NAI |Det )/.test(a0.s)) k = lastIdx((t) => t.s.slice(0, 2) === a0.s.slice(0, 2));
    if (k >= 0) before[k]!.del = true;
  }
}

/** Zeit nach vorne: «H04, Zeit null sieben eins fünf, …» → «0715 H04 …»; Zeit vor neuem Melder ohne Satzzeichen trennt */
function stepTimePlacement(toks: Tok[]) {
  const words = () => toks.filter((t) => !t.del && !t.p);
  let ws = words();
  for (let k = 0; k < ws.length; k++) {
    const t = ws[k]!;
    if (!t.time && !(t.n && validTime(t.s) && /^(?:zeit|uhrzeit|wann)$/.test(low(ws[k - 1])))) continue;
    t.time = true;
    const prev = ws[k - 1];
    const pw = low(prev);
    if (pw === "zeit" || pw === "uhrzeit" || pw === "wann" || (pw === "um" && k === 1)) { prev!.del = true; }
    ws = words();
    const idx = ws.indexOf(t);
    const before = ws.slice(0, idx);
    const earlierTime = before.some((x) => x.time);
    const nextW = ws[idx + 1];
    const between = toks.slice(toks.indexOf(before[0] ?? t), toks.indexOf(t)).some((x) => !x.del && x.p && /^[.!?;]$/.test(x.s));
    if (idx > 0 && !earlierTime && !between && before.length <= 2 && before.every((x) => /^(?:H\d|T\d$|Det |Zug |Gr |Trp |Pat |Rot$|Blau$)/i.test(x.s))) {
      // nach vorne (hinter «T2»)
      const at = toks.indexOf(t);
      toks.splice(at, 1);
      const dayTok = toks.find((x) => !x.del && !x.p);
      const ins = dayTok && /^T\d$/.test(dayTok.s) ? toks.indexOf(dayTok) + 1 : 0;
      toks.splice(ins, 0, { ...t, sp: true });
      ws = words();
    } else if (idx > 0 && nextW && /^(?:H\d|Det )/.test(nextW.s) && !/^(?:um|ab|bis|seit|vor|nach|zeit)$/.test(low(before[before.length - 1]))) {
      // «… AG13 0720 H05 Sperre» → neue Meldung
      t.brk = true;
      const tPrev = before[before.length - 1];
      if (tPrev && /^T\d$/.test(tPrev.s)) { tPrev.brk = true; t.brk = false; }
    }
  }
}

/** Melder am Meldungsanfang («H04», «Det 2», nach Zeit/Tag) */
const MELDER_TOK_RE = /^(?:H\d{1,2}|(?:Det|Zug|Gr|Trp|Pat) \d{1,2})$/;
const LEAD_TOK_RE = /^(?:H\d{1,2}|T\d|\d{4}|\d{1,2}[:.]\d{2}|(?:Det|Zug|Gr|Trp|Pat) \d{1,2})$/;
/** vor einem Melder mitten im Satz: kein neuer Absender («Kontakt mit H05», «übergibt an H05», «Rtg H05») */
const MELDER_REF_RE = /^(?:bei|beim|von|vom|mit|zu|zum|zur|an|am|für|nach|über|und|oder|durch|ab|auf|aus|vor|hinter|neben|gegen|rtg|richtung|bis|ohne|sowie|als|wie|meldet|sieht|sehen|beobachtet|unterstützt|ablösung|löst|ersetzt|zwischen|via|ca)$/i;

/**
 * Neue Meldung ohne «Ende»: Satzende + neuer Melder/Element («… AG13. Hotel 05, Sperre …») bzw. ein zweites «Hxx»
 * nach einer Meldung mit Melder und Inhalt («H04 2 Fz AG13 Rtg N H05 Sperre AK7»). Wiederholter Melder («H04, H04») fällt weg.
 */
function stepMelderBreak(toks: Tok[]) {
  let seg: Tok[] = [];
  let sentenceEnd = false;
  for (const t of toks) {
    if (t.del) { if (t.end) { seg = []; sentenceEnd = false; } continue; }
    if (t.p) { if (/^[.!?;]$/.test(t.s)) sentenceEnd = true; continue; }
    if (t.brk) seg = [];
    const prev = seg[seg.length - 1];
    if (prev && MELDER_TOK_RE.test(t.s)) {
      const lead = seg.findIndex((x) => !LEAD_TOK_RE.test(x.s));
      const content = lead >= 0;
      if (/^H\d/.test(t.s) && t.s === prev.s) { t.del = true; continue; }
      const melderFirst = seg.some((x, k) => /^H\d/.test(x.s) && (lead < 0 || k < lead));
      const noPunct = /^H\d{2}$/.test(t.s) && melderFirst && !MELDER_REF_RE.test(prev.s) && t !== toks.filter((x) => !x.del && !x.p).pop();
      if (content && (sentenceEnd || noPunct)) { t.brk = true; seg = []; }
    }
    seg.push(t);
    sentenceEnd = false;
  }
}

// ---------------------------------------------------------------------------------------------------------------

/** Zahlwort (nicht Ziffer, nicht Artikel «ein/eine»), z. B. «zwei», «zwo», «drü», «vierzehn» */
const isNumberWord = (w: string) => !/\d/.test(w) && !EIN_RE.test(w) && spokenNumber(w) !== undefined;
/** zählbares Wort («Fz», «Pers», «Panzer», «Lastwagen» …) – davor ist eine Zahl die Anzahl */
export const isCountNoun = (w: string | undefined) => !!w && COUNT_NOUN_RE.test(w.replace(/[.,;:!?]+$/, ""));

/**
 * Enthält ein getippter Text Funk- bzw. Sprechsprache, die `normalizeSpoken` sicher in Kurzschrift bringt?
 * Nur dann wird getippter Text normalisiert – getippte Kurzmeldungen («H04 2 Fz AK7») bleiben unverändert.
 * Auslöser: Buchstabierfolge mit Zahl («Alpha Kilo 7», «Hotel 4», «Hotel null vier»); Zahlwort vor einem zählbaren
 * Wort («zwei Fz», «drei feindliche Soldaten»); Uhrzeit in Worten («viertel nach zehn», «halb elf», «zehn Uhr fünfzehn»);
 * Aufzählung mit Artikel als Anzahl («ein Auto, einen Lastwagen und 3 Personen»).
 */
export function looksSpoken(text: string): boolean {
  const words = text.toLowerCase().replace(/ß/g, "ss").split(/[\s,;:!?()]+/).map((w) => w.replace(/[.]+$/, "")).filter(Boolean);
  const num = (w: string | undefined) => !!w && (/^\d{1,2}$/.test(w) || isNumberWord(w));
  let einCount = 0;
  let otherCount = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const n1 = words[i + 1];
    const n2 = words[i + 2];
    // Buchstabierfolge: «hotel 4», «hotel null vier», «alpha kilo 7», «alpha kilo sieben»
    if (w === "hotel" && num(n1)) return true;
    if (PHONETIC[w] && n1 && PHONETIC[n1]) {
      let j = i + 2;
      while (words[j] && PHONETIC[words[j]!]) j++;
      if (num(words[j]) || (words[j] === "-" && num(words[j + 1]))) return true;
    }
    // Zahlwort vor zählbarem Wort (höchstens ein Beschreibungswort dazwischen)
    if (isNumberWord(w) && (isCountNoun(n1) || (n1 && !num(n1) && isCountNoun(n2)))) return true;
    // Uhrzeit in Worten
    if ((w === "viertel" || w === "dreiviertel" || w === "halb") && (num(n1) || ((n1 === "nach" || n1 === "vor") && num(n2)))) return true;
    if (isNumberWord(w) && n1 === "uhr") return true;
    if (isNumberWord(w) && (n1 === "nach" || n1 === "vor") && (num(n2) || n2 === "halb")) return true;
    // Anzahl in einer Aufzählung
    if (EIN_RE.test(w) && (isCountNoun(n1) || (n1 && isCountNoun(n2)))) einCount++;
    else if (/^\d{1,3}$/.test(w) && (isCountNoun(n1) || (n1 && isCountNoun(n2)))) otherCount++;
  }
  return einCount > 0 && einCount + otherCount >= 2;
}

/**
 * Gesprochenen bzw. diktierten Text in Kurzschreibweise umwandeln.
 * @param o.typed getippter Text (siehe `normalizeTyped`): Zahlwörter verschmelzen nie mit geschriebenen Ziffern
 */
export function normalizeSpoken(text: string, o: { typed?: boolean } = {}): SpokenResult {
  const changes: SpokenResult["changes"] = [];
  const lines: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    // Zögern («null äh vier») trennt nichts: vorab entfernen; das nächste Wort merkt sich das («Alpha, äh, Golf»)
    let hz = false;
    const toks = tokenize(line).filter((t) => {
      if (!HESITATION.has(low(t))) {
        if (hz && !t.p) { t.hz = true; hz = false; }
        return true;
      }
      changes.push({ from: t.s, to: "" });
      hz = true;
      return false;
    });
    stepSpelling(toks);
    stepNumbers(toks);
    stepDigits(toks, !!o.typed);
    stepTimes(toks);
    stepTimeWords(toks);
    stepPlanquadrat(toks);
    stepPhonetic(toks);
    stepElements(toks);
    stepCoordinates(toks);
    stepDirections(toks);
    stepVocab(toks);
    stepFiller(toks);
    stepRepeat(toks);
    stepCorrection(toks);
    stepTimePlacement(toks);
    stepMelderBreak(toks);
    lines.push(...render(line, toks, changes));
  }
  const seen = new Set<string>();
  const uniq = changes.filter((c) => {
    const k = `${c.from}\u0000${c.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { text: lines.join("\n"), changes: uniq };
}

/** Tokens wieder zu Text; Meldungsende und «. 0720 …» (neuer Satz mit Zeit) trennen die Zeilen */
function render(line: string, toks: Tok[], changes: SpokenResult["changes"]): string[] {
  const out: string[] = [];
  let cur = "";
  let delFrom = -1;
  let delTo = -1;
  let last: Tok | undefined;
  const flushDel = () => {
    if (delFrom >= 0) {
      const from = line.slice(delFrom, delTo).trim();
      if (/[\p{L}\d]/u.test(from)) changes.push({ from, to: "" });
    }
    delFrom = -1;
  };
  const newLine = () => {
    const s = tidy(cur);
    if (s) out.push(s);
    cur = "";
    last = undefined;
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.del) {
      if (!t.p) {
        if (delFrom < 0) delFrom = t.a;
        delTo = t.b;
      }
      if (t.end) { flushDel(); newLine(); }
      continue;
    }
    if (!t.p) flushDel();
    if (t.brk && cur) newLine();
    // Satzende vor neuer Zeitangabe → neue Meldung
    if (t.p && /^[.!?;]$/.test(t.s)) {
      const nx = toks.slice(i + 1).find((x) => !x.del);
      if (nx && (nx.time || (nx.n && validTime(nx.s)) || /^T\d$/.test(nx.s))) { newLine(); continue; }
    }
    const nextLive = toks.slice(i + 1).find((x) => !x.del);
    // Satzzeichen als Pause («Hotel null vier, zwo Fahrzeuge.») fallen weg; «07.20», «2,5» bleiben
    // Ausnahme: Komma zwischen zwei unveränderten Wörtern (getippter Text «NAI 1, Zugehörigkeit unklar») bleibt
    const same = (x: Tok | undefined) => !!x && !x.p && line.slice(x.a, x.b) === x.s;
    const keepComma = t.s === "," && same(last) && last!.b === t.a && same(nextLive) && toks.slice(toks.indexOf(last!) + 1, i).every((x) => x.p);
    if (t.p && /^[,.!?;…–—-]$/.test(t.s) && !keepComma && (t.sp || !nextLive || nextLive.sp || nextLive.a !== t.b)) continue;
    const orig = line.slice(t.a, t.b);
    if (!t.p && orig !== t.s) changes.push({ from: orig, to: t.s });
    let sep = " ";
    if (!cur) sep = "";
    else if (last && last.b === t.a && !t.sp) sep = "";
    else if (t.p && /^[:)]$/.test(t.s)) sep = "";
    else if (/\($/.test(cur)) sep = "";
    cur += sep + t.s;
    last = t;
  }
  flushDel();
  newLine();
  return out;
}

const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/\s+:/g, ":").replace(/^[\s:/,]+|[\s:/,]+$/g, "").trim();

// ---------------------------------------------------------------------------------------------------------------
// Mehrere Meldungen trennen

/** Zeit am Anfang: «0715», «07:15», «07.15», «T2 0715», «7.15 Uhr» (nicht Datum «15.05.2030», nicht Koordinate) */
const LEAD_TIME_RE = /^(?:T\s?\d[\s,:]+)?(?:(?:[01]\d|2[0-3])[0-5]\d|(?:[01]?\d|2[0-3])[:.h][0-5]\d)(?![\d'’]|[.:]\d)/i;
const LEAD_T_RE = /^T\s?\d(?=[\s,:])/i;
const NUMBERED_RE = /^\s*(?:\d{1,3}[.)]|[-•*–])\s+/;
const HEADER_WORDS = new Set([
  "datum", "zeit", "uhrzeit", "melder", "von", "an", "meldung", "meldungen", "text", "inhalt", "bemerkung", "bemerkungen", "nr",
  "lfd", "ort", "wer", "was", "wo", "wann", "wie", "massnahmen", "massnahme", "visum", "lagejournal", "journal", "seite",
  "blatt", "eingang", "ausgang", "kanal", "empfänger", "absender", "erledigt", "tag", "nummer", "element", "lage", "kürzel",
]);
const FORM_RE = /^(zeit|wann|melder|von|wer|was|wo|wie|wohin|rtg|richtung|anzahl|bemerkung|bem|tätigkeit|ort)\s*[:=]\s*(.*)$/i;
const CONT_RE = /^(?:rtg|richtung|und|mit|sowie|dann|danach|anschliessend|in|im|bei|beim|auf|nach|aus|von|ca|evtl|vermutlich)\b/i;
const ENDE_RE = /(?<!\b(?:am|zum|beim|das|dem|ans|bis|gegen|vom|an)\s+)\b(?:ende|schluss)\b(?:\s+der\s+(?:meldung|durchsage))?[.!,;]*/giu;

function isHeader(line: string): boolean {
  const l = line.trim();
  if (/^(?:lagejournal|journal|datum)\b/i.test(l)) return true;
  if (/^seite\s+\d+(?:\s*(?:von|\/)\s*\d+)?$/i.test(l)) return true;
  if (/\d/.test(l)) return false;
  const words = l.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  return words.length > 0 && words.every((w) => HEADER_WORDS.has(w));
}

/** Meldezettel mit Feldern («Zeit: 0715», «Melder: H04», «Was: 2 Fz», «Wo: AG13») → eine Meldung */
function formToText(fields: Array<[string, string]>): string {
  const get = (...k: string[]) => fields.filter(([key]) => k.includes(key)).map(([, v]) => v.trim()).filter(Boolean);
  const dir = get("wohin", "rtg", "richtung").map((v) => (/^(?:rtg|richtung)\b/i.test(v) ? v : `Rtg ${v}`));
  const melder = get("melder", "von");
  return [...get("zeit", "wann"), ...melder.map((m, i) => (i === melder.length - 1 ? `${m}:` : m)), ...get("wer", "anzahl", "was", "tätigkeit"), ...get("wo", "ort"), ...get("wie"), ...dir, ...get("bemerkung", "bem")]
    .join(" ");
}

/** Abkürzungen, deren Punkt am Ende bleibt */
const ABBR_END = /(?:^|\s)(?:evtl|ca|vmtl|vermutl|bzw|usw|gegn|feindl|mögl|Det|Gr|Pat|Patr|Trp|Bem|Nr)\.$/i;
const clean = (s: string) => {
  const t = s.replace(/\s+/g, " ").replace(/^[\s\-–•|,;:]+|[\s\-–|,;]+$/g, "").trim();
  return ABBR_END.test(t) ? t : t.replace(/[.!?]+$/, "").trim();
};

/**
 * Text mit mehreren Meldungen (Foto einer Journalseite, langes Sprachmemo) in einzelne Meldungen trennen.
 * Trennt an Zeitangaben am Zeilen- und Satzanfang, Leerzeilen, Nummerierung, Funk-Schlussworten («Ende», «Schluss»),
 * Journal-Tabellenzeilen («0715 | H04 | 2 Fz AG13»). Folgezeilen ohne Zeit gehören zur vorherigen Meldung,
 * Kopfzeilen («Datum», «Zeit | Melder | Meldung», «Lagejournal …») fallen weg.
 */
export function splitMeldungen(text: string): string[] {
  interface Seg { s: string; start: boolean; time: boolean }
  const segs: Seg[] = [];
  let boundary = true;
  let form: Array<[string, string]> = [];
  const flushForm = () => {
    if (form.length) segs.push({ s: formToText(form), start: true, time: true });
    form = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = raw.replace(/\u00a0/g, " ").trim();
    if (!line) { flushForm(); boundary = true; continue; }
    if (isHeader(line.replace(/[|\t]/g, " "))) { flushForm(); boundary = true; continue; }
    // Tabellenzeile «0715 | H04 | 2 Fz»: Zellen zusammenfügen
    const table = /[|\t]/.test(line);
    if (table) line = line.split(/\s*[|\t]+\s*/).filter(Boolean).join(" ");
    const fm = FORM_RE.exec(line);
    if (fm && !table) {
      const key = fm[1]!.toLowerCase();
      // ein einzelnes «Wo: AG13» zwischen normalen Zeilen ist auch ein Formularfeld
      form.push([key === "richtung" ? "rtg" : key, fm[2]!]);
      continue;
    }
    flushForm();
    let numbered = false;
    if (NUMBERED_RE.test(line) && !LEAD_TIME_RE.test(line)) { line = line.replace(NUMBERED_RE, ""); numbered = true; }
    // innerhalb der Zeile: «Ende»/«Schluss» und Satzende vor einer Zeit trennen
    const parts = line.replace(ENDE_RE, "\u0001").split(/\u0001|(?<=[.!?;])\s+(?=(?:T\s?\d\s+)?(?:[01]\d|2[0-3])[:.]?[0-5]\d(?![\d'’]))/);
    parts.forEach((p, k) => {
      const s = p.trim();
      const afterEnde = k > 0;
      if (!s) { if (afterEnde) boundary = true; return; }
      const time = LEAD_TIME_RE.test(s) || LEAD_T_RE.test(s);
      segs.push({ s, start: boundary || time || numbered || table || afterEnde, time });
      boundary = false;
      numbered = false;
    });
  }
  flushForm();
  const timeMode = segs.some((s) => s.time);
  const out: string[] = [];
  let prevRaw = "";
  for (const seg of segs) {
    const cont = !seg.start && out.length > 0 && (timeMode || /^[a-zäöü]/.test(seg.s) || CONT_RE.test(seg.s) || /[,\-&+]$/.test(prevRaw));
    if (cont) out[out.length - 1] += " " + seg.s;
    else out.push(seg.s);
    prevRaw = seg.s;
  }
  return out.map(clean).filter((s) => /[\p{L}\d]/u.test(s));
}

// ---------------------------------------------------------------------------------------------------------------
// Texterkennung (OCR) glätten

/** Zeichen, die die Texterkennung in Zahlen typischerweise verwechselt */
const OCR_DIGIT: Record<string, string> = { O: "0", o: "0", I: "1", l: "1", "|": "1" };
const fixDigits = (s: string) => s.replace(/[OoIl|]/g, (c) => OCR_DIGIT[c] ?? c);

/**
 * Typische Fehler der Texterkennung glätten: O/0 und l/1 in Zeiten und Planquadraten («O7I5» → 0715, «AGl3» → AG13,
 * «HO4» → H04), Trennungen am Zeilenende («Liefer-\nwagen» → Lieferwagen), doppelte Leerzeichen, typografische Zeichen.
 */
export interface CleanOcrOptions {
  /** gibt es das Planquadrat im Raster? («NA13» ist dann kein «NAI 3») */
  isCell?: (c: string) => boolean;
  /** Namen der NAI der Übung («NAI 3») */
  nai?: string[];
}

export function cleanOcr(text: string, opts: CleanOcrOptions = {}): string {
  let t = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[“”„]/g, '"')
    .replace(/[‚‘]/g, "'")
    .replace(/[—]/g, "–")
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl");
  // Trennung am Zeilenende: klein weiter → zusammen, gross weiter → mit Bindestrich («Nord-\nOst»)
  t = t.replace(/([\p{L}])[-¬]\n[ \t]*([\p{Ll}])/gu, "$1$2").replace(/([\p{L}])-\n[ \t]*([\p{Lu}])/gu, "$1-$2");
  t = t
    .split("\n")
    .map((line) =>
      line
        .replace(/ {2,}/g, " ")
        // Tabellenstrich als «l», «I», «[», «]» gelesen («0715 l H04 l 2 Fz»)
        .replace(/(?<=\S\s)[lI[\]](?=\s\S)/g, "|")
        .split(/(\s+)/)
        .map((tok) => fixToken(tok, opts))
        .join("")
        // «Rtg ©» → Rtg O, «AK7 ©/€» → AK7 C (Kreis-Zeichen statt Buchstabe)
        .replace(/\b(Rtg|nach|aus) ?[©®@](?=$|[\s,.;])/g, "$1 O")
        .replace(/\b([A-Z]{2}\d{1,2}) ?[©€¢](?=$|[\s,.;])/g, "$1 C")
        .replace(/[ ]+$/g, "")
        .replace(/^[ ]+/g, ""),
    )
    .join("\n");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

function fixToken(tok: string, opts: CleanOcrOptions): string {
  if (!tok || /^\s+$/.test(tok)) return tok;
  // Satzzeichen am Rand abtrennen
  const m = /^([("'«]*)(.*?)([)"'»,;:.!?]*)$/.exec(tok);
  if (!m) return tok;
  const [, pre, core, post] = m as unknown as [string, string, string, string];
  return pre + fixCore(core, opts) + post;
}

function fixCore(c: string, opts: CleanOcrOptions = {}): string {
  if (!c) return c;
  // «NA13», «NAl3», «NAI3» → NAI 3 (I als 1 gelesen, Leerschlag verschluckt) – ausser es gibt das Planquadrat «NA13»
  const na = /^NA[1Il|](\d{1,2})$/.exec(c);
  if (na) {
    const name = `NAI ${+na[1]!}`;
    if (c.startsWith("NAI") || opts.nai?.includes(name) || !opts.isCell?.(c)) return name;
  }
  // Zeit «O7I5», «O7:I5», «07.l5»
  if (/^[\dOoIl|]{4}$/.test(c) && /\d/.test(c) && /[OoIl|]/.test(c)) {
    const d = fixDigits(c);
    if (/^(?:[01]\d|2[0-3])[0-5]\d$/.test(d)) return d;
  }
  if (/^[\dOoIl|]{1,2}[:.][\dOoIl|]{2}$/.test(c) && /\d/.test(c) && /[OoIl|]/.test(c)) {
    const d = fixDigits(c);
    if (/^(?:[01]?\d|2[0-3])[:.][0-5]\d$/.test(d)) return d;
  }
  // Element «HO4», «H0l» → H04 / H01
  const h = /^H([\dOoIl|])([\dOoIl|])$/.exec(c);
  if (h && /[OoIl|]/.test(c) && /\d/.test(c)) return "H" + fixDigits(h[1]! + h[2]!);
  // Planquadrat «AGl3», «AGI3», «AG1O» (Buchstaben gross, dann Ziffern mit Verwechslungen; mind. eine echte Ziffer)
  const pq = /^([A-Z]{1,2})([\dOoIl|]{1,2})([A-D]?)$/.exec(c);
  if (pq && /[OoIl|]/.test(pq[2]!) && (/\d/.test(pq[2]!) || (pq[1]!.length === 2 && pq[2]!.length === 2 && /[lI|]/.test(pq[2]!)))) {
    const d = fixDigits(pq[2]!);
    if (/^[1-9]\d?$/.test(d)) return pq[1]! + d + pq[3]!;
  }
  // «AG 13» bleibt; «NAl», «NA1» → NAI
  if (/^NA[l1|]$/.test(c)) return "NAI";
  // Zahlen mit Verwechslungen in Koordinaten/Mengen «2'6OO'1OO», «1l99OOO»
  if (/^[\dOoIl|'’]+$/.test(c) && (c.match(/\d/g)?.length ?? 0) >= 3 && /[OoIl|]/.test(c) && c.length >= 5) return fixDigits(c);
  return c;
}
