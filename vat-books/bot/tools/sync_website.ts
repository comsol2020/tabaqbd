import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { syncDeletions } from "../lib/mirror.js";

export default defineTool({
  description: prompt`
    Apply month deletions the operator already confirmed on the website
    (osbdsyl.online) onto these chat books. Does not delete a month that
    was not confirmed there. Call this before a monthly report or get_books
    so the books match the website.
  `,
  effect: "write",
  inputSchema: z.object({}),
  dryRunResult: () => ({ applied: [] }),
  async execute(_input, ctx) {
    return syncDeletions(ctx.host.kv);
  },
});
