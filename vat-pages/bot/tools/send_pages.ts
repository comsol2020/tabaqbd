import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { sendToVat } from "../lib/send.js";

export default defineTool({
  description: prompt`
    Split every given workspace file into one page and deliver each page
    to the VAT books inbox. A multi-page PDF becomes one PDF per page. Images
    stay one page. A ZIP is unpacked first. Pages stay pending: this does not
    confirm them and does not fill Mushak 6.1. The VAT books agent does that
    after the operator confirms.
  `,
  effect: "write",
  inputSchema: z.object({
    bin: z.string().describe("13-digit importer BIN; Bengali digits are fine"),
    paths: z.array(z.string().min(1)).min(1).describe("Workspace-relative PDF, image, ZIP, or folder paths"),
  }),
  dryRunResult: () => ({ pages: [], inbox: "dry-run", vat: { notified: false } }),
  execute({ bin, paths }, ctx) {
    return sendToVat({
      bin,
      paths,
      workspaceDir: ctx.workspaceDir,
      evalRun: ctx.session.purpose === "eval",
      mcp: ctx.host.mcp,
      kv: ctx.host.kv,
    });
  },
});
