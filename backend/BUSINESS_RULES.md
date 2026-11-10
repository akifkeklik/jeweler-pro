# Jeweler Pro: financial and inventory business rules

This document defines how money, gold and stock are calculated, posted and
reconciled. Where a rule could reasonably be implemented in more than one way,
the choice is marked **Assumption** with its rationale. Review each assumption
with the business owner and an accountant before go-live. Nothing here is a
statement of legal, tax or accounting requirements.

Code references: `backend/domain/*` (pure calculation engine),
`backend/services/finance/*` (ledger, inventory, pricing, idempotency),
`backend/services/{sales,purchase,cash,catalog}Service.js`.

---

## 1. Precision and rounding (`domain/precision.js`, `domain/decimal.js`)

| Quantity | Stored as | Example |
|---|---|---|
| Money (TRY) | integer kuruş (`…Minor`) | `12345` = 123.45 TL |
| Weight | integer milligrams (`weightMg`) | `1750` = 1.750 g |
| Fine metal content | integer milligrams fine (`fineMg`) | `1603` = 1.603 g has |
| Purity | integer, parts per 10 000 | `9160` = 0.916 (22 ayar) |
| Unit / gram price (input) | exact decimal, 4 places | `6562.5300` TL/g |
| FX rate (input) | exact decimal, 6 places | `50.210400` |
| Percentages (input) | exact decimal, 2 places | `12.50` % |

- All arithmetic uses BigInt fixed-point. JavaScript floating point is never
  used for a financial result. JSON responses show amounts as numbers for
  display only, and clients send amounts as decimal strings.
- **Input is strict.** Excess decimals (such as `10.005` TL), exponent
  notation, decimal commas, negative amounts, `NaN` and `Infinity` are
  rejected with HTTP 400.
- **Rounding is HALF_UP (commercial) and happens once per computed amount**:
  a unit price, a discount, a currency conversion, a fine-weight figure.
  Totals are exact sums of already-rounded amounts.
- **Assumption:** a line total is the rounded unit price × quantity. The
  printed unit price is therefore always exactly consistent with the line.

## 2. Precious metals (`domain/metals.js`)

- Karats map to **trade standards**, not karat/24:
  - 24 = 995 (has)
  - 22 = 916
  - 18 = 750
  - 14 = 585
  - 9 = 375
  - 8 = 333

  999.9 bullion and silver (999 / 925 / 900 / 800) must be selected
  explicitly. An explicit purity (`purity` 0.xxxx or `milyem` 916) always
  overrides a karat label.
- Fine content = weight × purity, rounded once to the milligram.
- **Assumption (milyem convention):** the market quote `HAS_ALTIN` (and
  `GUMUS_GRAM`) is treated as the TRY price of 1 g at 1000 milyem, which is
  the usual Turkish jeweller convention. If the shop prices relative to 995,
  configure purities accordingly.

## 3. Pricing (`domain/pricing.js`)

Gram-priced items (`pricingMode: 'gram'`) are priced at sale time from the
live has-gold sell price:

| Labour (`laborType`) | Unit price |
|---|---|
| `none` | weight × purity × price |
| `milyem` | weight × (purity + labour‰) × price, e.g. 22 ayar sold at 916 + 35 = 951 |
| `per_gram` | weight × purity × price + weight × labour TL/g |
| `fixed` | weight × purity × price + labour TL per piece |

- The unit price is rounded once. The metal/labour breakdown is derived so
  that metal + labour equals the unit price exactly.
- **Discounts:**
  - A line discount (percent or amount) is rounded once and can never exceed
    the line.
  - A sale-level discount is allocated to lines proportionally (largest
    remainder), so a return refunds exactly the net value of the returned
    items.
- **Scrap buy-back (hurda alımı):** weight × (assayed purity − fire
  deduction‰) × buy price. The recorded fine content uses the assayed purity
  (fire is a price deduction, not lost metal).
- **Currency conversion:** amount × rate, rounded once to the target minor
  unit.
- **Card/POS commission:** see §15.
- **Not implemented:** sales staff commissions.

## 4. Market prices (`services/finance/metalPricing.js`, `services/marketDataService.js`)

- **Live quotes only.** A sale or buy-back is priced only from a quote that
  is present, not stale, not cached, not indicative or theoretical, and
  within `PRICING_MAX_QUOTE_AGE_MS` (default 5 min).
- **Otherwise refuse.** The command fails with `409 MARKET_PRICE_UNAVAILABLE`
  and the user may enter an explicit manual gram price. The sale line stores
  the price snapshot with `priceType: 'manual'` or `'live'`, plus the source,
  side, both quoted sides and the source timestamp.
