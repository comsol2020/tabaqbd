import { netValue, purchaseLedger, salesLedger, tradeLedger } from "./ledger.js";
import type { ImporterDoc } from "./types.js";

export type FormId = "4.3" | "6.1" | "6.2" | "6.2.1" | "6.3";

export type Column = { key: string; bn: string; en: string; group?: string };

export type Book = {
  form: FormId;
  titleBn: string;
  titleEn: string;
  importer: { bin: string; name: string };
  columns: Column[];
  rows: Record<string, string | number>[];
  meta?: Record<string, string>;
  totals: Record<string, number>;
};

// Column sets are the single place to align with the official layouts.
// Mushak 6.1 (ক্রয় হিসাব পুস্তক): columns (1)-(21) as printed on the official form.
const COLS_61: Column[] = [
  { key: "serial", bn: "ক্রমিক সংখ্যা", en: "Serial" },
  { key: "date", bn: "তারিখ", en: "Date" },
  { key: "openQty", bn: "পরিমাণ (একক)", en: "Opening quantity", group: "মজুদ উপকরণের প্রারম্ভিক জের" },
  { key: "openVal", bn: "মূল্য (সকল প্রকার কর ব্যতীত)", en: "Opening value", group: "মজুদ উপকরণের প্রারম্ভিক জের" },
  { key: "boeNo", bn: "চালানপত্র/বিল অব এন্ট্রি নম্বর", en: "Challan / bill of entry no.", group: "ক্রয়কৃত উপকরণ" },
  { key: "boeDate", bn: "তারিখ", en: "Challan / bill of entry date", group: "ক্রয়কৃত উপকরণ" },
  { key: "supplierName", bn: "নাম", en: "Supplier name", group: "বিক্রেতা/সরবরাহকারী" },
  { key: "supplierAddress", bn: "ঠিকানা", en: "Supplier address", group: "বিক্রেতা/সরবরাহকারী" },
  { key: "supplierBin", bn: "নিবন্ধন/তালিকাভুক্তি/জাতীয় পরিচয়পত্র নং", en: "Supplier BIN/NID", group: "বিক্রেতা/সরবরাহকারী" },
  { key: "description", bn: "বিবরণ", en: "Description", group: "ক্রয়কৃত উপকরণ" },
  { key: "quantity", bn: "পরিমাণ", en: "Quantity", group: "ক্রয়কৃত উপকরণ" },
  { key: "value", bn: "মূল্য (সকল প্রকার কর ব্যতীত)", en: "Value excl. taxes (AV+CD+RD)", group: "ক্রয়কৃত উপকরণ" },
  { key: "sd", bn: "সম্পূরকশুল্ক (যদি থাকে)", en: "SD", group: "ক্রয়কৃত উপকরণ" },
  { key: "vat", bn: "মূসক", en: "VAT", group: "ক্রয়কৃত উপকরণ" },
  { key: "totalQty", bn: "পরিমাণ (একক) =(৩+১১)", en: "Total quantity =(3+11)", group: "মোট উপকরণের পরিমাণ" },
  { key: "totalVal", bn: "মূল্য (সকল প্রকার কর ব্যতীত) =(৪+১২)", en: "Total value =(4+12)", group: "মোট উপকরণের পরিমাণ" },
  { key: "useQty", bn: "পরিমাণ (একক)", en: "Quantity used", group: "পণ্য প্রস্তুত/প্রক্রিয়া করণে উপকরণের ব্যবহার" },
  { key: "useVal", bn: "মূল্য (সকল প্রকার কর ব্যতীত)", en: "Value used", group: "পণ্য প্রস্তুত/প্রক্রিয়া করণে উপকরণের ব্যবহার" },
  { key: "closeQty", bn: "পরিমাণ (একক)", en: "Closing quantity", group: "উপকরণের প্রান্তিক জের" },
  { key: "closeVal", bn: "মূল্য (সকল প্রকার কর ব্যতীত)", en: "Closing value", group: "উপকরণের প্রান্তিক জের" },
  { key: "remarks", bn: "মন্তব্য", en: "Remarks" },
];

