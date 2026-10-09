export type Customer = {
  id: string;
  name: string;
  bin?: string;
  nid?: string;
  address: string;
};

export type PurchaseLine = {
  lineId: string;
  boeKey: string;
  serial: number;
  boeNo: string;
  boeDate: string;
  customsHouse?: string;
  supplierName?: string;
  supplierAddress?: string;
  description: string;
  hsCode?: string;
  unit: string;
  quantity: number;
  assessableValue: number;
  cd: number;
  rd: number;
  sd: number;
  vat: number;
  ait: number;
  at: number;
  additionPct: number;
  costValue: number;
  unitCost: number;
  declaredUnitPrice: number;
};

export type Invoice = {
  challanNo: string;
  serial: number;
  issueDate: string;
  requestId: string;
  round: number;
  lineId: string;
  buyerId: string;
  buyerName: string;
  buyerBinNid: string;
  deliveryAddress: string;
  description: string;
  hsCode?: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  value: number;
  sdRate: number;
  sd: number;
  vatRate: number;
  vat: number;
  total: number;
};

export type RotationState = {
  round: number;
  lastRoundIds: string[];
  lastServed: Record<string, number>;
};

/** Last Mushak 4.3 declaration for one HS code of this importer. */
export type CoefficientRow = {
  hsCode: string;
  description: string;
  unit: string;
  unitCost: number;
  additionPct: number;
  declaredUnitPrice: number;
  declaredOn: string;
  boeNo: string;
};

export type ImporterDoc = {
  bin: string;
  name: string;
  address?: string;
  /** Mushak 4.3 value addition %, set once per BIN. */
  additionPct?: number;
  /** Current 4.3 declaration, keyed by normalised HS code. */
  coefficients: Record<string, CoefficientRow>;
  customers: Customer[];
  purchases: PurchaseLine[];
  invoices: Invoice[];
  rotation: RotationState;
  requests: Record<string, string[]>;
};