- **Manual prices per metal.** A sale's `manualPrices` is keyed by metal code
  (`{ XAU, XAG }`); every gram line uses the price of its own product's metal,
  so a gold + silver cart needs both (or a live quote for the missing one).
  Unknown keys are refused (`400 INVALID_METAL`).
- **Sides:** sales use the dealer's **sell** price, buy-backs the **buy**
  price. Inventory valuation at market uses the **buy** price, and only when
  a live quote exists (otherwise "not computed", never a stale value).
- **Theoretical prices:** these reference prices are only derived from live
  inputs, and carry the older input's timestamp.
- **GenelPara** returns no source timestamp. Freshness therefore means
  "received within 5 min", and the quotes are labelled
  `timestampSource: 'received'`. The free API allows about 1000 requests a
  day, so it is fetched at most every 3 min (`GENELPARA_MIN_INTERVAL_MS`),
  user refreshes respect that interval, and the remaining quota is reported
  in provider status.
- **TCMB** reports `unavailable` (not `ok`) when it returns no current
  quotes, for example at weekends.
- **BIST and the other paid providers** need `*_API_URL` / `*_API_KEY`. Until
  configured they report `unavailable`. None of them has been verified
  against a real endpoint in this repository (no credentials).
- **Failover.** Per symbol, a live quote always wins over a stale/cached one,
  then provider priority. (Before: priority only — a stale quote of a
  higher-priority provider could hide a live one and block sales.)
- **Resilience** (`providers/providerHealth.js`): per-provider circuit
  breaker (opens after 3 consecutive failures, cooldown 60 s doubling to
  10 min, one half-open trial), HTTP 429 honours `Retry-After` and is not
  retried, network errors / timeouts / 5xx get one retry with backoff and
  jitter, malformed responses are rejected without retry. Concurrent
  fetches of one provider are de-duplicated; results are cached
  (`MARKET_DATA_CACHE_TTL_MS`, never shorter than a provider's minimum
  fetch interval).
- **Freshness labels** (`GET /api/prices`): `live` (usable for pricing),
  `delayed` (display only), `indicative` (theoretical, never used for
  transactions). Manual prices exist only as explicit per-transaction
  entries and are stored as `priceType: 'manual'` in the sale snapshot and
  the audit record. When every provider is down, no live quote exists and
  pricing refuses (`409 MARKET_PRICE_UNAVAILABLE`).
- **Health:** `GET /api/prices/status` → `providerHealth` (circuit state,
  success/failure/rate-limit counters, last latency, last error).
- **Registry:** `registerProvider()` / `unregisterProvider()` in
  `services/marketDataService.js` add a new adapter (subclass of
  `MarketDataProvider`) without touching business logic.

## 5. Double-entry ledger (`services/finance/ledgerService.js`)

- Every financial event is one immutable `LedgerEntry` with at least two
  lines. For each unit (TRY, XAU, XAG), Σ debit = Σ credit. This is enforced
  by the model, so no code path can store an unbalanced entry.
- Corrections are reversal entries (`reversalOf` / `reversedBy`). Entries are
  never edited or deleted.
- **Balance projections.** `AccountBalance` (per account and unit), the
  customer balances (`balanceTryMinor`, `balanceGoldMg`) and the supplier
  balance are written in the same transaction as the entry.
- **Reconciliation** (`GET /api/ledger/reconciliation`) recomputes everything
  from the journal:
  - every entry balances;
  - each projection equals the journal;
  - customer and supplier balances equal their accounts;
  - the trial balance sums to zero;
  - stock equals the movements.
- **Chart of accounts:** documented at the top of `ledgerService.js`. Cash,
  card and bank-transfer accounts are per branch, and the gold till
  (`vault:{branch}`, unit XAU) holds customer gold settlements.
- **Customer balance sign** (kept from the earlier version):
  - positive = the business owes the customer;
  - negative = the customer owes the business.
- **Assumption:** `revenue:sales` is recorded net of discounts, and returns
  go to the contra account `revenue:returns`.

## 6. Inventory (`services/finance/inventoryService.js`)

- **Traceability.** Every stock change is an immutable `StockMovement`:
  - opening and opening migration;
  - purchase and purchase cancellation;
  - sale, sale cancellation and sale return;
  - adjustment and revaluation;
  - scrap purchase.

  `Product.stock` and the cost pool are projections of these movements.
- **Negative stock is impossible.** Outgoing movements are guarded inside the
  transaction. Twenty concurrent sales of the last five units produce exactly
  five sales.
- **Cost method (Assumption: weighted average).** Each product has an exact
  cost pool (kuruş). Issuing q of n units removes round(pool × q / n); the
  last unit takes the remainder, so the pool never drifts. Returns and
  cancellations put back exactly the cost that was issued.
