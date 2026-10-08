import { productKey, tradeLedger } from "./ledger.js";
import type { ImporterDoc, Invoice } from "./types.js";
import { round2 } from "./vat.js";
import { type Cell, buildXlsx } from "./xlsx.js";

export type ImportLine = {
  boeNo: string;
  boeDate: string;
  officeCode: string;
  itemNo: number;
  cpcCode: string;
  supplier: string;
  quantity: number;
  assessableValue: number;
  value: number;
  cd: number;
  rd: number;
  sd: number;
  vat: number;
  ait: number;
  at: number;
};

export type SalesGroup = {
  category: string;
  quantity: number;
  value: number;
  sd: number;
  vat: number;
};

export type ItemReport = {
  item: string;
  hsCode: string;
  unit: string;
  imports: ImportLine[];
  salesGroups: SalesGroup[];
  importedQty: number;
  importedValue: number;
  importedVat: number;
  challans: number;
  soldQty: number;
  soldValue: number;
  soldSd: number;
  soldVat: number;
  soldTotal: number;
  soldCost: number;
  openQty: number;
  openVal: number;
  closeQty: number;
  closeVal: number;
};

export type MonthlyReport = {
  month: string;
  importer: { bin: string; name: string };
  items: ItemReport[];
  totals: {
    importedValue: number;
    importedDuties: number;
    importedVat: number;
    challans: number;
    soldValue: number;
    soldSd: number;
    soldVat: number;
    soldTotal: number;
    inputValue: number;
    inputSd: number;
    inputVat: number;
    advanceTax: number;
  };
  notes: {
    note8: { value: number; sd: number; vat: number };
    note22: { value: number };
    note30: number;
    note34: number;
  };
};

const categoryName = (vatRate: number, sdRate: number) =>
  `Commercial Importer/Other Traders (VAT ${vatRate}%, SD ${sdRate}%)`;

const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