// Mushak 6.2.1 (ক্রয়-বিক্রয় হিসাব, for traders): columns (1)-(26) as printed on the official form.
const COLS_621: Column[] = [
  { key: "serial", bn: "ক্রমিক সংখ্যা", en: "Serial" },
  { key: "date", bn: "তারিখ", en: "Date" },
  { key: "openQty", bn: "পরিমাণ (একক)", en: "Opening quantity", group: "বিক্রয়যোগ্য পণ্যের প্রারম্ভিক জের" },
  { key: "openVal", bn: "মূল্য (সকল প্রকার কর ব্যতীত)", en: "Opening value", group: "বিক্রয়যোগ্য পণ্যের প্রারম্ভিক জের" },
  { key: "buyQty", bn: "পরিমাণ (একক)", en: "Purchased quantity", group: "ক্রয়" },
  { key: "buyVal", bn: "মূল্য (সকল প্রকার কর ব্যতীত)", en: "Purchased value", group: "ক্রয়" },
  { key: "totalQty", bn: "পরিমাণ (একক) =(৩+৫)", en: "Total quantity =(3+5)", group: "মোট পণ্য" },
  { key: "totalVal", bn: "মূল্য (সকল প্রকার কর ব্যতীত) =(৪+৬)", en: "Total value =(4+6)", group: "মোট পণ্য" },
  { key: "sellerName", bn: "নাম", en: "Seller name", group: "বিক্রেতার তথ্য" },
  { key: "sellerAddress", bn: "ঠিকানা", en: "Seller address", group: "বিক্রেতার তথ্য" },
  { key: "sellerBin", bn: "নিবন্ধন/তালিকাভুক্তি/জাতীয় পরিচয়পত্র নং", en: "Seller BIN/NID", group: "বিক্রেতার তথ্য" },
  { key: "boeNo", bn: "নম্বর", en: "Purchase challan / bill of entry no.", group: "ক্রয় চালানপত্রের/বিল অব এন্ট্রির বিবরণ" },
  { key: "boeDate", bn: "তারিখ", en: "Purchase challan / bill of entry date", group: "ক্রয় চালানপত্রের/বিল অব এন্ট্রির বিবরণ" },
  { key: "description", bn: "বিবরণ", en: "Description", group: "বিক্রীত/সরবরাহকৃত পণ্যের বিবরণ" },
  { key: "quantity", bn: "পরিমাণ", en: "Quantity sold", group: "বিক্রীত/সরবরাহকৃত পণ্যের বিবরণ" },
  { key: "value", bn: "করযোগ্য মূল্য (সকল প্রকার কর ব্যতীত)", en: "Taxable value", group: "বিক্রীত/সরবরাহকৃত পণ্যের বিবরণ" },
  { key: "sd", bn: "সম্পূরক শুল্ক (যদি থাকে)", en: "SD", group: "বিক্রীত/সরবরাহকৃত পণ্যের বিবরণ" },
  { key: "vat", bn: "মূসক", en: "VAT", group: "বিক্রীত/সরবরাহকৃত পণ্যের বিবরণ" },
  { key: "buyerName", bn: "নাম", en: "Buyer name", group: "ক্রেতার তথ্য" },
  { key: "buyerAddress", bn: "ঠিকানা", en: "Buyer address", group: "ক্রেতার তথ্য" },
  { key: "buyerBinNid", bn: "নিবন্ধন/তালিকাভুক্তি/জাতীয় পরিচয়পত্র নং", en: "Buyer BIN/NID", group: "ক্রেতার তথ্য" },
  { key: "challanNo", bn: "নম্বর", en: "Sales challan no.", group: "বিক্রয় চালানপত্রের বিবরণ" },
  { key: "issueDate", bn: "তারিখ", en: "Sales challan date", group: "বিক্রয় চালানপত্রের বিবরণ" },
  { key: "closeQty", bn: "পরিমাণ (একক) =(৭-১৫)", en: "Closing quantity =(7-15)", group: "পণ্যের প্রান্তিক জের" },
  { key: "closeVal", bn: "মূল্য (সকল প্রকার কর ব্যতীত) =(৮-১৬)", en: "Closing value =(8-16)", group: "পণ্যের প্রান্তিক জের" },
  { key: "remarks", bn: "মন্তব্য", en: "Remarks" },
];