- **Unknown cost.** Products whose cost is unknown are excluded from COGS and
  valuation and reported as such. A purchase into a product with stock of
  unknown cost is refused until a cost revaluation is entered; costs are
  never guessed.
- **Edits through the product API:**
  - a changed `stock` becomes an `adjustment` (offset to
    `inventory_adjustment`);
  - a changed `costPrice` becomes a `revaluation` (offset to
    `equity:revaluation`).

  Both require the `inventory:adjust` permission (manager and admin). Opening
  stock on product creation is an `opening` movement posted against
  `equity:opening`.
- **Metal pools** (`MetalStock`) hold bulk gold and silver by branch, metal
  and purity, with weight, fine content and a cost pool, under the same
  rules.
- **Stock ownership (invariant).** Units on hand always belong to exactly
  one branch — the product's `branch` — and every stock movement and
  `inventory:{branch}` posting of the product is booked to that branch
  (`inventoryService.assertStockOwner`, enforced inside every movement:
  `409 BRANCH_OWNERSHIP_MISMATCH`). A product without a branch is a shared
  catalogue item that holds **no** stock: the first incoming movement
  (opening stock, purchase, return) claims it for that branch. Legacy stock
  on a branch-less product is frozen (`409 STOCK_OWNERSHIP_UNRESOLVED`)
  until resolved (OPERATIONS.md → "Stock ownership recovery").
- **Who may act.** A product with a `branch` is sold, bought, adjusted and
  archived only by users of that branch (admins excepted). Non-admins may
  set a product's branch only to their own (or leave it shared); admins
  only to an active branch. Stock moves between branches only through
  transfers (§16); changing the `branch` of a product that has stock is
  refused (`409 PRODUCT_BRANCH_HAS_STOCK`).
- **Documents follow the stock.** A sale or purchase belongs to the branch
  that owns its products; all lines must belong to one branch
  (`409 MIXED_BRANCH_DOCUMENT`). An admin acting on another branch's stock
  must name that branch explicitly (`branch` in the payload) — otherwise
  `409 CROSS_BRANCH_CONFIRMATION_REQUIRED`; the whole document (stock
  movements, `inventory:`, till / card / bank accounts, POS records) is
  then booked to that branch. Collections, returns, refunds and
  cancellations of a sale or purchase are booked to the document's branch,
  whoever performs them. (Before: the admin's own branch was used even for
  another branch's stock, silently moving inventory value between branches.)
- Opening stock and count adjustments are booked to the inventory account
  of the **product's** branch (before: the user's branch).
- **Reservations.** Approved transfers reserve units (`Product.reservedStock`,
  `MetalStock.reservedWeightMg/reservedFineMg`). Sales, adjustments and
  returns can only take `stock − reserved`.

## 7. Sales (`services/salesService.js`)

Sale → stock decrease → customer receivable → collection.

- **One transaction.** Stock movements, journal entries (revenue, receivable,
  COGS and payments), the sale document, the idempotency record and the
  audit record commit together or not at all.
- **Several lines of one product.** Allowed (each line keeps its own
  discount, gram weight and return state). Stock leaves line by line through
  the same product state, so each line's cost is the weighted average left by
  the previous line and Σ line costs equals the cost of all units sold. The
  total quantity per product must be free stock, otherwise
  `409 INSUFFICIENT_STOCK` with the total requested.
- **Payments:**
  - Payments are cash, card or bank transfer, can be split, and may be
    partial.
  - Overpayment is rejected.
  - The open balance stays on the customer's account (cari).
  - Legacy single-product requests without `payments` mean "paid in full with
    `paymentMethod`" (the historic behaviour).
- **Credit limit (Assumption).** `creditLimit > 0` is enforced:
  existing debt + new open balance must not exceed it. `creditLimit = 0`
  means *not configured* (no limit), because every existing customer has 0.
  Set limits explicitly where credit control is required.
- **Payments against a sale** reduce its open balance and cannot exceed it.
  General account collections (tahsilat) are allocated to the customer's
  open sales oldest first; any surplus stays as account credit.
- **Returns:**
  - Returns can be partial, per line and quantity. They refund the net line
    value proportionally; returning every unit refunds the line exactly.
  - Money paid beyond the new net value is refunded through the chosen method
    or, with `cari`, kept as account credit.
  - Requires `sales:cancel`.
- **Cancellation (void):**
  - Restores stock at the issued cost and reverses the sale entry.
  - Refunds payments taken at the sale or against it, through the same
    method.
  - Collections allocated from the account stay as credit.
  - Not possible after a return (use returns for the rest).
