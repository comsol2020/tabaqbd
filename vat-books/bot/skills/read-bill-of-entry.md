---
description: How to read a Bangladesh customs bill of entry scan (land port, e.g. Tamabil, Bhomra) into save_bill_of_entry fields.
---

# Reading a bill of entry

Layout of the common form ("BILL OF ENTRY / EXPORT"), phone photos included:

- **Importer** is box 8 "Consignee/Importer": `BIN: 000311657-0701` is 9+4
  digits, so 13 digits once the hyphen is dropped. Name and address follow.
  The TIN under it is not the BIN. Box 2 is the foreign exporter, which is the
  supplier (name to `supplierName`, address lines to `supplierAddress`). Box 14 is the C&F agent (not the importer).
- **B/E number and date**: top right, "Registration" shows a letter and number
  (`C 8251`, save as `C-8251`) with the date beside it, printed `DD/MM/YYYY`
  (05/09/2026 is 5 September 2026). The assessment and receipt dates in the
  accounting box are later dates; do not use them.
- **Item**: HS code is box 33. One `items` entry per item number (box 32);
  check box 5 (item count) matches. Assessable value is box 46.
- **Quantity and unit (standing rule)**: stock quantity is **box 38 net
  weight**, unit **KG**. Do not use box 41 Quantity/Units (it may be blank, or
  hold a different figure such as 240). Do not use package count. If the
  description of goods contains `EXT= … KGS`, pass that text as
  `goodsDescription` and pass box 38 alone as `quantity`. The tool adds only
  those EXT kilograms to box 38. Do not add or subtract any other figure,
  and do not change any money figure. Do not ask which quantity to use.
- **Product name (standing rule)**: look up every box-33 HS code with
  `lookup_hs` (shared across all importers). If the name is already stored,
  use it and do not ask. If it is unknown, ask the operator to type the name
  once, then `set_product_name` or pass `productName` on save. Never invent a
  name from the scan's "Description of Goods" text, and never ask again for an
  HS code that is already in the catalogue. `2521.00.10` and `25210010` are the
  same code.
- **Value addition %**: once per BIN, not per bill of entry. If
  `list_importers` already shows `additionPct` for this BIN, omit it. If not,
  ask the operator once and pass `valueAdditionPct` (or `set_value_addition`).
  Never invent a percentage.
- **Duties**: box 47 table has rows CD, RD, SD, VAT, AIT, AT, ATV with
  base, rate and amount. Use the **amount** column. ATV is a base only and has
  no amount in the books; ignore it. Rows that are 0.00 are 0.
- **Cross-check**: pass the "Total" under that table as `declaredTotalTax`
  (CD+RD+SD+VAT+AIT+AT). The tool warns if your reading does not add up.
  The larger "Total declaration" in the accounting box also includes other
  fees; do not use it.
- If the photo is blurry, cropped, or the BIN is not 13 digits, ask for a
  better scan. Do not fill gaps.
