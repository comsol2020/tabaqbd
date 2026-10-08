import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { serviceBill } from "../lib/billing.js";
import { monthlyReport } from "../lib/report.js";
import { requireImporter } from "../lib/store.js";
import { normalizeBin } from "../lib/vat.js";

export default defineTool({
  description: prompt`
    Service-fee calculator for one importer for one month. First 5 bills of
    entry = 500 Tk total, each further B/E = 50 Tk. Same slab for Mushak 6.3
    challans. Pass a bin and month to count from the books, or pass the two
    counts yourself.
  `,
  effect: "read",
  inputSchema: z.object({
    bin: z.string().optional(),
    month: z.string().optional().describe("YYYY-MM, with bin"),
    boeCount: z.number().int().min(0).optional(),
    challanCount: z.number().int().min(0).optional(),
  }),
  async execute({ bin, month, boeCount, challanCount }, ctx) {
    if (bin && month) {
      const doc = await requireImporter(ctx.host.kv, normalizeBin(bin));
      const r = monthlyReport(doc, month);
      return { month, bin: doc.bin, name: doc.name, ...r.bill };
    }
    if (boeCount === undefined || challanCount === undefined) {
      throw new Error("Pass bin+month, or both boeCount and challanCount.");
    }
    return serviceBill(boeCount, challanCount);
  },
});
