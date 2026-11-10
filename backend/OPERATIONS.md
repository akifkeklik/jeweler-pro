# Jeweler Pro — operations runbook

For whoever deploys and runs the API. Business rules: `BUSINESS_RULES.md`;
security model: `SECURITY.md`.

## 1. Database requirements

- MongoDB **replica set** (transactions). Production start-up refuses a
  standalone server (`config/databaseCapabilities.js`).
- Every financial command is one transaction (snapshot read, majority
  write). Transient conflicts are retried by the driver; any error rolls
  back stock, journal, balances, documents, idempotency and audit together.
- Indexes are declared on the models and built at start-up. Verify after a
  deployment:
  ```
  mongosh "$MONGO_URI" --eval 'db.getCollectionNames().forEach(c => printjson({ c, idx: db[c].getIndexes().map(i => i.name) }))'
  ```
  Unique indexes that protect money: `idempotencyrecords._id`
  (`business|scope|key`), `stockmovements {businessId, externalKey}`,
  `ledgerentries {businessId, externalKey}`, `account_balances._id`,
  `metal_stocks._id`, `posproviders {businessId, code}`,
  `products {businessId, barcode}`.

## 2. Backup & restore

Take a consistent backup **before every deployment that changes data or
schema and before running a migration**:

```
mongodump --uri="$MONGO_URI" --oplog --gzip --archive=jeweler-$(date +%Y%m%d-%H%M).gz
```

`--oplog` makes the dump point-in-time consistent on a replica set. Store
it off-host and encrypted (it contains customer data).

Restore (into an EMPTY database or a staging cluster first):

```
mongorestore --uri="$RESTORE_URI" --oplogReplay --gzip --archive=jeweler-YYYYMMDD-HHMM.gz --drop
```

After a restore, verify the books for every business:

```
MONGO_URI="$RESTORE_URI" node scripts/migrate.js     # dry run; exit 0 = nothing pending
# and per business, as an admin: GET /api/ledger/reconciliation → ok: true
```

Practise the restore regularly; an untested backup is not a backup.

## 3. Migrations

`scripts/migrateFinancialData.js` converts pre-ledger data (tenancy fields,
tenant-scoped indexes, opening stock movements and journal entries, exact
customer balances). It is idempotent and never re-posts history.

- **Production never migrates implicitly.** At start-up it runs a read-only
  dry run (`scripts/migrationPlan.js`); if anything is pending the server
  refuses to start (`MigrationPendingError`) unless
  `MIGRATION_AUTO_APPLY=true`. Development and test still migrate
  automatically.
- **Procedure:**
  1. `node scripts/migrate.js > plan.json` — dry run. Review the opening
     inventory value, receivable / payable totals and the `issues`
     (invalid stock, corrupt balances, sales pointing at missing customers
     or products, stock with unknown cost). Exit code 2 = work pending.
  2. Fix or accept the issues. **Corrupt records are never auto-corrected**:
     they are skipped by the migration and stay visible in reconciliation.
  3. Take a backup (§2).
  4. `node scripts/migrate.js --apply --confirm-backup > result.json` —
     applies, re-plans and reconciles every business. Exit 0 = nothing
     pending and every business reconciles; exit 3 = verification flags
     records for a human (read `reconciliation[].discrepancies`: malformed
     legacy stock and still-ambiguous ownership are expected here until
     resolved; anything else is a stop).
  5. Start the API.
- **Safeguards (verified by `test/migrationRehearsal.test.js`, which runs
  this exact procedure with the real CLIs on a messy legacy dataset):**
  - The dry run is strictly read-only — documents **and indexes** (Mongoose
    automatic index builds are disabled in both CLIs; the apply builds the
    indexes explicitly after its pre-flight).
  - `--apply` without `--confirm-backup` is refused before connecting.
  - **Blocking duplicates** (`product_duplicate_barcode`,
    `daily_closing_duplicate` in the dry-run `issues`, `plan.blocking: true`)
    would violate the tenant-scoped unique indexes. `--apply` refuses
    (`MigrationBlockedError`, exit 1) **before writing anything**. Resolve
    each duplicate by hand (e.g. re-label one barcode), then dry-run again.
  - **Interrupted apply** (crash, kill, failover): re-run step 4. Each opening
    is posted once (external keys), the float→exact balance conversion is
    deterministic, so the re-run converges to exactly the same books.
  - `resolveStockOwnership.js` refuses to run before the migration (legacy
    products without `businessId` would otherwise be invisible and it would
    report a false "nothing left").
