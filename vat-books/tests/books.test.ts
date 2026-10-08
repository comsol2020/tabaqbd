import { monthlyReport, reportHtml, reportXlsx } from "../bot/lib/report.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBook, toCsv, toHtml, toXlsx } from "../bot/lib/forms.js";
import { confirmSales, planSales } from "../bot/lib/sales.js";
import {
  createImporter,
  listBins,
  newImporter,
  saveImporter,
  saveSharedCustomers,
} from "../bot/lib/store.js";
import type { ImporterDoc } from "../bot/lib/types.js";
import {
  computeSale,
  round2,
  declaredPrice,
  dutyTotal,
  impliedImportVatRate,
  normalizeBin,
  selectCustomers,
} from "../bot/lib/vat.js";

function fixture(customerCount = 7): ImporterDoc {
  const doc = newImporter("1234567890123", "Test Importer Ltd");
  doc.purchases.push({
    lineId: "B1|2026-01-05#1",
    boeKey: "B1|2026-01-05",
    serial: 1,
    boeNo: "B1",
    boeDate: "2026-01-05",
    description: "Cotton fabric",
    unit: "kg",
    quantity: 1000,
    assessableValue: 500000,
    cd: 25000,
    rd: 0,
    sd: 0,
    vat: 78750,
    ait: 25000,
    at: 0,
    additionPct: 10,
    costValue: 100000,
    unitCost: 100,
    declaredUnitPrice: 100,
  });
  for (let i = 1; i <= customerCount; i++) {
    doc.customers.push({ id: `name:c${i}`, name: `C${i}`, address: `Addr ${i}` });
  }
  return doc;
}

const req = {
  lineId: "B1|2026-01-05#1",
  count: 3,
  quantityPerSale: 10,
  issueDate: "2026-02-01",
};

test("BIN accepts Bengali digits and separators", () => {
  assert.equal(normalizeBin("১২৩৪৫৬৭৮৯-০১২৩"), "1234567890123");
  assert.throws(() => normalizeBin("12345"));
});

test("sale amounts", () => {
  assert.deepEqual(computeSale(10, 100, 15, 0), { value: 1000, sd: 0, vat: 150, total: 1150 });
});

test("rotation skips the previous round and goes least-recently-served", () => {
  const doc = fixture();
  const ids = (r: number) =>
    confirmSales(doc, req, `req-${r}-xxxxxxxx`) && doc.rotation.lastRoundIds;
  const r1 = [...ids(1)];
  const r2 = [...ids(2)];
  const r3 = [...ids(3)];
  assert.deepEqual(r1, ["name:c1", "name:c2", "name:c3"]);
  assert.deepEqual(r2, ["name:c4", "name:c5", "name:c6"]);
  assert.equal(r2.filter((x) => r1.includes(x)).length, 0);
  assert.equal(r3.filter((x) => r2.includes(x)).length, 0);
  assert.deepEqual(r3, ["name:c7", "name:c1", "name:c2"]);
});

test("too few customers outside the last round warns instead of failing", () => {
  const doc = fixture(4);
  confirmSales(doc, req, "req-1-xxxxxxxx");
  const sel = selectCustomers(doc.customers, doc.rotation, 3);
  assert.equal(sel.selected.length, 3);
  assert.equal(sel.warnings.length, 1);
  assert.equal(sel.selected[0]?.id, "name:c4");
});

test("same requestId is recorded once", () => {
  const doc = fixture();
  const a = confirmSales(doc, req, "req-same-xxxxxxxx");
  const b = confirmSales(doc, req, "req-same-xxxxxxxx");
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.deepEqual(a.challanNos, b.challanNos);
  assert.equal(doc.invoices.length, 3);
});

test("stock and date guards", () => {
  const doc = fixture();
  assert.throws(() => planSales(doc, { ...req, quantityPerSale: 400 }), /Not enough stock/);
  assert.throws(() => planSales(doc, { ...req, issueDate: "2026-01-01" }), /before the bill of entry/);
});

test("books render from the same data", () => {
  const doc = fixture();
  confirmSales(doc, req, "req-1-xxxxxxxx");
  assert.equal(buildBook(doc, "6.1").rows.length, 1);
  const b62 = buildBook(doc, "6.2");
  assert.equal(b62.rows.length, 3);
  assert.equal(b62.totals.vat, 450);
  assert.equal(buildBook(doc, "6.3").rows[0]?.challanNo, "1234567890123-000001");
  assert.ok(toCsv(b62).startsWith("\uFEFF"));
});

test("real Tamabil bill of entry: duties reconcile with the printed total", () => {
  const item = {
    assessableValue: 41087.94,
    cd: 2054.4,
    rd: 0,
    sd: 4314.23,
    vat: 7118.49,
    ait: 2054.4,
    at: 3559.24,
  };
  assert.equal(impliedImportVatRate(item), 15);
  assert.equal(dutyTotal([item]), 19100.76);
});

test("a new importer inherits the shared customer list", async () => {
  const map = new Map<string, unknown>();
  const kv = {
    get: async (k: string) => map.get(k),
    put: async (k: string, v: unknown) => void map.set(k, v),
    delete: async (k: string) => void map.delete(k),
  } as unknown as Parameters<typeof createImporter>[0];
  await saveSharedCustomers(kv, [{ id: "name:a", name: "A", address: "" }]);
  const doc = await createImporter(kv, "1234567890123", "X Ltd");
  assert.equal(doc.customers.length, 1);
  await saveImporter(kv, doc);
  assert.deepEqual(await listBins(kv), ["1234567890123"]);
});

