import { inflateRawSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

export type PageBytes = {
  source: string;
  page: number;
  pages: number;
  fileName: string;
  contentType: string;
  bytes: Buffer;
};

const MAX_DEPTH = 3;

export function sniff(buf: Buffer): string | undefined {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return "application/zip";
  return undefined;
}

export function safeStem(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "page";
  const cleaned = base.replace(/[^\w.\- ]+/g, "").slice(0, 60) || "page";
  return cleaned.replace(/\.[^.]+$/, "") || "page";
}

export async function expandToPages(name: string, data: Buffer, depth = 0): Promise<PageBytes[]> {
  if (depth > MAX_DEPTH) throw new Error("ফাইলের ভিতরে আরেকটি ফাইল অনেক গভীরে।");
  const type = sniff(data);
  if (type === "application/pdf") return splitPdf(name, data);
  if (type === "image/jpeg" || type === "image/png" || type === "image/webp") {
    const ext = type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
    return [
      {
        source: name,
        page: 1,
        pages: 1,
        fileName: `${safeStem(name)}.${ext}`,
        contentType: type,
        bytes: data,
      },
    ];
  }
  if (type === "application/zip") {
    const entries = unzip(data);
    const pages: PageBytes[] = [];
    for (const entry of entries) {
      if (!sniff(entry.data)) continue;
      pages.push(...(await expandToPages(entry.name, entry.data, depth + 1)));
    }
    if (pages.length === 0) throw new Error("ZIP-এ কোনো পাতা নেই।");
    return pages;
  }
  throw new Error(`এই ফাইল এক পাতা করা যায় না: ${name}`);
}

async function splitPdf(name: string, data: Buffer): Promise<PageBytes[]> {
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(data, { ignoreEncryption: true });
  } catch {
    throw new Error(`পিডিএফ খোলা যায়নি: ${name}`);
  }
  const count = src.getPageCount();
  if (count < 1) throw new Error(`পিডিএফে কোনো পাতা নেই: ${name}`);
  const stem = safeStem(name);
  const pages: PageBytes[] = [];
  for (let i = 0; i < count; i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    const saved = Buffer.from(await doc.save({ useObjectStreams: false }));
    pages.push({
      source: name,
      page: i + 1,
      pages: count,
      fileName: count === 1 ? `${stem}.pdf` : `${stem}-p${String(i + 1).padStart(2, "0")}.pdf`,
      contentType: "application/pdf",
      bytes: saved,
    });
  }
  return pages;
}

export function unzip(data: Buffer): { name: string; data: Buffer }[] {
  const eocd = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > data.length) throw new Error("ZIP পড়া যায়নি।");
  const count = data.readUInt16LE(eocd + 10);
  let ptr = data.readUInt32LE(eocd + 16);
  if (count === 0xffff || ptr === 0xffffffff) throw new Error("এই ZIP খোলা যায় না।");
  const files: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    if (ptr + 46 > data.length || data.readUInt32LE(ptr) !== 0x02014b50) throw new Error("ZIP পড়া যায়নি।");
    const method = data.readUInt16LE(ptr + 10);
    const compSize = data.readUInt32LE(ptr + 20);
    const nameLen = data.readUInt16LE(ptr + 28);
    const extraLen = data.readUInt16LE(ptr + 30);
    const commentLen = data.readUInt16LE(ptr + 32);
    const localOff = data.readUInt32LE(ptr + 42);
    const name = data.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8").replace(/\\/g, "/");
    ptr += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || name.startsWith("/") || name.includes("..")) continue;
    if (name.startsWith("__MACOSX/") || name.endsWith(".DS_Store")) continue;
    if (localOff + 30 > data.length || data.readUInt32LE(localOff) !== 0x04034b50) throw new Error("ZIP পড়া যায়নি।");
    const localNameLen = data.readUInt16LE(localOff + 26);
    const localExtraLen = data.readUInt16LE(localOff + 28);
    const start = localOff + 30 + localNameLen + localExtraLen;
    const compressed = data.subarray(start, start + compSize);
    if (compressed.length !== compSize) throw new Error("ZIP পড়া যায়নি।");
    const bytes = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (!bytes) throw new Error(`ZIP এ এই ফাইল খোলা যায়নি: ${name}`);
    const base = name.split("/").pop();
    if (!base) continue;
    files.push({ name: base, data: bytes });
  }
  return files;
}