- **Locked facts.** The amounts, payment method and date of a journaled sale
  cannot be edited; notes can. Legacy pre-ledger sales keep their old
  editable payment method and date.
- **Assumption:** the posting date is always the server time. Back-dating
  sales is not allowed.

## 8. Purchases (`services/purchaseService.js`)

Purchase → stock increase → supplier payable → payment.

- **Lines:**
  - products (quantity × unit cost);
  - metal (weight, purity, total cost) into the metal pool.
- **Entries:** debit `inventory:{branch}`, credit `ap:{supplier}`. Payments
  can be made at purchase time, against a purchase, or as a supplier voucher
  (allocated to open purchases oldest first).
- **Cancellation:**
  - Requires the purchased goods to still be in stock. It removes them at
    average cost and reverses the payable.
  - **Assumption:** payments already made are not reversed. They remain a
    debit balance on the supplier's account until the supplier refunds.
- **Cancellation is refused once a return or price adjustment exists**
  (`PURCHASE_HAS_RETURNS`); use returns for the rest.
- **Purchase returns:** see §17.

## 9. Cash and accounts (`services/cashService.js`)

`POST /api/cash/transactions` vouchers:

| Type | Accounting effect |
|---|---|
| `tahsilat` (collection) | money or gold received: debit cash/bank or gold till, credit the customer's account |
| `tediye` (payment) | to a customer (TRY or gold) or a supplier (TRY) |
| `gider` (expense) | debit `expense:{category}` |
| `devir` (opening balance) | cash or gold opening against `equity:opening`; customer or supplier opening with an explicit `direction` (`borc` = they owe us, `alacak` = we owe them) |
| `hurda_alimi` (scrap buy-back) | metal into the pool at cost; paid in cash/bank or credited to the customer (`paymentMethod: 'cari'`); priced at an agreed amount or from purity, fire and the live/manual buy price |

- **Permissions beyond `cash:write`.**
  - A customer or supplier **opening balance** (`devir` with a party)
    creates a receivable/payable against `equity:opening` and requires
    `accounts:manage` (admin, manager). Otherwise a cashier could book "we
    owe the customer X", pay X out of the drawer, and hide the loss in
    opening equity. The drawer float (`devir` without a party) stays a
    cashier operation.
  - Any **supplier** voucher (`tediye` / `devir` with `supplierId`) requires
    `purchases:write`, like `POST /api/purchases/:id/payments`.
  - Changing a customer's **credit limit** requires `accounts:manage`.
    Sending the unchanged value (the UI echoes the record on edit) is
    allowed.
  - A customer or supplier with an **open balance** (TRY or gold) cannot be
    archived (`409 OPEN_BALANCE`); settle it first.
- **Gold till.** It cannot go negative: you cannot pay out gold you do not
  hold.
- **Assumption:** the TRY cash account is *not* blocked from going negative.
  Without an opening balance (devir) the drawer's starting cash is unknown.
  Record opening cash so the Z-report is meaningful.

## 10. Daily closing / Z-report

- **Calculation.** The figures come from the ledger cash account of the
  branch:
  - the opening balance carried over;
  - today's inflows and outflows by type;
  - the calculated drawer cash.

  "Today" is the local day in `REPORT_TIME_ZONE` (default Europe/Istanbul).
  The previous version used UTC boundaries.
- **Counting.** The counted cash is mandatory. A difference is posted to
  `cash_over_short`, so ledger cash equals counted cash.
- **Gold count.** When the counted gold (`closingGoldActual`, g has) is
  submitted, its difference to the gold till is posted to `gold_over_short`
  (XAU), so the ledger gold till equals the count, and the gold till is
  locked together with the drawer. When it is omitted (gold not counted),
  nothing is posted and the gold till stays open. The UI sends it only when
  the field is filled. (Before: the gold difference was recorded but never
  posted.)
- **Lock.** After closing, no further cash posting for that branch and day is
  accepted (`409 CASH_DAY_CLOSED`), nor gold-till posting when gold was
  counted. Card and transfer postings remain possible. A second closing is
  refused.
- **Branch.** Non-admins close their own branch. Naming another branch is
  refused (`403 BRANCH_MISMATCH`) — it is never silently redirected to the
  caller's own drawer (before: the request closed and locked the caller's
  branch). Admins may close any active branch.
- **Race safety.** A closing and a concurrent cash posting can never
  disagree: both write the same balance document, so one is serialised
  after the other.

## 11. Idempotency and concurrency

- **Idempotency.** Financial commands accept an `Idempotency-Key` header:
  sale, payment, return, purchase, purchase payment and voucher.
  - The same key with the same payload returns the original result
    (`Idempotent-Replayed: true`).
  - The same key with a different payload gets `422`.
  - Parallel duplicates execute exactly once.

  The UI sends a key with every financial action.
