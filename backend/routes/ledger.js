const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission } = require('../middleware/authorization');
const AccountBalance = require('../models/AccountBalance');
const LedgerEntry = require('../models/LedgerEntry');
const ledger = require('../services/finance/ledgerService');
const inventory = require('../services/finance/inventoryService');
const transferService = require('../services/transferService');
const posService = require('../services/posService');
const { tenantContext, branchScope } = require('../services/finance/core');

const unitScale = (unit) => (unit === 'TRY' ? 100 : 1000);

// Accounts that belong to one branch (till, card, bank, gold till, stock).
const BRANCH_ACCOUNT = /^(?:cash|vault|inventory):(.+)$|^bank:(.+):(?:card|transfer)$/;
/** Branch of a branch-specific account, else null (business-wide account). */
function accountBranch(account) {
  const m = BRANCH_ACCOUNT.exec(account);
  return m ? (m[1] ?? m[2]) : null;
}
/** Non-admins see business-wide accounts and their own branch's accounts only. */
const visibleAccount = (ctx) => (a) => ctx.isAdmin || [null, ctx.branch].includes(accountBranch(a.account));

/** GET /api/ledger/accounts — trial balance (every account with its balance). */
router.get('/accounts', requirePermission('ledger:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const accounts = (await AccountBalance.find({ businessId: ctx.businessId }).sort({ account: 1, unit: 1 }).lean()).filter(visibleAccount(ctx));
  res.json(accounts.map((a) => ({
    account: a.account,
    unit: a.unit,
    debit: a.debit / unitScale(a.unit),
    credit: a.credit / unitScale(a.unit),
    balance: (a.debit - a.credit) / unitScale(a.unit),
    closedDate: a.closedDate,
    lastPostedAt: a.lastPostedAt,
  })));
}));

/** GET /api/ledger/entries — journal (newest first), optional ?account= and ?reference= filters. */
router.get('/entries', requirePermission('ledger:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  // Journal entries are branch documents: non-admins see their own branch's.
  const filter = { businessId: ctx.businessId, ...branchScope(ctx, typeof req.query.branch === 'string' ? req.query.branch : undefined) };
  if (typeof req.query.account === 'string' && req.query.account.length <= 120) filter['lines.account'] = req.query.account;
  if (typeof req.query.referenceKind === 'string' && typeof req.query.referenceId === 'string') {
    filter['reference.kind'] = req.query.referenceKind;
    filter['reference.id'] = req.query.referenceId;
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const entries = await LedgerEntry.find(filter).sort({ date: -1, _id: -1 }).limit(limit).populate('createdBy', 'name').lean();
  res.json(entries.map((e) => ({
    ...e,
    lines: e.lines.map((l) => ({ ...l, debit: l.debit / unitScale(l.unit), credit: l.credit / unitScale(l.unit) })),
  })));
}));

/** GET /api/ledger/reconciliation — books + inventory integrity check. */
router.get('/reconciliation', requirePermission('ledger:read'), asyncHandler(async (req, res) => {
  const { businessId } = tenantContext(req);
  const [books, stock, transfers, pos] = await Promise.all([
    ledger.reconcile(businessId), inventory.reconcile(businessId), transferService.reconcile(businessId), posService.reconcile(businessId),
  ]);
  res.json({
    ok: books.ok && stock.ok && transfers.ok && pos.ok, ledger: books, inventory: stock, transfers, pos,
  });
}));

module.exports = router;
module.exports.accountBranch = accountBranch;
