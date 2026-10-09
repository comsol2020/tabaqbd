import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { diskDir, openDisk } from "../lib/disk.js";
import { mirrorImporter, recordDeletion } from "../lib/mirror.js";
import { applyReset, previewReset } from "../lib/month.js";
import { publishBooks } from "../lib/publish.js";
import { requireImporter, saveImporter } from "../lib/store.js";
import { normalizeBin } from "../lib/vat.js";

export default defineTool({
  description: prompt`
    Delete one BIN's whole month: every bill of entry and every challan dated
    in that month. Other months, the PIN, and Mushak 4.3 stay. Call first
    without confirm and show the confirmation message (the phrase, the bill
    numbers and the challan numbers). Call again with confirm set to that
    exact phrase only after the operator confirms the message. Any other
    confirm value deletes nothing.
  `,
  effect: "write",
  inputSchema: z.object({
    bin: z.string(),
    month: z.string().describe("YYYY-MM"),
    confirm: z
      .string()
      .optional()
      .describe("Exact phrase from the preview. Omit to preview only"),
  }),
  dryRunResult: () => ({ deleted: false }),
  async execute({ bin: rawBin, month, confirm }, ctx) {
    const bin = normalizeBin(rawBin);
    const doc = await requireImporter(ctx.host.kv, bin);
    const preview = previewReset(doc, month);
    if (!confirm) return { deleted: false, ...preview };
    if (confirm.trim() !== preview.phrase) {
      throw new Error(`Confirmation did not match. Nothing was deleted. The message to confirm is: ${preview.phrase}`);
    }
    applyReset(doc, month);
    await saveImporter(ctx.host.kv, doc);
    const website = openDisk();
    await recordDeletion(website, bin, month);
    const mirrored = await mirrorImporter(doc, diskDir());
    const published = await publishBooks(ctx.artifacts, doc, ["6.1", "6.2", "6.2.1", "6.3"]);
    return {
      deleted: true,
      ...preview,
      published,
      websiteMirror: mirrored.ok ? undefined : mirrored.warning,
    };
  },
});