// Mushak 4.3 (উপকরণ-উৎপাদ সহগ ঘোষণা) columns (1)-(12), read from the official form.
const COLS_43: Column[] = [
  { key: "serial", bn: "ক্রমিক সংখ্যা", en: "Serial" },
  { key: "hsCode", bn: "পণ্যের এইচ এস কোড/সেবা কোড", en: "HS code / service code" },
  { key: "description", bn: "সরবরাহতব্য পণ্য/সেবার নাম ও বর্ণনা (প্রযোজ্য ক্ষেত্রে ব্র্যান্ড নামসহ)", en: "Name and description of supplied goods" },
  { key: "unit", bn: "সরবরাহের একক", en: "Unit of supply" },
  { key: "inputDescription", bn: "উপকরণের বিবরণ", en: "Input description" },
  { key: "inputQty", bn: "অপচয়সহ পরিমাণ", en: "Quantity incl. wastage" },
  { key: "inputValue", bn: "ক্রয় মূল্য", en: "Purchase value" },
  { key: "wasteQty", bn: "অপচয়ের পরিমাণ", en: "Wastage quantity" },
  { key: "wastePct", bn: "শতকরা হার", en: "Wastage %" },
  { key: "additionHead", bn: "মূল্য সংযোজনের খাত", en: "Value addition head" },
  { key: "additionValue", bn: "মূল্য", en: "Value addition" },
  { key: "remarks", bn: "মন্তব্য", en: "Remarks" },
];

// Mushak 6.2 (বিক্রয় হিসাব পুস্তক): columns (1)-(21). The printed closing formulas read (7-11) and (8-26), which are typos for (7-15) and (8-16).
const COLS_62: Column[] = [
  { key: "serial", bn: "ক্রমিক সংখ্যা", en: "Serial" },
  { key: "date", bn: "তারিখ", en: "Date" },
  { key: "openQty", bn: "পরিমাণ (একক)", en: "Opening quantity", group: "উৎপাদিত পণ্য/সেবার প্রারম্ভিক জের" },
  { key: "openVal", bn: "মূল্য (সকল প্রকার কর ব্যতীত)", en: "Opening value", group: "উৎপাদিত পণ্য/সেবার প্রারম্ভিক জের" },
  { key: "recvQty", bn: "পরিমাণ (একক)", en: "Quantity received", group: "উৎপাদন" },
  { key: "recvVal", bn: "মূল্য (সকল প্রকার কর ব্যতীত)", en: "Value received", group: "উৎপাদন" },
  { key: "totalQty", bn: "পরিমাণ (একক) =(৩+৫)", en: "Total quantity =(3+5)", group: "মোট উৎপাদিত পণ্য/সেবা" },
  { key: "totalVal", bn: "মূল্য (সকল প্রকার কর ব্যতীত) =(৪+৬)", en: "Total value =(4+6)", group: "মোট উৎপাদিত পণ্য/সেবা" },
  { key: "buyerName", bn: "নাম", en: "Buyer name", group: "ক্রেতা/সরবরাহগ্রহীতা" },
  { key: "buyerAddress", bn: "ঠিকানা", en: "Buyer address", group: "ক্রেতা/সরবরাহগ্রহীতা" },
  { key: "buyerBinNid", bn: "নিবন্ধন/তালিকাভুক্তি/জাতীয় পরিচয়পত্র নং", en: "Buyer BIN/NID", group: "ক্রেতা/সরবরাহগ্রহীতা" },
  { key: "challanNo", bn: "নম্বর", en: "Challan no.", group: "চালানপত্রের বিবরণ" },
  { key: "issueDate", bn: "তারিখ", en: "Challan date", group: "চালানপত্রের বিবরণ" },
  { key: "description", bn: "বিবরণ", en: "Description", group: "বিক্রিত/সরবরাহকৃত পণ্যের বিবরণ" },
  { key: "quantity", bn: "পরিমাণ", en: "Quantity", group: "বিক্রিত/সরবরাহকৃত পণ্যের বিবরণ" },
  { key: "value", bn: "করযোগ্য মূল্য", en: "Taxable value", group: "বিক্রিত/সরবরাহকৃত পণ্যের বিবরণ" },
  { key: "sd", bn: "সম্পূরক শুল্ক (যদি থাকে)", en: "SD", group: "বিক্রিত/সরবরাহকৃত পণ্যের বিবরণ" },
  { key: "vat", bn: "মূসক", en: "VAT", group: "বিক্রিত/সরবরাহকৃত পণ্যের বিবরণ" },
  { key: "closeQty", bn: "পরিমাণ (একক) =(৭-১৫)", en: "Closing quantity =(7-15)", group: "পণ্যের প্রান্তিক জের" },
  { key: "closeVal", bn: "মূল্য (সকল প্রকার কর ব্যতীত) =(৮-১৬)", en: "Closing value =(8-16)", group: "পণ্যের প্রান্তিক জের" },
  { key: "remarks", bn: "মন্তব্য", en: "Remarks" },
];

