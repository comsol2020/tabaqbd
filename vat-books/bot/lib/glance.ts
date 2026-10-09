export type GlanceRow = {
  billNo: string;
  date: string;
  kg: number;
};

/** Small table the operator matches to the scan: bill number, date, kilograms. */
export function glanceRows(
  lines: { boeNo: string; boeDate: string; quantity: number }[],
): GlanceRow[] {
  return lines.map((line) => ({
    billNo: line.boeNo,
    date: line.boeDate,
    kg: line.quantity,
  }));
}
