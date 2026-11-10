# Working on Jeweler Pro

This app handles money, gold and customers' personal data. The rules below exist so that every change can actually be reviewed, and so that a mistake is caught before it reaches a shop.

## 1. Small pull requests

- **One topic per PR.** A bug fix, a feature slice or a refactor, never all three together.
- **Aim for under 400 changed lines** (lockfiles and generated locale JSON excluded). Above that, split the work: schema and service first, then API, then UI.
- Refactors and formatting go in their own PR, without behaviour changes, so the behavioural diff stays readable.
- A PR that changes the books (ledger postings, stock, VAT) needs a second reviewer.

## 2. Commits

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(sales): …`, `fix(tenancy): …`, `docs: …`, `test: …`, `chore: …`, `build: …`.
- The subject says **what changed**, in the imperative, under 72 characters. The body says **why** and lists any behaviour change.
- No marketing words ("world-class", "enterprise-grade", "ultimate"). Describe the change.

## 3. Code written with AI assistance

AI tools are welcome. The author is still responsible for every line.

- **Read and understand all of it** before you open the PR. If you cannot explain a line in review, delete it or rewrite it.
- **Don't let the same tool write both the code and its tests unchecked.** Work out the expected figures yourself (see the hand-computed comments in `backend/test/financialCore.test.js` and `backend/test/vat.test.js`).
- **No hand-written security primitives** (JWT, crypto, CSRF, rate limiting, input validation). Use a maintained library.
- **No fake features.** A button or dialog must either work or not exist. A camera dialog that animates but never decodes a barcode is a bug, not a feature.
- Watch for typical AI artefacts: invisible control characters (lint: `no-control-regex`), duplicate object keys, unused code, invented APIs, and claims in comments that the code does not back up.

## 4. Before you push

```powershell
npm run lint
npm run typecheck
npm test
npm --prefix backend test
```

CI runs the same gates, plus a dependency audit and the Docker builds. A red gate blocks the merge.

## 5. Project rules that are easy to break

- **Tenancy:** every query on business data must filter by `businessId`. The `tenantGuard` plugin throws if one doesn't. A bypass needs a written reason: `.setOptions({ skipTenantGuard: 'reason' })`.
- **Money:** integer kuruş and BigInt arithmetic only (`backend/domain/decimal.js`), never floating point.
- **API contract:** a new or removed route must be reflected in `docs/openapi.json`, otherwise `openapiContract.test.js` fails.
- **Texts:** every user-facing string goes through i18n in all eight languages. A new backend error `code` also needs a translation in `src/i18n/messages/core.ts`.
- **Files:** keep them under about 600 lines. Lint warns above that. Split large pages into components.
- **Business rules:** a rule with legal or accounting impact is documented in `backend/BUSINESS_RULES.md` and marked **Assumption** until a professional has confirmed it.
