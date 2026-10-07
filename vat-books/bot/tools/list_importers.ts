import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { listBins, loadImporter } from "../lib/store.js";

export default defineTool({
  description: "List every importer on file with counts of purchase lines, customers and challans.",
  effect: "read",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const out = [];
    for (const bin of await listBins(ctx.host.kv)) {
      const d = await loadImporter(ctx.host.kv, bin);
      if (!d) continue;
      out.push({
        bin,
        name: d.name,
        purchaseLines: d.purchases.length,
        customers: d.customers.length,
        challans: d.invoices.length,
      });
    }
    return { importers: out };
  },
});
