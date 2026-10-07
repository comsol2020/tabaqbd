import { defineEval } from "@cursor/bdk/evals";

export default defineEval({
  tags: ["smoke"],
  async test(t) {
    await t.send(
      [
        "Importer: ABC Textiles Ltd, BIN ১২৩৪৫৬৭৮৯-০১২৩, Dhaka.",
        "Bill of entry C-1001 dated 05/01/2026, supplier Zhejiang Cotton Co.",
        "One item: Cotton fabric, HS 5208.12, 1000 kg, AV 500000, CD 25000, RD 0, SD 0, VAT 78750, AIT 25000, AT 0.",
        "Save it.",
      ].join("\n"),
    );
    t.succeeded();
    t.calledTool("save_bill_of_entry");
  },
});
