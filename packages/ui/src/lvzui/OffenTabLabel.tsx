/**
 * Beschriftung des Umschalter-Teils «Offen n» (Spez. MVP 3, Kap. 3.7, E10): Zahl der LVZ-Punkte (ohne Hinweise),
 * neutral in Tinte, einmaliges Aufleuchten bei Zunahme (wie «Was Rot»), kein Ton.
 */
import { useEffect, useRef, useState } from "react";
import "./lvzui.css";

export function OffenTabLabel({ n }: { n: number }) {
  const prev = useRef(n);
  const [pulse, setPulse] = useState(0);
  useEffect(() => { if (n > prev.current) setPulse((x) => x + 1); prev.current = n; }, [n]);
  return (
    <>
      <span className="of-tab-l">Offen</span>
      {n > 0 && <>{" "}<span key={pulse} className={"red-badge of-badge" + (pulse ? " pulse" : "")}>{n}</span></>}
    </>
  );
}