- **Transactions.** Every command runs in one MongoDB transaction (snapshot
  read, majority write). Conflicting transactions are retried by the driver.
  An error at any step rolls back stock, journal, balances and documents
  together.

## 12. Tenant and branch isolation

- **Tenant isolation.** Every financial and catalogue document carries a
  `businessId`. Every query and write is filtered by the caller's business,
  covering products, categories, materials, customers, suppliers, sales,
  purchases, vouchers, closings, journal, stock and reports. Another
  business's id behaves exactly like a missing one (404). Ledger accounts are
  never created for unknown or foreign parties.
- **Branch isolation.** Non-admin users see sales, vouchers, purchases,
  stock movements (also per product), journal entries, branch accounts
  (`cash:`, `bank:`, `vault:`, `inventory:` of other branches are hidden
  from the trial balance) and inventory valuation of their own branch only;
  `?branch=` is ignored for them. Admins see all branches (optional
  `?branch=`). Another branch's purchase or sale behaves exactly like a
  missing one (404) on every endpoint — read, payment, return, refund,
  cancellation. Customers, suppliers, their statements (`ar:` / `ap:`
  accounts) and the product catalogue are business-wide master data.
- **Intentional access rules (business-wide master data vs branch-bound
  transactions):**
  - Customers, suppliers and their statements are **visible business-wide**
    to anyone holding the read permission: a customer may buy in one branch
    and pay in another.
  - A **collection** (`tahsilat`) at branch B settles the customer's
    business-wide receivable, oldest open sale first, including sales of
    branch A. The money is booked to B's drawer/bank and appears on B's
    Z-report — never on A's. Branch A's sale shows the payment
    (`source: account_collection`).
  - Branch-bound **documents** (sales, purchases, POS transactions and
    settlements, transfers, closings) can only be read and changed by their
    branch (other branches: 404 or `403 BRANCH_MISMATCH`). This covers
    payments, returns, cancellations and edits on another branch's sale.
  - Gold and cash can only leave the caller's own branch till.
  - Admins act on every branch, always with an explicit branch for writes.
- **Client ownership fields are never trusted.** `businessId`, `reservedStock`,
  `costPoolMinor`, `transferOriginId` are ignored on write; `branch` is
  authorised as above; an admin's explicit branch must be an active branch
  (also for the day closing).
- **Reconciliation** additionally checks per branch that `inventory:{branch}`
  equals the cost of that branch's stock movements
  (`branch_inventory_value`), that no branch-bound product holds units or
  value booked to another branch (`foreign_branch_stock`), and reports
  stock without an owner (`unresolved_ownership`).
- **Previous behaviour.** Before this change none of these collections were
  tenant-scoped.

## 13. Migration (`scripts/migrateFinancialData.js`, runs at start-up, idempotent)

- **Tenancy.** Legacy documents get the default business and branch.
- **Indexes.** The global unique indexes (`products.barcode_1`,
  `dailyclosings.date_1`) are replaced by tenant-scoped ones. Legacy
  duplicates that would violate them (same barcode, or two closings of one
  branch and day, within a business) block the migration before any write;
  they are reported, never auto-renamed or deleted.
- **Stock.** Existing stock gets an `opening_migration` movement and, when
  the cost is known, an opening inventory entry — in the branch that owns
  it (product branch → explicit resolution → single-branch business →
  unambiguous movement custody). Ambiguous ownership is never defaulted:
  it is reported and frozen until an operator resolves it
  (`scripts/resolveStockOwnership.js`). (Before: every opening was booked
  to the default branch.)
- **Customer balances.** Existing balances get exact integer fields and an
  `opening_migration` journal entry, so receivables equal balances.
- **Historical sales and vouchers are not re-posted.** Their effect is
  already contained in the migrated balances, and re-posting would double
  count. Statements show the migrated balance as one opening line.

## 14. Permissions added

| Permission | Roles | Purpose |
|---|---|---|
| `purchases:read` / `purchases:write` | manager, admin | suppliers, purchases, supplier payments |
| `inventory:adjust` | manager, admin | stock count adjustments and cost revaluations |
| `ledger:read` | manager, admin | trial balance, journal, valuation, reconciliation |
| `transfers:read` | staff, manager, admin | view transfers of the own branch (admin: all) |
| `transfers:write` | manager, admin | create drafts, dispatch, cancel |
| `transfers:approve` | manager, admin | approve / reject drafts, close shortfalls (return or write-off) |
| `transfers:receive` | staff, manager, admin | receive at the destination branch |
| `pos:read` | manager, admin | POS transactions, settlements, providers |
| `pos:settle` | manager, admin | record / reverse bank settlements |
| `pos:configure` | admin | POS providers and commission rules |