- **Rollback strategy:** the migration only *adds* documents and fields
  (plus replacing two legacy global unique indexes by tenant-scoped ones).
  The rollback is the restore of the backup from step 3; there is no
  partial "down" script, deliberately (a partial undo of journal entries is
  riskier than a restore).
- **Stock ownership (branch of legacy stock).** Opening stock is booked to
  the branch that **owns** it, never to the default branch by assumption.
  The owner comes from, in order: the product's own `branch`; an explicit
  operator resolution; the business's single branch (only when it has, or
  ever had, exactly one); or every movement of the product having been
  booked by one branch through the application. Anything else is reported
  as `stock_ownership_ambiguous` (dry run `issues`, start-up log) and the
  stock stays **frozen** (`409 STOCK_OWNERSHIP_UNRESOLVED`) until resolved —
  see "Stock ownership recovery" below. Start-up never re-books postings
  that already exist; mis-booked history (`stock_branch_misbooked`, e.g.
  openings the earlier migration put into the default branch) is repaired
  only by the recovery procedure.
- **Test on a sanitized copy first:** restore a production dump into a
  staging cluster, anonymise personal fields (names, phones, e-mails,
  addresses, tax numbers) with a script of your own, then run steps 1–4
  there. `test/migrationSafety.test.js` covers the logic with synthetic
  legacy-shaped documents; it is not a substitute for a dry run on real data.

### Stock ownership recovery (`scripts/resolveStockOwnership.js`)

Used for products whose stock has no owning branch (frozen), or whose
movements / inventory value were booked to a branch other than the owner
(reconciliation: `foreign_branch_stock`, `unresolved_ownership`).

1. `node scripts/resolveStockOwnership.js [--business=ID] > ownership.json`
   — read-only. Per product: status (`needs_opening`, `needs_assignment`,
   `needs_reclass`, `ambiguous`, `conflict`, `inconsistent`,
   `invalid_stock`), the owner and its basis, the net quantity / cost booked
   to each foreign branch, and for ambiguous products the evidence
   (known branches, movements per branch). Exit 2 = decisions pending.
2. Decide every ambiguous product with the shop (physical count per branch).
   Write `resolutions.json`: `{ "<businessId>": { "<productId>": "<branch>" } }`
   (active branches only; a product that already has a branch cannot be
   re-assigned here — use a transfer).
3. Dry-run again with `--resolutions=resolutions.json`; check
   `invalidResolutions` is empty.
4. Backup (§2), then
   `node scripts/resolveStockOwnership.js --apply --confirm-backup --resolutions=resolutions.json`.
   Each product is applied in its own transaction and re-analysed inside
   it: opening in the owner branch, branch assignment, and for foreign
   bookings paired `ownership_reclass` movements plus one balanced
   `inventory_ownership_reclass` entry per foreign branch
   (`Dr inventory:{owner} / Cr inventory:{foreign}`). Quantities, purity,
   cost pools and the trial balance are unchanged. Every touched business is
   reconciled afterwards (exit 3 if not clean). Re-running is a no-op.
5. **Undo:** everything is additive. A wrong explicit owner is corrected
   with a normal inter-branch transfer (stock and value move with an audit
   trail); a full undo is the backup restore.

## 4. Multiple API instances

