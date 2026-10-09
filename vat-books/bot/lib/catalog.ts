import { normalizeHs } from "./vat.js";
import type { HsCatalog } from "./store.js";

export function lookupHs(catalog: HsCatalog, hsCode: string): { key: string; hsCode: string; name?: string } {
  const key = normalizeHs(hsCode);
  const hit = catalog[key];
  return { key, hsCode: hit?.hsCode ?? hsCode, name: hit?.name };
}

export function setHsName(catalog: HsCatalog, hsCode: string, name: string, replace = false): HsCatalog {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Product name cannot be empty.");
  const key = normalizeHs(hsCode);
  const existing = catalog[key];
  if (existing && existing.name.toLowerCase() !== trimmed.toLowerCase() && !replace) {
    throw new Error(
      `HS ${existing.hsCode} is already named "${existing.name}". Pass replace=true only if the operator is correcting that name.`,
    );
  }
  return { ...catalog, [key]: { hsCode: existing?.hsCode ?? hsCode.trim(), name: replace ? trimmed : (existing?.name ?? trimmed) } };
}

export function requireHsName(catalog: HsCatalog, hsCode: string, productName?: string): { catalog: HsCatalog; key: string; name: string; hsCode: string } {
  const found = lookupHs(catalog, hsCode);
  if (found.name) {
    return { catalog, key: found.key, name: found.name, hsCode: found.hsCode };
  }
  if (!productName?.trim()) {
    throw new Error(
      `Unknown HS code ${hsCode}. Ask the operator to type the product name once, then pass it as productName (or call set_product_name).`,
    );
  }
  const next = setHsName(catalog, hsCode, productName);
  const hit = next[found.key]!;
  return { catalog: next, key: found.key, name: hit.name, hsCode: hit.hsCode };
}
