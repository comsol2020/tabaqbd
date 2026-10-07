import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { buildBook } from "../lib/forms.js";
import { requireImporter } from "../lib/store.js";
import { normalizeBin } from "../lib/vat.js";

export default defineTool({
  description: prompt`
    Read an importer's business book as rows with totals: 6.1 purchase book,
    6.2 sales book, or 6.3 challans. Optionally filter by date range.
  `,
  effect: "read",
  inputSchema: z.object({
    bin: z.string(),
    form: z.enum(["6.1", "6.2", "6.3"]),
    from: z.string().optional().describe("YYYY-MM-DD"),
    to: z.string().optional().describe("YYYY-MM-DD"),
  }),
  async execute({ bin, form, from, to }, ctx) {
    const doc = await requireImporter(ctx.host.kv, normalizeBin(bin));
    const book = buildBook(doc, form, { from, to });
    return {
      title: book.titleBn,
      importer: book.importer,
      rowCount: book.rows.length,
      totals: book.totals,
      columns: book.columns.map((c) => c.key),
      rows: book.rows,
    };
  },
});
