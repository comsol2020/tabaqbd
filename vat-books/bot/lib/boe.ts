import type { ImporterDoc } from "./types.js";

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
