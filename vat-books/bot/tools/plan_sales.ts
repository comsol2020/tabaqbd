import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { planSales } from "../lib/sales.js";
import { requireImporter } from "../lib/store.js";
import { normalizeBin } from "../lib/vat.js";
import { salesInput } from "../lib/schemas.js";

export default defineTool({
  description: prompt`
    Preview a sales round without saving anything: which customers the
    rotation picks, the unit price (the Mushak 4.3 declared price of that purchase line, never anything else), the amounts for each Mushak 6.3 challan, and the stock
    left. Customers served in the previous round are skipped. Always show
    this to the user and get approval before confirm_sales.
  `,
  effect: "read",
  inputSchema: z.object(salesInput),
  async execute({ bin, ...req }, ctx) {
    const doc = await requireImporter(ctx.host.kv, normalizeBin(bin));
    const plan = planSales(doc, req);
    return {
      importer: doc.name,
      line: plan.line.lineId,
      unitPrice: plan.line.declaredUnitPrice,
      additionPct: plan.line.additionPct,
      remainingBefore: plan.remainingBefore,
      remainingAfter: plan.remainingAfter,
      excludedPreviousRound: plan.excludedPreviousRound,
      warnings: plan.warnings,
      sales: plan.sales.map((s) => ({
        buyer: s.buyerName,
        quantity: s.quantity,
        value: s.value,
        vat: s.vat,
        total: s.total,
      })),
    };
  },
});