| Concern | Behaviour across instances |
|---|---|
| Idempotency keys | stored in MongoDB in the same transaction → exactly-once across instances |
| Stock, balances, transfers, POS | MongoDB transactions + conditional updates → safe across instances |
| Auth rate limits (in-process) | per instance (precise first layer) |
| Auth rate limits (shared) | `middleware/sharedRateLimit.js`: atomic MongoDB counters with TTL, on login / forgot / reset. On by default in production (`RATE_LIMIT_SHARED_STORE=mongo`), off elsewhere; fails closed (503) if the store is unreachable |
| Market data cache / circuit breakers | per instance (each instance polls providers itself; mind provider quotas: N instances × fetch rate). Reviewed: a shared cache would need either a new dependency or a MongoDB lease; with the 30 s cache, ≤ 3 instances stay within the free providers' quotas, and every sale snapshots the exact quote it used, so instances never disagree inside one document. Revisit above 3 instances or with a metered feed |
| Stock ownership claims | the first stock of a shared item claims it for one branch inside the transaction, guarded on `branch: ''` — concurrent claims from two branches resolve to exactly one owner (tested) |
| Sessions / tokens | stateless JWT + refresh sessions in MongoDB |

A reverse-proxy limit remains advisable as an outer layer.

## 5. Observability

- **Correlation id:** every request gets `X-Correlation-ID` (a valid
  client-supplied id is kept). It is stored on ledger entries, stock
  movements, POS transactions and audit records → a financial operation can
  be traced from the browser to every document it wrote:
  `db.ledgerentries.find({ correlationId: "<id>" })`.
- **Request log:** one line per request; `LOG_FORMAT=json` for structured
  JSON (`time, level, method, path, status, durationMs, correlationId,
  businessId, userId`). Query strings, bodies, headers and tokens are never
  logged. Failed mutating financial requests carry `financial: true` — alert
  on their rate. `REQUEST_LOG=off` disables the line (tests).
- **Errors:** 5xx are logged with stack; 4xx compactly (name, code,
  message); path without query string.
- **Provider health:** `GET /api/prices/status → providerHealth` (circuit
  state, failures, rate limits, latency, last error).
- **Books:** `GET /api/ledger/reconciliation` must be `ok: true`; schedule it
  daily per business and alert on discrepancies.
- **Readiness:** `GET /health/ready` (503 until MongoDB is connected).

## 6. Configuration added in this release

All optional; secrets stay in environment variables, never in the code.

| Variable | Default | Purpose |
|---|---|---|
| `MIGRATION_AUTO_APPLY` | unset | `true` lets production apply pending migrations at start-up |
| `RATE_LIMIT_SHARED_STORE` | `mongo` in production, `off` otherwise | cluster-wide auth rate limiting |
| `LOG_FORMAT` | text | `json` for structured logs |
| `REQUEST_LOG` | on | `off` disables per-request lines |
| `MARKET_DATA_BREAKER_THRESHOLD` | 3 | consecutive failures before a provider's circuit opens |
| `MARKET_DATA_BREAKER_COOLDOWN_MS` | 60000 | first cooldown (doubles, max 10 min) |
| `MARKET_DATA_RETRY_BASE_MS` | 250 | backoff base for the single retry |

## 7. Quality gates

```
cd backend && npm test                        # unit + integration (in-memory replica set)
cd backend && node scripts/defectInjection.js # injects 34 financial / authorization / migration defects; all must be caught
npm test                                      # frontend unit tests (Vitest)
npm run build                                 # production build
npm run test:e2e && npm run test:e2e:ops      # browser E2E (Playwright, real stack)
```

`test/systemAcceptance.test.js` chains every workflow (sale, collection,
scrap buy-back, purchasing and returns, transfers, POS settlement and
refunds, branch closings, failure injection) in one business with two
branches, reconciling the books after every step, and attacks the branch
and role boundaries from inside the business.

## 8. Environment reference

Names only — values live in the deployment's secret store, never in the
repository. Production start-up validates them (`config/runtimeConfig.js`)
and refuses an unsafe configuration.

