// Fügt die gebauten Apps und die Startseite zu _site/ zusammen (für GitHub Pages).
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";

const out = "_site";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync("site", out, { recursive: true });
for (const app of ["lagejournal", "uebungsauswertung"]) {
  const dist = `apps/${app}/dist`;
  if (!existsSync(dist)) throw new Error(`${dist} fehlt – zuerst bauen`);
  cpSync(dist, `${out}/${app}`, { recursive: true });
}
writeFileSync(`${out}/.nojekyll`, "");
console.log("_site/ bereit");
