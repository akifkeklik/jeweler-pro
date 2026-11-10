const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission, validateNumericId } = require('../middleware/authorization');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const AuditLog = require('../models/AuditLog');
const { createSalesService, financialView, lineDto } = require('../services/salesService');
const { tenantContext, branchScope } = require('../services/finance/core');
const { readKey, withIdempotency } = require('../services/finance/idempotency');

const salesService = createSalesService({ Sale, Product, Customer, AuditLog });

/**
 * Sale DTO. Keeps every legacy field (customerName, productName, totalPrice,
 * paymentMethod, …) and adds the financial view (paid, balanceDue, lines …).
 */
function toSaleDto(sale) {
  const value = sale.toObject ? sale.toObject() : sale;
  const customer = value.customerId && typeof value.customerId === 'object' ? value.customerId : null;
  const product = value.productId && typeof value.productId === 'object' ? value.productId : null;
  const lines = Array.isArray(value.lines) ? value.lines.map(lineDto) : undefined;
  return {
    ...value,
    customerId: customer ? customer._id : value.customerId,
    productId: product ? product._id : value.productId,
    customerName: customer ? customer.name : undefined,
    productName: lines?.length ? lines.map((l) => l.productName).join(', ') : (product ? product.name : undefined),
    lines,
    financial: financialView(value),
    payments: (value.payments || []).map((p) => ({ kind: p.kind, method: p.method, amount: p.amountMinor / 100, source: p.source, at: p.at })),
    returns: (value.returns || []).map((r) => ({ returnId: r.returnId, amount: r.amountMinor / 100, refund: r.refundMinor / 100, refundMethod: r.refundMethod, lines: r.lines, at: r.at, reason: r.reason })),
  };
}

async function loadDto(ctx, id) {
  const sale = await Sale.findOne({ _id: id, businessId: ctx.businessId, ...branchScope(ctx) })
    .populate({ path: 'customerId', select: 'name', match: { businessId: ctx.businessId } })
    .populate({ path: 'productId', select: 'name', match: { businessId: ctx.businessId } });
  return sale ? toSaleDto(sale) : null;
}

function notFound() {
  const error = new Error('Satış bulunamadı');
  error.statusCode = 404;
  error.code = 'SALE_NOT_FOUND';
  return error;
}

router.get('/', requirePermission('sales:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const filter = { businessId: ctx.businessId, ...branchScope(ctx, req.query.branch) };
  if (req.query.customerId && /^\d+$/.test(String(req.query.customerId))) filter.customerId = Number(req.query.customerId);
  if (typeof req.query.paymentStatus === 'string' && ['paid', 'partial', 'unpaid', 'refunded'].includes(req.query.paymentStatus)) {
    filter.paymentStatus = req.query.paymentStatus;
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);
  const sales = await Sale.find(filter)
    .populate({ path: 'customerId', select: 'name', match: { businessId: ctx.businessId } })
    .populate({ path: 'productId', select: 'name', match: { businessId: ctx.businessId } })
    .sort({ date: -1 })
    .limit(limit);
  res.json(sales.map(toSaleDto));
}));

/** Exact server-side price preview (nothing is stored, no stock is reserved). */
router.post('/quote', requirePermission('sales:write'), asyncHandler(async (req, res) => {
  res.json(await salesService.quoteSale(req.body, tenantContext(req)));
}));

router.get('/:id', validateNumericId, requirePermission('sales:read'), asyncHandler(async (req, res) => {
  const dto = await loadDto(tenantContext(req), Number(req.params.id));
  if (!dto) throw notFound();
  res.json(dto);
}));

router.post('/', requirePermission('sales:write'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const key = readKey(req);
  const outcome = await withIdempotency(ctx, { scope: 'sale.create', key, payload: req.body }, ({ remember }) => salesService.createSale(
    req.body,
    { actorUserId: req.user._id, correlationId: req.correlationId },
    ctx,
    key ? { idempotency: { remember } } : {},
  ));
  const id = outcome.replayed ? Number(outcome.record.resourceId) : outcome.result._id;
  if (outcome.replayed) res.set('Idempotent-Replayed', 'true');
  res.status(201).json(await loadDto(ctx, id));
}));

/** Payment against the sale's outstanding balance. */
router.post('/:id/payments', validateNumericId, requirePermission('sales:write'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const key = readKey(req);
  const outcome = await withIdempotency(ctx, { scope: `sale.payment:${req.params.id}`, key, payload: req.body }, ({ remember }) => salesService.recordPayment(
    req.params.id, req.body, ctx, key ? { idempotency: { remember } } : {},
  ));
  if (outcome.replayed) res.set('Idempotent-Replayed', 'true');
  res.json(await loadDto(ctx, Number(req.params.id)));
}));

/** Partial / full return of sold lines. */
router.post('/:id/returns', validateNumericId, requirePermission('sales:cancel'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const key = readKey(req);
  const outcome = await withIdempotency(ctx, { scope: `sale.return:${req.params.id}`, key, payload: req.body }, ({ remember }) => salesService.returnSale(
    req.params.id, req.body, ctx, key ? { idempotency: { remember } } : {},
  ));
  if (outcome.replayed) res.set('Idempotent-Replayed', 'true');
  res.json(await loadDto(ctx, Number(req.params.id)));
}));

router.put('/:id', validateNumericId, requirePermission('sales:write'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const sale = await salesService.updateSale(Number(req.params.id), req.body, {
    actorUserId: req.user._id,
    correlationId: req.correlationId,
  }, ctx);
  res.json(toSaleDto(sale));
}));

// A sale is a financial record: DELETE means cancel (reverse) it, never erase history.
router.delete('/:id', validateNumericId, requirePermission('sales:cancel'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const sale = await salesService.cancelSale(req.params.id, {
    actorUserId: req.user._id,
    correlationId: req.correlationId,
  }, ctx);
  res.json({ message: 'Satış iptal edildi; stok geri eklendi ve muhasebe kaydı ters kayıtla kapatıldı', data: toSaleDto(sale) });
}));

module.exports = router;
module.exports.toSaleDto = toSaleDto;
