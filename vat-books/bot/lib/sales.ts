import type { Customer, ImporterDoc, Invoice, PurchaseLine } from "./types.js";
import { computeSale, isIsoDate, round2, selectCustomers } from "./vat.js";

export type SalesRequest = {
  lineId: string;
  count: number;
  quantityPerSale: number;
  unitPrice: number;
  issueDate: string;
  vatRate?: number;
  sdRate?: number;
};

export type PlannedSale = Omit<Invoice, "challanNo" | "serial" | "requestId" | "round">;

export type SalesPlan = {
  line: PurchaseLine;
  customers: Customer[];
  sales: PlannedSale[];
  remainingBefore: number;
  remainingAfter: number;
  excludedPreviousRound: string[];
  warnings: string[];
};

export function soldQuantity(doc: ImporterDoc, lineId: string): number {
  return round2(
    doc.invoices.filter((i) => i.lineId === lineId).reduce((s, i) => s + i.quantity, 0),
  );
}

export function planSales(doc: ImporterDoc, req: SalesRequest): SalesPlan {
  if (!isIsoDate(req.issueDate)) throw new Error("issueDate must be YYYY-MM-DD");
  if (!(req.quantityPerSale > 0)) throw new Error("quantityPerSale must be positive");
  if (!(req.unitPrice > 0)) throw new Error("unitPrice must be positive");
  const line = doc.purchases.find((p) => p.lineId === req.lineId);
  if (!line) throw new Error(`Unknown purchase line ${req.lineId}`);
  if (req.issueDate < line.boeDate) {
    throw new Error(`Sale date ${req.issueDate} is before the bill of entry date ${line.boeDate}.`);
  }
  const remainingBefore = round2(line.quantity - soldQuantity(doc, line.lineId));
  const needed = round2(req.count * req.quantityPerSale);
  if (needed > remainingBefore) {
    throw new Error(
      `Not enough stock on ${line.lineId}: ${needed} ${line.unit} requested, ${remainingBefore} remaining.`,
    );
  }
  const selection = selectCustomers(doc.customers, doc.rotation, req.count);
  const vatRate = req.vatRate ?? 15;
  const sdRate = req.sdRate ?? 0;
  const sales = selection.selected.map((c): PlannedSale => {
    const amounts = computeSale(req.quantityPerSale, req.unitPrice, vatRate, sdRate);
    return {
      issueDate: req.issueDate,
      lineId: line.lineId,
      buyerId: c.id,
      buyerName: c.name,
      buyerBinNid: c.bin ?? c.nid ?? "",
      deliveryAddress: c.address,
      description: line.description,
      hsCode: line.hsCode,
      unit: line.unit,
      quantity: req.quantityPerSale,
      unitPrice: req.unitPrice,
      value: amounts.value,
      sdRate,
      sd: amounts.sd,
      vatRate,
      vat: amounts.vat,
      total: amounts.total,
    };
  });
  return {
    line,
    customers: selection.selected,
    sales,
    remainingBefore,
    remainingAfter: round2(remainingBefore - needed),
    excludedPreviousRound: selection.excludedPreviousRound,
    warnings: selection.warnings,
  };
}

export type ConfirmResult = {
  duplicate: boolean;
  round: number;
  challanNos: string[];
};

export function confirmSales(
  doc: ImporterDoc,
  req: SalesRequest,
  requestId: string,
): ConfirmResult {
  const prior = doc.requests[requestId];
  if (prior) {
    return { duplicate: true, round: doc.rotation.round, challanNos: prior };
  }
  const plan = planSales(doc, req);
  const round = doc.rotation.round + 1;
  const challanNos: string[] = [];
  let serial = doc.invoices.length;
  for (const sale of plan.sales) {
    serial += 1;
    const challanNo = `${doc.bin}-${String(serial).padStart(6, "0")}`;
    doc.invoices.push({ ...sale, challanNo, serial, requestId, round });
    doc.rotation.lastServed[sale.buyerId] = round;
    challanNos.push(challanNo);
  }
  doc.rotation.round = round;
  doc.rotation.lastRoundIds = plan.customers.map((c) => c.id);
  doc.requests[requestId] = challanNos;
  return { duplicate: false, round, challanNos };
}
