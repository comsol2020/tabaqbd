---
description: How to read a Bangladesh customs bill of entry scan into save_bill_of_entry fields.
---

# Reading a bill of entry

- Importer: BIN (13 digits, may be printed as `000000000-0000`) and name come
  from the importer/consignee block. Not the C&F agent's.
- Header: B/E number and date (customs house in the title). Supplier is the
  exporter/seller.
- One `items` entry per commodity line: description, HS code, unit, quantity,
  assessable value (AV), then duties: CD, RD, SD, VAT, AIT, AT. A duty that is
  not printed is 0.
- Check each line: VAT should be about 15% (sometimes 5%, 7.5%, 10%) of
  AV + CD + RD + SD. The tool warns when it is not; re-read that line.
- If the page is blurry, cropped, or the BIN is not 13 digits, ask for a
  better scan. Do not fill gaps.
