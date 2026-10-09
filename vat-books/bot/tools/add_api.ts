import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { addApi } from "../lib/apis.js";
import { openDisk } from "../lib/disk.js";

export default defineTool({
  description: prompt`
    Register an API for later use: a label, an https base URL (http only on
    localhost), and the env var name that holds the key. Do not put the key
    in this call. Registering does not call the API and does not send books
    or scans anywhere.
  `,
  effect: "write",
  inputSchema: z.object({
    label: z.string(),
    baseUrl: z.string(),
    apiKeyEnv: z.string().describe("Uppercase env name, such as NBR_API_KEY"),
    id: z.string().optional().describe("Lowercase id. Derived from the label if omitted"),
    note: z.string().optional(),
  }),
  dryRunResult: () => ({ added: false }),
  async execute(input) {
    const entry = await addApi(openDisk(), input);
    return { added: true, api: entry };
  },
});
