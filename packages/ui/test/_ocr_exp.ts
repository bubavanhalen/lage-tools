// Versuch (nicht einchecken): Aufbereitung + tesseract in Node
import sharp from "sharp";
import { createWorker, PSM } from "tesseract.js";
import * as P from "../src/photo";
import { ocrToMeldungen } from "../src/ocr";
import { demoExercise, findCells } from "@lage/core";
const [img, mode = "gray", lang = "best", outPng] = process.argv.slice(2);
const MY = "/tmp/claude-0/-home-claude/73cd496a-e443-5e08-bd1b-a4c0a2b0800b/scratchpad/4b-foto";
(async () => {
  const { data, info } = await sharp(img).rotate().resize(2000, 2000, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = new Uint8ClampedArray(info.width * info.height * 4);
  for (let i = 0, j = 0; i < info.width * info.height; i++, j += 3) { rgba[i * 4] = data[j]; rgba[i * 4 + 1] = data[j + 1]; rgba[i * 4 + 2] = data[j + 2]; rgba[i * 4 + 3] = 255; }
  let g = P.toGray(rgba, info.width, info.height);
  const t0 = Date.now();
  const q = P.findPaper(g);
  if (q) { const s = P.quadSize(q); const k = Math.min(2, +(process.env.KW ?? 2200) / Math.max(s.w, s.h)); g = P.warpQuad(g, q, Math.round(s.w * k), Math.round(s.h * k)); }
  const out = (P as any).prepareForOcrMode ? (P as any).prepareForOcrMode(g, mode) : P.prepareForOcr(g);
  console.error("Aufbereitung", Date.now() - t0, "ms", q ? "Papier gefunden" : "kein Papier");
  const png = await sharp(Buffer.from(out.d), { raw: { width: out.w, height: out.h, channels: 1 } }).png().toBuffer();
  if (outPng) await sharp(png).toFile(outPng);
  const w = await createWorker("deu", 1, { langPath: `${MY}/lang/${lang}`, gzip: true, cacheMethod: "none" });
  await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1", user_defined_dpi: "300" });
  const r = await w.recognize(png, {}, { text: true, blocks: true });
  console.log(`conf ${r.data.confidence.toFixed(0)}\n` + r.data.blocks!.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.map((l) => `${l.confidence.toFixed(0).padStart(3)} | ${l.words.map((x) => `${x.text}(${x.confidence.toFixed(0)})`).join(" ")}`))).join("\n"));
  const lines = r.data.blocks!.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)).map((l) => ({ text: l.words.filter((w) => w.text.trim() && (w.confidence >= 45 || (w.confidence >= 15 && /^[\p{L}\d]{2,}$/u.test(w.text)))).map((w) => w.text).join(" "), l })).filter((x) => /[\p{L}\d]{2}/u.test(x.text));
  const ex = demoExercise();
  console.log("---\n" + ocrToMeldungen(lines.map((x) => x.text).join("\n"), (c) => findCells(c, ex.sheets).length > 0).join("\n"));
  await w.terminate();
})();
