# ADR 0001: Identify branches by a stable id, not by their display name

- **Status:** accepted. Phase 1 (registry) implemented on 2026-11-11; phase 2 (id-based account codes) still requires a rehearsal on real data.
- **Date:** 2026-11-10, updated 2026-11-11

## Context

A branch is identified everywhere by its display name (`'Merkez Şube - Kapalıçarşı'`):

- `User.branch`, `Product.branch`, `Sale.branch`, `Purchase.branch`, `StockTransfer.source/destinationBranch`, `DailyClosing.branch`, …
- **inside ledger account codes**: `cash:{branch}`, `bank:{branch}:card`, `inventory:{branch}`, `vault:{branch}`
- **inside composite primary keys**: `MetalStock._id = ${businessId}|${branch}|${metal}|${purity}`, `AccountBalance._id = ${businessId}|${account}|${unit}`

Consequences:

1. Renaming a branch (e.g. a typo fix or a move) silently splits its history across two "branches".
2. Two spellings of the same name ("Merkez" vs "Merkez ") become two branches.
3. Account codes contain free text (spaces, Turkish letters), which is fragile in exports and integrations.

## Decision

Introduce a `Branch` collection `{ _id: 'br_<short id>', businessId, name, active }`. Every reference stores `branchId`, and the UI shows `name`. Account codes use the id (`cash:br_x7k2`).

## Phase 1: registry (implemented)

Phase 1 removes consequences 1 and 2 without touching the books:

- **`Branch` collection** (`models/Branch.js`): `{ code, name, codeKey, nameKey }`. The registry is filled lazily from `User.branch`, so existing data needs no migration.
  - `code` is the value already stored everywhere: users, sales, stock, ledger account codes and composite ids. It never changes.
  - `name` is the editable display name.
- **Renaming** (`PATCH /api/branches/:code`, admins, audited) changes only `name`, so a branch's history can no longer split.
- **Assigning a branch to a user** normalises the input (trims, collapses whitespace, Unicode NFC) and matches it ignoring case (Turkish-aware) against existing codes **and** display names. "merkez " and "MERKEZ" resolve to the existing `Merkez`, and typing a branch's display name assigns its code.
- **Concurrency:** a branch reserves its keys in `claims`, which has a unique multikey index: the code key of a branch created through the registry, and its current display-name key. Concurrent creations or renames to the same name can never leave two branches answering to one name. One request wins, and the other gets the existing code or `409 BRANCH_NAME_IN_USE`. Legacy entries reserve nothing until they are renamed.
- **New codes** may not contain `:` or `|`, the separators of account codes and composite ids. This mitigates consequence 3 for every new branch.
- **`GET /api/branches`** returns `[{ code, name }]`. The Settings → Users tab lets admins rename branches and shows display names.

## Phase 2: why it is not done yet

Ledger account codes and composite keys change, so this is a **data migration of the books**, not a refactor. A safe migration needs:

1. A dry run on a **copy of real production data**, with a reconciliation report before and after (trial balance, stock == movements, open transfers).
2. Rewriting `AccountBalance` and `MetalStock` ids and every `LedgerEntry.lines.account` in one maintenance window. Ledger entries are immutable, so this also needs an agreed approach: rewrite with an audit record, or keep a mapping table.
3. A rollback plan. Today that is "restore the backup" (OPERATIONS.md §2).

None of this can be rehearsed without real data, so doing it blind would put the books at risk for a cosmetic gain.

## Phase 2 plan, when it is scheduled

1. Add a `branchId` next to `branch` on every model (dual write), using the registry from phase 1. The code stays the source of truth.
2. Backfill `branchId` (`scripts/migrateBranchIds.js --dry-run|--apply --confirm-backup`).
3. Switch reads to `branchId`, and keep the name only for display.
4. Migrate account codes and composite ids in one rehearsed window, then run reconciliation.
5. Remove the free-text `branch` fields in a later release.

Until then, `services/finance/branchDirectory.js` owns the registry and validates branches against the active branches of the business.
