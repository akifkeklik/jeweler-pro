const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission } = require('../middleware/authorization');
const StockMovement = require('../models/StockMovement');
const MetalStock = require('../models/MetalStock');
const inventory = require('../services/finance/inventoryService');
const { liveMetalPrices } = require('../services/finance/metalPricing');
const { PURITY_PRESETS, KARAT_TO_PURITY } = require('../domain/metals');
const { tenantContext, branchScope } = require('../services/finance/core');

/** GET /api/inventory/movements — stock movement journal (tenant / branch scoped). */
router.get('/movements', requirePermission('catalog:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const filter = { businessId: ctx.businessId, ...branchScope(ctx, req.query.branch) };
  if (req.query.productId && /^\d+$/.test(String(req.query.productId))) filter.productId = Number(req.query.productId);
  if (req.query.itemType === 'metal' || req.query.itemType === 'product') filter.itemType = req.query.itemType;
  if (typeof req.query.movementType === 'string' && StockMovement.MOVEMENT_TYPES.includes(req.query.movementType)) filter.movementType = req.query.movementType;
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const movements = await StockMovement.find(filter).sort({ createdAt: -1 }).limit(limit)
    .populate({ path: 'productId', select: 'name', match: { businessId: ctx.businessId } })
    .populate('createdBy', 'name').lean();
  res.json(movements.map((m) => ({
    ...m,
    productName: m.productId && typeof m.productId === 'object' ? m.productId.name : undefined,
    productId: m.productId && typeof m.productId === 'object' ? m.productId._id : m.productId,
    weightGrams: m.weightMg / 1000,
    fineGrams: m.fineMg / 1000,
    cost: m.costMinor === null ? null : m.costMinor / 100,
  })));
}));

/** GET /api/inventory/metal — bulk metal pools (scrap / bullion). */
router.get('/metal', requirePermission('catalog:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const pools = await MetalStock.find({ businessId: ctx.businessId, ...branchScope(ctx, req.query.branch) }).sort({ branch: 1, metal: 1, purity: -1 }).lean();
  res.json(pools.map((p) => ({
    branch: p.branch, metal: p.metal, purity: p.purity, milyem: p.purity / 10,
    weightGrams: p.weightMg / 1000, fineGrams: p.fineMg / 1000, costTry: p.costPoolMinor / 100, updatedAt: p.updatedAt,
  })));
}));

/** GET /api/inventory/purities — supported purity presets and karat mapping. */
router.get('/purities', requirePermission('catalog:read'), (req, res) => {
  res.json({ presets: PURITY_PRESETS, karatToPurity: KARAT_TO_PURITY });
});

/** GET /api/inventory/valuation — at cost, and metal at live buy price (when fresh). */
router.get('/valuation', requirePermission('ledger:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  // Non-admins value their own branch only; admins the business or ?branch=.
  const { branch } = branchScope(ctx, typeof req.query.branch === 'string' ? req.query.branch : undefined);
  res.json(await inventory.valuation(ctx.businessId, { metalPrices: await liveMetalPrices('buy'), branch }));
}));

/** GET /api/inventory/reconciliation — projections vs. movements. */
router.get('/reconciliation', requirePermission('ledger:read'), asyncHandler(async (req, res) => {
  res.json(await inventory.reconcile(tenantContext(req).businessId));
}));

module.exports = router;
