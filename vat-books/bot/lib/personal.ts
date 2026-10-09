import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { asJson } from "./disk.js";
import type { Kv } from "./store.js";

const KEY = "personal:docs";

export type PersonalDoc = {
  id: string;
  bin: string;
  fileName: string;
  contentType: string;
  bytes: number;
  createdAt: string;
};

export function personalFileName(name: string): string {
  const base = path.basename(name).replace(/[\u0000-\u001f\\/]+/g, "").trim().slice(0, 120);
  return base || "file";
}

export function personalContentType(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.length >= 6 && (buf.subarray(0, 6).toString() === "GIF87a" || buf.subarray(0, 6).toString() === "GIF89a")) return "image/gif";
  if (buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return "application/octet-stream";
}

export function personalInline(contentType: string): boolean {
  return contentType === "image/jpeg" || contentType === "image/png" || contentType === "image/webp" || contentType === "image/gif" || contentType === "application/pdf";
}

export async function listPersonal(kv: Kv, bin?: string): Promise<PersonalDoc[]> {
  const value = await kv.get(KEY);
  const all = Array.isArray(value) ? value.filter(isDoc) : [];
  const rows = bin ? all.filter((row) => row.bin === bin) : all;
  return rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function savePersonal(
  kv: Kv,
  dir: string,
  input: { bin: string; fileName: string; data: Buffer },
): Promise<PersonalDoc> {
  if (input.data.length === 0) throw new Error("ফাইল বেছে নিন।");
  const id = crypto.randomBytes(16).toString("hex");
  const meta: PersonalDoc = {
    id,
    bin: input.bin,
    fileName: personalFileName(input.fileName),
    contentType: personalContentType(input.data),
    bytes: input.data.length,
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(path.join(dir, "personal"), { recursive: true });
  await fs.writeFile(personalFile(dir, id), input.data);
  const all = await listPersonal(kv);
  await kv.put(KEY, asJson([meta, ...all]));
  return meta;
}

export async function removePersonal(kv: Kv, dir: string, id: string): Promise<PersonalDoc> {
  const all = await listPersonal(kv);
  const doc = all.find((row) => row.id === id);
  if (!doc) throw new Error("ফাইল নেই।");
  await fs.rm(personalFile(dir, id), { force: true });
  await kv.put(KEY, asJson(all.filter((row) => row.id !== id)));
  return doc;
}

export function personalFile(dir: string, id: string): string {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Bad file id.");
  return path.join(dir, "personal", id);
}

function isDoc(value: unknown): value is PersonalDoc {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<PersonalDoc>;
  return typeof row.id === "string" && typeof row.bin === "string" && typeof row.fileName === "string";
}
