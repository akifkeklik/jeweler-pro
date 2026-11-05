const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const Sale = require('../models/Sale');

router.get('/summary', asyncHandler(async (req, res) => {
  const sales = await Sale.find({ status: { $ne: 'cancelled' } })
    .populate('customerId', 'name');

  const totalRevenue = sales.reduce((sum, sale) => sum + (sale.totalPrice || 0), 0);
  const totalQuantity = sales.reduce((sum, sale) => sum + (sale.quantity || 0), 0);
  const customerIds = new Set(sales.map((sale) => sale.customerId?._id?.toString()).filter(Boolean));
  const costComplete = sales.every((sale) => Number.isFinite(sale.unitCostAtSale) && sale.unitCostAtSale !== null);
  const totalProfit = costComplete
    ? sales.reduce((sum, sale) => sum + sale.totalPrice - sale.unitCostAtSale * sale.quantity, 0)
    : null;

  res.json({
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalProfit: totalProfit === null ? null : Math.round(totalProfit * 100) / 100,
    profitDataComplete: costComplete,
    totalQuantity,
    totalCustomers: customerIds.size,
  });
}));

module.exports = router;
