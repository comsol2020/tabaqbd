import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { loadCatalog } from "../lib/providers.js";

const ProviderView = z.object({
  id: z.string(),
  label: z.string(),
  protocol: z.literal("openai-compatible"),
  configured: z.boolean(),
  apiKeyEnv: z.string(),
  defaultModel: z.string(),
  baseUrl: z.string(),
  baseHost: z.string(),
});

export default defineTool({
  description:
    "List model APIs. Miarouter is always present. Extra APIs come from EXTRA_PROVIDERS_JSON. Never returns API keys.",
  effect: "read",
  inputSchema: z.object({}),
  outputSchema: z.object({
    defaultProviderId: z.literal("miarouter"),
    providers: z.array(ProviderView),
    ignored: z.array(z.object({ reason: z.string() })),
  }),
  async execute() {
    return loadCatalog();
  },
});