function groupSales(sales: Invoice[]): SalesGroup[] {
  const groups = new Map<string, Invoice[]>();
  for (const i of sales) {
    const k = categoryName(i.vatRate, i.sdRate);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return [...groups].map(([category, xs]) => ({
    category,
    quantity: sum(xs.map((i) => i.quantity)),
    value: sum(xs.map((i) => i.value)),
    sd: sum(xs.map((i) => i.sd)),
    vat: sum(xs.map((i) => i.vat)),
  }));
}

export function monthlyReport(doc: ImporterDoc, month: string): MonthlyReport {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("month must be YYYY-MM");
  const lineKey = new Map(doc.purchases.map((p) => [p.lineId, productKey(p)]));
  const keys = [
    ...new Set([...doc.purchases.map(productKey), ...doc.invoices.map((i) => lineKey.get(i.lineId) ?? i.lineId)]),
  ];
  const ledger = tradeLedger(doc);
  const items: ItemReport[] = [];
  for (const key of keys) {
    const rows = ledger.filter((r) => r.key === key);
    const before = rows.filter((r) => r.date.slice(0, 7) < month);
    const inMonth = rows.filter((r) => r.date.slice(0, 7) === month);
    if (inMonth.length === 0 && (before.at(-1)?.closing.qty ?? 0) === 0) continue;
    const purchases = doc.purchases.filter((p) => productKey(p) === key && p.boeDate.slice(0, 7) === month);
    const sales = doc.invoices.filter(
      (i) => lineKey.get(i.lineId) === key && i.issueDate.slice(0, 7) === month,
    );
    const ref = doc.purchases.find((p) => productKey(p) === key);
    const open = before.at(-1)?.closing ?? { qty: 0, val: 0 };
    const close = inMonth.at(-1)?.closing ?? open;
    const soldCost = sum(
      inMonth.filter((r) => r.kind === "sale").map((r) => round2(r.opening.val - r.closing.val)),
    );
    items.push({
      item: ref?.description ?? key,
      hsCode: ref?.hsCode ?? "",
      unit: ref?.unit ?? "",
      imports: purchases.map((p) => ({
        boeNo: p.boeNo,
        boeDate: p.boeDate,
        officeCode: p.officeCode ?? "",
        itemNo: Number(p.lineId.split("#")[1] ?? 1),
        cpcCode: p.cpcCode ?? "",
        supplier: p.supplierName ?? "",
        quantity: p.quantity,
        assessableValue: p.assessableValue,
        value: round2(p.assessableValue + p.cd + p.rd + p.sd),
        cd: p.cd,
        rd: p.rd,
        sd: p.sd,
        vat: p.vat,
        ait: p.ait,
        at: p.at,
      })),
      salesGroups: groupSales(sales),
      importedQty: sum(purchases.map((p) => p.quantity)),
      importedValue: sum(purchases.map((p) => p.assessableValue)),
      importedVat: sum(purchases.map((p) => p.vat)),
      challans: sales.length,
      soldQty: sum(sales.map((i) => i.quantity)),
      soldValue: sum(sales.map((i) => i.value)),
      soldSd: sum(sales.map((i) => i.sd)),
      soldVat: sum(sales.map((i) => i.vat)),
      soldTotal: sum(sales.map((i) => i.total)),
      soldCost,
      openQty: open.qty,
      openVal: open.val,
      closeQty: close.qty,
      closeVal: close.val,
    });
  }
  const allLines = items.flatMap((i) => i.imports);
  const soldValue = sum(items.map((i) => i.soldValue));
  const soldSd = sum(items.map((i) => i.soldSd));
  const soldVat = sum(items.map((i) => i.soldVat));
  const inputValue = sum(allLines.map((l) => l.value));
  const advanceTax = sum(allLines.map((l) => l.at));
  return {
    month,
    importer: { bin: doc.bin, name: doc.name },
    items,
    totals: {
      importedValue: sum(allLines.map((l) => l.assessableValue)),
      importedDuties: sum(allLines.map((l) => l.cd + l.rd + l.sd + l.ait + l.at)),
      importedVat: sum(allLines.map((l) => l.vat)),
      challans: items.reduce((s, i) => s + i.challans, 0),
      soldValue,
      soldSd,
      soldVat,
      soldTotal: sum(items.map((i) => i.soldTotal)),
      inputValue,
      inputSd: sum(allLines.map((l) => l.sd)),
      inputVat: sum(allLines.map((l) => l.vat)),
      advanceTax,
    },
    notes: {
      note8: { value: soldValue, sd: soldSd, vat: soldVat },
      note22: { value: inputValue },
      note30: advanceTax,
      note34: round2(soldVat - advanceTax),
    },
  };
}

type Table = { title: string; head: string[]; rows: Cell[][] };

function tables(r: MonthlyReport): Table[] {
  const n = r.notes;
  const summary: Table = {
    title: "রিটার্নের নোট (৯.১) / Return notes for the month",
    head: ["নোট", "বিবরণ", "মূল্য (a)", "SD (b)", "VAT (c)"],
    rows: [
      ["8 / 9", "Retail/Wholesale/Trade Based Supply - মোট বিক্রয় (সাব-ফরম ৩.৮ এর মোট)", n.note8.value, n.note8.sd, n.note8.vat],
      ["22", "Goods/Service Not Admissible for Credit - Import (সাব-ফরম ৪.২২ এর মোট)", n.note22.value, "", ""],
      ["30", "Advance Tax Paid at Import Stage (৪.২২ এর AT মোট)", "", "", n.note30],
      ["34", "Net Payable VAT = 9(c) - 23(b) + 28 - 33 (ইনপুট ক্রেডিট না নিলে, অন্য অ্যাডজাস্টমেন্ট ছাড়া)", "", "", n.note34],
    ],
  };
  const sub38: Table = {
    title: "সাব-ফরম ৩.৮: Retail/Wholesale/Trade Based Supply",
    head: ["Category Name", "Goods/Service Commercial Description", "Goods/Service Code", "Goods/Service Name", "Value (a)", "SD (b)", "VAT (c)", "বিক্রিত পরিমাণ", "একক", "চালান সংখ্যা"],
    rows: [
      ...r.items.flatMap((i) =>
        i.salesGroups.map((g): Cell[] => [g.category, i.item, i.hsCode, i.item, g.value, g.sd, g.vat, g.quantity, i.unit, i.challans]),
      ),
      ["TOTAL", "", "", "", n.note8.value, n.note8.sd, n.note8.vat, "", "", r.totals.challans],
    ],
  };
  const sub422: Table = {
    title: "সাব-ফরম ৪.২২: Import (Not Admissible for Credit)",
    head: ["Data Source", "BoE Number", "BoE Date", "BoE Office Code", "BoE Item No", "CPC Code", "Goods/Service Commercial Description", "Goods/Service Code", "Goods/Service Name", "Assessable Value", "Value (a)", "SD (b)", "VAT (c)", "AT", "পরিমাণ", "একক"],
    rows: [
      ...r.items.flatMap((i) =>
        i.imports.map((l): Cell[] => [
          "Import against Bill of E", l.boeNo, l.boeDate, l.officeCode, l.itemNo, l.cpcCode, i.item, i.hsCode, i.item,
          l.assessableValue, l.value, l.sd, l.vat, l.at, l.quantity, i.unit,
        ]),
      ),
      ["TOTAL", "", "", "", "", "", "", "", "", sum(r.items.flatMap((i) => i.imports.map((l) => l.assessableValue))), r.totals.inputValue, r.totals.inputSd, r.totals.inputVat, r.totals.advanceTax, "", ""],
    ],
  };
  const stock: Table = {
    title: "মজুদ (প্রতিটি পণ্যের আলাদা) / Stock by item",
    head: ["পণ্য", "একক", "মাসের শুরুর পরিমাণ", "শুরুর মূল্য", "আমদানি পরিমাণ", "বিক্রিত পরিমাণ", "বিক্রিত পণ্যের ক্রয়মূল্য", "মাসের শেষ পরিমাণ", "শেষ মূল্য"],
    rows: r.items.map((i): Cell[] => [i.item, i.unit, i.openQty, i.openVal, i.importedQty, i.soldQty, i.soldCost, i.closeQty, i.closeVal]),
  };
  return [summary, sub38, sub422, stock];
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function reportHtml(r: MonthlyReport): string {
  const body = tables(r)
    .map(
      (t) =>
        `<h2>${esc(t.title)}</h2><table><thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows
          .map((row) => `<tr>${row.map((c) => `<td${typeof c === "number" ? ' class="num"' : ""}>${esc(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
    )
    .join("");
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>Monthly report ${esc(r.month)}</title><style>body{font-family:"Noto Sans Bengali",sans-serif;margin:24px}table{border-collapse:collapse;width:100%;font-size:12px;margin-bottom:24px}th,td{border:1px solid #444;padding:4px 6px;text-align:left}th{background:#eee}.num{text-align:right}</style></head><body><h1>মাসিক রিপোর্ট ${esc(r.month)}</h1><p>${esc(r.importer.name)} &mdash; BIN ${esc(r.importer.bin)}</p>${body}</body></html>`;
}

export function reportXlsx(r: MonthlyReport): Uint8Array {
  const rows: Cell[][] = [[`মাসিক রিপোর্ট ${r.month}`], [r.importer.name, r.importer.bin], []];
  for (const t of tables(r)) {
    rows.push([t.title], t.head, ...t.rows, []);
  }
  return buildXlsx({ name: `Report ${r.month}`, rows, widths: [34, 30, 18, 24, 16, 14, 30, 16, 24, 16, 14, 12, 12, 12, 12, 8] });
}

export type SummaryRow = { bin: string; name: string; importedValue: number; importedVat: number; challans: number; soldValue: number; soldVat: number; soldTotal: number };

export function summaryXlsx(month: string, rows: SummaryRow[]): Uint8Array {
  const head = ["BIN", "আমদানিকারক", "আমদানির শুল্কায়নযোগ্য মূল্য", "আমদানির মূসক", "চালান সংখ্যা", "বিক্রয়ের করযোগ্য মূল্য", "বিক্রয়ের মূসক", "বিক্রয় মোট"];
  const data = rows.map((r): Cell[] => [r.bin, r.name, r.importedValue, r.importedVat, r.challans, r.soldValue, r.soldVat, r.soldTotal]);
  return buildXlsx({ name: `Summary ${month}`, rows: [[`সব আমদানিকারক - ${month}`], head, ...data], widths: [16, 30, 20, 16, 12, 20, 16, 16] });
}
