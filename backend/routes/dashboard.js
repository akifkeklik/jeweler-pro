const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const Sale = require('../models/Sale');
const { requirePermission } = require('../middleware/authorization');
const { fromCents } = require('../utils/financial');
const { saleNet } = require('./reports');
const { tenantContext, branchScope } = require('../services/finance/core');

/**
 * GET /api/dashboard/summary — business (non-admins: own branch) totals.
 * Revenue is net of returns; profit is reported only when the cost of every
 * sold unit is known (never estimated).
 */
router.get('/summary', requirePermission('dashboard:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const sales = await Sale.find({ businessId: ctx.businessId, ...branchScope(ctx), status: { $ne: 'cancelled' } })
    .select('customerId totalPrice totalMinor returnedMinor lines quantity unitCostAtSale status')
    .lean();

  let totalRevenue = 0;
  let totalCost = 0;
  let costComplete = true;
  let totalQuantity = 0;
  const customerIds = new Set();
  for (const sale of sales) {
    const { revenue, cost } = saleNet(sale);
    totalRevenue += revenue;
    if (cost === null) costComplete = false;
    else totalCost += cost;
    totalQuantity += Array.isArray(sale.lines) && sale.lines.length
      ? sale.lines.reduce((s, l) => s + l.quantity - (l.returnedQuantity || 0), 0)
      : (sale.quantity || 0);
    if (sale.customerId !== undefined && sale.customerId !== null) customerIds.add(String(sale.customerId));
  }

  res.json({
    totalRevenue: fromCents(totalRevenue),
    totalProfit: costComplete ? fromCents(totalRevenue - totalCost) : null,
    profitDataComplete: costComplete,
    totalQuantity,
    totalCustomers: customerIds.size,
  });
}));

module.exports = router;
