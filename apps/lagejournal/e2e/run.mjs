#!/usr/bin/env node
/**
 * Abnahmetests Lagejournal (Spez. MVP 1, Kap. 7) – baut eine eigene Kopie der App, serviert sie statisch und lässt
 * die Specs mit Playwright laufen. Ergebnisse: apps/lagejournal/e2e/out/<spec>.json (+ Screenshots).
 *
 *   npm run e2e                              (Root oder apps/lagejournal)
 *   npm run e2e -- --port 9051 --nur inventar --ohne-build --echte-kacheln
 *
 * Optionen: --port N (Standard 9050) · --nur a,b (Specs) · --ohne-build (letzte Kopie in out/site verwenden) ·
 * --echte-kacheln (swisstopo laden; Standard: graue Ersatzkachel, schnell und ohne Netz).
 * Playwright: global installiert (require('playwright')), Chromium unter /opt/pw-browsers/chromium oder
 * PW_CHROMIUM=…; kein `playwright install` nötig. Node ≥ 22.18 (lädt die .ts-Specs ohne Übersetzer).
 * Exit-Code 1, wenn ein Test rot ist (rot ist während MVP 1 erlaubt; der Lauf selbst muss durchgehen).
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync, cpSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const ROOT = resolve(APP, "../..");
const OUT = join(HERE, "out");
const SITE = join(OUT, "site");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const port = +opt("--port", process.env.E2E_PORT ?? "9050");
const nur = opt("--nur", "")?.split(",").filter(Boolean) ?? [];
const ohneBuild = args.includes("--ohne-build");
const echteKacheln = args.includes("--echte-kacheln");

const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 22 || (maj === 22 && min < 18)) {
  console.error(`Node ${process.versions.node}: für die .ts-Specs braucht es Node ≥ 22.18 (Typen entfernen ohne Übersetzer).`);
  process.exit(2);
}

// ---------- Playwright (global) ----------
function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req("playwright"); } catch { /* weiter */ }
  const g = execSync("npm root -g", { encoding: "utf8" }).trim();
  return createRequire(join(g, "noop.js"))("playwright");
}
const { chromium } = loadPlaywright();
const CHROMIUM = process.env.PW_CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

// ---------- Build-Kopie ----------
mkdirSync(OUT, { recursive: true });
if (!ohneBuild || !existsSync(join(SITE, "lagejournal", "index.html"))) {
  console.log("Baue Kopie nach", join(SITE, "lagejournal"), "…");
  const r = spawnSync("npx", ["vite", "build", "--outDir", join(SITE, "lagejournal"), "--emptyOutDir", "--logLevel", "warn"], { cwd: APP, stdio: "inherit" });
  if (r.status !== 0) { console.error("Build fehlgeschlagen"); process.exit(2); }
  if (existsSync(join(ROOT, "site", "icons"))) cpSync(join(ROOT, "site", "icons"), join(SITE, "icons"), { recursive: true });
}

// ---------- statischer Server ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff": "font/woff", ".woff2": "font/woff2", ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json", ".map": "application/json", ".gz": "application/gzip", ".mp3": "audio/mpeg", ".onnx": "application/octet-stream" };
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let f = normalize(join(SITE, p));
  if (!f.startsWith(SITE)) { res.writeHead(403).end(); return; }
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  if (!existsSync(f)) { res.writeHead(404).end("nicht gefunden"); return; }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(f).pipe(res);
});
await new Promise((ok, err) => { server.once("error", err); server.listen(port, "127.0.0.1", ok); }).catch((e) => {
  console.error(`Port ${port} besetzt? (${e.code}) – anderen Port mit --port wählen.`); process.exit(2);
});
const BASE = `http://127.0.0.1:${port}/lagejournal/`;
console.log("App unter", BASE);

// graue Ersatzkachel 1×1 (Leaflet streckt sie)
const TILE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP48OEDAAWIAsMQ6c3eAAAAAElFTkSuQmCC", "base64");

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--disable-gpu", "--disable-gpu-compositing"] });

