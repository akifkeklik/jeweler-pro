const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const Sale = require('../models/Sale');

/**
 * Dashboard summary - istatistikler
 */
router.get('/summary', asyncHandler(async (req, res) => {
  const sales = await Sale.find()
    .populate('customerId', 'name')
    .populate('productId', 'name');

  const totalRevenue = sales.reduce((sum, s) => sum + (s.totalPrice || 0), 0);
  const totalProfit = sales.reduce((sum, s) => sum + Math.round((s.totalPrice || 0) * 0.2), 0);
  const totalQuantity = sales.reduce((sum, s) => sum + (s.quantity || 0), 0);

  const uniqueCustomers = new Set(sales.map(s => s.customerId?._id?.toString()));
  const totalCustomers = uniqueCustomers.size;

  res.json({
    totalRevenue: Math.round(totalRevenue),
    totalProfit: Math.round(totalProfit),
    totalQuantity,
    totalCustomers,
  });
}));

module.exports = router;
