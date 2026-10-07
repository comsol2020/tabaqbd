import type { Customer, RotationState } from "./types.js";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

export function normalizeDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

export function normalizeBin(input: string): string {
  const digits = normalizeDigits(input).replace(/\D/g, "");
  if (digits.length !== 13) {
    throw new Error(
      `BIN must be 13 digits, got ${digits.length} ("${input}"). Re-read the document or ask the user.`,
    );
  }
  return digits;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function customerKey(c: { bin?: string; nid?: string; name: string }): string {
  if (c.bin) return `bin:${normalizeDigits(c.bin).replace(/\D/g, "")}`;
  if (c.nid) return `nid:${normalizeDigits(c.nid).replace(/\D/g, "")}`;
  return `name:${c.name.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

export const KNOWN_VAT_RATES = [0, 5, 7.5, 10, 15];

export function impliedImportVatRate(item: {
  assessableValue: number;
  cd: number;
  rd: number;
  sd: number;
  vat: number;
}): number {
  const base = item.assessableValue + item.cd + item.rd + item.sd;
  return base > 0 ? round2((item.vat / base) * 100) : 0;
}

export function vatRateLooksOff(rate: number): boolean {
  return KNOWN_VAT_RATES.every((r) => Math.abs(rate - r) > 0.5);
}

export type SaleAmounts = {
  value: number;
  sd: number;
  vat: number;
  total: number;
};

export function computeSale(
  quantity: number,
  unitPrice: number,
  vatRate: number,
  sdRate: number,
): SaleAmounts {
  const value = round2(quantity * unitPrice);
  const sd = round2((value * sdRate) / 100);
  const vat = round2(((value + sd) * vatRate) / 100);
  return { value, sd, vat, total: round2(value + sd + vat) };
}

export type Selection = {
  selected: Customer[];
  excludedPreviousRound: string[];
  warnings: string[];
};

/**
 * Round-robin with a one-round cool-down: customers served in the previous
 * round are skipped, the rest are taken least-recently-served first.
 */
export function selectCustomers(
  customers: Customer[],
  rotation: RotationState,
  count: number,
): Selection {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("count must be a positive integer");
  }
  if (customers.length === 0) {
    throw new Error("No customers on file for this importer. Import a customer list first.");
  }
  if (count > customers.length) {
    throw new Error(
      `Requested ${count} customers but only ${customers.length} are on file.`,
    );
  }
  const prev = new Set(rotation.lastRoundIds);
  const order = (a: Customer, b: Customer) =>
    (rotation.lastServed[a.id] ?? -1) - (rotation.lastServed[b.id] ?? -1) ||
    customers.indexOf(a) - customers.indexOf(b);
  const eligible = customers.filter((c) => !prev.has(c.id)).sort(order);
  const cooling = customers.filter((c) => prev.has(c.id)).sort(order);
  const warnings: string[] = [];
  const selected = eligible.slice(0, count);
  if (selected.length < count) {
    const need = count - selected.length;
    selected.push(...cooling.slice(0, need));
    warnings.push(
      `Only ${eligible.length} customer(s) were outside the previous round, so ${need} repeat customer(s) were needed.`,
    );
  }
  return {
    selected,
    excludedPreviousRound: cooling.map((c) => c.id),
    warnings,
  };
}

export function dutyTotal(items: { cd: number; rd: number; sd: number; vat: number; ait: number; at: number }[]): number {
  return round2(items.reduce((s, i) => s + i.cd + i.rd + i.sd + i.vat + i.ait + i.at, 0));
}

export type Coefficient = { costValue: number; unitCost: number; declaredUnitPrice: number };

/**
 * Mushak 4.3 declared price. Cost is what the importer cannot recover:
 * assessable value + CD + RD + SD + AIT. VAT and AT are adjustable and stay out.
 */
export function declaredPrice(
  item: { assessableValue: number; cd: number; rd: number; sd: number; ait: number; quantity: number },
  additionPct: number,
): Coefficient {
  const costValue = round2(item.assessableValue + item.cd + item.rd + item.sd + item.ait);
  const unitCost = round2(costValue / item.quantity);
  const declaredUnitPrice = round2(unitCost * (1 + additionPct / 100));
  return { costValue, unitCost, declaredUnitPrice };
}
