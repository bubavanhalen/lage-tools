/* Service Worker der Lage-Tools: App offline verfügbar, Kartenkacheln aus dem Zwischenspeicher. */
const VERSION = "__VERSION__";
const APP = "__APP__";
const APP_CACHE = `lt-${APP}-${VERSION}`;
const TILE_CACHE = "lt-tiles-v1";
/** erst bei Gebrauch geladen (nicht beim Installieren): Ordner → Zwischenspeicher (gleich wie in der App) */
const ON_DEMAND = { "ocr/": "lt-ocr-v1", "assets/ort-wasm-": "lt-stt-v1" };

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
        const res = await fetch(req);
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
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {
        // Dateiname mit Hash (z. B. Spracherkennung): ältere Fassung desselben Namens freigeben
        if (!lazy.endsWith("/")) for (const k of await c.keys()) if (new URL(k.url).pathname.startsWith(scope + lazy) && k.url !== url.href) await c.delete(k);
        c.put(url.href, res.clone());
      }
      return res;
    })());
    return;
  }
  ev.respondWith((async () => {
    const c = await caches.open(APP_CACHE);
    if (req.mode === "navigate") {
      try {
        const res = await fetch(req);
        if (res.ok) return res;
      } catch { /* offline */ }
      return (await c.match("./index.html")) ?? (await c.match("./")) ?? Response.error();
    }
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return fetch(req);
  })());
});
