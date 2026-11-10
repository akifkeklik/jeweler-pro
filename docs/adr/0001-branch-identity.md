# ADR 0001: Identify branches by a stable id, not by their display name

- **Status:** proposed. Deliberately **not** implemented in the remediation round.
- **Date:** 2026-11-10

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

## Why it was not done now

Ledger account codes and composite keys change, so this is a **data migration of the books**, not a refactor. A safe migration needs:

1. A dry run on a **copy of real production data**, with a reconciliation report before and after (trial balance, stock == movements, open transfers).
2. Rewriting `AccountBalance` and `MetalStock` ids and every `LedgerEntry.lines.account` in one maintenance window. Ledger entries are immutable, so this also needs an agreed approach: rewrite with an audit record, or keep a mapping table.
3. A rollback plan. Today that is "restore the backup" (OPERATIONS.md §2).

None of this can be rehearsed without real data, so doing it blind would put the books at risk for a cosmetic gain.

## Plan when it is scheduled

1. Add `Branch` and a `branchId` next to `branch` on every model (dual write). The name stays the source of truth.
2. Backfill `branchId` (`scripts/migrateBranchIds.js --dry-run|--apply --confirm-backup`).
3. Switch reads to `branchId`, and keep the name only for display.
4. Migrate account codes and composite ids in one rehearsed window, then run reconciliation.
5. Remove the free-text `branch` fields in a later release.

Until then, the branch list is managed by `services/finance/branchDirectory.js`, which validates names against the known branches of the business.
