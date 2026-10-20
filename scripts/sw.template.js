/* Service Worker der Lage-Tools: App offline verfügbar, Kartenkacheln aus dem Zwischenspeicher. */
const VERSION = "__VERSION__";
const APP = "__APP__";
const APP_CACHE = `lt-${APP}-${VERSION}`;
const TILE_CACHE = "lt-tiles-v1";

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
