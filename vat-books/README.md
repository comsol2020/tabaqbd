# VAT Books

BDK agent that keeps Mushak 6.1 / 6.2 / 6.3 books for many importers.

- Scanned bill of entry -> the model reads it -> `save_bill_of_entry` fills the importer's 6.1 purchase book (importer is keyed by BIN).
- `import_customers` -> `plan_sales` (preview) -> operator approves -> `confirm_sales` writes 6.3 challans and the 6.2 sales book.
- Customer rotation is code, not model judgment: customers served in the previous round are skipped, the rest go least-recently-served first.
- `export_books` publishes CSV (Excel) and printable HTML as downloadable artifacts.

Column layouts live in `bot/lib/forms.ts` and must be aligned with the VAT Online format.

```bash
npm install
npm test                         # rotation, VAT math, books
npx bdk serve --dir . --mode single --dev   # needs a Cursor credential for model turns
```

Hosting: this is a Node 22 process with a persistent state volume (`--state-root`); it cannot run on Cloudflare Workers/Pages. Cloudflare can sit in front (DNS, TLS, Access) of a VPS/container running it.
