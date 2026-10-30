/**
 * App installieren (Spez. MVP 3.5, A4) – Phase 0: fängt `beforeinstallprompt` beim Laden des Moduls ab (Workspace
 * importiert es früh, damit das Ereignis nicht verloren geht) und erkennt iOS und den installierten Zustand.
 * Paket A zeigt «App installieren» bzw. die Anleitung «Zum Home-Bildschirm» im Offline-Popover.
 */
export type InstallWeg = "prompt" | "ios" | "manuell" | "fertig";

interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice?: Promise<{ outcome: "accepted" | "dismissed" }> }

let aufgeschoben: InstallPrompt | null = null;
const hoerer = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); aufgeschoben = e as InstallPrompt; for (const h of hoerer) h(); });
  window.addEventListener("appinstalled", () => { aufgeschoben = null; for (const h of hoerer) h(); });
}

/** iPhone/iPad (auch iPadOS mit Desktop-Kennung «MacIntel» und Touch) */
export function istIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** als App geöffnet (Home-Bildschirm / installiert) */
export function istInstalliert(): boolean {
  try {
    if (matchMedia("(display-mode: standalone)").matches) return true;
  } catch { /* alter Browser */ }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Weg zur Installation auf diesem Gerät */
export function installWeg(): InstallWeg {
  if (istInstalliert()) return "fertig";
  if (aufgeschoben) return "prompt";
  return istIos() ? "ios" : "manuell";
}

/** «App installieren» (Benutzergeste): true = angenommen */
export async function installieren(): Promise<boolean> {
  const p = aufgeschoben;
  if (!p) return false;
  await p.prompt();
  const r = await p.userChoice?.catch(() => null);
  aufgeschoben = null;
  for (const h of hoerer) h();
  return r?.outcome === "accepted";
}

/** benachrichtigt bei neuem `beforeinstallprompt` / Installation; gibt das Abmelden zurück */
export function onInstallWeg(h: () => void): () => void {
  hoerer.add(h);
  return () => hoerer.delete(h);
}
