import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import {
  loadImporter,
  loadSharedCustomers,
  saveImporter,
  saveSharedCustomers,
} from "../lib/store.js";
import type { Customer } from "../lib/types.js";
import { customerKey, normalizeBin } from "../lib/vat.js";

export default defineTool({
  description: prompt`
    Add customers to a customer list. With a bin, the list belongs to that
    importer. Without a bin, it is the shared master list that every importer
    created afterwards starts with (existing importers are not changed).
    Customers already on the list (same BIN, else same NID, else same name)
    are skipped, so the call is safe to repeat. Order is preserved because it
    is the tie-break for rotation.
  `,
  effect: "write",
  inputSchema: z.object({
    bin: z.string().optional().describe("Omit to update the shared master list"),
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
  async execute({ bin: rawBin, customers }, ctx) {
    const kv = ctx.host.kv;
    const doc = rawBin ? await loadImporter(kv, normalizeBin(rawBin)) : undefined;
    if (rawBin && !doc) {
      throw new Error(`No importer ${rawBin} yet. Save its bill of entry first (that creates it).`);
    }
    const list: Customer[] = doc ? doc.customers : await loadSharedCustomers(kv);
    const have = new Set(list.map((c) => c.id));
    let added = 0;
    for (const c of customers) {
      const id = customerKey(c);
      if (have.has(id)) continue;
      have.add(id);
      const entry: Customer = { id, name: c.name.trim(), address: c.address };
      if (c.bin) entry.bin = c.bin;
      if (c.nid) entry.nid = c.nid;
      list.push(entry);
      added += 1;
    }
    if (doc) await saveImporter(kv, doc);
    else await saveSharedCustomers(kv, list);
    return {
      list: doc ? doc.bin : "shared",
      added,
      skipped: customers.length - added,
      total: list.length,
    };
  },
});
