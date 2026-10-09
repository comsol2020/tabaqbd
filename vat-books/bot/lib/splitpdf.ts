import { PDFDocument } from "pdf-lib";

export type UploadPage = { contentType: string; data: Buffer };

/** One image stays one page. A PDF becomes one PDF per page. A single-page PDF is kept as uploaded. */
export async function singlePages(contentType: string, data: Buffer): Promise<UploadPage[]> {
  if (contentType !== "application/pdf" && data.subarray(0, 5).toString() !== "%PDF-") {
    return [{ contentType, data }];
  }
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(data, { ignoreEncryption: true });
  } catch {
    throw new Error("পিডিএফ খোলা যায়নি।");
  }
  const count = src.getPageCount();
  if (count < 1) throw new Error("পিডিএফে কোনো পাতা নেই।");
  if (count === 1) return [{ contentType: "application/pdf", data }];
  const pages: UploadPage[] = [];
  for (let i = 0; i < count; i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    pages.push({
      contentType: "application/pdf",
      data: Buffer.from(await doc.save({ useObjectStreams: false })),
    });
  }
  return pages;
}

export function pageFileName(name: string, index: number, count: number): string {
  if (count === 1) return name;
  const stem = name.replace(/\.pdf$/i, "").replace(/\.+$/, "") || "page";
  const suffix = `-p${String(index).padStart(2, "0")}.pdf`;
  return `${stem.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`;
}
