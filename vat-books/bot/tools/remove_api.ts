import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { removeApi } from "../lib/apis.js";
import { openDisk } from "../lib/disk.js";

export default defineTool({
  description: prompt`
    Remove one registered API by id. Does not call the API and does not
    change the books.
  `,
  effect: "write",
  inputSchema: z.object({
    id: z.string(),
  }),
  dryRunResult: () => ({ removed: false }),
  async execute({ id }) {
    return { removed: await removeApi(openDisk(), id), id };
  },
});
