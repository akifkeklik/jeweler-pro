const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission } = require('../middleware/authorization');
const PosProvider = require('../models/PosProvider');
const PosTransaction = require('../models/PosTransaction');
const PosSettlement = require('../models/PosSettlement');
const posService = require('../services/posService');
const { tenantContext, branchScope, notFound } = require('../services/finance/core');
const { readKey, withIdempotency } = require('../services/finance/idempotency');

const isObjectId = (v) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v) && String(new mongoose.Types.ObjectId(v)) === v;

function requireObjectId(req, res, next) {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Geçersiz ID formatı', code: 'INVALID_ID' });
  return next();
}

/* ----------------------------------------------------------- providers */

router.get('/providers', requirePermission('pos:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const providers = await PosProvider.find({ businessId: ctx.businessId }).sort({ active: -1, name: 1 }).lean();
  res.json(providers.map(posService.providerDto));
}));

/** Active providers usable at the caller's branch (for the POS screen; sales:write may read). */
router.get('/providers/active', requirePermission('sales:write'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const providers = await posService.activeProviders(ctx.businessId, ctx.branch);
  res.json(providers.map((p) => ({ _id: p._id, code: p.code, name: p.name, installments: p.rules.map((r) => r.installments) })));
}));

router.post('/providers', requirePermission('pos:configure'), asyncHandler(async (req, res) => {
  const provider = await posService.createProvider(tenantContext(req), req.body);
  res.status(201).json(posService.providerDto(provider));
}));

router.put('/providers/:id', requireObjectId, requirePermission('pos:configure'), asyncHandler(async (req, res) => {
  const provider = await posService.updateProvider(tenantContext(req), req.params.id, req.body || {});
  res.json(posService.providerDto(provider));
}));

/** POST /api/pos/quote — server-side commission preview { providerId, installments, amount }. */
router.post('/quote', requirePermission('sales:write'), asyncHandler(async (req, res) => {
  res.json(await posService.quote(tenantContext(req), req.body || {}));
}));

/* -------------------------------------------------------- transactions */

router.get('/transactions', requirePermission('pos:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const filter = { businessId: ctx.businessId, ...branchScope(ctx, req.query.branch) };
  if (['open', 'partially_settled', 'settled'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.status === 'unsettled') filter.status = { $ne: 'settled' };
  if (req.query.providerId === 'none') filter.providerId = null;
  else if (isObjectId(req.query.providerId)) filter.providerId = new mongoose.Types.ObjectId(req.query.providerId);
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  const rows = await PosTransaction.find(filter).sort({ capturedAt: -1 }).limit(limit).lean();
  res.json(rows.map(posService.transactionDto));
}));

router.get('/summary', requirePermission('pos:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  res.json(await posService.summary(ctx, branchScope(ctx, req.query.branch)));
}));

/* --------------------------------------------------------- settlements */

router.get('/settlements', requirePermission('pos:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const rows = await PosSettlement.find({ businessId: ctx.businessId, ...branchScope(ctx, req.query.branch) }).sort({ settlementDate: -1, createdAt: -1 }).limit(300).lean();
  res.json(rows.map(posService.settlementDto));
}));

router.post('/settlements', requirePermission('pos:settle'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const key = readKey(req);
  const outcome = await withIdempotency(ctx, { scope: 'pos.settlement', key, payload: req.body }, ({ remember }) => posService.createSettlement(
    ctx, req.body, key ? { idempotency: { remember } } : {},
  ));
  if (outcome.replayed) res.set('Idempotent-Replayed', 'true');
  const id = outcome.replayed ? outcome.record.resourceId : String(outcome.result._id);
  const settlement = await PosSettlement.findOne({ _id: id, businessId: ctx.businessId }).lean();
  if (!settlement) throw notFound('Hesap kesimi bulunamadı', 'POS_SETTLEMENT_NOT_FOUND');
  res.status(201).json(posService.settlementDto(settlement));
}));

router.post('/settlements/:id/reverse', requireObjectId, requirePermission('pos:settle'), asyncHandler(async (req, res) => {
  const settlement = await posService.reverseSettlement(tenantContext(req), req.params.id, req.body || {});
  res.json(posService.settlementDto(settlement.toObject()));
}));

module.exports = router;
