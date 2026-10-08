import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { prepareAgent } from "../lib/prepare.js";

const condition = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,40}$/)
    .describe("Stable id for one user requirement."),
  text: z.string().min(1).max(500).describe("The requirement in the user's words."),
});

const toolSpec = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
  description: z.string().min(1).max(500),
});

export default defineTool({
  description:
    "Check every requirement against the agent instructions and, only when all checks pass, return an n8n workflow. The user pastes credentials in n8n. Call again after fixing any failed check. ready is true only when passed equals total.",
  effect: "read",
  inputSchema: z.object({
    name: z.string().min(1).max(80),
    goal: z.string().min(1).max(500),
    conditions: z.array(condition).min(1).max(30),
    instructions: z
      .string()
      .min(1)
      .max(16_000)
      .describe("System prompt the built agent will follow. Each requirement quote must appear here verbatim."),
    tools: z.array(toolSpec).max(20),
    evidence: z
      .array(
        z.object({
          conditionId: z.string(),
          quote: z
            .string()
            .min(12)
            .max(500)
            .describe("Exact sentence from instructions that enforces this requirement."),
        }),
      )
      .min(1)
      .max(30),
    providerId: z.string().optional().describe("Omit to use Miarouter."),
    model: z.string().min(1).max(200).optional(),
  }),
  async execute(input) {
    return prepareAgent(input);
  },
});
