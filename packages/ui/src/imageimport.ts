/**
 * Bilder aus Dateien holen: Bild, PDF (jede Seite) oder Word (eingebettete Bilder).
 * Alles im Browser, offline.
 */
export interface Candidate {
  name: string;
  canvas: HTMLCanvasElement;
}

const MAX_SIDE = 3000;

function toCanvas(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  const cv = document.createElement("canvas");
  cv.width = Math.round(w * s);
  cv.height = Math.round(h * s);
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}

async function fromBlob(blob: Blob, name: string): Promise<Candidate | null> {
  try {
    const bmp = await createImageBitmap(blob);
    return { name, canvas: toCanvas(bmp, bmp.width, bmp.height) };
  } catch {
    return null;
  }
}

async function fromPdf(file: File): Promise<Candidate[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: Candidate[] = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 12); i++) {
    const page = await pdf.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(4, MAX_SIDE / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale });
    const cv = document.createElement("canvas");
    cv.width = Math.round(vp.width);
    cv.height = Math.round(vp.height);
    await page.render({ canvas: cv, canvasContext: cv.getContext("2d")!, viewport: vp }).promise;
    out.push({ name: `${file.name} – Seite ${i}`, canvas: cv });
  }
  return out;
}

async function fromDocx(file: File): Promise<Candidate[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const media = Object.values(zip.files).filter((f) => /^word\/media\/.+\.(png|jpe?g|gif|bmp|webp)$/i.test(f.name));
  const out: Candidate[] = [];
  for (const f of media) {
    const c = await fromBlob(await f.async("blob"), `${file.name} – ${f.name.split("/").pop()}`);
    if (c && c.canvas.width > 150 && c.canvas.height > 150) out.push(c);
  }
  return out;
}

export async function candidatesFromFile(file: File): Promise<Candidate[]> {
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf") || file.type === "application/pdf") return fromPdf(file);
  if (n.endsWith(".docx")) return fromDocx(file);
  const c = await fromBlob(file, file.name);
  return c ? [c] : [];
}

export function imageDataOf(cv: HTMLCanvasElement): ImageData {
  return cv.getContext("2d")!.getImageData(0, 0, cv.width, cv.height);
}
