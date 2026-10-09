import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { diskDir, openDisk } from "../../../vat-books/bot/lib/disk.js";
import { listUploads, saveUpload, uploadFile } from "../../../vat-books/bot/lib/uploads.js";
import { normalizeBin } from "../../../vat-books/bot/lib/vat.js";
import { expandToPages, sniff, type PageBytes } from "./pages.js";

export type DeliveredPage = {
  source: string;
  page: number;
  pages: number;
  fileName: string;
  path: string;
  uploadId: string;
  status: "pending";
  duplicate: boolean;
};

export function dataDir(): string {
  return diskDir();
}

export function inside(root: string, rel: string): string {
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, rel);
  const relTo = path.relative(rootResolved, resolved);
  if (relTo.startsWith("..") || path.isAbsolute(relTo)) throw new Error("ফাইল ওয়ার্কস্পেসের বাইরে।");
  return resolved;
}

export async function deliverPages(input: {
  workspaceDir: string;
  dataDir: string;
  bin: string;
  paths: string[];
}): Promise<{ bin: string; pages: DeliveredPage[] }> {
  if (input.paths.length === 0) throw new Error("কোনো ফাইল দেওয়া হয়নি।");
  const bin = normalizeBin(input.bin);
  const sources = await readSources(input.workspaceDir, input.paths);
  const expanded: PageBytes[] = [];
  for (const source of sources) expanded.push(...(await expandToPages(source.name, source.data)));
  const written = await writePages(input.workspaceDir, expanded);
  const kv = openDisk(input.dataDir);
  const seen = await hashes(input.dataDir, bin);
  const pages: DeliveredPage[] = [];
  for (const page of written) {
    const hash = crypto.createHash("sha256").update(page.bytes).digest("hex");
    const existing = seen.get(hash);
    if (existing) {
      pages.push({ ...page.meta, uploadId: existing, status: "pending", duplicate: true });
      continue;
    }
    const saved = await saveUpload(kv, input.dataDir, {
      bin,
      fileName: page.meta.fileName,
      contentType: page.contentType,
      data: page.bytes,
    });
    seen.set(hash, saved.id);
    pages.push({ ...page.meta, uploadId: saved.id, status: "pending", duplicate: false });
  }
  return { bin, pages };
}

async function readSources(workspaceDir: string, paths: string[]): Promise<{ name: string; data: Buffer }[]> {
  const out: { name: string; data: Buffer }[] = [];
  for (const rel of paths) {
    const abs = inside(workspaceDir, rel);
    const stat = await fs.stat(abs).catch(() => undefined);
    if (!stat) throw new Error(`ফাইল পাওয়া যায়নি: ${rel}`);
    if (stat.isDirectory()) {
      const names = await fs.readdir(abs);
      for (const name of names) {
        const child = path.join(abs, name);
        const childStat = await fs.stat(child);
        if (!childStat.isFile()) continue;
        const data = await fs.readFile(child);
        if (!sniff(data)) continue;
        out.push({ name, data });
      }
      continue;
    }
    out.push({ name: path.basename(abs), data: await fs.readFile(abs) });
  }
  if (out.length === 0) throw new Error("পাঠানোর মতো কোনো ফাইল নেই।");
  return out;
}

async function writePages(
  workspaceDir: string,
  pages: PageBytes[],
): Promise<{ meta: Omit<DeliveredPage, "uploadId" | "status" | "duplicate">; bytes: Buffer; contentType: string }[]> {
  const dir = path.join(workspaceDir, "pages");
  await fs.mkdir(dir, { recursive: true });
  const written = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const fileName = `${String(i + 1).padStart(2, "0")}-${page.fileName}`;
    const abs = path.join(dir, fileName);
    await fs.writeFile(abs, page.bytes);
    written.push({
      meta: {
        source: page.source,
        page: page.page,
        pages: page.pages,
        fileName,
        path: path.relative(workspaceDir, abs),
      },
      bytes: page.bytes,
      contentType: page.contentType,
    });
  }
  return written;
}

async function hashes(dir: string, bin: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const rows = await listUploads(openDisk(dir), bin);
  for (const row of rows) {
    try {
      const buf = await fs.readFile(uploadFile(dir, row.id));
      map.set(crypto.createHash("sha256").update(buf).digest("hex"), row.id);
    } catch {
      // a missing file cannot match a new page
    }
  }
  return map;
}
