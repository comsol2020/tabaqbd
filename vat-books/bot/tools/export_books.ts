import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import type { FormId } from "../lib/forms.js";
import { publishBooks } from "../lib/publish.js";
import { requireImporter } from "../lib/store.js";
import { normalizeBin } from "../lib/vat.js";

const FORMS: FormId[] = ["4.3", "6.1", "6.2", "6.3"];

export default defineTool({
  description: prompt`
    Re-publish an importer's books (4.3, 6.1, 6.2, 6.3) as downloadable CSV and
    printable HTML. Books are already published automatically when a bill of
    entry is saved or sales are confirmed, so call this only on request.
  `,
  effect: "write",
  inputSchema: z.object({
    bin: z.string(),
    forms: z.array(z.enum(["4.3", "6.1", "6.2", "6.3"])).default(FORMS),
  }),
  dryRunResult: () => ({ exported: [] }),
  async execute({ bin: rawBin, forms }, ctx) {
    const doc = await requireImporter(ctx.host.kv, normalizeBin(rawBin));
    return { bin: doc.bin, exported: await publishBooks(ctx.artifacts, doc, forms) };
  },
});
