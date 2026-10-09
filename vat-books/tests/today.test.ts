import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { addApi, listApis, parseApiEntry } from "../bot/lib/apis.js";
import { applyBoe } from "../bot/lib/boe.js";
import { openDisk } from "../bot/lib/disk.js";
import { extFromDescription } from "../bot/lib/extkg.js";
import { glanceRows } from "../bot/lib/glance.js";
import { mirrorImporter, recordDeletion, syncDeletions } from "../bot/lib/mirror.js";
import { applyReset, partyActivity, previewReset, resetPhrase } from "../bot/lib/month.js";
import { htmlToPdf } from "../bot/lib/pdf.js";
import { hashPin, importerPinMatches, setImporterPin, verifyPin } from "../bot/lib/pins.js";
import { addCustomers, loadImporter, loadSharedCustomers, newImporter, removeCustomer, saveImporter, type Kv } from "../bot/lib/store.js";
import type { ImporterDoc, Invoice, PurchaseLine } from "../bot/lib/types.js";
import { listUploads, pdfPageCount, saveUpload } from "../bot/lib/uploads.js";
import { startServer } from "../dashboard/server.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("buyer list appends, skips the same name, and can drop one", async () => {
  const kv = memoryKv();
  assert.equal((await addCustomers(kv, undefined, [{ name: "রহিম", address: "ঢাকা" }])).added, 1);
  const again = await addCustomers(kv, undefined, [
    { name: "রহিম", address: "ঢাকা" },
    { name: "করিম", address: "চট্টগ্রাম" },
  ]);
  assert.equal(again.added, 1);
  assert.equal(again.skipped, 1);
  assert.equal((await loadSharedCustomers(kv)).length, 2);
  await removeCustomer(kv, undefined, (await loadSharedCustomers(kv))[0]!.id);
  assert.equal((await loadSharedCustomers(kv)).length, 1);
  await saveImporter(kv, newImporter("0003116570701", "A"));
  assert.equal((await addCustomers(kv, "0003116570701", [{ name: "ক", address: "খ" }])).list, "0003116570701");
  await assert.rejects(() => addCustomers(kv, "0000000000000", [{ name: "x", address: "" }]), /No importer/);
});

function memoryKv(): Kv {
  const map = new Map<string, unknown>();
  return {
    get: async (key: string) => map.get(key) as never,
    put: async (key: string, value: unknown) => void map.set(key, value),
    delete: async (key: string) => void map.delete(key),
  } as unknown as Kv;
}

function line(over: Partial<PurchaseLine> = {}): PurchaseLine {
  return {
    lineId: "C-1|2026-01-05#1",
    boeKey: "C-1|2026-01-05",
    serial: 1,
    boeNo: "C-1",
    boeDate: "2026-01-05",
    description: "Stone",
    unit: "KG",
    quantity: 10,
    assessableValue: 100,
    cd: 0,
    rd: 0,
    sd: 0,
    vat: 0,
    ait: 0,
    at: 0,
    additionPct: 10,
    costValue: 100,
    unitCost: 10,
    declaredUnitPrice: 11,
    ...over,
  };
}

function sale(over: Partial<Invoice> = {}): Invoice {
  return {
    challanNo: "1234567890123-000001",
    serial: 1,
    issueDate: "2026-02-02",
    requestId: "req-1",
    round: 1,
    lineId: "C-1|2026-01-05#1",
    buyerId: "name:a",
    buyerName: "A",
    buyerBinNid: "",
    deliveryAddress: "Addr",
    description: "Stone",
    unit: "KG",
    quantity: 1,
    unitPrice: 11,
    value: 11,
    sdRate: 0,
    sd: 0,
    vatRate: 15,
    vat: 1.65,
    total: 12.65,
    ...over,
  };
}

function twoPagePdf(): Buffer {
  return Buffer.from(
    `%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R >>endobj
4 0 obj<< /Type /Page /Parent 2 0 R >>endobj
trailer<<>>
%%EOF`,
  );
}

