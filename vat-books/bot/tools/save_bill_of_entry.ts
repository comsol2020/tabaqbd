import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { applyBoe, sameBill } from "../lib/boe.js";
import { diskDir, openDisk } from "../lib/disk.js";
import { glanceRows } from "../lib/glance.js";
import { mirrorImporter } from "../lib/mirror.js";
import { publishBooks } from "../lib/publish.js";
import { createImporter, loadHsCatalog, loadImporter, saveHsCatalog, saveImporter } from "../lib/store.js";
import { assertUploadForSave, markUploadPosted } from "../lib/uploads.js";
import { isIsoDate, normalizeBin } from "../lib/vat.js";

const money = z.number().min(0);

export default defineTool({
  description: prompt`
    Save one bill of entry that you have already read from an uploaded scan,
    and add its lines to the importer's Mushak 6.1 purchase book. Quantity is
    the net weight from box 38, in KG, and nothing else. If the goods description
    contains EXT= … KGS, pass that text as goodsDescription and pass box 38 alone
    as quantity; only those kilograms are added, and no money figure changes.
    The result includes glance (bill number, date, kg) for a quick check against
    the scan. Pass uploadId only for a website upload that is already confirmed.
    Product name comes from the shared HS
    catalogue (lookup_hs); pass productName only for an HS code the catalogue
    does not yet have — the name the operator typed, not the scan's description
    text. Value addition % is once per BIN: pass valueAdditionPct only if this
    importer has none yet. A BIN seen for the first time gets its books created
    automatically.     Saving the same bill of entry C-number and date again changes
    nothing, including a manual entry. When duplicate is true, tell the
    operator the notice in their language and stop. Do not add the stock
    again. Mushak 4.3 is published only on the first declaration or when
    unit cost moves more than 7.5%. 6.1 and 6.2.1 are published on every save.
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
      supplierAddress: z.string().optional().describe("Exporter's address as printed (box 2)"),
      valueAdditionPct: z
        .number()
        .min(0)
        .max(1000)
        .optional()
        .describe("Mushak 4.3 value addition % for this BIN. Required only the first time this BIN is seen; omit later"),
      declaredTotalTax: z
        .number()
        .optional()
        .describe("The 'Total' printed under the tax table (CD+RD+SD+VAT+AIT+AT), used to cross-check the reading"),
      items: z
        .array(
          z.object({
            hsCode: z.string().min(1).describe("Box 33, required"),
            productName: z
              .string()
              .optional()
              .describe("Only if lookup_hs says this HS is unknown: the name the operator typed"),
            unit: z.string().min(1).describe("Always KG from box 38"),
            quantity: z.number().positive().describe("Box 38 net weight only. Do not add EXT yourself and do not use box 41"),
            goodsDescription: z
              .string()
              .optional()
              .describe("Description of goods as printed. EXT= … KGS in this text is added to box 38"),
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
    uploadId: z
      .string()
      .optional()
      .describe("Website upload id. The upload must already be confirmed or it is refused"),
  }),
  dryRunResult: () => ({ saved: false }),
  async execute({ importer, boe, uploadId }, ctx) {
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
        `Name on this document ("${importer.name}") differs from the name on file ("${doc.name}") for BIN ${bin}. Filed under the BIN.`,
      );
    }
    const prior = doc.purchases.find((p) => sameBill(boe.number, boe.date, p.boeNo, p.boeDate));
    const duplicate = prior !== undefined;
    const website = openDisk();
    if (uploadId) await assertUploadForSave(website, uploadId, bin, duplicate);
    if (prior) {
      if (uploadId) await markUploadPosted(website, uploadId, prior.boeKey);
      const notice = `আগে ${prior.boeDate} তারিখে এই বিল অব এন্ট্রি (${prior.boeNo}) যোগ করা হয়েছে। আবার যোগ হয়নি।`;
      return { saved: false, duplicate: true, bin, boeKey: prior.boeKey, notice, warnings };
    }
    const catalog = await loadHsCatalog(kv);
    const result = applyBoe(doc, boe, catalog);
    warnings.push(...result.warnings);
    await saveHsCatalog(kv, result.catalog);
    await saveImporter(kv, doc);
    const mirrored = await mirrorImporter(doc, diskDir());
    if (!mirrored.ok) warnings.push(mirrored.warning);
    if (uploadId) await markUploadPosted(website, uploadId, boeKey);
    const forms = result.publish43 ? (["4.3", "6.1", "6.2.1"] as const) : (["6.1", "6.2.1"] as const);
    const published = await publishBooks(ctx.artifacts, doc, [...forms]);
    return {
      saved: true,
      duplicate: false,
      newImporter: isNewImporter,
      customersInherited: isNewImporter ? doc.customers.length : undefined,
      published,
      fourThreeRegenerated: result.publish43,
      additionPct: doc.additionPct,
      declaredUnitPrices: result.lines.map((l) => ({
        lineId: l.lineId,
        hsCode: l.hsCode,
        description: l.description,
        additionPct: l.additionPct,
        unitCost: l.unitCost,
        declaredUnitPrice: l.declaredUnitPrice,
      })),
      glance: {
        columns: ["বিল নং", "তারিখ", "কেজি"],
        rows: glanceRows(result.lines),
      },
      bin,
      importerName: doc.name,
      lineIds: result.lines.map((l) => l.lineId),
      warnings,
    };
  },
});
