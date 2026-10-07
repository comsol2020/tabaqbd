import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { loadImporter, newImporter, saveImporter } from "../lib/store.js";
import type { PurchaseLine } from "../lib/types.js";
import { impliedImportVatRate, isIsoDate, normalizeBin, vatRateLooksOff } from "../lib/vat.js";

const money = z.number().min(0);

export default defineTool({
  description: prompt`
    Save one bill of entry that you have already read from an uploaded scan,
    and add its lines to the importer's Mushak 6.1 purchase book. The importer
    is created from its BIN and name if it does not exist yet. Saving the same
    bill of entry number and date again changes nothing. Pass money exactly as
    printed, in BDT, as plain numbers.
  `,
  effect: "write",
  inputSchema: z.object({
    importer: z.object({
      bin: z.string().describe("13-digit BIN of the importer; Bengali digits are fine"),
      name: z.string().min(1),
      address: z.string().optional(),
    }),
    boe: z.object({
      number: z.string().min(1),
      date: z.string().describe("YYYY-MM-DD"),
      customsHouse: z.string().optional(),
      supplierName: z.string().optional(),
      items: z
        .array(
          z.object({
            description: z.string().min(1),
            hsCode: z.string().optional(),
            unit: z.string().min(1),
            quantity: z.number().positive(),
            assessableValue: money,
            cd: money.default(0),
            rd: money.default(0),
            sd: money.default(0),
            vat: money,
            ait: money.default(0),
            at: money.default(0),
          }),
        )
        .min(1),
    }),
  }),
  dryRunResult: () => ({ saved: false }),
  async execute({ importer, boe }, ctx) {
    const bin = normalizeBin(importer.bin);
    if (!isIsoDate(boe.date)) throw new Error(`boe.date must be YYYY-MM-DD, got "${boe.date}"`);
    const kv = ctx.host.kv;
    const boeKey = `${boe.number.trim()}|${boe.date}`;
    const doc = (await loadImporter(kv, bin)) ?? newImporter(bin, importer.name.trim(), importer.address);
    const warnings: string[] = [];
    if (doc.name.trim().toLowerCase() !== importer.name.trim().toLowerCase()) {
      warnings.push(
        `Name on this document ("${importer.name}") differs from the name on file ("${doc.name}") for BIN ${bin}. Filed under the BIN; please verify.`,
      );
    }
    if (doc.purchases.some((p) => p.boeKey === boeKey)) {
      return { saved: false, duplicate: true, bin, boeKey, warnings };
    }
    const base = doc.purchases.length;
    const lines = boe.items.map((it, i): PurchaseLine => {
      const rate = impliedImportVatRate(it);
      if (vatRateLooksOff(rate)) {
        warnings.push(
          `Item ${i + 1}: VAT implies ${rate}% of (AV+CD+RD+SD), which is not a usual rate. Re-check the scan.`,
        );
      }
      return {
        lineId: `${boeKey}#${i + 1}`,
        boeKey,
        serial: base + i + 1,
        boeNo: boe.number.trim(),
        boeDate: boe.date,
        customsHouse: boe.customsHouse,
        supplierName: boe.supplierName,
        description: it.description,
        hsCode: it.hsCode,
        unit: it.unit,
        quantity: it.quantity,
        assessableValue: it.assessableValue,
        cd: it.cd,
        rd: it.rd,
        sd: it.sd,
        vat: it.vat,
        ait: it.ait,
        at: it.at,
      };
    });
    doc.purchases.push(...lines);
    await saveImporter(kv, doc);
    return {
      saved: true,
      duplicate: false,
      bin,
      importerName: doc.name,
      lineIds: lines.map((l) => l.lineId),
      warnings,
    };
  },
});
