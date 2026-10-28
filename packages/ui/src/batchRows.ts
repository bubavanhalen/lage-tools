/**
 * Zeilen der Prüfung mehrerer Meldungen (BatchReview) – ohne Browser testbar.
 */
export interface BatchItem {
  text: string;
  /** Herkunft für Anzeige, z. B. «Foto 07:12, Zeile 3» */
  origin?: string;
  /** Vorschlag der KI (Handschrift) */
  ki?: boolean;
  /** unsichere Teile (KI bzw. Prüfung) – solche KI-Zeilen sind nicht vorab angehakt */
  unsicher?: string[];
}

export interface BatchRow { key: number; text: string; origin?: string; doubt?: string[]; on: boolean; state: "offen" | "eingetragen" | "verworfen" }

/** Zeilen zu Beginn: unsichere KI-Zeilen sind nicht angehakt («bitte prüfen»), «Alle übernehmen» nimmt sie nicht mit */
export function initialRows(items: BatchItem[]): BatchRow[] {
  return items.map((it, i) => {
    const doubt = it.unsicher?.length ? it.unsicher : undefined;
    return { key: i, text: it.text, origin: it.origin, doubt, on: !(it.ki && doubt), state: "offen" as const };
  });
}

/** Prüfung meldet einen PQ, der nicht aus der Meldung stammt bzw. nicht im Raster liegt → Ort nur vermutet */
export const pqDoubt = (unsicher?: string[]) => unsicher?.find((u) => /^PQ .*(steht nicht in der Meldung|nicht im Raster)/.test(u));