// Mushak 6.3 line-item table. Bengali headings reconstructed from the official sample
// PDF, whose text layer is lost; widths and word lengths were matched column by column.
const COLS_63: Column[] = [
  { key: "lineNo", bn: "ক্রমিক", en: "Serial" },
  { key: "description", bn: "পণ্য/সেবার বর্ণনা", en: "Description of goods/services" },
  { key: "unit", bn: "সরবরাহের একক", en: "Unit of supply" },
  { key: "quantity", bn: "পরিমাণ", en: "Quantity" },
  { key: "unitPrice", bn: "একক মূল্য (টাকা)", en: "Unit price (BDT)" },
  { key: "value", bn: "মোট মূল্য (টাকা)", en: "Total value (BDT)" },
  { key: "sdRate", bn: "সম্পূরক শুল্কের হার", en: "SD rate" },
  { key: "sd", bn: "সম্পূরক শুল্কের পরিমাণ", en: "SD amount" },
  { key: "vatRate", bn: "VAT/সুনির্দিষ্ট কর হার", en: "VAT/specific tax rate" },
  { key: "vat", bn: "VAT/সুনির্দিষ্ট করের পরিমাণ", en: "VAT/specific tax amount" },
  { key: "total", bn: "সকল শুল্ক ও করসহ মূল্য", en: "Value including all duties and taxes" },
];

