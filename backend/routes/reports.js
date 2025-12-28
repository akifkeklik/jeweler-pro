const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const Sale = require('../models/Sale');
const Product = require('../models/Product');

/**
 * Daily reports
 */
router.get('/daily', asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sales = await Sale.find({ date: { $gte: today } });

  const dailyRevenue = sales.reduce((sum, s) => sum + (s.totalPrice || 0), 0);
  const dailyProfit = sales.reduce((sum, s) => sum + Math.round((s.totalPrice || 0) * 0.2), 0);
  const dailyQuantity = sales.reduce((sum, s) => sum + (s.quantity || 0), 0);

  res.json({
    date: today.toISOString().split('T')[0],
    totalRevenue: Math.round(dailyRevenue),
    totalProfit: Math.round(dailyProfit),
    quantity: dailyQuantity,
    transactionCount: sales.length,
  });
}));

/**
 * Top sellers (this month)
 */
router.get('/top-sellers', asyncHandler(async (req, res) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);

  const sales = await Sale.aggregate([
    { $match: { date: { $gte: start, $lte: now } } },
    {
      $group: {
        _id: '$productName',
        quantity: { $sum: '$quantity' },
        revenue: { $sum: '$totalPrice' },
        profit: { $sum: { $multiply: ['$totalPrice', 0.2] } },
      },
    },
    { $sort: { quantity: -1 } },
    { $limit: 10 },
  ]);

  const mapped = sales.map(s => ({
    product: s._id,
    quantity: s.quantity,
    revenue: Math.round(s.revenue),
    profit: Math.round(s.profit),
  }));

  res.json(mapped);
}));

/**
 * Low stock products
 */
router.get('/low-stock', asyncHandler(async (req, res) => {
  const products = await Product.find({ stock: { $lte: 5 } })
    .select('name stock');

  const mapped = products.map(p => ({
    name: p.name,
    stock: p.stock,
  }));

  res.json(mapped);
}));

/**
 * Monthly summary
 */
router.get('/monthly', asyncHandler(async (req, res) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const sales = await Sale.find({ date: { $gte: start, $lte: end } });

  const monthlyRevenue = sales.reduce((sum, s) => sum + (s.totalPrice || 0), 0);
  const monthlyProfit = sales.reduce((sum, s) => sum + Math.round((s.totalPrice || 0) * 0.2), 0);
  const monthlyQuantity = sales.reduce((sum, s) => sum + (s.quantity || 0), 0);

  res.json({
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    totalRevenue: Math.round(monthlyRevenue),
    totalProfit: Math.round(monthlyProfit),
    quantity: monthlyQuantity,
    transactionCount: sales.length,
  });
}));

module.exports = router;
