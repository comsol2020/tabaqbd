import { defineAgent } from "@cursor/bdk";

export default defineAgent({
  name: "VAT pages",
  description:
    "Split a bundled PDF, ZIP, or image set into one page each and hand those pages to the VAT books agent.",
  model: {
    id: "grok-4.5",
    params: [
      { id: "effort", value: "low" },
      { id: "fast", value: "true" },
    ],
  },
});
