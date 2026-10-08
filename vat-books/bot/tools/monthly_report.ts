import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { listBins, loadImporter, requireImporter } from "../lib/store.js";
import { type SummaryRow, monthlyReport, reportHtml, reportXlsx, summaryXlsx } from "../lib/report.js";
import { normalizeBin } from "../lib/vat.js";

export default defineTool({
  description: prompt`
    Monthly report for the operator's manual Mushak 9.1 entry (no portal
    involved), laid out like the return. With a bin: the return notes, sub-form
    3.8 (sales per item), sub-form 4.22 (imports per bill of entry item) and
    stock (opening, imported, sold, closing), each item kept separate because
    each item has its own stock. Without a bin: one summary row per importer.
    Publishes an Excel file and a printable page.
  `,
  effect: "write",
  inputSchema: z.object({
    month: z.string().describe("YYYY-MM"),
    bin: z.string().optional().describe("Omit for the all-importers summary"),
  }),
  dryRunResult: () => ({ published: [] }),
  async execute({ month, bin }, ctx) {
    const kv = ctx.host.kv;
    if (bin) {
      const doc = await requireImporter(kv, normalizeBin(bin));
      const report = monthlyReport(doc, month);
      const key = `${doc.bin}/report-${month}`;
      const x = await ctx.artifacts.tag({
        kind: "report",
        key: `${key}.xlsx`,
        title: `${doc.name} (${doc.bin}) monthly report ${month} .xlsx`,
        data: { bin: doc.bin, month },
        contents: reportXlsx(report),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const h = await ctx.artifacts.tag({
        kind: "report",
        key: `${key}.html`,
        title: `${doc.name} (${doc.bin}) monthly report ${month} .html`,
        data: { bin: doc.bin, month },
        contents: reportHtml(report),
        contentType: "text/html; charset=utf-8",
      });
      return { ...report, published: [x.id, h.id] };
    }
    const rows: SummaryRow[] = [];
    for (const b of await listBins(kv)) {
      const doc = await loadImporter(kv, b);
      if (!doc) continue;
      const t = monthlyReport(doc, month).totals;
      rows.push({
        bin: doc.bin,
        name: doc.name,
        importedValue: t.importedValue,
        importedVat: t.importedVat,
        challans: t.challans,
        soldValue: t.soldValue,
        soldVat: t.soldVat,
        soldTotal: t.soldTotal,
      });
    }
    const a = await ctx.artifacts.tag({
      kind: "report",
      key: `all/report-${month}.xlsx`,
      title: `All importers monthly summary ${month} .xlsx`,
      data: { month, importers: rows.length },
      contents: summaryXlsx(month, rows),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    return { month, importers: rows, published: [a.id] };
  },
});
