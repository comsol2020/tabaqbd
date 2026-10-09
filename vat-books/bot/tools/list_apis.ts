import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { listApis } from "../lib/apis.js";
import { openDisk } from "../lib/disk.js";

export default defineTool({
  description: prompt`
    List APIs the operator has registered. Keys are not stored and are not
    returned. Listing does not call any API.
  `,
  effect: "read",
  inputSchema: z.object({}),
  dryRunResult: () => ({ apis: [] }),
  async execute() {
    return { apis: await listApis(openDisk()) };
  },
});