export const CHALLAN_HEADER: Column[] = [
  { key: "challanNo", bn: "চালান নং", en: "Challan no." },
  { key: "issueDate", bn: "ইস্যুর তারিখ", en: "Issue date" },
  { key: "buyerName", bn: "ক্রেতার নাম", en: "Buyer" },
  { key: "buyerBinNid", bn: "ক্রেতার বিআইএন/এনআইডি", en: "Buyer BIN/NID" },
  { key: "deliveryAddress", bn: "সরবরাহের ঠিকানা", en: "Delivery address" },
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
      .map((p, i) => ({
        serial: i + 1,
        hsCode: p.hsCode ?? "",
        description: p.description,
        unit: p.unit,
        inputDescription: `${p.description} (বিল অব এন্ট্রি ${p.boeNo})`,
        inputQty: 1,
        inputValue: p.unitCost,
        wasteQty: 0,
        wastePct: 0,
        additionHead: `মূল্য সংযোজন ${p.additionPct}%`,
        additionValue: Math.round((p.declaredUnitPrice - p.unitCost) * 100) / 100,
        remarks: `ঘোষিত একক মূল্য ${p.declaredUnitPrice}`,
      }));
    const firstSupply = doc.invoices.map((i) => i.issueDate).sort()[0] ?? "";
    return {
      form,
      titleBn: "মূসক-৪.৩ উপকরণ-উৎপাদ সহগ ঘোষণা",
      titleEn: "Mushak 4.3 Input-Output Coefficient Declaration",
      importer,
      columns: COLS_43,
      rows,
      meta: { address: doc.address ?? "", firstSupply },
      totals: {},
    };
  }
  if (form === "6.2.1") {
    const rows = tradeLedger(doc)
      .filter((r) => inRange(r.date))
      .map((r, n) => {
        const p = r.purchase;
        const i = r.invoice;
        return {
          serial: n + 1,
          date: r.date,
          openQty: r.opening.qty,
          openVal: r.opening.val,
          buyQty: p ? p.quantity : "",
          buyVal: p ? netValue(p) : "",
          totalQty: r.total.qty,
          totalVal: r.total.val,
          sellerName: p?.supplierName ?? "",
          sellerAddress: p?.supplierAddress ?? "",
          sellerBin: "",
          boeNo: p?.boeNo ?? "",
          boeDate: p?.boeDate ?? "",
          description: p?.description ?? i?.description ?? "",
          quantity: i ? i.quantity : "",
          value: i ? i.value : "",
          sd: i ? i.sd : "",
          vat: i ? i.vat : "",
          buyerName: i?.buyerName ?? "",
          buyerAddress: i?.deliveryAddress ?? "",
          buyerBinNid: i?.buyerBinNid ?? "",
          challanNo: i?.challanNo ?? "",
          issueDate: i?.issueDate ?? "",
          closeQty: r.closing.qty,
          closeVal: r.closing.val,
          remarks: p?.unit ?? i?.unit ?? "",
        };
      });
    return {
      form,
      titleBn: "মূসক-৬.২.১ ক্রয়-বিক্রয় হিসাব",
      titleEn: "Mushak 6.2.1 Purchase-Sales Account (traders)",
      importer,
      columns: COLS_621,
      rows,
      meta: { address: doc.address ?? "", subtitle: "পণ্য বা সেবা প্রক্রিয়াকরণে সম্পৃক্ত নয় (ব্যবসায়ী)" },
      totals: sum(rows, ["buyQty", "buyVal", "quantity", "value", "sd", "vat"]),
    };
  }
  if (form === "6.1") {
    const rows = purchaseLedger(doc)
      .filter((r) => inRange(r.purchase.boeDate))
      .map((r, i) => ({
        serial: i + 1,
        date: r.purchase.boeDate,
        openQty: r.opening.qty,
        openVal: r.opening.val,
        boeNo: r.purchase.boeNo,
        boeDate: r.purchase.boeDate,
        supplierName: r.purchase.supplierName ?? "",
        supplierAddress: r.purchase.supplierAddress ?? "",
        supplierBin: "",
        description: r.purchase.description,
        quantity: r.purchase.quantity,
        value: netValue(r.purchase),
        sd: r.purchase.sd,
        vat: r.purchase.vat,
        totalQty: r.total.qty,
        totalVal: r.total.val,
        useQty: r.usage.qty,
        useVal: r.usage.val,
        closeQty: r.closing.qty,
        closeVal: r.closing.val,
        remarks: r.purchase.unit,
      }));
    return {
      form,
      titleBn: "মূসক-৬.১ ক্রয় হিসাব পুস্তক",
      titleEn: "Mushak 6.1 Purchase Account Book",
      importer,
      columns: COLS_61,
      rows,
      meta: { address: doc.address ?? "", subtitle: "পণ্য/সেবার উপকরণ ক্রয়" },
      totals: sum(rows, ["quantity", "value", "sd", "vat", "useQty", "useVal"]),
    };
  }
  const invoices = doc.invoices.filter((i) => inRange(i.issueDate));
  if (form === "6.2") {
    const rows = salesLedger(doc)
      .filter((r) => inRange(r.invoice.issueDate))
      .map((r, n) => ({
        serial: n + 1,
        date: r.invoice.issueDate,
        openQty: r.opening.qty,
        openVal: r.opening.val,
        recvQty: r.received.qty,
        recvVal: r.received.val,
        totalQty: r.total.qty,
        totalVal: r.total.val,
        buyerName: r.invoice.buyerName,
        buyerAddress: r.invoice.deliveryAddress,
        buyerBinNid: r.invoice.buyerBinNid,
        challanNo: r.invoice.challanNo,
        issueDate: r.invoice.issueDate,
        description: r.invoice.description,
        quantity: r.invoice.quantity,
        value: r.invoice.value,
        sd: r.invoice.sd,
        vat: r.invoice.vat,
        closeQty: r.closing.qty,
        closeVal: r.closing.val,
        remarks: r.invoice.unit,
      }));
    return {
      form,
      titleBn: "মূসক-৬.২ বিক্রয় হিসাব পুস্তক",
      titleEn: "Mushak 6.2 Sales Account Book",
      importer,
      columns: COLS_62,
      rows,
      meta: { address: doc.address ?? "", subtitle: "পণ্য/সেবার বিক্রয়" },
      totals: sum(rows, ["quantity", "value", "sd", "vat"]),
    };
  }
  const lines = invoices.map((i) => ({ ...i, lineNo: 1 }));
  return {
    form,
    titleBn: "মূসক-৬.৩ কর চালানপত্র",
    titleEn: "Mushak 6.3 Tax Invoice (Challan)",
    importer,
    columns: COLS_63,
    rows: lines as unknown as Book["rows"],
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
  const cols = book.form === "6.3" ? [...CHALLAN_HEADER, ...book.columns] : book.columns;
  const header = cols
    .map((c) => csvCell(`${c.group ? `${c.group} - ` : ""}${c.bn} / ${c.en}`))
    .join(",");
  const lines = book.rows.map((r) => cols.map((c) => csvCell(r[c.key])).join(","));
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

  if (book.form === "4.3") {
    const th = book.columns.map((c, i) => `<th>(${i + 1})<br>${esc(c.bn)}</th>`).join("");
    const trs = book.rows
      .map(
        (r) =>
          `<tr>${book.columns.map((c) => `<td${typeof r[c.key] === "number" ? ' class="num"' : ""}>${esc(r[c.key])}</td>`).join("")}</tr>`,
      )
      .join("");
    const info = `<p>প্রতিষ্ঠানের নাম: ${esc(book.importer.name)}<br>ঠিকানা: ${esc(book.meta?.address)}<br>বিন: ${esc(book.importer.bin)}<br>দাখিলের তারিখ: ________<br>ঘোষিত সহগ অনুযায়ী পণ্য/সেবার প্রথম সরবরাহের তারিখ: ${esc(book.meta?.firstSupply)}</p>`;
    const foot = `<p style="text-align:right">প্রতিষ্ঠান কর্তৃপক্ষের দায়িত্বপ্রাপ্ত ব্যক্তির নাম: ________<br>পদবী: ________<br>স্বাক্ষর: ________<br>সীল: ________</p><p style="font-size:11px">বিশেষ দ্রষ্টব্য: ১। যেকোন পণ্য বা সেবা প্রথম সরবরাহের পূর্ববর্তী ১৫ দিনের মধ্যে অনলাইনে মূসক কম্পিউটার সিস্টেমে বা সংশ্লিষ্ট বিভাগীয় কর্মকর্তার দপ্তরে উপকরণ-উৎপাদ সহগ ঘোষণা দাখিল করিতে হইবে। ২। পণ্য মূল্য বা মোট উপকরণ/কাঁচামালের মূল্য ৭.৫% এর বেশী পরিবর্তন হইলে নতুন ঘোষণা দাখিল করিতে হইবে। ৩। উপকরণ ক্রয়ের স্বপক্ষে প্রামাণিক দলিল হিসাবে বিল অব এন্ট্রি বা চালানপত্রের কপি সংযুক্ত করিতে হইবে।</p>`;
    return wrap(`${info}<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>${foot}`);
  }
  if (book.form === "6.3") {
    const th63 = book.columns.map((c) => `<th>${esc(c.bn)}</th>`).join("");
    const cards = book.rows
      .map((r) => {
        const meta = CHALLAN_HEADER.map(
          (c) => `<tr><th style="width:180px">${esc(c.bn)}</th><td>${esc(r[c.key])}</td></tr>`,
        ).join("");
        const cells = book.columns.map((c) => `<td class="num">${esc(r[c.key])}</td>`).join("");
        const tot = book.columns
          .map((c, i) => {
            if (i === 1) return "<td><b>মোট</b></td>";
            return ["value", "sd", "vat", "total"].includes(c.key)
              ? `<td class="num"><b>${esc(r[c.key])}</b></td>`
              : "<td></td>";
          })
          .join("");
        return `<section style="margin-bottom:28px;page-break-inside:avoid"><h2>মূসক-৬.৩ কর চালানপত্র</h2><p>বিক্রেতা: ${esc(book.importer.name)} &mdash; BIN ${esc(book.importer.bin)}</p><table style="width:auto;margin-bottom:8px">${meta}</table><table><thead><tr>${th63}</tr></thead><tbody><tr>${cells}</tr><tr>${tot}</tr></tbody></table></section>`;
      })
      .join("");
    return wrap(cards);
  }
  const hasGroups = book.columns.some((c) => c.group);
  const groupRow = hasGroups ? `<tr>${groupCells(book.columns)}</tr>` : "";
  const th = book.columns
    .map((c, i) => `<th>${hasGroups ? `(${i + 1})<br>` : ""}${esc(c.bn)}</th>`)
    .join("");
  const info = hasGroups
    ? `<p>প্রতিষ্ঠানের নাম: ${esc(book.importer.name)}<br>ঠিকানা: ${esc(book.meta?.address)}<br>ব্যবসা সনাক্তকরণ সংখ্যা (BIN): ${esc(book.importer.bin)}<br>${esc(book.meta?.subtitle)}</p>`
    : "";
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
  return wrap(`${info}<table><thead>${groupRow}<tr>${th}</tr></thead><tbody>${trs}<tr>${total}</tr></tbody></table>`);
}

function groupCells(columns: Column[]): string {
  const cells: string[] = [];
  for (let i = 0; i < columns.length; ) {
    const g = columns[i]?.group ?? "";
    let j = i;
    while (j < columns.length && (columns[j]?.group ?? "") === g) j++;
    cells.push(`<th colspan="${j - i}">${esc(g)}</th>`);
    i = j;
  }
  return cells.join("");
}