## 15. Card / POS commission (`services/posService.js`, `domain/commission.js`)

- **Providers** (`/api/pos/providers`, `pos:configure`): one per bank / POS
  agreement, optionally limited to branches, with one rule per installment
  count: rate (exact %, up to 4 decimals, stored in ppm), fixed fee per
  transaction, valör days. Rule changes create a new **version**; the old
  version moves to `history`.
- **Capture.** Every card payment (sale, payment against a sale, card
  `tahsilat`) creates a `PosTransaction` in the same transaction with a
  snapshot of the rule (version, rate, fee, valör, refund policy):
  - commission = round_half_up(gross × rate) + fee, once; it can never
    exceed the gross (`422 COMMISSION_EXCEEDS_AMOUNT`);
  - `Dr expense:pos_commission / Cr bank:{branch}:card` — the card account
    then holds exactly the NET amount the bank owes;
  - expected settlement date = capture + valör days (calendar days).
  - Several active providers → the client must choose (`400
    POS_PROVIDER_REQUIRED`); exactly one → used by default; none → previous
    behaviour (gross receivable, commission unknown, item flagged
    `commissionConfigured: false`).
  - Card numbers are never stored: terminal / authorisation codes that look
    like a PAN are rejected (`CARD_DATA_REJECTED`).
- **Historical snapshots.** Recorded transactions are never recalculated
  with a later rate (tested).
- **A POS authorisation is not a settlement.** Items stay `open` until a
  bank deposit is matched.
- **Settlement** (`POST /api/pos/settlements`, `pos:settle`): deposit amount
  + matched items (explicit list with optional partial amounts, or all items
  due by the settlement date). `Dr bank:{branch}:transfer (deposited) / Cr
  bank:{branch}:card (expected)`. A difference is booked **only** with an
  explicit resolution: `commission` (→ `expense:pos_commission`) or
  `settlement_difference` (→ `pos_settlement_difference`, to investigate);
  otherwise `422 SETTLEMENT_DIFFERENCE_UNRESOLVED`. Partial settlement is
  supported; refunds (negative items) are matched in full. A wrong match is
  corrected by reversal (`/reverse`, reason required), never by editing.
- **Settlement direction.** `depositedAmount` is the signed bank movement and
  must have the sign of the expected net (`422 SETTLEMENT_DIRECTION_MISMATCH`
  otherwise):
  - expected > 0 → the bank paid in: deposited > 0 (`Dr transfer / Cr card`);
  - expected < 0 (refund-only batch, refunds exceed captures) → the bank
    debited the account: deposited < 0 (`Dr card / Cr transfer`);
  - expected = 0 (captures and refunds net out) → deposited = 0; the items are
    closed by the settlement document, no journal entry is posted, and a
    reversal only reopens the items.
  A difference within the same direction still needs an explicit resolution.
- **Refunds.** Card refunds (returns, cancellations) create negative items
  linked to the original payment. Commission policy per provider:
  `retained` (default — the bank keeps the commission) or `reversed` (bank
  refunds it proportionally; cumulative shares, so a full refund reverses
  exactly).
- **Reconciliation** (part of `/api/ledger/reconciliation`): net = gross −
  commission per item, settled within bounds, Σ settlement allocations ==
  settled amounts. The card account vs. open POS items is a *warning*
  (`pos_gl_difference`): card postings outside the POS flow (legacy data,
  company-card payments recorded as "kredi kartı") explain it.

## 16. Inter-branch transfers (`services/transferService.js`)

Lifecycle `draft → approved → in_transit → (partially_received) → received`;
`draft → rejected | cancelled`; `approved → cancelled`.

| Step | Who | Effect |
|---|---|---|
| create | `transfers:write`, source branch (admin: any) | validates branches, products, free stock, purity pools; nothing reserved |
| approve | `transfers:approve`, source branch, **not the creator** (admin excepted) | reserves products / metal |
| reject | `transfers:approve`, source branch, reason | — |
| cancel | `transfers:write`, source, reason; draft or approved only | releases reservations |
| dispatch | `transfers:write`, source | stock out at weighted-average cost: `Dr inventory_transit / Cr inventory:{source}` |
| receive | `transfers:receive`, destination | partial or full: `Dr inventory:{destination} / Cr inventory_transit` at exactly the dispatched cost share |
| resolve | `transfers:approve`, source or destination, reason | shortfall `return_to_source` (stock back at its cost) or `write_off` (`Dr expense:transfer_loss`) |

