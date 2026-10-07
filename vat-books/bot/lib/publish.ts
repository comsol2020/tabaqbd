import type { ToolContext } from "@cursor/bdk/tools";
import { type FormId, buildBook, toCsv, toHtml } from "./forms.js";
import type { ImporterDoc } from "./types.js";

export type PublishedBook = { form: FormId; ext: "csv" | "html"; artifactId: string; rows: number };

export async function publishBooks(
  artifacts: ToolContext["artifacts"],
  doc: ImporterDoc,
  forms: FormId[],
): Promise<PublishedBook[]> {
  const out: PublishedBook[] = [];
  for (const form of forms) {
    const book = buildBook(doc, form);
    for (const [ext, contents, contentType] of [
      ["csv", toCsv(book), "text/csv; charset=utf-8"],
      ["html", toHtml(book), "text/html; charset=utf-8"],
    ] as const) {
      const record = await artifacts.tag({
        kind: "book",
        key: `${doc.bin}/mushak-${form}.${ext}`,
        title: `${doc.name} (${doc.bin}) ${book.titleEn} .${ext}`,
        data: { bin: doc.bin, form, ext, rows: book.rows.length },
        contents,
        contentType,
      });
      out.push({ form, ext, artifactId: record.id, rows: book.rows.length });
    }
  }
  return out;
}
