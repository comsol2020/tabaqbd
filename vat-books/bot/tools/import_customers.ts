import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { loadImporter, newImporter, saveImporter } from "../lib/store.js";
import type { Customer } from "../lib/types.js";
import { customerKey, normalizeBin } from "../lib/vat.js";

export default defineTool({
  description: prompt`
    Add customers to an importer's customer list. Customers already on the
    list (same BIN, else same NID, else same name) are skipped, so the call
    is safe to repeat. Order is preserved because it is the tie-break for
    rotation.
  `,
  effect: "write",
  inputSchema: z.object({
    bin: z.string(),
    importerName: z.string().optional().describe("Only needed if the importer does not exist yet"),
    customers: z
      .array(
        z.object({
          name: z.string().min(1),
          bin: z.string().optional(),
          nid: z.string().optional(),
          address: z.string().default(""),
        }),
      )
      .min(1),
  }),
  dryRunResult: () => ({ added: 0 }),
  async execute({ bin: rawBin, importerName, customers }, ctx) {
    const bin = normalizeBin(rawBin);
    const kv = ctx.host.kv;
    let doc = await loadImporter(kv, bin);
    if (!doc) {
      if (!importerName) throw new Error(`No importer ${bin}; pass importerName or save a bill of entry first.`);
      doc = newImporter(bin, importerName);
    }
    const have = new Set(doc.customers.map((c) => c.id));
    let added = 0;
    for (const c of customers) {
      const id = customerKey(c);
      if (have.has(id)) continue;
      have.add(id);
      const entry: Customer = { id, name: c.name.trim(), address: c.address };
      if (c.bin) entry.bin = c.bin;
      if (c.nid) entry.nid = c.nid;
      doc.customers.push(entry);
      added += 1;
    }
    await saveImporter(kv, doc);
    return { bin, added, skipped: customers.length - added, total: doc.customers.length };
  },
});
