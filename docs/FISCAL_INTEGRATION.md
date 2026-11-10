# Fiscal integration (e-Arşiv / e-Fatura / ÖKC)

**Status:** the integration seam is in place (`backend/services/fiscal`), but **no real provider is connected yet**. The app currently prints an internal sales slip that says on it that it is not a tax document.

## Why the app does not issue invoices itself

In Turkey, legal sales documents are issued through:

- a **GİB-authorised private integrator** (özel entegratör), for e-Arşiv fatura and e-Fatura, or
- a **new-generation cash register** (yeni nesil ÖKC / POS-ÖKC) for retail receipts.

Each one needs a contract, credentials and usually a certification step. You can't build or test that inside this repository.

## What exists

| Part | File | Purpose |
|---|---|---|
| Provider interface | `backend/services/fiscal/index.js` | `issue(document)` / `cancel(documentNo, reason)` |
| Default provider | `manual` | Records that the legal document is issued outside the app |
| Document builder | `buildFiscalDocument()` | Seller, buyer, lines with the KDV breakdown, totals (kuruş) |
| Configuration | `FISCAL_PROVIDER` env (default `manual`) | Picks the adapter. An unknown name fails at start-up |

## Connecting a real integrator (checklist)

1. **Decide with your mali müşavir** which document types the business must issue: e-Arşiv only, e-Fatura for registered buyers, and/or ÖKC.
2. Choose an integrator and get **test (sandbox) credentials**.
3. Write `backend/services/fiscal/<integrator>.js` that maps `buildFiscalDocument()` to the integrator API and calls `registerProvider()`.
4. Store the returned `documentNo` / `documentUrl` on the sale (new `fiscal` sub-document) and show it on the receipt.
5. **Failure handling:** never block the sale on an integrator outage. Mark the sale `fiscal.status = 'pending'` and retry from a background job. Show pending documents on the dashboard.
6. Cancellation and returns: use the integrator's cancel / return-invoice flow within the legal time limits.
7. Add contract tests against the sandbox to CI (with secrets), and run them before every release.

## Open questions for the accountant (also listed in BUSINESS_RULES.md)

- KDV treatment of gold jewellery and coins (margin basis), bullion exemption, silver.
- Whether scrap buy-back (hurda alımı) needs a gider pusulası / müstahsil makbuzu.
- Retention period and archive format of issued documents.
