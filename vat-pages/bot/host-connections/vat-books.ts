import { defineConnection } from "@cursor/bdk/connections";

/** Host-only. The model does not talk to the VAT agent; send_pages does. */
export default defineConnection({
  agent: "vat-books",
  description:
    "Tell the VAT books agent that one-page scans are waiting in its inbox.",
});
