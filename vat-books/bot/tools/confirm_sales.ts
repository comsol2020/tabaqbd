import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { publishBooks } from "../lib/publish.js";
import { confirmSales } from "../lib/sales.js";
import { requireImporter, saveImporter } from "../lib/store.js";
import { salesInput } from "../lib/schemas.js";
import { normalizeBin } from "../lib/vat.js";

export default defineTool({
  description: prompt`
    Record a sales round after the user approved the preview: one Mushak 6.3
    challan per selected customer, each also entered in the 6.2 sales book,
    and the rotation advances. Pass the same requestId on a retry and nothing
    is recorded twice. Only call this for real sales the user confirmed.
  `,
  effect: "write",
  inputSchema: z.object({
    ...salesInput,
    requestId: z.string().min(8).describe("Unique id for this approval, reused on retry"),
  }),
  dryRunResult: () => ({ recorded: false }),
  async execute({ bin: rawBin, requestId, ...req }, ctx) {
    const bin = normalizeBin(rawBin);
    const doc = await requireImporter(ctx.host.kv, bin);
    const result = confirmSales(doc, req, requestId);
    if (result.duplicate) return { bin, ...result };
    await saveImporter(ctx.host.kv, doc);
    const published = await publishBooks(ctx.artifacts, doc, ["6.1", "6.2", "6.2.1", "6.3"]);
    return { bin, ...result, published };
  },
});
