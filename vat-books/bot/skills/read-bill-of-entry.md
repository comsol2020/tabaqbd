---
description: How to read a Bangladesh customs bill of entry scan (land port, e.g. Tamabil) into save_bill_of_entry fields.
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
- **Item**: HS code (box 33), description (box 31), and the assessable value
  (box 46 "Item Assessable Value"). One `items` entry per item number (box 32);
  check box 5 (item count) matches.
- **Quantity and unit**: use the quantity that the goods are measured in.
  Boxes 35/38 give gross/net weight in kg; box 41 "Quantity/Units" can hold a
  different number. If these disagree (for example 25,500 kg net weight and 240
  in box 41), say so and ask the operator which one is the stock quantity.
- **Duties**: box 47 table has rows CD, RD, SD, VAT, AIT, AT, ATV with
  base, rate and amount. Use the **amount** column. ATV is a base only and has
  no amount in the books; ignore it. Rows that are 0.00 are 0.
- **Cross-check**: pass the "Total" under that table as `declaredTotalTax`
  (CD+RD+SD+VAT+AIT+AT). The tool warns if your reading does not add up.
  The larger "Total declaration" in the accounting box also includes other
  fees; do not use it.
- If the photo is blurry, cropped, or the BIN is not 13 digits, ask for a
  better scan. Do not fill gaps.

- **Office code / CPC code**: pass `officeCode` and `cpcCode` to the save tool
  only if they are printed on the scan or the operator gives them; they appear in
  return sub-form 4.22 and are left blank otherwise.
