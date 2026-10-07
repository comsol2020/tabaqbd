import type { ImporterDoc } from "./types.js";

export type FormId = "4.3" | "6.1" | "6.2" | "6.3";

export type Column = { key: string; bn: string; en: string };

export type Book = {
  form: FormId;
  titleBn: string;
  titleEn: string;
  importer: { bin: string; name: string };
  columns: Column[];
  rows: Record<string, string | number>[];
  totals: Record<string, number>;
};

// Column sets are the single place to align with the VAT Online layout.
const COLS_61: Column[] = [
  { key: "serial", bn: "ক্রমিক", en: "Serial" },
  { key: "boeDate", bn: "বিল অব এন্ট্রির তারিখ", en: "Bill of entry date" },
  { key: "boeNo", bn: "বিল অব এন্ট্রি নং", en: "Bill of entry no." },
  { key: "supplierName", bn: "সরবরাহকারীর নাম", en: "Supplier" },
  { key: "description", bn: "পণ্যের বিবরণ", en: "Description" },
  { key: "hsCode", bn: "এইচ.এস. কোড", en: "HS code" },
  { key: "unit", bn: "একক", en: "Unit" },
  { key: "quantity", bn: "পরিমাণ", en: "Quantity" },
  { key: "assessableValue", bn: "শুল্কায়নযোগ্য মূল্য (AV)", en: "Assessable value" },
  { key: "cd", bn: "আমদানি শুল্ক (CD)", en: "CD" },
  { key: "rd", bn: "নিয়ন্ত্রণমূলক শুল্ক (RD)", en: "RD" },
  { key: "sd", bn: "সম্পূরক শুল্ক (SD)", en: "SD" },
  { key: "vat", bn: "মূসক (VAT)", en: "VAT" },
  { key: "ait", bn: "অগ্রিম আয়কর (AIT)", en: "AIT" },
  { key: "at", bn: "অগ্রিম কর (AT)", en: "AT" },
];

const COLS_43: Column[] = [
  { key: "serial", bn: "ক্রমিক", en: "Serial" },
  { key: "boeNo", bn: "বিল অব এন্ট্রি নং", en: "Bill of entry no." },
  { key: "boeDate", bn: "তারিখ", en: "Date" },
  { key: "description", bn: "পণ্যের বিবরণ", en: "Description" },
  { key: "hsCode", bn: "এইচ.এস. কোড", en: "HS code" },
  { key: "unit", bn: "একক", en: "Unit" },
  { key: "quantity", bn: "পরিমাণ", en: "Quantity" },
  { key: "costValue", bn: "মোট ক্রয়মূল্য", en: "Total cost" },
  { key: "unitCost", bn: "একক ক্রয়মূল্য", en: "Unit cost" },
  { key: "additionPct", bn: "মূল্য সংযোজন %", en: "Value addition %" },
  { key: "declaredUnitPrice", bn: "ঘোষিত একক বিক্রয়মূল্য", en: "Declared unit price" },
];

const COLS_62: Column[] = [
  { key: "serial", bn: "ক্রমিক", en: "Serial" },
  { key: "issueDate", bn: "তারিখ", en: "Date" },
  { key: "challanNo", bn: "চালান নং", en: "Challan no." },
  { key: "buyerName", bn: "ক্রেতার নাম", en: "Buyer" },
  { key: "buyerBinNid", bn: "ক্রেতার বিআইএন/এনআইডি", en: "Buyer BIN/NID" },
  { key: "description", bn: "পণ্যের বিবরণ", en: "Description" },
  { key: "unit", bn: "একক", en: "Unit" },
  { key: "quantity", bn: "পরিমাণ", en: "Quantity" },
  { key: "value", bn: "মূল্য", en: "Value" },
  { key: "sd", bn: "সম্পূরক শুল্ক", en: "SD" },
  { key: "vat", bn: "মূসক", en: "VAT" },
  { key: "total", bn: "মোট", en: "Total" },
];

const COLS_63: Column[] = [
  { key: "challanNo", bn: "চালান নং", en: "Challan no." },
  { key: "issueDate", bn: "ইস্যুর তারিখ", en: "Issue date" },
  { key: "buyerName", bn: "ক্রেতার নাম", en: "Buyer" },
  { key: "buyerBinNid", bn: "ক্রেতার বিআইএন/এনআইডি", en: "Buyer BIN/NID" },
  { key: "deliveryAddress", bn: "সরবরাহের ঠিকানা", en: "Delivery address" },
  { key: "description", bn: "পণ্যের বিবরণ", en: "Description" },
  { key: "hsCode", bn: "এইচ.এস. কোড", en: "HS code" },
  { key: "unit", bn: "একক", en: "Unit" },
  { key: "quantity", bn: "পরিমাণ", en: "Quantity" },
  { key: "unitPrice", bn: "একক মূল্য", en: "Unit price" },
  { key: "value", bn: "মূল্য (কর ব্যতীত)", en: "Value excl. tax" },
  { key: "sd", bn: "সম্পূরক শুল্ক", en: "SD" },
  { key: "vatRate", bn: "মূসক হার %", en: "VAT rate %" },
  { key: "vat", bn: "মূসক", en: "VAT" },
  { key: "total", bn: "মোট", en: "Total" },
];

