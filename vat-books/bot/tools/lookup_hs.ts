import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { lookupHs } from "../lib/catalog.js";
import { loadHsCatalog } from "../lib/store.js";

export default defineTool({
  description: prompt`
    Look up product names for HS codes in the shared catalogue (all importers).
    Call this after reading box 33, before save_bill_of_entry. For each unknown
    code, ask the operator to type the name once; never invent one and never
    ask again for a code that already has a name.
  `,
  effect: "read",
  inputSchema: z.object({
    hsCodes: z.array(z.string().min(1)).min(1),
  }),
  async execute({ hsCodes }, ctx) {
    const catalog = await loadHsCatalog(ctx.host.kv);
    const items = hsCodes.map((hsCode) => {
      try {
        const hit = lookupHs(catalog, hsCode);
        return { hsCode, known: Boolean(hit.name), name: hit.name ?? null };
      } catch (e) {
        return { hsCode, known: false, name: null, error: e instanceof Error ? e.message : String(e) };
      }
    });
    return {
      items,
      unknown: items.filter((i) => !i.known).map((i) => i.hsCode),
    };
  },
});
