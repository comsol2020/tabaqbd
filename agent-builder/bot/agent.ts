import { defineAgent } from "@cursor/bdk";

export default defineAgent({
  name: "Agent Builder",
  description:
    "Builds an n8n-ready agent from the user's requirements, checks every condition, and leaves credentials for the user to paste.",
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
