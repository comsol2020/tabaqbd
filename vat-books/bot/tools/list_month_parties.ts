import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { syncDeletions } from "../lib/mirror.js";
import { type PartyActivity, partyActivity } from "../lib/month.js";
import { listBins, loadImporter } from "../lib/store.js";

export default defineTool({
  description: prompt`
    List importers that have a bill of entry or a challan in the month.
    Does not build the report or the service bill. Show the list and wait.
    Call monthly_report for one BIN only after the operator asks to generate
    that party's report. Applies month deletions already confirmed on the
    website before listing.
  `,
  effect: "write",
  inputSchema: z.object({
    month: z.string().describe("YYYY-MM"),
  }),
  dryRunResult: () => ({ parties: [] }),
  async execute({ month }, ctx) {
    const synced = await syncDeletions(ctx.host.kv);
    const parties: PartyActivity[] = [];
    for (const bin of await listBins(ctx.host.kv)) {
      const doc = await loadImporter(ctx.host.kv, bin);
      if (!doc) continue;
      const row = partyActivity(doc, month);
      if (row) parties.push(row);
    }
    return { month, parties, synced };
  },
});
