import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { lookupHs, setHsName } from "../lib/catalog.js";
import { loadHsCatalog, saveHsCatalog } from "../lib/store.js";

export default defineTool({
  description: prompt`
    Store the product name the operator typed for an HS code (box 33). Shared
    across every importer. Use this the first time that HS appears, or with
    replace=true only when the operator is correcting a stored name.
  `,
  effect: "write",
  inputSchema: z.object({
    hsCode: z.string().min(1),
    name: z.string().min(1),
    replace: z.boolean().optional().describe("Only if the operator is correcting an existing name"),
  }),
  dryRunResult: () => ({ saved: false }),
  async execute({ hsCode, name, replace }, ctx) {
    const catalog = await loadHsCatalog(ctx.host.kv);
    const next = setHsName(catalog, hsCode, name, replace ?? false);
    await saveHsCatalog(ctx.host.kv, next);
    const hit = lookupHs(next, hsCode);
    return { saved: true, hsCode: hit.hsCode, name: hit.name };
  },
});
