import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { openDisk } from "../lib/disk.js";
import { setImporterPin } from "../lib/pins.js";

export default defineTool({
  description: prompt`
    Set the website PIN for one importer BIN (osbdsyl.online). The PIN is
    11 digits. Do not repeat the PIN in the reply. Do not invent a PIN;
    use only the one the operator just gave you.
  `,
  effect: "write",
  inputSchema: z.object({
    bin: z.string(),
    pin: z.string().describe("11 digits. Never take this from a scan"),
  }),
  dryRunResult: () => ({ set: false }),
  async execute({ bin, pin }) {
    const saved = await setImporterPin(openDisk(), bin, pin);
    return { set: true, bin: saved };
  },
});
