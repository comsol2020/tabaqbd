import { defineAgent } from "@cursor/bdk";

export default defineAgent({
  name: "Agent Builder",
  description:
    "Drafts agents and runs prompts through Miarouter, with room for more APIs.",
  model: {
    id: "grok-4.5",
    params: [
      { id: "effort", value: "high" },
      { id: "fast", value: "true" },
    ],
  },
  tools: ["read", "grep", "glob", "ls"],
  hosting: {
    egressDomains: ["api.maiarouter.ai"],
    secretNames: ["MIAROUTER_API_KEY"],
  },
});