/** @type {import("./lib.ts").Harness} */
const harness = {
  base: BASE,
  out: OUT,
  log: (...a) => console.log("   ", ...a),
  async shot(page, name) {
    const f = join(OUT, name + ".png");
    mkdirSync(dirname(f), { recursive: true });
    await page.screenshot({ path: f, animations: "disabled" }).catch(() => {});
  },
  async open(o = {}) {
    const geraet = o.geraet ?? "laptop";
    const vp = geraet === "tablet" ? { width: 1024, height: 768 } : { width: 1440, height: 900 };
    const ctx = await browser.newContext({
      viewport: vp, deviceScaleFactor: 1, hasTouch: geraet === "tablet", serviceWorkers: "block",
      colorScheme: o.dunkel ? "dark" : "light", locale: "de-CH", timezoneId: "Europe/Zurich", acceptDownloads: true,
    });
    ctx.setDefaultTimeout(3000);
    const page = await ctx.newPage();
    const fehler = [], downloads = [];
    page.on("pageerror", (e) => fehler.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") fehler.push("console: " + m.text().slice(0, 200)); });
    page.on("download", (d) => downloads.push(d.suggestedFilename()));
    await page.addInitScript(({ aw, css, bereit }) => {
      window.L_DISABLE_3D = true;
      // Testhaken: Offline-Status «bereit» (Grundansicht wird im Zustand «Offline bereit» gezählt); Produkt unverändert
      if (bereit) window.__ltOfflineBereit = true;
      try { if (aw) localStorage.setItem("lage-tools.arbeitsweise", JSON.stringify(aw)); } catch { /* egal */ }
      if (css) document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); });
    }, { aw: o.arbeitsweise ?? null, css: o.css ?? null, bereit: o.offline !== "echt" });
    if (!echteKacheln) await page.route(/wmts.*\.geo\.admin\.ch|api3\.geo\.admin\.ch\/.*tile/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: TILE, headers: { "access-control-allow-origin": "*" } }));
    if (o.uhr) await page.clock.install({ time: o.uhr });
    await page.goto(BASE + (o.query ?? ""));
    await page.waitForSelector(".app", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return { page, geraet, fehler, downloads, close: () => ctx.close() };
  },
};

// ---------- Specs ----------
const specs = readdirSync(HERE).filter((f) => f.endsWith(".spec.ts")).sort().filter((f) => !nur.length || nur.includes(f.replace(/\.spec\.ts$/, "")));
let rot = 0;
const summary = [];
for (const f of specs) {
  const t0 = Date.now();
  console.log(`\n== ${f}`);
  let results;
  try {
    const mod = await import(pathToFileURL(join(HERE, f)).href);
    results = await mod.default.run(harness);
  } catch (e) {
    results = [{ name: "(Spec abgebrochen)", ok: false, fehler: String(e?.stack ?? e).slice(0, 1000) }];
  }
  for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.geraet ? ` [${r.geraet}]` : ""}${r.ok ? "" : ` – ${r.fehler ?? "nicht erfüllt"}`}`);
  const name = f.replace(/\.spec\.ts$/, "");
  const nRot = results.filter((r) => !r.ok).length;
  rot += nRot;
  summary.push({ spec: name, gruen: results.length - nRot, rot: nRot });
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ spec: name, am: new Date().toISOString(), dauer_ms: Date.now() - t0, basis: BASE, gruen: results.length - nRot, rot: nRot, tests: results }, null, 2));
}
writeFileSync(join(OUT, "zusammenfassung.json"), JSON.stringify({ am: new Date().toISOString(), specs: summary }, null, 2));
await browser.close();
server.close();
console.log(`\n${summary.map((s) => `${s.spec}: ${s.gruen} grün, ${s.rot} rot`).join(" · ")}\nErgebnisse: ${OUT}`);
process.exit(rot ? 1 : 0);