test("4.3 declared price: cost excludes VAT and AT, addition applied per unit", () => {
  const p = declaredPrice(
    { assessableValue: 41087.94, cd: 2054.4, rd: 0, sd: 4314.23, ait: 2054.4, quantity: 25500 },
    10,
  );
  assert.equal(p.costValue, 49510.97);
  assert.equal(p.unitCost, 1.94);
  assert.equal(p.declaredUnitPrice, 2.13);
});

test("sales use the 4.3 declared price and the 4.3 book renders", () => {
  const doc = fixture();
  const plan = planSales(doc, req);
  assert.equal(plan.sales[0]?.unitPrice, 100);
  const b43 = buildBook(doc, "4.3");
  assert.equal(b43.columns.length, 12);
  assert.equal(b43.rows[0]?.inputValue, 100);
  assert.equal(b43.rows[0]?.additionValue, 0);
  assert.equal(toHtml(b43).includes("প্রতিষ্ঠানের নাম"), true);
});

test("6.1 and 6.2 follow the official columns and keep a running stock", () => {
  const doc = fixture();
  confirmSales(doc, req, "req-1-xxxxxxxx");
  doc.purchases.push({
    ...doc.purchases[0]!,
    lineId: "B2|2026-03-01#1",
    boeKey: "B2|2026-03-01",
    serial: 2,
    boeNo: "B2",
    boeDate: "2026-03-01",
    quantity: 500,
    assessableValue: 250000,
    cd: 12500,
  });
  const b61 = buildBook(doc, "6.1");
  assert.equal(b61.columns.length, 21);
  const [r1, r2] = b61.rows;
  assert.equal(r1?.openQty, 0);
  assert.equal(r1?.useQty, 30);
  assert.equal(r1?.closeQty, 970);
  assert.equal(r2?.openQty, 970);
  assert.equal(r2?.totalQty, 1470);
  assert.equal(r2?.value, 262500);

  const b62 = buildBook(doc, "6.2");
  assert.equal(b62.columns.length, 21);
  assert.equal(b62.rows.length, 3);
  assert.equal(b62.rows[0]?.recvQty, 1000);
  assert.equal(b62.rows[0]?.closeQty, 990);
  assert.equal(b62.rows[2]?.closeQty, 970);
  assert.equal(b62.rows[1]?.recvQty, 0);
  assert.ok(toHtml(b62).includes("colspan"));
});

test("6.2.1 is one chronological register with 26 columns and a running stock", () => {
  const doc = fixture();
  confirmSales(doc, req, "req-1-xxxxxxxx");
  const b = buildBook(doc, "6.2.1");
  assert.equal(b.columns.length, 26);
  assert.equal(b.rows.length, 4);
  const [buy, s1, s2, s3] = b.rows;
  assert.equal(buy?.buyQty, 1000);
  assert.equal(buy?.closeQty, 1000);
  assert.equal(s1?.openQty, 1000);
  assert.equal(s1?.quantity, 10);
  assert.equal(s1?.closeQty, 990);
  assert.equal(s3?.closeQty, 970);
  assert.equal(s2?.buyQty, "");
  assert.ok(toHtml(b).includes("ক্রেতার তথ্য"));
});

test("xlsx export is a valid zip with the form's header rows and data", () => {
  const doc = fixture();
  confirmSales(doc, req, "req-1-xxxxxxxx");
  const bytes = toXlsx(buildBook(doc, "6.2.1"));
  assert.equal(Buffer.from(bytes.subarray(0, 2)).toString(), "PK");
  const text = Buffer.from(bytes).toString("utf8");
  assert.ok(text.includes("ক্রেতার তথ্য"));
  assert.ok(text.includes("(26)"));
  assert.ok(text.includes("mergeCell"));
});

test("monthly report keeps items separate with their own stock", () => {
  const doc = fixture();
  doc.purchases.push({
    ...doc.purchases[0]!,
    lineId: "B2|2026-02-10#1",
    boeKey: "B2|2026-02-10",
    serial: 2,
    boeNo: "B2",
    boeDate: "2026-02-10",
    description: "Marble",
    hsCode: "2515",
    unit: "kg",
    quantity: 200,
    assessableValue: 20000,
    cd: 0,
    declaredUnitPrice: 150,
  });
  confirmSales(doc, req, "req-1-xxxxxxxx");
  confirmSales(doc, { ...req, lineId: "B2|2026-02-10#1", count: 1, quantityPerSale: 5, issueDate: "2026-02-15" }, "req-2-xxxxxxxx");
  const r = monthlyReport(doc, "2026-02");
  assert.equal(r.items.length, 2);
  const [cotton, marble] = r.items;
  assert.equal(cotton?.soldQty, 30);
  assert.equal(cotton?.openQty, 1000);
  assert.equal(cotton?.closeQty, 970);
  assert.equal(cotton?.importedQty, 0);
  assert.equal(marble?.importedQty, 200);
  assert.equal(marble?.soldQty, 5);
  assert.equal(marble?.closeQty, 195);
  assert.equal(r.totals.challans, 4);
  assert.equal(r.totals.soldValue, round2(cotton!.soldValue + marble!.soldValue));
  assert.equal(monthlyReport(doc, "2026-01").items[0]?.importedQty, 1000);
  assert.ok(Buffer.from(reportXlsx(r)).subarray(0, 2).toString() === "PK");
  assert.ok(reportHtml(r).includes("সারসংক্ষেপ"));
  const line = marble!.imports[0]!;
  assert.equal(line.value, round2(line.assessableValue + doc.purchases[1]!.cd + doc.purchases[1]!.rd + doc.purchases[1]!.sd));
});
