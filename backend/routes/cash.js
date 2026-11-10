const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission, hasPermission } = require('../middleware/authorization');
const CashTransaction = require('../models/CashTransaction');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const AuditLog = require('../models/AuditLog');
const cashService = require('../services/cashService');
const { createSalesService } = require('../services/salesService');
const { tenantContext, branchScope, badRequest } = require('../services/finance/core');
const { readKey, withIdempotency } = require('../services/finance/idempotency');

const salesService = createSalesService({ Sale, Product, Customer, AuditLog });

const present = (value) => value !== undefined && value !== null && value !== '';

/**
 * Permissions beyond cash:write that a voucher needs (BUSINESS_RULES.md §9):
 *  - a supplier voucher moves the payable and settles purchases → purchases:write,
 *    the same permission as POST /api/purchases/:id/payments;
 *  - a customer/supplier opening balance (devir) creates a receivable or
 *    payable against opening equity → accounts:manage. Without it a cashier
 *    could book "we owe the customer X" and pay X out of the drawer with the
 *    loss hidden in equity. The drawer float (devir without a party) stays a
 *    cashier operation.
 * Returns the missing permission or null.
 */
function voucherPermissionDenial(user, body) {
  if (!body || typeof body !== 'object') return null;
  if (present(body.supplierId) && !hasPermission(user, 'purchases:write')) return 'purchases:write';
  if (body.type === 'devir' && (present(body.customerId) || present(body.supplierId)) && !hasPermission(user, 'accounts:manage')) {
    return 'accounts:manage';
  }
  return null;
}

/**
 * GET /api/cash/transactions — vouchers of the caller's business
 * (non-admins: own branch only).
 */
router.get('/transactions', requirePermission('cash:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const filter = { businessId: ctx.businessId, ...branchScope(ctx, req.query.branch) };
  if (req.query.customerId && /^\d+$/.test(String(req.query.customerId))) filter.customerId = Number(req.query.customerId);
  if (req.query.supplierId && /^\d+$/.test(String(req.query.supplierId))) filter.supplierId = Number(req.query.supplierId);
  if (typeof req.query.type === 'string' && cashService.TYPES.includes(req.query.type)) filter.type = req.query.type;
  if (typeof req.query.paymentMethod === 'string') filter.paymentMethod = String(req.query.paymentMethod);

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const transactions = await CashTransaction.find(filter)
    .populate({ path: 'customerId', select: 'name phone customerType', match: { businessId: ctx.businessId } })
    .populate('handledBy', 'name email')
    .sort({ date: -1 })
    .limit(limit);
  res.json(transactions);
}));

/**
 * POST /api/cash/transactions — cash / account voucher.
 * satis_tahsilati with saleId is a payment against that sale.
 */
router.post('/transactions', requirePermission('cash:write'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const denial = voucherPermissionDenial(req.user, req.body);
  if (denial) return res.status(403).json({ error: 'Bu işlem için yetkiniz bulunmuyor', code: 'FORBIDDEN', permission: denial });
  const key = readKey(req);
  if (req.body?.type === 'satis_tahsilati') {
    if (!req.body.saleId) throw badRequest('Satış tahsilatı için saleId zorunludur');
    const outcome = await withIdempotency(ctx, { scope: `sale.payment:${req.body.saleId}`, key, payload: req.body }, ({ remember }) => salesService.recordPayment(
      req.body.saleId,
      { method: req.body.paymentMethod || 'nakit', amount: req.body.amountTry },
      ctx,
      key ? { idempotency: { remember } } : {},
    ));
    if (outcome.replayed) res.set('Idempotent-Replayed', 'true');
    const sale = outcome.replayed ? await Sale.findOne({ _id: Number(req.body.saleId), businessId: ctx.businessId }) : outcome.result.sale;
    return res.status(201).json({ type: 'satis_tahsilati', saleId: sale._id, balanceDue: (sale.balanceDueMinor || 0) / 100, paymentStatus: sale.paymentStatus });
  }

  const outcome = await withIdempotency(ctx, { scope: 'cash.voucher', key, payload: req.body }, ({ remember }) => cashService.createVoucher(
    ctx, req.body, key ? { idempotency: { remember } } : {},
  ));
  if (outcome.replayed) {
    res.set('Idempotent-Replayed', 'true');
    const voucher = await CashTransaction.findOne({ _id: outcome.record.resourceId, businessId: ctx.businessId });
    return res.status(201).json(voucher);
  }
  const { voucher, allocations } = outcome.result;
  return res.status(201).json({ ...voucher.toObject(), allocations });
}));

/** GET /api/cash/daily-summary — today's register for the caller's branch (admins: ?branch=). */
router.get('/daily-summary', requirePermission('reports:read'), asyncHandler(async (req, res) => {
  res.json(await cashService.dailySummary(tenantContext(req), { branch: req.query.branch }));
}));

/** POST /api/cash/daily-closing — Z-report: counts the drawer and locks the day. */
router.post('/daily-closing', requirePermission('cash:closing'), asyncHandler(async (req, res) => {
  res.json(await cashService.closeDay(tenantContext(req), req.body || {}));
}));

/** GET /api/cash/customer/:customerId/ledger — customer statement (cari ekstre). */
router.get('/customer/:customerId/ledger', requirePermission('customers:read'), asyncHandler(async (req, res) => {
  res.json(await cashService.customerStatement(tenantContext(req), req.params.customerId));
}));

module.exports = router;
