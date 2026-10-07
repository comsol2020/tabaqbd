import type { ToolContext } from "@cursor/bdk/tools";
import type { ImporterDoc } from "./types.js";

export type Kv = ToolContext["host"]["kv"];
type JsonValue = Parameters<Kv["put"]>[1];

const REGISTRY = "importers";
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
    customers: [],
    purchases: [],
    invoices: [],
    rotation: { round: 0, lastRoundIds: [], lastServed: {} },
    requests: {},
  };
}

export async function requireImporter(kv: Kv, bin: string): Promise<ImporterDoc> {
  const doc = await loadImporter(kv, bin);
  if (!doc) {
    throw new Error(`No importer with BIN ${bin}. Save a bill of entry for it first.`);
  }
  return doc;
}
