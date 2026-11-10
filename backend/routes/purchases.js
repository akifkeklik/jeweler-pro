const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission, validateNumericId } = require('../middleware/authorization');
const Purchase = require('../models/Purchase');
const purchaseService = require('../services/purchaseService');
const { tenantContext, branchScope, notFound } = require('../services/finance/core');
const { readKey, withIdempotency } = require('../services/finance/idempotency');

/** Tenant AND branch scoped: another branch's purchase behaves exactly like a missing one (404). */
async function loadDto(ctx, id) {
  const purchase = await Purchase.findOne({ _id: id, businessId: ctx.businessId, ...branchScope(ctx) }).populate({ path: 'supplierId', select: 'name', match: { businessId: ctx.businessId } }).lean();
  if (!purchase) throw notFound('Alış bulunamadı', 'PURCHASE_NOT_FOUND');
  return purchaseService.purchaseDto(purchase);
}

router.get('/', requirePermission('purchases:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const filter = { businessId: ctx.businessId, ...branchScope(ctx, req.query.branch) };
  if (req.query.supplierId && /^\d+$/.test(String(req.query.supplierId))) filter.supplierId = Number(req.query.supplierId);
  const purchases = await Purchase.find(filter).populate({ path: 'supplierId', select: 'name', match: { businessId: ctx.businessId } }).sort({ date: -1 }).limit(500).lean();
  res.json(purchases.map(purchaseService.purchaseDto));
}));

router.get('/:id', validateNumericId, requirePermission('purchases:read'), asyncHandler(async (req, res) => {
  res.json(await loadDto(tenantContext(req), Number(req.params.id)));
}));

router.post('/', requirePermission('purchases:write'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const key = readKey(req);
  const outcome = await withIdempotency(ctx, { scope: 'purchase.create', key, payload: req.body }, ({ remember }) => purchaseService.createPurchase(
    ctx, req.body, key ? { idempotency: { remember } } : {},
  ));
  if (outcome.replayed) res.set('Idempotent-Replayed', 'true');
  const id = outcome.replayed ? Number(outcome.record.resourceId) : outcome.result._id;
  res.status(201).json(await loadDto(ctx, id));
}));

router.post('/:id/payments', validateNumericId, requirePermission('purchases:write'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const key = readKey(req);
  const outcome = await withIdempotency(ctx, { scope: `purchase.payment:${req.params.id}`, key, payload: req.body }, ({ remember }) => purchaseService.payPurchase(
    ctx, req.params.id, req.body, key ? { idempotency: { remember } } : {},
  ));
  if (outcome.replayed) res.set('Idempotent-Replayed', 'true');
  res.json(await loadDto(ctx, Number(req.params.id)));
}));

/** POST /api/purchases/:id/returns — purchase return (goods) or supplier price adjustment. */
router.post('/:id/returns', validateNumericId, requirePermission('purchases:write'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const key = readKey(req);
  const outcome = await withIdempotency(ctx, { scope: `purchase.return:${req.params.id}`, key, payload: req.body }, ({ remember }) => purchaseService.returnPurchase(
    ctx, req.params.id, req.body, key ? { idempotency: { remember } } : {},
  ));
  if (outcome.replayed) res.set('Idempotent-Replayed', 'true');
  res.json(await loadDto(ctx, Number(req.params.id)));
}));

/** POST /api/purchases/:id/refunds — the supplier pays back its credit on this purchase. */
router.post('/:id/refunds', validateNumericId, requirePermission('purchases:write'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const key = readKey(req);
  const outcome = await withIdempotency(ctx, { scope: `purchase.refund:${req.params.id}`, key, payload: req.body }, ({ remember }) => purchaseService.recordSupplierRefund(
    ctx, req.params.id, req.body, key ? { idempotency: { remember } } : {},
  ));
  if (outcome.replayed) res.set('Idempotent-Replayed', 'true');
  res.json(await loadDto(ctx, Number(req.params.id)));
}));

router.delete('/:id', validateNumericId, requirePermission('purchases:write'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  await purchaseService.cancelPurchase(ctx, req.params.id);
  res.json({ message: 'Alış iptal edildi; stok düşüldü ve tedarikçi borcu ters kayıtla kapatıldı', data: await loadDto(ctx, Number(req.params.id)) });
}));

module.exports = router;
