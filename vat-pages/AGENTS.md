# vat-pages

Bot Development Kit (BDK) project (`@cursor/bdk`). The served agent's
prompt is `bot/instructions.md`.

This agent only splits a bundled scan into one page and hands each page
to `vat-books`. It does not keep Mushak books. Do not add 6.1 rules here.

## Approved work stays

The operator will say how far the work is correct. After that, an update
must not change that part. Do not rewrite, reorder, or tighten instructions,
tools, or bookkeeping behavior they already called correct. The update is
only the next part: add it after the approved point.

## Loop

```bash
bdk validate --dir .
npm test
npm run check
bdk call send_pages --dir .. --slug vat-pages --input '{…}'
```

Run the CLI under Node, never Bun. Serve the repo root so `vat-pages` and
`vat-books` mount together. This agent declares a peer named `vat-books`,
so serving this directory alone does not start. Both need the same
`VAT_DATA_DIR`.
