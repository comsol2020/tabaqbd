import { createCanvas } from "@napi-rs/canvas";
import { getDocument, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { singlePages, type UploadPage } from "./splitpdf.js";

/** Files above this are reduced to a smaller JPEG per page. At or below it, bytes stay as uploaded. */
export const SHRINK_OVER = 8 * 1024 * 1024;

const MAX_EDGE = 2000;
const PAGE_BUDGET = 1_500_000;

export async function prepareUpload(contentType: string, data: Buffer): Promise<UploadPage[]> {
  if (data.length <= SHRINK_OVER) return singlePages(contentType, data);
  if (contentType === "application/pdf" || data.subarray(0, 5).toString() === "%PDF-") return shrinkPdf(data);
  return [{ contentType: "image/jpeg", data: await shrinkImage(data) }];
}

async function shrinkImage(data: Buffer): Promise<Buffer> {
  let edge = MAX_EDGE;
  let quality = 82;
  let best = data;
  for (let attempt = 0; attempt < 4; attempt++) {
    const out = await sharp(data, { failOn: "none" })
      .rotate()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (out.length < best.length) best = out;
    if (best.length <= PAGE_BUDGET) return best;
    edge = Math.round(edge * 0.75);
    quality = Math.max(55, quality - 10);
  }
  if (best.length >= data.length) throw new Error("ফাইল ছোট করা যায়নি।");
  return best;
}

async function shrinkPdf(data: Buffer): Promise<UploadPage[]> {
  const doc = await getDocument({
    data: new Uint8Array(data),
    disableWorker: true,
    isEvalSupported: false,
  } as Parameters<typeof getDocument>[0]).promise;
  try {
    const count = doc.numPages;
    if (count < 1) throw new Error("পিডিএফে কোনো পাতা নেই।");
    const pages: UploadPage[] = [];
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      try {
        pages.push({ contentType: "image/jpeg", data: await renderPage(page) });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

async function renderPage(page: PDFPageProxy): Promise<Buffer> {
  let edge = MAX_EDGE;
  let quality = 82;
  let best: Buffer | undefined;
  const base = page.getViewport({ scale: 1 });
  const long = Math.max(base.width, base.height) || 1;
  for (let attempt = 0; attempt < 3; attempt++) {
    const scale = Math.min(2, edge / long);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
    const out = canvas.toBuffer("image/jpeg", quality);
    if (!best || out.length < best.length) best = out;
    if (best.length <= PAGE_BUDGET) return best;
    edge = Math.round(edge * 0.75);
    quality = Math.max(55, quality - 10);
  }
  if (!best) throw new Error("ফাইল ছোট করা যায়নি।");
  return best;
}