export function buildBook(
  doc: ImporterDoc,
  form: FormId,
  range: { from?: string; to?: string } = {},
): Book {
  const importer = { bin: doc.bin, name: doc.name };
  const inRange = (d: string) =>
    (!range.from || d >= range.from) && (!range.to || d <= range.to);

  if (form === "4.3") {
    const rows = doc.purchases
      .filter((p) => inRange(p.boeDate))
      .map((p, i) => ({ ...p, serial: i + 1 }));
    return {
      form,
      titleBn: "মূসক-৪.৩ সহগ ঘোষণা",
      titleEn: "Mushak 4.3 Coefficient Declaration",
      importer,
      columns: COLS_43,
      rows: rows as unknown as Book["rows"],
      totals: sum(rows, ["costValue"]),
    };
  }
  if (form === "6.1") {
    const rows = doc.purchases
      .filter((p) => inRange(p.boeDate))
      .map((p, i) => ({ ...p, serial: i + 1 }));
    return {
      form,
      titleBn: "মূসক-৬.১ ক্রয় হিসাব পুস্তক",
      titleEn: "Mushak 6.1 Purchase Account Book",
      importer,
      columns: COLS_61,
      rows: rows as unknown as Book["rows"],
      totals: sum(rows, ["assessableValue", "cd", "rd", "sd", "vat", "ait", "at"]),
    };
  }
  const invoices = doc.invoices.filter((i) => inRange(i.issueDate));
  if (form === "6.2") {
    const rows = invoices.map((i, n) => ({ ...i, serial: n + 1 }));
    return {
      form,
      titleBn: "মূসক-৬.২ বিক্রয় হিসাব পুস্তক",
      titleEn: "Mushak 6.2 Sales Account Book",
      importer,
      columns: COLS_62,
      rows: rows as unknown as Book["rows"],
      totals: sum(rows, ["quantity", "value", "sd", "vat", "total"]),
    };
  }
  return {
    form,
    titleBn: "মূসক-৬.৩ কর চালানপত্র",
    titleEn: "Mushak 6.3 Tax Invoice (Challan)",
    importer,
    columns: COLS_63,
    rows: invoices as unknown as Book["rows"],
    totals: sum(invoices, ["value", "sd", "vat", "total"]),
  };
}

function sum<T extends object>(rows: T[], keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) {
    out[k] =
      Math.round(
        rows.reduce((s, r) => s + Number((r as Record<string, unknown>)[k] ?? 0), 0) * 100,
      ) / 100;
  }
  return out;
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(book: Book): string {
  const header = book.columns.map((c) => csvCell(`${c.bn} / ${c.en}`)).join(",");
  const lines = book.rows.map((r) => book.columns.map((c) => csvCell(r[c.key])).join(","));
  return `\uFEFF${[header, ...lines].join("\r\n")}\r\n`;
}

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function toHtml(book: Book): string {
  const head = `<h1>${esc(book.titleBn)}</h1><p>${esc(book.titleEn)}<br>${esc(book.importer.name)} &mdash; BIN ${esc(book.importer.bin)}</p>`;
  const style = `<style>body{font-family:"Noto Sans Bengali",sans-serif;margin:24px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #444;padding:4px 6px;text-align:left}th{background:#eee}.num{text-align:right}</style>`;
  const wrap = (body: string) =>
    `<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>${esc(book.titleEn)}</title>${style}</head><body>${head}${body}</body></html>`;

  if (book.form === "6.3") {
    const cards = book.rows
      .map((r) => {
        const body = book.columns
          .map((c) => `<tr><th>${esc(c.bn)}</th><td>${esc(r[c.key])}</td></tr>`)
          .join("");
        return `<table style="margin-bottom:24px;page-break-inside:avoid">${body}</table>`;
      })
      .join("");
    return wrap(cards);
  }
  const th = book.columns.map((c) => `<th>${esc(c.bn)}</th>`).join("");
  const trs = book.rows
    .map(
      (r) =>
        `<tr>${book.columns
          .map((c) => `<td${typeof r[c.key] === "number" ? ' class="num"' : ""}>${esc(r[c.key])}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const total = book.columns
    .map((c, i) =>
      i === 0 ? "<td><b>মোট</b></td>" : `<td class="num"><b>${esc(book.totals[c.key] ?? "")}</b></td>`,
    )
    .join("");
  return wrap(`<table><thead><tr>${th}</tr></thead><tbody>${trs}<tr>${total}</tr></tbody></table>`);
}
