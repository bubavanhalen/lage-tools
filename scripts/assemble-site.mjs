// Fügt die gebauten Apps und die Startseite zu _site/ zusammen (für GitHub Pages)
// und ergänzt pro App Service Worker, Liste der Offline-Dateien und Manifest.
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

const out = "_site";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync("site", out, { recursive: true });

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

/** Wie ON_DEMAND, aber von Vite gebaut (Name mit Hash): Dateinamen-Anfang. Spracherkennung: ONNX-Laufzeit (WASM, 21 MB). */
const ON_DEMAND_ASSETS = { lagejournal: ["assets/ort-wasm-"] };

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

for (const [app, meta] of Object.entries(APPS)) {
  const dist = `apps/${app}/dist`;
  if (!existsSync(dist)) throw new Error(`${dist} fehlt – zuerst bauen`);
  const dir = `${out}/${app}`;
  cpSync(dist, dir, { recursive: true });
  const lazy = [...Object.keys(ON_DEMAND[app] ?? {}), ...(ON_DEMAND_ASSETS[app] ?? [])];
  for (const [sub, files] of Object.entries(ON_DEMAND[app] ?? {})) {
    mkdirSync(`${dir}/${sub}`, { recursive: true });
    for (const [from, to] of files) cpSync(from, `${dir}/${sub}${to}`);
  }
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
  writeFileSync(`${dir}/sw.js`, readFileSync("scripts/sw.template.js", "utf8").replace("__VERSION__", version).replace("__APP__", app));
}
writeFileSync(`${out}/.nojekyll`, "");
console.log("_site/ bereit");
