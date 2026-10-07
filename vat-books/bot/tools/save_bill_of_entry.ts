import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { publishBooks } from "../lib/publish.js";
import { createImporter, loadImporter, saveImporter } from "../lib/store.js";
import type { PurchaseLine } from "../lib/types.js";
import { declaredPrice, dutyTotal, impliedImportVatRate, isIsoDate, normalizeBin, vatRateLooksOff } from "../lib/vat.js";

const money = z.number().min(0);

export default defineTool({
  description: prompt`
    Save one bill of entry that you have already read from an uploaded scan,
    and add its lines to the importer's Mushak 6.1 purchase book. A BIN seen
    for the first time gets its books created automatically from the BIN and
    name on the document, and the 4.3 and 6.1 books are published as CSV and HTML, so
    never ask the operator to register an importer separately. Saving the same
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
      valueAdditionPct: z
        .number()
        .min(0)
        .max(1000)
        .describe("Mushak 4.3 value addition % typed by the operator for this bill of entry. Ask for it if not given; never invent one"),
      declaredTotalTax: z
        .number()
        .optional()
        .describe("The 'Total' printed under the tax table (CD+RD+SD+VAT+AIT+AT), used to cross-check the reading"),
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
            valueAdditionPct: z.number().min(0).max(1000).optional().describe("Overrides the bill of entry level % for this item"),
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
    const existing = await loadImporter(kv, bin);
    const isNewImporter = !existing;
    const doc = existing ?? (await createImporter(kv, bin, importer.name.trim(), importer.address));
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
      const pct = it.valueAdditionPct ?? boe.valueAdditionPct;
      const price = declaredPrice(it, pct);
      const prev = [...doc.purchases]
        .reverse()
        .find((p) => (it.hsCode && p.hsCode === it.hsCode) || p.description === it.description);
      if (prev && prev.unitCost > 0) {
        const change = (price.unitCost - prev.unitCost) / prev.unitCost;
        if (Math.abs(change) > 0.075) {
          warnings.push(
            `Item ${i + 1}: unit cost moved ${(change * 100).toFixed(1)}% from ${prev.unitCost} (${prev.boeNo}). Mushak 4.3 note 2: a change of more than 7.5% needs a new declaration.`,
          );
        }
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
        additionPct: pct,
        ...price,
      };
    });
    if (boe.declaredTotalTax !== undefined) {
      const computed = dutyTotal(boe.items);
      if (Math.abs(computed - boe.declaredTotalTax) > 1) {
        warnings.push(
          `Duties add up to ${computed} but the document total is ${boe.declaredTotalTax}. A figure was probably misread. Re-check the scan before relying on this book.`,
        );
      }
    }
    doc.purchases.push(...lines);
    await saveImporter(kv, doc);
    const published = await publishBooks(ctx.artifacts, doc, ["4.3", "6.1"]);
    return {
      saved: true,
      duplicate: false,
      newImporter: isNewImporter,
      customersInherited: isNewImporter ? doc.customers.length : undefined,
      published,
      declaredUnitPrices: lines.map((l) => ({ lineId: l.lineId, additionPct: l.additionPct, unitCost: l.unitCost, declaredUnitPrice: l.declaredUnitPrice })),
      bin,
      importerName: doc.name,
      lineIds: lines.map((l) => l.lineId),
      warnings,
    };
  },
});
