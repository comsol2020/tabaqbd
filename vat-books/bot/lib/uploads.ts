import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { asJson } from "./disk.js";
import type { Kv } from "./store.js";
import { isIsoDate } from "./vat.js";

const UPLOADS = "uploads";

export type UploadStatus = "pending" | "confirmed" | "posted";

export type UploadMeta = {
  id: string;
  bin: string;
  fileName: string;
  contentType: string;
  bytes: number;
  status: UploadStatus;
  createdAt: string;
  /** Operator-chosen bill date for a manual entry. Absent on a normal importer upload. */
  entryDate?: string;
  confirmedAt?: string;
  postedAt?: string;
  boeKey?: string;
};

export function pdfPageCount(buf: Buffer): number {
  const text = buf.toString("latin1");
  const marked = text.match(/\/Type\s*\/Page(?!s)\b/g);
  if (marked && marked.length > 0) return marked.length;
  let max = 0;
  const dicts = text.match(/<<[^>]{0,500}>>/g) ?? [];
  for (const dict of dicts) {
    if (!/\/Type\s*\/Pages\b/.test(dict)) continue;
    const count = /\/Count\s+(\d+)/.exec(dict);
    const n = count ? Number(count[1]) : 0;
    if (n > max) max = n;
  }
  return max;
}

export function assertSinglePage(contentType: string, buf: Buffer): void {
  if (contentType !== "application/pdf" && buf.subarray(0, 5).toString() !== "%PDF-") return;
  const pages = pdfPageCount(buf);
  if (pages > 1) {
    throw new Error("এক পাতা করে আপলোড করুন। এই পিডিএফে একাধিক পাতা আছে।");
  }
}

export async function listUploads(kv: Kv, bin?: string): Promise<UploadMeta[]> {
  const value = await kv.get(UPLOADS);
  const all = Array.isArray(value) ? value.filter(isUpload) : [];
  const rows = bin ? all.filter((row) => row.bin === bin) : all;
  return rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveUpload(
  kv: Kv,
  dir: string,
  input: { bin: string; fileName: string; contentType: string; data: Buffer; entryDate?: string },
): Promise<UploadMeta> {
  assertSinglePage(input.contentType, input.data);
  const entryDate = input.entryDate?.trim();
  if (entryDate && !isIsoDate(entryDate)) throw new Error("তারিখ YYYY-MM-DD হতে হবে।");
  const id = crypto.randomBytes(16).toString("hex");
  const meta: UploadMeta = {
    id,
    bin: input.bin,
    fileName: input.fileName.slice(0, 120),
    contentType: input.contentType,
    bytes: input.data.length,
    status: "pending",
    createdAt: new Date().toISOString(),
    ...(entryDate ? { entryDate } : {}),
  };
  await fs.mkdir(path.join(dir, "uploads"), { recursive: true });
  await fs.writeFile(uploadFile(dir, id), input.data);
  const all = await listUploads(kv);
  await kv.put(UPLOADS, asJson([meta, ...all]));
  return meta;
}

export async function confirmUpload(kv: Kv, id: string): Promise<UploadMeta> {
  const all = await listUploads(kv);
  const upload = all.find((row) => row.id === id);
  if (!upload) throw new Error(`No upload ${id}.`);
  if (upload.status === "pending") {
    upload.status = "confirmed";
    upload.confirmedAt = new Date().toISOString();
    await kv.put(UPLOADS, asJson(all));
  }
  return upload;
}

export async function assertUploadForSave(
  kv: Kv,
  id: string,
  bin: string,
  allowPosted: boolean,
): Promise<UploadMeta> {
  const all = await listUploads(kv);
  const upload = all.find((row) => row.id === id);
  if (!upload) throw new Error(`No upload ${id}.`);
  if (upload.bin !== bin) throw new Error(`Upload ${id} belongs to another BIN.`);
  if (upload.status === "pending") {
    throw new Error(`Upload ${id} is not confirmed. It stays out of the books until the operator confirms it.`);
  }
  if (upload.status === "posted" && !allowPosted) {
    throw new Error(`Upload ${id} is already in the books.`);
  }
  return upload;
}

export async function markUploadPosted(kv: Kv, id: string, boeKey: string): Promise<void> {
  const all = await listUploads(kv);
  const upload = all.find((row) => row.id === id);
  if (!upload || upload.status === "posted") return;
  upload.status = "posted";
  upload.postedAt = new Date().toISOString();
  upload.boeKey = boeKey;
  await kv.put(UPLOADS, asJson(all));
}

export function uploadFile(dir: string, id: string): string {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Bad upload id.");
  return path.join(dir, "uploads", id);
}

function isUpload(value: unknown): value is UploadMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<UploadMeta>;
  return typeof row.id === "string" && typeof row.bin === "string" && typeof row.status === "string";
}
