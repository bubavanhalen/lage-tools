/**
 * Laufende Uhr für die Vorschau («jetzt 10:40»): springt zu jeder vollen Minute weiter (und beim Zurückkehren in
 * das Fenster). Die Zeit einer Meldung ohne Zeitangabe wird trotzdem erst beim Eintragen (Enter) festgelegt.
 */
import { useEffect, useState } from "react";

export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t: number | undefined;
    const tick = () => {
      setNow(new Date());
      const ms = 60000 - (Date.now() % 60000) + 50;
      t = window.setTimeout(tick, ms);
    };
    t = window.setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
    const vis = () => { if (document.visibilityState === "visible") setNow(new Date()); };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", vis);
    return () => { window.clearTimeout(t); document.removeEventListener("visibilitychange", vis); window.removeEventListener("focus", vis); };
  }, []);
  return now;
}