| Group | Variables |
|---|---|
| Core (required in production) | `NODE_ENV=production`, `MONGO_URI` (replica set), `JWT_SECRET` (≥ 32 chars, random), `CORS_ORIGIN`, `APP_URL`, `PORT` |
| Proxy / cookies | `TRUST_PROXY` (hop count or subnet, never `true`), `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_SAMESITE`, `AUTH_COOKIE_DOMAIN` |
| First admin / recovery | `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` (first start only), `ADMIN_RECOVERY`, `ADMIN_RECOVERY_TOKEN`, `ADMIN_RECOVERY_OVERRIDE_ACTIVE_ADMINS` (break-glass, `SECURITY.md` §3) |
| E-mail (password reset) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS` |
| Market data | `MARKET_DATA_INTERVAL_MS`, `MARKET_DATA_CACHE_TTL_MS`, `PRICING_MAX_QUOTE_AGE_MS`, `TCMB_TIMEOUT_MS`, `GENELPARA_ENABLED`, `GENELPARA_MIN_INTERVAL_MS`, `BIST_API_URL`, `BIST_API_KEY`, breaker/retry (§6) |
| Operations | `REPORT_TIME_ZONE` (default Europe/Istanbul; defines "today" for Z-reports), `MIGRATION_AUTO_APPLY`, `RATE_LIMIT_SHARED_STORE`, `RATE_LIMIT_MAX_ENTRIES`, `AUDIT_TELEMETRY_RETENTION_DAYS`, `LOG_FORMAT`, `REQUEST_LOG` |
| Frontend build | `VUE_APP_API_URL`, `VUE_APP_API_TIMEOUT` |

## 9. Production deployment checklist

**Before (staging, with a sanitized production copy):**
1. All quality gates (§7) green on the release commit.
2. Restore the latest production dump into staging, anonymise it, run the
   migration procedure (§3) and the ownership recovery (§3) there. Record
   the dry-run totals (opening inventory per branch, receivables, payables,
   gold) and have the shop owner sign them off — they become the opening
   balances.
3. Resolve every blocking duplicate and every ambiguous stock decision on
   paper (physical count per branch) before the production window.

**Deployment window (production):**
1. Announce downtime; stop all API instances (no writes during the migration).
2. Backup (§2) and verify the archive can be listed (`mongorestore --dryRun`).
3. `node scripts/migrate.js > plan.json` — compare with the staging totals.
   Any difference → stop and investigate.
4. `node scripts/migrate.js --apply --confirm-backup > result.json`.
5. `node scripts/resolveStockOwnership.js --apply --confirm-backup --resolutions=resolutions.json`.
6. Deploy the new API and frontend build; start ONE instance first.
7. Verify (below); then start the remaining instances.

**Post-deployment verification:**
- `GET /health` → `OK`; `GET /health/ready` → 200 `READY`.
- As an admin, per business: `GET /api/ledger/reconciliation` → `ok: true`
  (only the human-pending items accepted at step 3 may remain).
- `GET /api/prices/status` → at least one provider healthy.
- Smoke test in the UI (one branch): small cash sale → payment → customer
  statement → `/api/cash/daily-summary` shows it; void it with a return.
- Indexes present (§1 command), in particular the unique money indexes.
- Logs: no 5xx; alert rule on `financial: true` failures active.

**Rollback:**
- Application only (no migration ran): redeploy the previous build.
- After a migration: stop the API, restore the step-2 backup (§2), redeploy
  the previous build. There is no partial "down" migration by design.
- Never "fix" books by editing balances or opening entries: correct with a
  documented reversing / adjusting entry through the application.

**Known limitations and external dependencies:**
- Market data comes from public providers (TCMB, GenelPara, optional BIST
  feed). When all are stale, gram items cannot be sold at a live price — the
  cashier must enter a manual price (by design, never a stale quote).
- In-process caches (market data) and per-instance rate limiters: see §4;
  tested up to 3 instances.
- E-mail delivery (password reset) depends on the SMTP relay.
- **Scaling constraint — dashboard:** `/api/dashboard/summary` computes
  all-time totals by reading every sale of the scope on each load. Measured
  (60 000 sales, single node): ≈ 0.7–0.9 s, linear in history (≈ 4 s at
  300 000). A MongoDB aggregation was tried and measured slower (each pass
  is a full scan); the fix is incrementally maintained summary counters
  written in the sale/return/cancel transactions — planned, not done.
  Reports and lists are bounded (sales list ≤ 1000, purchases ≤ 500,
  vouchers ≤ 200 per request; 60–120 ms measured). Customers and products
  are returned unpaginated (fine for thousands, not for 100 000+).
- Branches are derived from active users (`User.branch`); there is no branch
  master data. Deactivating the last user of a branch makes it unusable as
  a transfer destination.
