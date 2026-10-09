import { normalizeDigits, round2 } from "./vat.js";

/**
 * Kilograms printed as `EXT= … KGS` in the goods description.
 * Only that figure is returned. Other weights (box 41, packages, gross) are ignored.
 */
const EXT_PATTERN = /EXT\s*=\s*([0-9০-৯][0-9০-৯,\s]*?(?:\.[0-9০-৯]+)?)\s*KGS\b/gi;

export function extFromDescription(text: string): { kg: number; matches: number } {
  if (!text.trim()) return { kg: 0, matches: 0 };
  let kg = 0;
  let matches = 0;
  for (const hit of text.matchAll(EXT_PATTERN)) {
    const raw = normalizeDigits(hit[1] ?? "").replace(/[\s,]/g, "");
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) continue;
    kg = round2(kg + value);
    matches += 1;
  }
  return { kg, matches };
}
