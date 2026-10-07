import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { type FormId, buildBook, toCsv, toHtml } from "../lib/forms.js";
import { requireImporter } from "../lib/store.js";
import { normalizeBin } from "../lib/vat.js";

const FORMS: FormId[] = ["6.1", "6.2", "6.3"];

export default defineTool({
  description: prompt`
    Publish an importer's books (6.1, 6.2, 6.3) as downloadable CSV (opens in
    Excel) and printable HTML files. Re-running replaces the earlier export.
  `,
  effect: "write",
  inputSchema: z.object({
    bin: z.string(),
    forms: z.array(z.enum(["6.1", "6.2", "6.3"])).default(FORMS),
  }),
  dryRunResult: () => ({ exported: [] }),
  async execute({ bin: rawBin, forms }, ctx) {
    const bin = normalizeBin(rawBin);
    const doc = await requireImporter(ctx.host.kv, bin);
    const exported = [];
    for (const form of forms) {
      const book = buildBook(doc, form);
      for (const [ext, contents, contentType] of [
        ["csv", toCsv(book), "text/csv; charset=utf-8"],
        ["html", toHtml(book), "text/html; charset=utf-8"],
      ] as const) {
        const record = await ctx.artifacts.tag({
          kind: "book",
          key: `${bin}/mushak-${form}.${ext}`,
          title: `${doc.name} (${bin}) ${book.titleEn} .${ext}`,
          data: { bin, form, ext, rows: book.rows.length },
          contents,
          contentType,
        });
        exported.push({ form, ext, artifactId: record.id, rows: book.rows.length });
      }
    }
    return { bin, exported };
  },
});
