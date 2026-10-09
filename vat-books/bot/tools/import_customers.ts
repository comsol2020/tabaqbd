import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { addCustomers } from "../lib/store.js";

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
  async execute({ bin, customers }, ctx) {
    return addCustomers(ctx.host.kv, bin, customers);
  },
});
