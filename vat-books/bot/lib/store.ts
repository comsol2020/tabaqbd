import type { ToolContext } from "@cursor/bdk/tools";
import type { Customer, ImporterDoc } from "./types.js";
import { customerKey, normalizeBin } from "./vat.js";

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

export type CustomerInput = { name: string; bin?: string; nid?: string; address?: string };

/** Same rules as import_customers: BIN, else NID, else name. Existing rows stay, new ones append. */
export async function addCustomers(
  kv: Kv,
  rawBin: string | undefined,
  customers: CustomerInput[],
): Promise<{ list: string; added: number; skipped: number; total: number }> {
  const doc = rawBin ? await loadImporter(kv, normalizeBin(rawBin)) : undefined;
  if (rawBin && !doc) {
    throw new Error(`No importer ${rawBin} yet. Save its bill of entry first (that creates it).`);
  }
  const list: Customer[] = doc ? doc.customers : await loadSharedCustomers(kv);
  const have = new Set(list.map((c) => c.id));
  let added = 0;
  for (const c of customers) {
    const name = c.name.trim();
    if (!name) continue;
    const id = customerKey({ name, bin: c.bin, nid: c.nid });
    if (have.has(id)) continue;
    have.add(id);
    const entry: Customer = { id, name, address: (c.address ?? "").trim() };
    if (c.bin?.trim()) entry.bin = c.bin.trim();
    if (c.nid?.trim()) entry.nid = c.nid.trim();
    list.push(entry);
    added += 1;
  }
  if (doc) await saveImporter(kv, doc);
  else await saveSharedCustomers(kv, list);
  return { list: doc ? doc.bin : "shared", added, skipped: customers.length - added, total: list.length };
}

export async function removeCustomer(kv: Kv, rawBin: string | undefined, id: string): Promise<void> {
  if (rawBin) {
    const doc = await loadImporter(kv, normalizeBin(rawBin));
    if (!doc) throw new Error(`No importer ${rawBin} yet. Save its bill of entry first (that creates it).`);
    doc.customers = doc.customers.filter((c) => c.id !== id);
    await saveImporter(kv, doc);
    return;
  }
  const list = await loadSharedCustomers(kv);
  await saveSharedCustomers(kv, list.filter((c) => c.id !== id));
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
