import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { openDisk } from "../lib/disk.js";
import { confirmUpload } from "../lib/uploads.js";

export default defineTool({
  description: prompt`
    Confirm one website upload so it may enter the books. Until this is
    called, save_bill_of_entry refuses that uploadId. Confirming does not
    invent figures; read the page and save it afterwards.
  `,
  effect: "write",
  inputSchema: z.object({
    uploadId: z.string().describe("Id from list_pending_uploads"),
  }),
  dryRunResult: () => ({ status: "pending" }),
  async execute({ uploadId }) {
    const upload = await confirmUpload(openDisk(), uploadId);
    return {
      id: upload.id,
      bin: upload.bin,
      status: upload.status,
      fileName: upload.fileName,
    };
  },
});
