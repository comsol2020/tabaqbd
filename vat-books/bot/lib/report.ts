import { productKey, tradeLedger } from "./ledger.js";
import type { ImporterDoc } from "./types.js";
import { round2 } from "./vat.js";
import { type Cell, buildXlsx } from "./xlsx.js";

export type ImportLine = {
  boeNo: string;
  boeDate: string;
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

export type ItemReport = {
  item: string;
  hsCode: string;
  unit: string;
  imports: ImportLine[];
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
};

const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

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
  };
}

type Table = { title: string; head: string[]; rows: Cell[][] };

function tables(r: MonthlyReport): Table[] {
  const t = r.totals;
  const summary: Table = {
    title: "সারসংক্ষেপ / Summary",
    head: ["বিবরণ", "মূল্য", "সম্পূরক শুল্ক", "মূসক"],
    rows: [
      ["মোট বিক্রয় (করযোগ্য মূল্য)", t.soldValue, t.soldSd, t.soldVat],
      ["মোট আমদানি (মূল্য + CD + RD + SD)", t.inputValue, t.inputSd, t.inputVat],
      ["আমদানিতে অগ্রিম কর (AT)", t.advanceTax, "", ""],
    ],
  };
  const sales: Table = {
    title: "বিক্রয়: আইটেম অনুযায়ী / Sales by item",
    head: ["পণ্য", "এইচ.এস. কোড", "একক", "চালান সংখ্যা", "বিক্রিত পরিমাণ", "করযোগ্য মূল্য", "সম্পূরক শুল্ক", "মূসক", "মোট"],
    rows: [
      ...r.items.map((i): Cell[] => [i.item, i.hsCode, i.unit, i.challans, i.soldQty, i.soldValue, i.soldSd, i.soldVat, i.soldTotal]),
      ["সর্বমোট", "", "", t.challans, "", t.soldValue, t.soldSd, t.soldVat, t.soldTotal],
    ],
  };
  const imports: Table = {
    title: "আমদানি/ক্রয়: আইটেম অনুযায়ী / Imports by item",
    head: ["পণ্য", "এইচ.এস. কোড", "বিল অব এন্ট্রি নং", "তারিখ", "সরবরাহকারী", "একক", "পরিমাণ", "শুল্কায়নযোগ্য মূল্য", "CD", "RD", "SD", "মূসক", "AIT", "AT"],
    rows: [
      ...r.items.flatMap((i): Cell[][] => {
        if (i.imports.length === 0) return [];
        return [
          ...i.imports.map((l): Cell[] => [i.item, i.hsCode, l.boeNo, l.boeDate, l.supplier, i.unit, l.quantity, l.assessableValue, l.cd, l.rd, l.sd, l.vat, l.ait, l.at]),
          [`${i.item} - মোট`, "", "", "", "", i.unit, i.importedQty, i.importedValue, sum(i.imports.map((l) => l.cd)), sum(i.imports.map((l) => l.rd)), sum(i.imports.map((l) => l.sd)), i.importedVat, sum(i.imports.map((l) => l.ait)), sum(i.imports.map((l) => l.at))],
        ];
      }),
      ["সর্বমোট", "", "", "", "", "", "", sum(r.items.flatMap((i) => i.imports.map((l) => l.assessableValue))), sum(r.items.flatMap((i) => i.imports.map((l) => l.cd))), sum(r.items.flatMap((i) => i.imports.map((l) => l.rd))), t.inputSd, t.inputVat, sum(r.items.flatMap((i) => i.imports.map((l) => l.ait))), t.advanceTax],
    ],
  };
  const stock: Table = {
    title: "মজুদ: প্রতিটি পণ্যের আলাদা / Stock by item",
    head: ["পণ্য", "একক", "মাসের শুরুর পরিমাণ", "শুরুর মূল্য", "আমদানি পরিমাণ", "বিক্রিত পরিমাণ", "বিক্রিত পণ্যের ক্রয়মূল্য", "মাসের শেষ পরিমাণ", "শেষ মূল্য"],
    rows: r.items.map((i): Cell[] => [i.item, i.unit, i.openQty, i.openVal, i.importedQty, i.soldQty, i.soldCost, i.closeQty, i.closeVal]),
  };
  return [summary, sales, imports, stock];
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
  return buildXlsx({ name: `Report ${r.month}`, rows, widths: [34, 16, 18, 14, 22, 12, 14, 18, 14, 12, 12, 12, 12, 12] });
}

export type SummaryRow = { bin: string; name: string; importedValue: number; importedVat: number; challans: number; soldValue: number; soldVat: number; soldTotal: number };

export function summaryXlsx(month: string, rows: SummaryRow[]): Uint8Array {
  const head = ["BIN", "আমদানিকারক", "আমদানির শুল্কায়নযোগ্য মূল্য", "আমদানির মূসক", "চালান সংখ্যা", "বিক্রয়ের করযোগ্য মূল্য", "বিক্রয়ের মূসক", "বিক্রয় মোট"];
  const data = rows.map((r): Cell[] => [r.bin, r.name, r.importedValue, r.importedVat, r.challans, r.soldValue, r.soldVat, r.soldTotal]);
  return buildXlsx({ name: `Summary ${month}`, rows: [[`সব আমদানিকারক - ${month}`], head, ...data], widths: [16, 30, 20, 16, 12, 20, 16, 16] });
}
