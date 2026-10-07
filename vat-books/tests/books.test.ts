import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBook, toCsv } from "../bot/lib/forms.js";
import { confirmSales, planSales } from "../bot/lib/sales.js";
import { newImporter } from "../bot/lib/store.js";
import type { ImporterDoc } from "../bot/lib/types.js";
import { computeSale, normalizeBin, selectCustomers } from "../bot/lib/vat.js";

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
  unitPrice: 100,
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
