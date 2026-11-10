## What and why

<!-- One topic. What changes for the user or the books, and why. -->

## How it was tested

<!-- Commands run, new or changed tests, hand-computed figures for money/gold changes. -->

## Checklist

- [ ] One topic, roughly under 400 changed lines (lockfiles and generated locales excluded)
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npm --prefix backend test` pass locally
- [ ] I have read and understood every line, including any AI-generated code
- [ ] Business-data queries filter by `businessId` (no unexplained `skipTenantGuard`)
- [ ] Money and gold use integer minor units and BigInt helpers
- [ ] New or removed routes are reflected in `docs/openapi.json`
- [ ] New texts and error codes are translated in all eight languages
- [ ] Ledger, stock or VAT changes: reconciliation tested, and a second reviewer is requested
- [ ] Legal or accounting assumptions are documented in `backend/BUSINESS_RULES.md`
