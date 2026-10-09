import type { ToolContext } from "@cursor/bdk/tools";
import type { Customer, ImporterDoc } from "./types.js";

export type Kv = ToolContext["host"]["kv"];
type JsonValue = Parameters<Kv["put"]>[1];

const REGISTRY = "importers";
const SHARED_CUSTOMERS = "shared:customers";
const docKey = (bin: string) => `importer:${bin}`;

export async function listBins(kv: Kv): Promise<string[]> {
  const v = await kv.get(REGISTRY);
  return Array.isArray(v) ? (v as string[]) : [];
}

export async function loadImporter(kv: Kv, bin: string): Promise<ImporterDoc | undefined> {
  const v = await kv.get(docKey(bin));
  return v ? (v as unknown as ImporterDoc) : undefined;
}

export async function saveImporter(kv: Kv, doc: ImporterDoc): Promise<void> {
  await kv.put(docKey(doc.bin), doc as unknown as JsonValue);
  const bins = await listBins(kv);
  if (!bins.includes(doc.bin)) await kv.put(REGISTRY, [...bins, doc.bin].sort());
}

export function newImporter(bin: string, name: string, address?: string): ImporterDoc {
  return {
    bin,
    name,
    address,
    coefficients: {},
    customers: [],
    purchases: [],
    invoices: [],
    rotation: { round: 0, lastRoundIds: [], lastServed: {} },
    requests: {},
  };
}

const HS_CATALOG = "hs:catalog";

export type HsCatalog = Record<string, { hsCode: string; name: string }>;

export async function loadHsCatalog(kv: Kv): Promise<HsCatalog> {
  const v = await kv.get(HS_CATALOG);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as HsCatalog) : {};
}

export async function saveHsCatalog(kv: Kv, catalog: HsCatalog): Promise<void> {
  await kv.put(HS_CATALOG, catalog as unknown as JsonValue);
}

export async function requireImporter(kv: Kv, bin: string): Promise<ImporterDoc> {
  const doc = await loadImporter(kv, bin);
  if (!doc) {
    throw new Error(`No importer with BIN ${bin}. Save a bill of entry for it first.`);
  }
  return doc;
}

export async function loadSharedCustomers(kv: Kv): Promise<Customer[]> {
  const v = await kv.get(SHARED_CUSTOMERS);
  return Array.isArray(v) ? (v as unknown as Customer[]) : [];
}

export async function saveSharedCustomers(kv: Kv, customers: Customer[]): Promise<void> {
  await kv.put(SHARED_CUSTOMERS, customers as unknown as JsonValue);
}

export async function createImporter(
  kv: Kv,
  bin: string,
  name: string,
  address?: string,
): Promise<ImporterDoc> {
  const doc = newImporter(bin, name, address);
  doc.customers = await loadSharedCustomers(kv);
  return doc;
}