- **Conservation:** per line, dispatched = received + returned + written
  off + outstanding — pieces, weight, fine content and cost. Partial costs
  are differences of cumulative shares, so transit clears to exactly zero.
- **Branches** are the branches with at least one active user of the
  business (no separate branch master data). Unknown branches and branches
  of other businesses are rejected.
- **Products** must belong to the source branch; shared products (no
  branch) are refused with an actionable message. At the destination the
  units go into, in order: the explicitly chosen target product (same
  pricing mode, metal, purity and weight required), the original catalogue
  item / an earlier branch copy, or a new branch copy (without barcode —
  barcodes are unique per business). A transfer back lands in the original.
- **Idempotency / concurrency:** dispatch, receive and resolve accept
  `Idempotency-Key`; status transitions are conditional inside the
  transaction, so parallel dispatches or approvals execute once (tested).
- **Reconciliation:** `inventory_transit` == Σ outstanding dispatched cost;
  reservations == Σ approved transfer lines.

## 17. Purchase returns (`services/purchaseService.js → returnPurchase`)

`POST /api/purchases/:id/returns` (`purchases:write`, purchase branch):

- **Goods return** against original purchase lines: pieces (products) or
  grams (metal; fine content is the line's exact share, purity unchanged).
  Bounded by purchased − already returned (`RETURN_EXCEEDS_PURCHASED`).
- **Physical availability.** The goods must be in stock and not reserved.
  Sold / consumed goods cannot go back: `409 INSUFFICIENT_STOCK_FOR_RETURN`
  with `alternative: 'price_adjustment'`.
- **Values.** Supplier credit = the line's remaining value × returned share
  (cumulative; a full return credits the line exactly). Inventory leaves at
  weighted-average cost (the average of the remaining units is unchanged).
  `Dr ap:{supplier} / Cr inventory:{branch} / ± purchase_return_variance`.
- **Price adjustment** (`kind: 'price_adjustment'`, credit note for
  consumed goods or a price correction): `Dr ap / Cr
  purchase_price_adjustment`, no stock movement; bounded by the line's
  remaining value.
- **Supplier refund.** When returns leave the supplier owing us money
  (`paymentStatus: 'overpaid'`, `supplierCredit`), a refund can be recorded
  with the return or later (`POST /api/purchases/:id/refunds`): `Dr
  cash/bank / Cr ap`. Refunds are bounded by that credit.
- Returns are append-only records with their journal entry; the original
  purchase lines and entries are never changed. Duplicate requests are
  prevented by per-line bounds inside the transaction and by
  `Idempotency-Key`.

## 18. Decisions requiring professional validation

These are implemented as documented assumptions. None of them has been
validated by an accountant or a Turkish tax adviser. **Each must be
confirmed or changed before production use.**

| # | Topic | Current implementation | Operational impact if wrong | Decision needed from |
|---|---|---|---|---|
| 1 | **24 ayar = 995** | karat 24 maps to purity 0.995; 999.9 must be chosen explicitly | fine content of 24K items understated by 0.49 % if the shop treats 24K as 999.9 | business owner / chamber (KTO) practice |
| 2 | **HAS_ALTIN quote = 1 g at 1000 milyem** | gram price × purity | every gram-priced sale shifts by ~0.5 % if the feed quotes 995 | owner + data provider contract |
| 3 | **Credit limit 0 = no limit** | `creditLimit > 0` enforced, 0 means unconfigured | customers with 0 can take unlimited credit | owner (credit policy) |
| 4 | **Weighted-average cost** (perpetual, per product and per metal pool) | also used for transfer dispatch and purchase-return removal | COGS and inventory value differ from FIFO / specific identification; specific identification is common for unique jewellery pieces | accountant (VUK valuation method) |
| 5 | **Chart of accounts** | internal codes (`cash:{branch}`, `ar:{id}`, `purchase_return_variance`, …), not the Turkish Tekdüzen Hesap Planı | an export / mapping to 100, 120, 153, 320, 600, 610, 621, 653, 780 … is needed for statutory books | accountant |
| 6 | **Purchase-return variance** | difference between supplier credit (original price) and average cost → `purchase_return_variance` | alternative: remove at original cost and re-average | accountant |
| 7 | **Price adjustments for consumed goods** | credited to `purchase_price_adjustment` (contra-COGS style); inventory pools unchanged even if some units are still on hand | inventory slightly overstated if part of the adjusted goods is unsold | accountant |
| 8 | **Scrap buy-back fire deduction** | fire is a price deduction; fine content recorded at assayed purity | metal pool overstated if fire represents real loss on melting | owner / refinery practice |
| 9 | **Currency conversion & rounding** | HALF_UP, once per amount, 2 decimals TRY | cumulative rounding differences vs. bank / invoice systems that round differently | accountant |
| 10 | **Discounts** | revenue net of discounts; sale-level discount allocated by largest remainder | presentation of discounts on invoices / e-Fatura | accountant |
| 11 | **Sales returns** | contra account `revenue:returns` | — | accountant |
| 12 | **POS commission timing** | expensed at capture (accrual), net receivable on the card account | alternative: recognise at settlement | accountant |
| 13 | **Refund commission policy** | per provider, default `retained` | wrong expense if the bank actually refunds (or vice-versa); check each bank agreement (void vs. refund, same-day cancellations) | owner + bank agreements |
| 14 | **Valör** | calendar days; no bank holiday calendar | expected settlement dates (overdue flags) are approximate | owner |
| 15 | **Installment sales** | commission per installment rule; the whole amount is one receivable with one expected date (blocked-account style) | banks that pay installments monthly need per-installment schedules | bank agreements |
| 16 | **Transfer losses** | written off to `expense:transfer_loss` at cost; requires a reason | tax deductibility of losses needs documentation (tutanak) | accountant |
| 17 | **Branch definition** | a branch exists when an active user is assigned to it | a branch without staff cannot receive transfers | owner |
| 18 | **Posting date = server time** | no back-dating | period-end corrections need reversal entries | accountant |

**Not claimed:** compliance with Turkish statutory accounting (VUK, TTK),
e-Fatura / e-Arşiv, e-Defter, ÖKC/POS fiscal device rules or MASAK
reporting. The KDV engine (§20) and the identification check (§21)
implement the **assumptions** listed there. They are switched off until the
business confirms them, and they are not a statement of legal compliance.

## 19. External dependencies

- **Market data:** licensed feeds (Hasfiyat, Nadir Döviz, İZKO, Investing,
  BIST) need contracts and `*_API_URL` / `*_API_KEY`. Their response
  formats are assumed (`ConfiguredHttpProvider` contract), not verified.
- **Bank / POS settlement files:** settlements are entered manually (or via
  the API). Automatic import of bank statements / POS settlement reports
  (MT940, bank-specific CSV, API) needs per-bank formats and credentials.

## 20. KDV (`domain/vat.js`; off by default)

- Prices are **VAT-inclusive**. The engine splits each sale line into
  matrah + KDV after all discounts, rounding once, HALF_UP.
- Classes per product (`Product.vatClass`; `auto` derives one):
  - `exempt`: has/külçe gold (purity ≥ 995, no labour). **Assumption A1** (KDVK 17/4-g).
  - `gold_margin`: gold jewellery and coins. KDV applies only to the
    amount above the gold value of the sale-time price snapshot.
    **Assumption A2** (KDVK 23). A discount below the gold value leaves
    no taxable margin.
  - `full`: everything else (silver, gemstones, accessories). **Assumption A3**.
  - A gold item without a metal breakdown (fixed price) is taxed on the
    full price and marked `gross_no_metal_value`. **Assumption A4**.
- Rate: `BusinessProfile.vat.standardRateBp` (default 2000 = 20 %).
- Books: `revenue:sales` is credited net of KDV, and `tax:vat_payable` is
  credited with the KDV. A return debits `tax:vat_payable` proportionally.
  A cancellation reverses the original entry.
- **Switching it on requires the name of the approving mali müşavir**
  (`VAT_APPROVAL_REQUIRED`). The time it was switched on is stored.
- Sales made while VAT was off carry no VAT snapshot. They are never
  recalculated.

## 21. MASAK identification and KVKK (`BusinessProfile.compliance`, `routes/customers.js`)

- `identificationThreshold` (TL, default **not set**): a sale whose total
  is at or above the threshold needs a customer with an identity
  document on file (`CUSTOMER_IDENTIFICATION_REQUIRED`). The identity
  (type, number, name) is snapshotted on the sale. **The amount is a
  compliance decision. The app ships no legal default.**
- Identity documents: TCKN (checksum verified), passport or foreign ID
  (5–20 alphanumerics). Lists show the number masked (`12*******90`).
  Only users with `customers:write` see it in full.
- KVKK: `kvkkNoticeVersion` on the customer records which privacy notice
  the person was informed with. The server stamps the time.
- Erasure (`POST /api/customers/:id/anonymize`, `customers:delete`) removes
  name, contact data, identity and notes, and keeps the numeric id,
  balances and sales so the books stay intact. It is refused with an open
  balance. Legal retention of issued invoices is the e-Arşiv provider's
  job (docs/FISCAL_INTEGRATION.md).
- Business tax number: 10-digit VKN (format only) or an 11-digit TCKN
  (checksum).

