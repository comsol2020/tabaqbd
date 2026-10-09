import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { test } from "node:test";
import type { HostMcpCallResult, JsonValue } from "@cursor/bdk";
import { PDFDocument } from "pdf-lib";
import { listUploads, pdfPageCount } from "../../vat-books/bot/lib/uploads.js";
import { openDisk } from "../../vat-books/bot/lib/disk.js";
import { deliverPages } from "../bot/lib/deliver.js";
import { expandToPages } from "../bot/lib/pages.js";
import { sendToVat } from "../bot/lib/send.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("a two-page PDF becomes two single-page files the VAT inbox accepts", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.addPage([240, 300]);
  const raw = Buffer.from(await doc.save({ useObjectStreams: false }));
  assert.equal(pdfPageCount(raw), 2);
  const pages = await expandToPages("bundle.pdf", raw);
  assert.equal(pages.length, 2);
  for (const page of pages) assert.equal(pdfPageCount(page.bytes), 1);

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "vatpages-ws-"));
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "vatpages-data-"));
  await fs.writeFile(path.join(workspace, "bundle.pdf"), raw);
  const first = await deliverPages({ workspaceDir: workspace, dataDir: data, bin: "১২৩৪৫৬৭৮৯০১২৩", paths: ["bundle.pdf"] });
  assert.equal(first.bin, "1234567890123");
  assert.equal(first.pages.length, 2);
  assert.equal(first.pages.every((page) => page.duplicate === false && page.status === "pending"), true);
  const stored = await listUploads(openDisk(data), first.bin);
  assert.equal(stored.length, 2);
  for (const row of stored) {
    const buf = await fs.readFile(path.join(data, "uploads", row.id));
    assert.equal(pdfPageCount(buf), 1);
  }
  const again = await deliverPages({ workspaceDir: workspace, dataDir: data, bin: first.bin, paths: ["bundle.pdf"] });
  assert.equal(again.pages.every((page) => page.duplicate), true);
  assert.equal((await listUploads(openDisk(data))).length, 2);
});

test("a zip of an image and a PDF is one page per scan", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const pdf = Buffer.from(await doc.save({ useObjectStreams: false }));
  const compressed = deflateRawSync(pdf);
  const zipped = zipStore([
    { name: "scan.png", data: PNG },
    { name: "nested/bill.pdf", data: compressed, method: 8, size: pdf.length },
  ]);
  const pages = await expandToPages("together.zip", zipped);
  assert.equal(pages.length, 2);
  assert.equal(pages[0]?.contentType, "image/png");
  assert.equal(pages[1]?.contentType, "application/pdf");
  assert.equal(pdfPageCount(pages[1]!.bytes), 1);
});

test("pages still reach the inbox when the VAT agent is not connected", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([180, 180]);
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "vatpages-solo-"));
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "vatpages-solo-data-"));
  await fs.writeFile(path.join(workspace, "one.pdf"), Buffer.from(await doc.save({ useObjectStreams: false })));
  const previous = process.env.VAT_DATA_DIR;
  process.env.VAT_DATA_DIR = data;
  try {
    const result = await sendToVat({
      bin: "1234567890123",
      paths: ["one.pdf"],
      workspaceDir: workspace,
      evalRun: false,
      kv: memoryKv(),
      mcp: { names: () => [], callTool: async () => { throw new Error("no peer"); } },
    });
    assert.equal(result.pageCount, 1);
    assert.equal(result.vat.notified, false);
    assert.match(result.vat.reason ?? "", /inbox/);
    assert.equal((await listUploads(openDisk(data))).length, 1);
  } finally {
    if (previous === undefined) delete process.env.VAT_DATA_DIR;
    else process.env.VAT_DATA_DIR = previous;
  }
});

test("send_pages writes the inbox and tells the VAT agent without filling 6.1", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.addPage([240, 300]);
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "vatpages-tool-"));
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "vatpages-tool-data-"));
  await fs.mkdir(path.join(workspace, "scans"));
  await fs.writeFile(path.join(workspace, "scans", "bundle.pdf"), Buffer.from(await doc.save()));
  const previous = process.env.VAT_DATA_DIR;
  process.env.VAT_DATA_DIR = data;
  const asked: { message?: string; sessionId?: string }[] = [];
  const kv = memoryKv();
  try {
    const result = await sendToVat({
      bin: "1234567890123",
      paths: ["scans/bundle.pdf"],
      workspaceDir: workspace,
      evalRun: false,
      kv,
      mcp: {
        names: () => ["vat-books"],
        callTool: async (_name, _tool, args) => {
          asked.push({
            message: String(args?.message ?? ""),
            sessionId: typeof args?.sessionId === "string" ? args.sessionId : undefined,
          });
          const result: HostMcpCallResult = {
            content: [{ type: "text", text: JSON.stringify({ status: "running", sessionId: "ses_vat" }) }],
          };
          return result;
        },
      },
    });
    assert.equal(result.pageCount, 2);
    assert.equal(result.inbox, "vat");
    assert.equal(result.vat.notified, true);
    assert.equal(result.vat.sessionId, "ses_vat");
    assert.match(result.next, /6\.1/);
    assert.equal(asked.length, 1);
    assert.match(asked[0]?.message ?? "", /confirm_upload কোরো না/);
    assert.equal((await listUploads(openDisk(data))).length, 2);
    assert.equal(sessionIdOf(await kv.get("handoff:1234567890123")), "ses_vat");
  } finally {
    if (previous === undefined) delete process.env.VAT_DATA_DIR;
    else process.env.VAT_DATA_DIR = previous;
  }
});

function memoryKv(): { get: (key: string) => Promise<JsonValue | undefined>; put: (key: string, value: JsonValue) => Promise<void> } {
  const map = new Map<string, JsonValue>();
  return {
    get: async (key) => map.get(key),
    put: async (key, value) => void map.set(key, value),
  };
}

function sessionIdOf(value: JsonValue | undefined): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const sessionId = value.sessionId;
  return typeof sessionId === "string" ? sessionId : undefined;
}

function zipStore(files: { name: string; data: Buffer; method?: number; size?: number }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const method = file.method ?? 0;
    const size = file.size ?? file.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, file.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + file.data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}
