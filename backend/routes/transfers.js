const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission, validateNumericId } = require('../middleware/authorization');
const StockTransfer = require('../models/StockTransfer');
const transferService = require('../services/transferService');
const { listBranches } = require('../services/finance/branchDirectory');
const { tenantContext } = require('../services/finance/core');
const { readKey, withIdempotency } = require('../services/finance/idempotency');

async function dto(ctx, id) {
  const transfer = await transferService.loadTransfer(null, ctx, id);
  return transferService.transferDto(transfer);
}

/** Runs an idempotent transfer command and answers with the fresh transfer view. */
function idempotentCommand(scope, run) {
  return asyncHandler(async (req, res) => {
    const ctx = tenantContext(req);
    const key = readKey(req);
    const outcome = await withIdempotency(ctx, { scope: `${scope}:${req.params.id}`, key, payload: req.body || null }, ({ remember }) => run(
      ctx, req.params.id, req.body || {}, key ? { idempotency: { remember } } : {},
    ));
    if (outcome.replayed) res.set('Idempotent-Replayed', 'true');
    res.json(await dto(ctx, req.params.id));
  });
}

/** GET /api/transfers/branches — active branches of the business (transfer destinations). */
router.get('/branches', requirePermission('transfers:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  res.json({ current: ctx.branch, branches: await listBranches(ctx.businessId) });
}));

/** GET /api/transfers — ?status=&direction=incoming|outgoing */
router.get('/', requirePermission('transfers:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const filter = { businessId: ctx.businessId, ...transferService.visibilityFilter(ctx) };
  if (typeof req.query.status === 'string' && StockTransfer.STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (req.query.direction === 'incoming') filter.destinationBranch = ctx.branch;
  if (req.query.direction === 'outgoing') filter.sourceBranch = ctx.branch;
  const transfers = await StockTransfer.find(filter).sort({ createdAt: -1 }).limit(300).lean();
  res.json(transfers.map(transferService.transferDto));
}));

router.get('/:id', validateNumericId, requirePermission('transfers:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const transfer = await transferService.loadTransfer(null, ctx, req.params.id);
  const view = transferService.transferDto(transfer);
  view.journal = (await transferService.journalOf(ctx, transfer._id)).map((e) => ({
    _id: e._id, entryType: e.entryType, date: e.date, description: e.description,
    lines: e.lines.map((l) => ({ account: l.account, unit: l.unit, debit: l.debit / 100, credit: l.credit / 100 })),
  }));
  res.json(view);
}));

router.post('/', requirePermission('transfers:write'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const key = readKey(req);
  const outcome = await withIdempotency(ctx, { scope: 'transfer.create', key, payload: req.body }, ({ remember }) => transferService.createTransfer(
    ctx, req.body, key ? { idempotency: { remember } } : {},
  ));
  if (outcome.replayed) res.set('Idempotent-Replayed', 'true');
  const id = outcome.replayed ? Number(outcome.record.resourceId) : outcome.result._id;
  res.status(201).json(await dto(ctx, id));
}));

router.post('/:id/approve', validateNumericId, requirePermission('transfers:approve'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  await transferService.approveTransfer(ctx, req.params.id, req.body || {});
  res.json(await dto(ctx, req.params.id));
}));

router.post('/:id/reject', validateNumericId, requirePermission('transfers:approve'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  await transferService.rejectTransfer(ctx, req.params.id, req.body || {});
  res.json(await dto(ctx, req.params.id));
}));

router.post('/:id/cancel', validateNumericId, requirePermission('transfers:write'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  await transferService.cancelTransfer(ctx, req.params.id, req.body || {});
  res.json(await dto(ctx, req.params.id));
}));

router.post('/:id/dispatch', validateNumericId, requirePermission('transfers:write'), idempotentCommand('transfer.dispatch', transferService.dispatchTransfer));
router.post('/:id/receive', validateNumericId, requirePermission('transfers:receive'), idempotentCommand('transfer.receive', transferService.receiveTransfer));
router.post('/:id/resolve', validateNumericId, requirePermission('transfers:approve'), idempotentCommand('transfer.resolve', transferService.resolveTransfer));

module.exports = router;
