import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { diskDir, openDisk } from "../lib/disk.js";
import { listUploads, uploadFile } from "../lib/uploads.js";
import { normalizeBin } from "../lib/vat.js";

export default defineTool({
  description: prompt`
    List pages importers uploaded on the website. A pending page is not in
    the books. Read and save a page only after its status is confirmed, and
    pass its id as uploadId to save_bill_of_entry. filePath is set only once
    the page is confirmed. If entryDate is set, that is the bill of entry
    date: pass it as boe.date. Do not use the upload day instead.
  `,
  effect: "read",
  inputSchema: z.object({
    bin: z.string().optional().describe("Omit to list every importer"),
    status: z.enum(["pending", "confirmed", "posted"]).optional(),
  }),
  dryRunResult: () => ({ uploads: [] }),
  async execute({ bin, status }) {
    const rows = await listUploads(openDisk(), bin ? normalizeBin(bin) : undefined);
    const filtered = status ? rows.filter((row) => row.status === status) : rows;
    return {
      uploads: filtered.map((row) => ({
        id: row.id,
        bin: row.bin,
        fileName: row.fileName,
        contentType: row.contentType,
        bytes: row.bytes,
        status: row.status,
        createdAt: row.createdAt,
        entryDate: row.entryDate,
        filePath: row.status === "pending" ? undefined : uploadFile(diskDir(), row.id),
      })),
    };
  },
});
