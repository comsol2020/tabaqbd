import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { createImporter, loadImporter, saveImporter } from "../lib/store.js";
import { normalizeBin } from "../lib/vat.js";

export default defineTool({
  description: prompt`
    Set the Mushak 4.3 value addition % for one importer (one figure per BIN).
    The operator tells it once. Later bills of entry reuse it. If this BIN is
    not on file yet, pass the importer name so the record can be created.
    Do not invent a percentage.
  `,
  effect: "write",
  inputSchema: z.object({
    bin: z.string(),
    valueAdditionPct: z.number().min(0).max(1000),
    name: z.string().optional().describe("Required only if this BIN is not on file yet"),
  }),
  dryRunResult: () => ({ saved: false }),
  async execute({ bin, valueAdditionPct, name }, ctx) {
    const id = normalizeBin(bin);
    const kv = ctx.host.kv;
    let doc = await loadImporter(kv, id);
    if (!doc) {
      if (!name?.trim()) {
        throw new Error(`No importer with BIN ${id}. Pass name to create it, or save a bill of entry first.`);
      }
      doc = await createImporter(kv, id, name.trim());
    }
    const previous = doc.additionPct;
    doc.additionPct = valueAdditionPct;
    await saveImporter(kv, doc);
    return { saved: true, bin: doc.bin, name: doc.name, previous, valueAdditionPct };
  },
});
