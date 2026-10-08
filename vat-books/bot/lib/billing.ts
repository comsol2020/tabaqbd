/** Operator's monthly fee for one importer. First 5 documents = 500 Tk total; each after that = 50 Tk. */
export function slabFee(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const n = Math.floor(count);
  return n <= 5 ? 500 : 500 + (n - 5) * 50;
}

export type ServiceBill = {
  boeCount: number;
  challanCount: number;
  boeFee: number;
  challanFee: number;
  total: number;
};

export function serviceBill(boeCount: number, challanCount: number): ServiceBill {
  const boeFee = slabFee(boeCount);
  const challanFee = slabFee(challanCount);
  return { boeCount, challanCount, boeFee, challanFee, total: boeFee + challanFee };
}
