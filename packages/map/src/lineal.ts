/**
 * Raster-Lineal am Bildschirmrand (Spez. MVP 3.5, B3, Wireframe 2.1/2.5): Liegt der beschriftete obere bzw. linke Rand
 * des Raster-Blatts ausserhalb des Kartenausschnitts, zeigt ein Band oben die Spaltenbuchstaben und links die
 * Zeilenzahlen – jeweils in der Mitte jeder sichtbaren Spalte/Zeile. Band 22 px (Präsentation 28 px), Plex Mono 12 px
 * 600 (Präsentation 16 px), Hintergrund `--surface` 92 %, nachts dunkel. Bei Spalten < 18 px jede 2., < 9 px jede
 * 5. Beschriftung. Mehrere Blätter: das Blatt unter der Bildmitte (sonst das mit der grössten sichtbaren Fläche).
 * Leaflet-Pane `lt-lineal` direkt im Kartencontainer (bewegt sich nicht mit der Karte), `pointer-events: none`;
 * Neuberechnung bei `move` gedrosselt per `requestAnimationFrame` (`linealOf` in rasterlayer.ts). Diese Datei rechnet
 * ohne Leaflet (Test `map/test/lineal.test.ts`).
 */

/** Blatt in Containerpixeln */
export interface LinealBlatt {
  cols: readonly string[];
  rows: readonly string[];
  /** linke obere Ecke des Blatts (Containerpixel) */
  x0: number;
  y0: number;
  /** Feldbreite/-höhe in px */
  cw: number;
  ch: number;
}
export interface LinealEintrag { text: string; pos: number }
export interface LinealBild {
  /** Band oben: Spaltenbuchstaben (x = Mitte), Band von x0 bis x1; null = kein Band */
  oben: { von: number; bis: number; eintraege: LinealEintrag[] } | null;
  /** Band links: Zeilenzahlen (y = Mitte), Band von y0 bis y1 */
  links: { von: number; bis: number; eintraege: LinealEintrag[] } | null;
  band: number;
}

/** Ausdünnung: jede wievielte Beschriftung (Feld < 18 px jede 2., < 9 px jede 5.) */
export const linealSchritt = (px: number): number => (px < 9 ? 5 : px < 18 ? 2 : 1);

/**
 * Was zeigt das Lineal? `W`×`H` = Kartengrösse, `band` = Bandbreite in px, `fs` = Schriftgrösse.
 * Der Rand des Blatts gilt als «im Bild», wenn seine Randbeschriftung (rasterlayer: Abstand max(0.45 × Feld, 12 px)
 * ausserhalb der Feldlinie) ganz sichtbar ist.
 */
export function linealBild(b: LinealBlatt, W: number, H: number, band = 22, fs = 12): LinealBild {
  const nc = b.cols.length, nr = b.rows.length;
  const left = b.x0, top = b.y0, right = b.x0 + nc * b.cw, bottom = b.y0 + nr * b.ch;
  const leer: LinealBild = { oben: null, links: null, band };
  if (!nc || !nr || right <= 0 || left >= W || bottom <= 0 || top >= H) return leer;
  // Randbeschriftung oben: Mitte bei top − max(0.45 ch, 12); sichtbar, wenn ihre obere Kante im Bild ist
  const offV = Math.max(0.45 * b.ch, 12);
  const obenFehlt = top - offV - fs / 2 < 0;
  // links: Mitte bei left − max(0.45 cw, rowW/2 + 7); sichtbar, wenn die linke Kante im Bild ist
  const rowW = Math.max(...b.rows.map((s) => s.length)) * fs * 0.62;
  const offH = Math.max(0.45 * b.cw, rowW / 2 + 7);
  const linksFehlt = left - offH - rowW / 2 < 0;
  // ein Band lohnt nur, wenn vom Blatt genug im Bild ist (mehr als das Band selbst)
  const oben = obenFehlt && bottom > band * 1.5 && right > band;
  const links = linksFehlt && right > band * 1.5 && bottom > band;
  const out: LinealBild = { oben: null, links: null, band };
  if (oben) {
    const st = linealSchritt(b.cw);
    const min = (links ? band : 0) + fs * 0.6, max = W - fs * 0.6;
    const e: LinealEintrag[] = [];
    for (let c = 0; c < nc; c += 1) {
      if (c % st) continue;
      const x = left + (c + 0.5) * b.cw;
      if (x >= min && x <= max) e.push({ text: b.cols[c]!, pos: x });
    }
    out.oben = { von: Math.max(0, left), bis: Math.min(W, right), eintraege: e };
  }
  if (links) {
    const st = linealSchritt(b.ch);
    const min = (oben ? band : 0) + fs * 0.6, max = H - fs * 0.6;
    const e: LinealEintrag[] = [];
    for (let r = 0; r < nr; r += 1) {
      if (r % st) continue;
      const y = top + (r + 0.5) * b.ch;
      if (y >= min && y <= max) e.push({ text: b.rows[r]!, pos: y });
    }
    out.links = { von: Math.max(0, top), bis: Math.min(H, bottom), eintraege: e };
  }
  return out;
}

/** Blatt für das Lineal: unter der Bildmitte, sonst die grösste sichtbare Fläche */
export function linealBlattWahl(bl: readonly LinealBlatt[], W: number, H: number): number {
  let best = -1, area = 0;
  for (let i = 0; i < bl.length; i++) {
    const b = bl[i]!;
    const r = b.x0 + b.cols.length * b.cw, u = b.y0 + b.rows.length * b.ch;
    if (b.x0 <= W / 2 && r >= W / 2 && b.y0 <= H / 2 && u >= H / 2) return i;
    const a = Math.max(0, Math.min(W, r) - Math.max(0, b.x0)) * Math.max(0, Math.min(H, u) - Math.max(0, b.y0));
    if (a > area) { area = a; best = i; }
  }
  return best;
}

