import { defineEval, includes } from "@cursor/bdk/evals";

const TWO_PAGE_PDF = `%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>endobj
4 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 210 200] >>endobj
trailer<< /Root 1 0 R >>
%%EOF`;

export default defineEval({
  tags: ["smoke"],
  async test(t) {
    await t.send(
      [
        "BIN 1234567890123.",
        "scans/bundle.pdf has the pages together.",
        "Send each page separately to the VAT agent.",
        "Do not fill Mushak 6.1.",
      ].join(" "),
      { workspaceFiles: { "scans/bundle.pdf": TWO_PAGE_PDF } },
    );
    t.succeeded();
    t.calledTool("send_pages");
    t.check(t.reply, includes(/পাতা|page|৬\.১|6\.1/));
  },
});
