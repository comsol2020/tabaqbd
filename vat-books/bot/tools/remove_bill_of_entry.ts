import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { removeBoe } from "../lib/boe.js";
import { publishBooks } from "../lib/publish.js";
import { requireImporter, saveImporter } from "../lib/store.js";
import { normalizeBin } from "../lib/vat.js";

export default defineTool({
  description: prompt`
    Remove a saved bill of entry that was read wrongly from a scan (wrong
    number, date or figures) so it can be saved again correctly. Only for
    bills of entry that no challan has been issued against. Use the number and
    date exactly as they were saved.
  `,
  effect: "write",
  inputSchema: z.object({
    bin: z.string(),
    number: z.string().describe("Bill of entry number as saved"),
    date: z.string().describe("YYYY-MM-DD as saved"),
  }),
  dryRunResult: () => ({ removed: false }),
  async execute({ bin, number, date }, ctx) {
    const doc = await requireImporter(ctx.host.kv, normalizeBin(bin));
    const { removedLines } = removeBoe(doc, number, date);
    await saveImporter(ctx.host.kv, doc);
    const published = await publishBooks(ctx.artifacts, doc, ["4.3", "6.1", "6.2.1"]);
    return { removed: true, bin: doc.bin, removedLines, published };
  },
});
