import type { ImporterDoc } from "./types.js";

export function assertMonth(month: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`month must be YYYY-MM, got "${month}"`);
  }
}

export function monthRange(month: string): { from: string; to: string } {
  assertMonth(month);
  return { from: `${month}-01`, to: `${month}-31` };
}

export function resetPhrase(bin: string, month: string): string {
  return `DELETE ${bin} ${month}`;
}

export type ResetBlock = {
  boeNo: string;
  challanNo: string;
  issueDate: string;
};

export type ResetPreview = {
  bin: string;
  month: string;
  boeCount: number;
  challanCount: number;
  boeNumbers: string[];
  challanNumbers: string[];
  blocked: ResetBlock[];
  phrase: string;
  empty: boolean;
};

export function previewReset(doc: ImporterDoc, month: string): ResetPreview {
  assertMonth(month);
  const purchases = doc.purchases.filter((p) => p.boeDate.slice(0, 7) === month);
  const invoices = doc.invoices.filter((i) => i.issueDate.slice(0, 7) === month);
  const ids = new Set(purchases.map((p) => p.lineId));
  const blocked = doc.invoices
    .filter((i) => ids.has(i.lineId) && i.issueDate.slice(0, 7) !== month)
    .map((i) => ({
      boeNo: purchases.find((p) => p.lineId === i.lineId)?.boeNo ?? "",
      challanNo: i.challanNo,
      issueDate: i.issueDate,
    }));
  return {
    bin: doc.bin,
    month,
    boeCount: new Set(purchases.map((p) => p.boeKey)).size,
    challanCount: invoices.length,
    boeNumbers: [...new Set(purchases.map((p) => p.boeNo))],
    challanNumbers: invoices.map((i) => i.challanNo),
    blocked,
    phrase: resetPhrase(doc.bin, month),
    empty: purchases.length === 0 && invoices.length === 0,
  };
}

/** Delete one month's bills of entry and challans. Other months stay. */
export function applyReset(doc: ImporterDoc, month: string): ResetPreview {
  const preview = previewReset(doc, month);
  if (preview.empty) {
    throw new Error(`BIN ${doc.bin} has no bills or challans in ${month}.`);
  }
  if (preview.blocked.length > 0) {
    const list = preview.blocked.map((b) => `${b.challanNo} (${b.issueDate})`).join(", ");
    throw new Error(
      `Cannot delete ${month} for BIN ${doc.bin}: a bill in this month has a challan in another month (${list}).`,
    );
  }
  doc.invoices = doc.invoices.filter((i) => i.issueDate.slice(0, 7) !== month);
  doc.purchases = doc.purchases.filter((p) => p.boeDate.slice(0, 7) !== month);
  doc.purchases.forEach((p, i) => {
    p.serial = i + 1;
  });
  return preview;
}

export type PartyActivity = {
  bin: string;
  name: string;
  boeCount: number;
  challanCount: number;
};

/** A party is listed only when that month has a bill of entry or a challan. */
export function partyActivity(doc: ImporterDoc, month: string): PartyActivity | undefined {
  assertMonth(month);
  const boeCount = new Set(
    doc.purchases.filter((p) => p.boeDate.slice(0, 7) === month).map((p) => p.boeKey),
  ).size;
  const challanCount = doc.invoices.filter((i) => i.issueDate.slice(0, 7) === month).length;
  if (boeCount === 0 && challanCount === 0) return undefined;
  return { bin: doc.bin, name: doc.name, boeCount, challanCount };
}
