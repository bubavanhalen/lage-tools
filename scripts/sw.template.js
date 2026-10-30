/*
 * Service Worker der Lage-Tools: App offline verfügbar, Kartenkacheln aus dem Zwischenspeicher.
 * MVP 3.5 (S4, A2): Seite «Netz zuerst» mit Zeitlimit (danach index.html aus dem Zwischenspeicher, eine spätere
 * Netzantwort wird verworfen – kein Neuladen); App-Dateien Zwischenspeicher zuerst; Kacheln Zwischenspeicher zuerst,
 * Netz mit Zeitlimit, dann 504. Die Zeitlimits setzt `scripts/assemble-site.mjs` aus `packages/core/src/entscheide.ts` ein.
 */
const VERSION = "__VERSION__";
const APP = "__APP__";
/** Seite aus dem Netz höchstens so lange (ms), dann aus dem Zwischenspeicher (SW_NETZ_TIMEOUT_MS) */
const NETZ_MS = __NETZ_MS__;
/** Kachel aus dem Netz höchstens so lange (ms), dann 504 (SW_KACHEL_TIMEOUT_MS) */
const KACHEL_MS = __KACHEL_MS__;

/** `fetch` mit Zeitlimit: null = Zeit abgelaufen (die Anfrage läuft im Hintergrund weiter, ihre Antwort wird verworfen) */
function mitZeitlimit(p, ms) {
  let t;
  return Promise.race([p.finally(() => clearTimeout(t)), new Promise((ok) => { t = setTimeout(() => ok(null), ms); })]);
}
const APP_CACHE = `lt-${APP}-${VERSION}`;
const TILE_CACHE = "lt-tiles-v1";
/** erst bei Gebrauch geladen (nicht beim Installieren): Ordner → Zwischenspeicher (gleich wie in der App) */
const ON_DEMAND = { "ocr/": "lt-ocr-v1", "assets/ort-wasm-": "lt-stt-v1" };

/**
 * «Cross-origin isolation» (für mehrere Threads in der Spracherkennung): GitHub Pages setzt keine eigenen
 * Kopfzeilen, deshalb ergänzt sie der Service Worker auf allen eigenen Antworten (Seite, Worker, WASM).
 * COEP «credentialless»: fremde Bilder/Kacheln ohne Cookies laden statt sperren (swisstopo funktioniert weiter).
 * Safari kennt «credentialless» nicht → dort ohne Isolation, Spracherkennung mit einem Thread.
 */
function isolate(res) {
  if (!res || res.type === "opaque" || res.type === "opaqueredirect" || res.status === 0) return res;
  const h = new Headers(res.headers);
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Embedder-Policy", "credentialless");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener("install", (ev) => {
  ev.waitUntil((async () => {
    const list = await (await fetch("precache.json", { cache: "no-store" })).json();
    const c = await caches.open(APP_CACHE);
    await c.addAll(list.map((p) => new Request(p, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(`lt-${APP}-`) && k !== APP_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Kartenkacheln: zuerst Zwischenspeicher, sonst laden und ablegen
  if (url.hostname === "wmts.geo.admin.ch") {
    ev.respondWith((async () => {
      const c = await caches.open(TILE_CACHE);
      const hit = await c.match(req.url);
      if (hit) return hit;
      try {
        // ohne Cookies (passt zu COEP «credentialless»; Kacheln brauchen keine)
        const net = fetch(req.mode === "cors" ? new Request(req, { credentials: "omit" }) : new Request(req.url, { mode: "no-cors", credentials: "omit" }));
        const res = await mitZeitlimit(net, KACHEL_MS);
        if (!res) return new Response("", { status: 504, statusText: "Zeitlimit" });
        if (res.ok) c.put(req.url, res.clone());
        return res;
      } catch (e) {
        return new Response("", { status: 504, statusText: "offline" });
      }
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Texterkennung u. ä.: zuerst Zwischenspeicher, sonst laden und ablegen (bleibt über App-Updates)
  const scope = new URL(self.registration.scope).pathname;
  const lazy = Object.keys(ON_DEMAND).find((d) => url.pathname.startsWith(scope + d));
  if (lazy) {
    ev.respondWith((async () => {
      const c = await caches.open(ON_DEMAND[lazy]);
      const hit = await c.match(url.href, { ignoreSearch: true });
      if (hit) return isolate(hit);
      const res = await fetch(req);
      if (res.ok) {
        // Dateiname mit Hash (z. B. Spracherkennung): ältere Fassung desselben Namens freigeben
        if (!lazy.endsWith("/")) for (const k of await c.keys()) if (new URL(k.url).pathname.startsWith(scope + lazy) && k.url !== url.href) await c.delete(k);
        c.put(url.href, res.clone());
      }
      return isolate(res);
    })());
    return;
  }
  ev.respondWith((async () => {
    const c = await caches.open(APP_CACHE);
    if (req.mode === "navigate") {
      // Netz zuerst, aber höchstens NETZ_MS: bei schwachem Netz startet die App aus dem Zwischenspeicher (≤ 4 s)
      try {
        const res = await mitZeitlimit(fetch(req), NETZ_MS);
        if (res && res.ok) return isolate(res);
      } catch { /* offline */ }
      const off = (await c.match("./index.html")) ?? (await c.match("./"));
      if (off) return isolate(off);
      // nichts im Zwischenspeicher (erster Start): doch auf das Netz warten
      try { return isolate(await fetch(req)); } catch { return Response.error(); }
    }
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return isolate(hit);
    return isolate(await fetch(req));
  })());
});
