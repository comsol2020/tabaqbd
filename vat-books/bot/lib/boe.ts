import { requireHsName } from "./catalog.js";
import type { HsCatalog } from "./store.js";
import type { CoefficientRow, ImporterDoc, PurchaseLine } from "./types.js";
import { declaredPrice, dutyTotal, impliedImportVatRate, isIsoDate, vatRateLooksOff } from "./vat.js";

export type BoeItemInput = {
  hsCode: string;
  productName?: string;
  unit: string;
  quantity: number;
  assessableValue: number;
  cd: number;
  rd: number;
  sd: number;
  vat: number;
  ait: number;
  at: number;
};

export type BoeInput = {
  number: string;
  date: string;
  customsHouse?: string;
  supplierName?: string;
  supplierAddress?: string;
  valueAdditionPct?: number;
  declaredTotalTax?: number;
  items: BoeItemInput[];
};

export type ApplyBoeResult = {
  lines: PurchaseLine[];
  catalog: HsCatalog;
  warnings: string[];
  publish43: boolean;
};

export function applyBoe(doc: ImporterDoc, boe: BoeInput, catalog: HsCatalog): ApplyBoeResult {
  if (!isIsoDate(boe.date)) throw new Error(`boe.date must be YYYY-MM-DD, got "${boe.date}"`);
  const boeKey = `${boe.number.trim()}|${boe.date}`;
  if (doc.purchases.some((p) => p.boeKey === boeKey)) {
    throw new Error(`duplicate:${boeKey}`);
  }
  const pct = boe.valueAdditionPct ?? doc.additionPct;
  if (pct === undefined) {
    throw new Error(
      `BIN ${doc.bin} has no Mushak 4.3 value addition %. Ask the operator once for this BIN and pass valueAdditionPct.`,
    );
  }
  if (doc.additionPct === undefined) doc.additionPct = pct;
  const warnings: string[] = [];
  let nextCatalog = catalog;
  let publish43 = Object.keys(doc.coefficients).length === 0;
  const base = doc.purchases.length;
  const lines = boe.items.map((it, i): PurchaseLine => {
    const rate = impliedImportVatRate(it);
    if (vatRateLooksOff(rate)) {
      warnings.push(
        `Item ${i + 1}: VAT implies ${rate}% of (AV+CD+RD+SD), which is not a usual rate. Re-check the scan.`,
      );
    }
    const named = requireHsName(nextCatalog, it.hsCode, it.productName);
    nextCatalog = named.catalog;
    const price = declaredPrice(it, pct);
    const prev = doc.coefficients[named.key];
    let declaredUnitPrice = price.declaredUnitPrice;
    if (!prev) {
      doc.coefficients[named.key] = coefficientFrom(named.hsCode, named.name, it.unit, price, pct, boe);
      publish43 = true;
    } else if (prev.unitCost > 0) {
      const change = (price.unitCost - prev.unitCost) / prev.unitCost;
      if (Math.abs(change) > 0.075) {
        declaredUnitPrice = price.declaredUnitPrice;
        doc.coefficients[named.key] = coefficientFrom(named.hsCode, named.name, it.unit, price, pct, boe);
        publish43 = true;
        warnings.push(
          `Item ${i + 1} (HS ${named.hsCode}): unit cost moved ${(change * 100).toFixed(1)}% from the 4.3 cost ${prev.unitCost}. A new Mushak 4.3 is required (more than 7.5%).`,
        );
      } else {
        declaredUnitPrice = prev.declaredUnitPrice;
      }
    }
    return {
      lineId: `${boeKey}#${i + 1}`,
      boeKey,
      serial: base + i + 1,
      boeNo: boe.number.trim(),
      boeDate: boe.date,
      customsHouse: boe.customsHouse,
      supplierName: boe.supplierName,
      supplierAddress: boe.supplierAddress,
      description: named.name,
      hsCode: named.hsCode,
      unit: it.unit,
      quantity: it.quantity,
      assessableValue: it.assessableValue,
      cd: it.cd,
      rd: it.rd,
      sd: it.sd,
      vat: it.vat,
      ait: it.ait,
      at: it.at,
      additionPct: pct,
      costValue: price.costValue,
      unitCost: price.unitCost,
      declaredUnitPrice,
    };
  });
  if (boe.declaredTotalTax !== undefined) {
    const computed = dutyTotal(boe.items);
    if (Math.abs(computed - boe.declaredTotalTax) > 1) {
      warnings.push(
        `Duties add up to ${computed} but the document total is ${boe.declaredTotalTax}. A figure was probably misread. Re-check the scan before relying on this book.`,
      );
    }
  }
  doc.purchases.push(...lines);
  return { lines, catalog: nextCatalog, warnings, publish43 };
}

function coefficientFrom(
  hsCode: string,
  description: string,
  unit: string,
  price: { unitCost: number; declaredUnitPrice: number },
  additionPct: number,
  boe: BoeInput,
): CoefficientRow {
  return {
    hsCode,
    description,
    unit,
    unitCost: price.unitCost,
    additionPct,
    declaredUnitPrice: price.declaredUnitPrice,
    declaredOn: boe.date,
    boeNo: boe.number.trim(),
  };
}

export function removeBoe(doc: ImporterDoc, number: string, date: string): { removedLines: string[] } {
  const boeKey = `${number.trim()}|${date}`;
  const lines = doc.purchases.filter((p) => p.boeKey === boeKey);
  if (lines.length === 0) throw new Error(`No bill of entry ${number} dated ${date} on file for BIN ${doc.bin}.`);
  const ids = new Set(lines.map((l) => l.lineId));
  const sold = doc.invoices.filter((i) => ids.has(i.lineId));
  if (sold.length > 0) {
    throw new Error(
      `Bill of entry ${number} has ${sold.length} challan(s) issued against it (${sold.map((i) => i.challanNo).join(", ")}). It cannot be removed.`,
    );
  }
  doc.purchases = doc.purchases.filter((p) => p.boeKey !== boeKey);
  doc.purchases.forEach((p, i) => {
    p.serial = i + 1;
  });
  return { removedLines: [...ids] };
}
