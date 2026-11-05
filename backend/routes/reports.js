const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const Sale = require('../models/Sale');
const Product = require('../models/Product');

function periodRange(period, previous = false) {
  const now = new Date();
  if (period === 'daily') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
  }
  if (period === 'weekly') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
    return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) };
  }
  const offset = previous ? 1 : 0;
  const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  return { start, end: new Date(now.getFullYear(), now.getMonth() - offset + 1, 1) };
}

function saleDto(sale) {
  const item = sale.toObject ? sale.toObject() : sale;
  const costKnown = Number.isFinite(item.unitCostAtSale) && item.unitCostAtSale !== null;
  return {
    ...item,
    customerName: item.customerId && typeof item.customerId === 'object' ? item.customerId.name : '',
    productName: item.productId && typeof item.productId === 'object' ? item.productId.name : '',
    kar: costKnown ? Math.round((item.totalPrice - item.unitCostAtSale * item.quantity) * 100) / 100 : null,
  };
}

async function getSales(period, previous = false) {
  const { start, end } = periodRange(period, previous);
  const sales = await Sale.find({
    date: { $gte: start, $lt: end },
    status: { $ne: 'cancelled' },
  })
    .populate('customerId', 'name')
    .populate('productId', 'name')
    .sort({ date: -1 });
  return sales.map(saleDto);
}

router.get('/daily', asyncHandler(async (req, res) => res.json(await getSales('daily'))));
router.get('/weekly', asyncHandler(async (req, res) => res.json(await getSales('weekly'))));
router.get('/monthly', asyncHandler(async (req, res) => res.json(await getSales('monthly', req.query.prev === '1'))));

router.get('/top-sellers', asyncHandler(async (req, res) => {
  const { start, end } = periodRange('monthly');
  const sales = await Sale.find({
    date: { $gte: start, $lt: end },
    status: { $ne: 'cancelled' },
  }).populate('productId', 'name');

  const grouped = new Map();
  for (const sale of sales) {
    const key = String(sale.productId?._id ?? sale.productId);
    const current = grouped.get(key) || {
      urun: sale.productId?.name || 'Ürün bilgisi yok',
      adet: 0,
      ciro: 0,
      kar: 0,
      hasCostData: true,
    };
    current.adet += sale.quantity || 0;
    current.ciro += sale.totalPrice || 0;
    if (Number.isFinite(sale.unitCostAtSale) && sale.unitCostAtSale !== null) {
      current.kar += sale.totalPrice - sale.unitCostAtSale * sale.quantity;
    } else {
      current.hasCostData = false;
    }
    grouped.set(key, current);
  }

  res.json([...grouped.values()]
    .map((item) => ({
      ...item,
      ciro: Math.round(item.ciro * 100) / 100,
      kar: item.hasCostData ? Math.round(item.kar * 100) / 100 : null,
    }))
    .sort((a, b) => b.adet - a.adet)
    .slice(0, 10));
}));

router.get('/low-stock', asyncHandler(async (req, res) => {
  const products = await Product.find({ stock: { $lte: 5 }, isArchived: { $ne: true } }).select('name stock').sort({ stock: 1, name: 1 });
  res.json(products.map((product) => ({ isim: product.name, stok: product.stock })));
}));

module.exports = router;
module.exports.periodRange = periodRange;
module.exports.saleDto = saleDto;
