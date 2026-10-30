// Fügt die gebauten Apps und die Startseite zu _site/ zusammen (für GitHub Pages)
// und ergänzt pro App Service Worker, Liste der Offline-Dateien und Manifest.
//
// MVP 3.5 (A2): die Zeitlimits des Service Workers kommen aus packages/core/src/entscheide.ts (SW_NETZ_TIMEOUT_MS,
// SW_KACHEL_TIMEOUT_MS) – nicht doppelt gepflegt. Nur Service Worker für eine schon gebaute App (z. B. die e2e-Kopie):
//   node scripts/assemble-site.mjs --sw <ordner der app> <app>     (z. B. apps/lagejournal/e2e/out/site/lagejournal lagejournal)
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Wurzel des Repos (unabhängig vom Arbeitsordner) */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

/** Zahl-Konstante aus entscheide.ts lesen (laut scheitern, wenn sie fehlt – nie still einen Standard nehmen) */
function entscheid(name) {
  const src = readFileSync(join(ROOT, "packages/core/src/entscheide.ts"), "utf8");
  const m = new RegExp(`export const ${name}\\s*=\\s*([\\d_]+)\\s*;`).exec(src);
  if (!m) throw new Error(`${name} fehlt in packages/core/src/entscheide.ts`);
  return Number(m[1].replace(/_/g, ""));
}
const SW_KONST = { __NETZ_MS__: entscheid("SW_NETZ_TIMEOUT_MS"), __KACHEL_MS__: entscheid("SW_KACHEL_TIMEOUT_MS") };

const APPS = {
  lagejournal: { name: "Lagejournal", short: "Lagejournal", desc: "Lageverfolgung im LVZ auf swisstopo-Karten mit Führungsraster" },
  uebungsauswertung: { name: "Übungsauswertung", short: "Auswertung", desc: "Journale Rot und Blau auswerten, AAR vorbereiten" },
};

/**
 * Dateien, die erst beim Einschalten geladen werden (nicht beim Installieren der App): Ordner pro App.
 * Der Service Worker legt sie beim ersten Gebrauch in einen eigenen Zwischenspeicher (siehe sw.template.js).
 */
const ON_DEMAND = {
  lagejournal: {
    // Texterkennung (tesseract.js): Worker, Kern (nur LSTM; Variante je nach Browser), Deutsch
    "ocr/": [
      ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
      ...["", "simd-", "relaxedsimd-"].map((v) => [`node_modules/tesseract.js-core/tesseract-core-${v}lstm.wasm.js`, `tesseract-core-${v}lstm.wasm.js`]),
      ["node_modules/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz", "deu.traineddata.gz"],
    ],
  },
};

/**
 * Wie ON_DEMAND, aber von Vite gebaut (Name mit Hash): Dateinamen-Anfang. Spracherkennung: ONNX-Laufzeit (WASM, 21 MB).
 * Gilt für beide Apps (die Übungsauswertung enthält dieselbe Oberfläche), sonst lädt die Installation 21 MB unnötig.
 */
const ON_DEMAND_ASSETS = { lagejournal: ["assets/ort-wasm-"], uebungsauswertung: ["assets/ort-wasm-"] };

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

/** Manifest, Liste der Offline-Dateien und Service Worker in den Ordner `dir` der App `app` schreiben */
function swFuer(dir, app) {
  const meta = APPS[app];
  if (!meta) throw new Error(`unbekannte App «${app}»`);
  const lazy = [...Object.keys(ON_DEMAND[app] ?? {}), ...(ON_DEMAND_ASSETS[app] ?? [])];
  writeFileSync(`${dir}/manifest.webmanifest`, JSON.stringify({
    name: meta.name, short_name: meta.short, description: meta.desc, lang: "de-CH",
    start_url: "./", scope: "./", display: "standalone", background_color: "#ffffff", theme_color: "#1d1d1d",
    icons: [192, 512].map((s) => ({ src: `../icons/icon-${s}.png`, sizes: `${s}x${s}`, type: "image/png", purpose: "any maskable" })),
  }, null, 1));
  const files = walk(dir).map((f) => relative(dir, f).split("\\").join("/")).filter((f) => !f.endsWith(".map") && f !== "sw.js" && f !== "precache.json" && !lazy.some((d) => f.startsWith(d)));
  const list = ["./", ...files.filter((f) => f !== "index.html"), "index.html", "../icons/icon-192.png", "../icons/icon-512.png"];
  const hash = createHash("sha256");
  for (const f of files) hash.update(f).update(readFileSync(join(dir, f)));
  const version = hash.digest("hex").slice(0, 12);
  writeFileSync(`${dir}/precache.json`, JSON.stringify(list));
  let sw = readFileSync("scripts/sw.template.js", "utf8").replace("__VERSION__", version).replace("__APP__", app);
  for (const [k, v] of Object.entries(SW_KONST)) sw = sw.replace(k, String(v));
  if (/__[A-Z_]+__/.test(sw)) throw new Error("sw.template.js: Platzhalter nicht ersetzt");
  writeFileSync(`${dir}/sw.js`, sw);
}

const nurSw = process.argv.indexOf("--sw");
if (nurSw >= 0) {
  const [dir, app] = process.argv.slice(nurSw + 1);
  if (!dir || !app || !existsSync(join(resolve(dir), "index.html"))) { console.error("Aufruf: node scripts/assemble-site.mjs --sw <ordner mit index.html> <app>"); process.exit(2); }
  swFuer(resolve(dir), app);
  console.log(`sw.js für ${app} in ${dir}`);
  process.exit(0);
}

const out = "_site";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync("site", out, { recursive: true });

for (const app of Object.keys(APPS)) {
  const dist = `apps/${app}/dist`;
  if (!existsSync(dist)) throw new Error(`${dist} fehlt – zuerst bauen`);
  const dir = `${out}/${app}`;
  cpSync(dist, dir, { recursive: true });
  for (const [sub, files] of Object.entries(ON_DEMAND[app] ?? {})) {
    mkdirSync(`${dir}/${sub}`, { recursive: true });
    for (const [from, to] of files) cpSync(from, `${dir}/${sub}${to}`);
  }
  swFuer(dir, app);
}
writeFileSync(`${out}/.nojekyll`, "");
console.log("_site/ bereit");