function cookieOf(res: Response): string {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return (list[0] ?? res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

test("EXT kilograms are added to box 38 and money figures stay", () => {
  const doc = newImporter("0003116570701", "Aritree");
  const result = applyBoe(
    doc,
    {
      number: "C-85",
      date: "2026-09-05",
      valueAdditionPct: 10,
      items: [
        {
          hsCode: "25210010",
          productName: "Stone",
          unit: "KG",
          quantity: 100,
          goodsDescription: "LIMESTONE EXT= 25 KGS PACKED IN BAGS",
          assessableValue: 1000,
          cd: 10,
          rd: 0,
          sd: 0,
          vat: 151.5,
          ait: 0,
          at: 0,
        },
      ],
    },
    {},
  );
  const row = result.lines[0];
  assert.equal(row?.quantity, 125);
  assert.equal(row?.box38Kg, 100);
  assert.equal(row?.extKg, 25);
  assert.equal(row?.assessableValue, 1000);
  assert.equal(row?.cd, 10);
  assert.equal(row?.rd, 0);
  assert.equal(row?.sd, 0);
  assert.equal(row?.vat, 151.5);
  assert.equal(row?.ait, 0);
  assert.equal(row?.at, 0);
  assert.equal(row?.costValue, 1010);
  assert.match(result.warnings.join("\n"), /No money figure was changed/);
  assert.deepEqual(glanceRows(result.lines), [{ billNo: "C-85", date: "2026-09-05", kg: 125 }]);
});

test("box 41, packages and EXT without KGS do not change quantity", () => {
  const doc = newImporter("0003116570701", "Aritree");
  const result = applyBoe(
    doc,
    {
      number: "C-88",
      date: "2026-09-06",
      valueAdditionPct: 10,
      items: [
        {
          hsCode: "25210010",
          productName: "Stone",
          unit: "KG",
          quantity: 100,
          goodsDescription: "GROSS 150 KG, PACKAGES 40, QTY 240, EXT= 10 KG",
          assessableValue: 1000,
          cd: 10,
          rd: 0,
          sd: 0,
          vat: 151.5,
          ait: 0,
          at: 0,
        },
      ],
    },
    {},
  );
  assert.equal(result.lines[0]?.quantity, 100);
  assert.equal(result.lines[0]?.extKg, 0);
  assert.equal(result.lines[0]?.assessableValue, 1000);
  assert.equal(extFromDescription("EXT=২৫ KGS").kg, 25);
  assert.equal(extFromDescription("EXT= 1,250.50 KGS").kg, 1250.5);
  assert.equal(extFromDescription("EXT= 10 KGS plus EXT= 2.5 KGS").kg, 12.5);
});

test("month reset waits for apply and leaves other months", () => {
  const doc = newImporter("1234567890123", "X");
  doc.purchases.push(line(), line({ lineId: "C-2|2026-03-01#1", boeKey: "C-2|2026-03-01", serial: 2, boeNo: "C-2", boeDate: "2026-03-01" }));
  const preview = previewReset(doc, "2026-01");
  assert.equal(doc.purchases.length, 2);
  assert.equal(preview.empty, false);
  assert.equal(preview.boeCount, 1);
  assert.equal(preview.phrase, resetPhrase(doc.bin, "2026-01"));
  applyReset(doc, "2026-01");
  assert.equal(doc.purchases.length, 1);
  assert.equal(doc.purchases[0]?.boeNo, "C-2");
  assert.equal(doc.purchases[0]?.serial, 1);
  assert.throws(() => applyReset(doc, "2026-05"), /no bills/);
});

test("a month is kept when its bill has a challan in another month", () => {
  const doc = newImporter("1234567890123", "X");
  doc.purchases.push(line());
  doc.invoices.push(sale());
  assert.throws(() => applyReset(doc, "2026-01"), /another month/);
  assert.equal(doc.purchases.length, 1);
  assert.equal(doc.invoices.length, 1);
  applyReset(doc, "2026-02");
  assert.equal(doc.invoices.length, 0);
  assert.equal(doc.purchases.length, 1);
});

test("party list is only importers with a transaction that month", () => {
  const quiet = newImporter("9999999999999", "Quiet");
  const busy = newImporter("1234567890123", "Busy");
  busy.purchases.push(line());
  busy.invoices.push(sale());
  assert.equal(partyActivity(quiet, "2026-01"), undefined);
  assert.equal(partyActivity(busy, "2026-01")?.boeCount, 1);
  assert.equal(partyActivity(busy, "2026-02")?.challanCount, 1);
  assert.equal(partyActivity(busy, "2026-03"), undefined);
});

test("API registry stores the endpoint and refuses secrets in the URL", async () => {
  assert.throws(() => parseApiEntry({ label: "NBR", baseUrl: "http://evil.com", apiKeyEnv: "NBR_API_KEY" }));
  assert.throws(() => parseApiEntry({ label: "NBR", baseUrl: "https://user:pass@example.com/v1", apiKeyEnv: "NBR_API_KEY" }));
  assert.throws(() => parseApiEntry({ label: "NBR", baseUrl: "https://example.com/v1", apiKeyEnv: "CURSOR_SECRET" }));
  const kv = memoryKv();
  const entry = await addApi(kv, { label: "NBR portal", baseUrl: "https://example.com/v1/", apiKeyEnv: "NBR_API_KEY", note: "later" });
  assert.equal(entry.id, "nbr-portal");
  assert.equal(entry.baseUrl, "https://example.com/v1");
  assert.equal((await listApis(kv)).length, 1);
  await assert.rejects(() => addApi(kv, { label: "NBR portal", baseUrl: "https://example.com/v1", apiKeyEnv: "NBR_API_KEY" }), /already/);
});

test("importer PIN is checked without keeping the plain pin", async () => {
  const kv = memoryKv();
  assert.throws(() => hashPin("1234"), /১১ সংখ্যা/);
  const stored = hashPin("12345678901");
  assert.equal(verifyPin("12345678901", stored), true);
  assert.equal(verifyPin("12345678900", stored), false);
  assert.equal(await setImporterPin(kv, "000311657-0701", "12345678901"), "0003116570701");
  assert.equal(await importerPinMatches(kv, "0003116570701", "12345678901"), "0003116570701");
  assert.equal(await importerPinMatches(kv, "0003116570701", "0000"), undefined);
});

test("a confirmed website deletion is applied to the chat books on sync", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vatmirror-"));
  const chat = memoryKv();
  const doc = newImporter("1234567890123", "X");
  doc.purchases.push(line(), line({ lineId: "C-2|2026-03-01#1", boeKey: "C-2|2026-03-01", serial: 2, boeNo: "C-2", boeDate: "2026-03-01" }));
  await saveImporter(chat, doc);
  assert.equal((await mirrorImporter(doc, dir)).ok, true);
  const disk = openDisk(dir);
  const site = await loadImporter(disk, doc.bin);
  assert.ok(site);
  applyReset(site, "2026-01");
  await saveImporter(disk, site);
  await recordDeletion(disk, doc.bin, "2026-01");
  const synced = await syncDeletions(chat, dir);
  assert.equal(synced.applied.length, 1);
  assert.equal((await loadImporter(chat, doc.bin))?.purchases.length, 1);
});

test("upload accepts one image and refuses a multi-page PDF", async () => {
  assert.equal(pdfPageCount(twoPagePdf()), 2);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vatup-"));
  const kv = openDisk(dir);
  const saved = await saveUpload(kv, dir, { bin: "1234567890123", fileName: "page.png", contentType: "image/png", data: PNG });
  assert.equal(saved.status, "pending");
  await assert.rejects(
    () => saveUpload(kv, dir, { bin: "1234567890123", fileName: "two.pdf", contentType: "application/pdf", data: twoPagePdf() }),
    /এক পাতা/,
  );
  assert.equal((await listUploads(kv)).length, 1);
  const dated = await saveUpload(kv, dir, {
    bin: "1234567890123",
    fileName: "sept.png",
    contentType: "image/png",
    data: PNG,
    entryDate: "2026-09-15",
  });
  assert.equal(dated.entryDate, "2026-09-15");
  assert.equal((await listUploads(kv)).find((row) => row.id === dated.id)?.entryDate, "2026-09-15");
  await assert.rejects(
    () => saveUpload(kv, dir, { bin: "1234567890123", fileName: "bad.png", contentType: "image/png", data: PNG, entryDate: "15-09-2026" }),
    /তারিখ/,
  );
});

test("dashboard: pin, one page, report button, confirmed reset, API", { timeout: 40_000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vatdash-"));
  const started = await startServer({ port: 0, host: "127.0.0.1", dataDir: dir, operatorPin: "2468" });
  const base = `http://127.0.0.1:${started.port}`;
  try {
    const home = await (await fetch(`${base}/`)).text();
    assert.match(home, /osbdsyl\.online/);
    assert.match(home, /action="\/login"/);
    assert.match(home, /ইউজার আইডি/);
    assert.match(home, /অনলাইনে ভ্যাট দাখিল করুন/);
    assert.doesNotMatch(home, /href="\/op"/);
    assert.doesNotMatch(home, /পোর্টালে কিছু পাঠায় না/);
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok");

    const op = await fetch(`${base}/op/login`, {
      method: "POST",
      body: new URLSearchParams({ pin: "2468" }),
      redirect: "manual",
    });
    assert.equal(op.status, 303);
    const opCookie = cookieOf(op);
    const pin = await fetch(`${base}/op/pin`, {
      method: "POST",
      headers: { cookie: opCookie },
      body: new URLSearchParams({ bin: "0003116570701", pin: "12345678901", pin2: "12345678901" }),
      redirect: "manual",
    });
    assert.equal(pin.status, 303);

    const user = await fetch(`${base}/login`, {
      method: "POST",
      body: new URLSearchParams({ bin: "0003116570701", pin: "12345678901" }),
      redirect: "manual",
    });
    assert.equal(user.status, 303);
    const userCookie = cookieOf(user);
    const form = new FormData();
    form.set("page", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "page.png");
    const uploaded = await fetch(`${base}/upload`, { method: "POST", headers: { cookie: userCookie }, body: form, redirect: "manual" });
    assert.equal(uploaded.status, 303);
    const appHtml = await (await fetch(`${base}/app`, { headers: { cookie: userCookie } })).text();
    assert.match(appHtml, /অপেক্ষমাণ/);
    assert.match(appHtml, /পোর্টালে কিছু পাঠায় না/);
    assert.match(appHtml, /এক পাতা করে বিল অব এন্ট্রি আপলোড করুন/);

    const disk = openDisk(dir);
    const pending = await listUploads(disk);
    assert.equal(pending[0]?.status, "pending");
    assert.equal(await loadImporter(disk, "0003116570701"), undefined);

    const bad = new FormData();
    bad.set("page", new Blob([new Uint8Array(twoPagePdf())], { type: "application/pdf" }), "two.pdf");
    const rejected = await fetch(`${base}/upload`, { method: "POST", headers: { cookie: userCookie }, body: bad });
    assert.equal(rejected.status, 400);
    assert.match(await rejected.text(), /এক পাতা/);
    assert.equal((await listUploads(disk)).length, 1);

    const confirmed = await fetch(`${base}/op/upload/confirm`, {
      method: "POST",
      headers: { cookie: opCookie },
      body: new URLSearchParams({ id: pending[0]!.id }),
      redirect: "manual",
    });
    assert.equal(confirmed.status, 303);
    assert.equal((await listUploads(disk))[0]?.status, "confirmed");
    assert.equal(await loadImporter(disk, "0003116570701"), undefined);

    const refused = await fetch(`${base}/op/api`, {
      method: "POST",
      headers: { cookie: opCookie },
      body: new URLSearchParams({ label: "X", baseUrl: "http://evil.com", apiKeyEnv: "X_KEY" }),
    });
    assert.equal(refused.status, 400);
    const added = await fetch(`${base}/op/api`, {
      method: "POST",
      headers: { cookie: opCookie },
      body: new URLSearchParams({ label: "NBR", baseUrl: "https://example.com/v1", apiKeyEnv: "NBR_API_KEY" }),
      redirect: "manual",
    });
    assert.equal(added.status, 303);
    assert.match(await (await fetch(`${base}/op/api`, { headers: { cookie: opCookie } })).text(), /NBR_API_KEY/);

    const doc: ImporterDoc = newImporter("0003116570701", "Aritree");
    doc.purchases.push(
      line({ boeNo: "C-85", boeDate: "2026-01-05", boeKey: "C-85|2026-01-05", lineId: "C-85|2026-01-05#1" }),
      line({ boeNo: "C-88", boeDate: "2026-03-02", boeKey: "C-88|2026-03-02", lineId: "C-88|2026-03-02#1", serial: 2 }),
    );
    await saveImporter(disk, doc);
    assert.match(await (await fetch(`${base}/op`, { headers: { cookie: opCookie } })).text(), /Aritree/);
    const customer = await (await fetch(`${base}/op/customer?bin=0003116570701`, { headers: { cookie: opCookie } })).text();
    assert.match(customer, /Aritree/);
    assert.match(customer, /name="form" value="6.1"/);
    assert.match(customer, /name="form" value="6.3"/);
    assert.match(customer, /type="month"/);
    assert.match(await (await fetch(`${base}/op/buyers`, { headers: { cookie: opCookie } })).text(), /৬\.৩ ক্রেতা/);
    assert.match(await (await fetch(`${base}/op/monthly`, { headers: { cookie: opCookie } })).text(), /action="\/op\/parties"/);
    const parties = await (await fetch(`${base}/op/parties?month=2026-01`, { headers: { cookie: opCookie } })).text();
    assert.match(parties, /রিপোর্ট জেনারেট/);
    assert.match(parties, /Aritree/);
    assert.match(await (await fetch(`${base}/op/parties?month=2026-02`, { headers: { cookie: opCookie } })).text(), /কোনো পার্টির লেনদেন নেই/);
    const report = await (await fetch(`${base}/op/report?bin=0003116570701&month=2026-01`, { headers: { cookie: opCookie } })).text();
    assert.match(report, /সার্ভিস বিল/);

    const preview = await (await fetch(`${base}/op/reset`, {
      method: "POST",
      headers: { cookie: opCookie },
      body: new URLSearchParams({ bin: "0003116570701", month: "2026-01" }),
    })).text();
    assert.match(preview, /কনফার্মেশন/);
    assert.equal((await loadImporter(disk, doc.bin))?.purchases.length, 2);
    const wrong = await fetch(`${base}/op/reset`, {
      method: "POST",
      headers: { cookie: opCookie },
      body: new URLSearchParams({ bin: "0003116570701", month: "2026-01", confirm: "DELETE please" }),
    });
    assert.equal(wrong.status, 400);
    assert.equal((await loadImporter(disk, doc.bin))?.purchases.length, 2);
    const wiped = await fetch(`${base}/op/reset`, {
      method: "POST",
      headers: { cookie: opCookie },
      body: new URLSearchParams({ bin: "0003116570701", month: "2026-01", confirm: "DELETE 0003116570701 2026-01" }),
      redirect: "manual",
    });
    assert.equal(wiped.status, 303);
    const left = await loadImporter(disk, doc.bin);
    assert.equal(left?.purchases.length, 1);
    assert.equal(left?.purchases[0]?.boeNo, "C-88");

    const pdf = await fetch(`${base}/download?form=6.1&month=2026-03`, { headers: { cookie: userCookie } });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
    assert.equal((await fetch(`${base}/op/parties?month=2026-03`)).status, 401);
  } finally {
    await started.close();
  }
});

test("html becomes a pdf", { timeout: 30_000 }, async () => {
  const pdf = await htmlToPdf("<!doctype html><html><head><meta charset=\"utf-8\"></head><body><p>C-85</p></body></html>");
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
});
