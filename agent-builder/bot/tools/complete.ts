import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { completeChat, MAX_MESSAGE_CHARS, MAX_MESSAGES, MAX_OUTPUT_TOKENS } from "../lib/providers.js";

const message = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(MAX_MESSAGE_CHARS),
});

export default defineTool({
  description:
    "Send a chat completion to one configured API. Defaults to Miarouter. Use this to try a prompt or draft with a model.",
  effect: "write",
  inputSchema: z.object({
    providerId: z.string().optional().describe("Provider id from list_providers. Omit for Miarouter."),
    model: z.string().min(1).max(200).optional().describe("Model id. Omit for the provider default."),
    messages: z.array(message).min(1).max(MAX_MESSAGES),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(1).max(MAX_OUTPUT_TOKENS).optional(),
  }),
  dryRunResult: ({ providerId, model }) => ({
    ok: true as const,
    dryRun: true,
    providerId: providerId ?? "miarouter",
    model: model ?? null,
    content: "",
  }),
  async execute(input) {
    return completeChat(input);
  },
});
