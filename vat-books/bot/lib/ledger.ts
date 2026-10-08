import type { ImporterDoc, Invoice, PurchaseLine } from "./types.js";
import { round2 } from "./vat.js";

export const productKey = (p: { hsCode?: string; description: string }) => p.hsCode || p.description;

/** Value of a purchase line excluding VAT, SD, AIT and AT: assessable value + CD + RD. */
export const netValue = (p: PurchaseLine) => round2(p.assessableValue + p.cd + p.rd);

type Stock = { qty: number; val: number };

const lineProduct = (doc: ImporterDoc, lineId: string) => {
  const p = doc.purchases.find((x) => x.lineId === lineId);
  return p ? productKey(p) : lineId;
};

export type PurchaseLedgerRow = {
  purchase: PurchaseLine;
  opening: Stock;
  total: Stock;
  usage: Stock;
  closing: Stock;
};

/** Mushak 6.1 running stock: opening + purchase = total, minus what was sold until the next purchase. */
export function purchaseLedger(doc: ImporterDoc): PurchaseLedgerRow[] {
  const out: PurchaseLedgerRow[] = [];
  const keys = [...new Set(doc.purchases.map(productKey))];
  for (const key of keys) {
    const lines = doc.purchases
      .filter((p) => productKey(p) === key)
      .sort((a, b) => a.boeDate.localeCompare(b.boeDate) || a.serial - b.serial);
    let state: Stock = { qty: 0, val: 0 };
    lines.forEach((p, i) => {
      const next = lines[i + 1];
      const sold = doc.invoices.filter(
        (inv) =>
          lineProduct(doc, inv.lineId) === key &&
          inv.issueDate >= p.boeDate &&
          (!next || inv.issueDate < next.boeDate),
      );
      const total: Stock = {
        qty: round2(state.qty + p.quantity),
        val: round2(state.val + netValue(p)),
      };
      const usedQty = Math.min(round2(sold.reduce((s, x) => s + x.quantity, 0)), total.qty);
      const usedVal = total.qty > 0 ? round2((usedQty * total.val) / total.qty) : 0;
      const usage = { qty: usedQty, val: usedVal };
      const closing = { qty: round2(total.qty - usedQty), val: round2(total.val - usedVal) };
      out.push({ purchase: p, opening: state, total, usage, closing });
      state = closing;
    });
  }
  return out.sort(
    (a, b) =>
      a.purchase.boeDate.localeCompare(b.purchase.boeDate) || a.purchase.serial - b.purchase.serial,
  );
}

export type SalesLedgerRow = {
  invoice: Invoice;
  opening: Stock;
  received: Stock;
  total: Stock;
  closing: Stock;
};

/** Mushak 6.2 running stock per sale: goods received since the previous sale count as the "production" column. */
export function salesLedger(doc: ImporterDoc): SalesLedgerRow[] {
  const sales = [...doc.invoices].sort(
    (a, b) => a.issueDate.localeCompare(b.issueDate) || a.serial - b.serial,
  );
  const state = new Map<string, Stock>();
  const taken = new Set<string>();
  return sales.map((invoice) => {
    const key = lineProduct(doc, invoice.lineId);
    const opening = state.get(key) ?? { qty: 0, val: 0 };
    const fresh = doc.purchases.filter(
      (p) => productKey(p) === key && p.boeDate <= invoice.issueDate && !taken.has(p.lineId),
    );
    for (const p of fresh) taken.add(p.lineId);
    const received: Stock = {
      qty: round2(fresh.reduce((s, p) => s + p.quantity, 0)),
      val: round2(fresh.reduce((s, p) => s + netValue(p), 0)),
    };
    const total = { qty: round2(opening.qty + received.qty), val: round2(opening.val + received.val) };
    const outVal = total.qty > 0 ? round2((invoice.quantity * total.val) / total.qty) : 0;
    const closing = {
      qty: round2(total.qty - invoice.quantity),
      val: round2(total.val - outVal),
    };
    state.set(key, closing);
    return { invoice, opening, received, total, closing };
  });
}
