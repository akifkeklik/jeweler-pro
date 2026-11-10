const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const { requirePermission } = require('../middleware/authorization');
const { toCents, fromCents } = require('../utils/financial');
const { zonedMidnightUtc } = require('../utils/timeZone');
const { roundDiv } = require('../domain/decimal');

/** Exact round(value × part / whole) for kuruş integers. */
const portion = (value, part, whole) => Number(roundDiv(BigInt(value) * BigInt(part), BigInt(whole)));
const { tenantContext, branchScope, badRequest } = require('../services/finance/core');

/**
 * Low-stock threshold (pieces): products with stock ≤ threshold are listed.
 * The user's configured value is passed by the client as ?threshold=N; when
 * it is absent the historic default of 5 applies. Whole numbers 1-1000 only.
 */
const DEFAULT_LOW_STOCK_THRESHOLD = 5;
const MAX_LOW_STOCK_THRESHOLD = 1000;
function parseLowStockThreshold(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LOW_STOCK_THRESHOLD;
  const text = String(raw).trim();
  const value = /^\d{1,4}$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LOW_STOCK_THRESHOLD) {
    throw badRequest(`Kritik stok eşiği 1-${MAX_LOW_STOCK_THRESHOLD} arasında bir tam sayı olmalıdır`, 'INVALID_THRESHOLD');
  }
  return value;
}

function periodRange(period, previous = false, now = new Date(), timeZone = process.env.REPORT_TIME_ZONE || 'Europe/Istanbul') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  const localDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  let startCalendar;
  let endCalendar;

  if (period === 'daily') {
    startCalendar = localDate;
    endCalendar = new Date(localDate.getTime() + 86400000);
  } else if (period === 'weekly') {
    const daysSinceMonday = (localDate.getUTCDay() + 6) % 7;
    startCalendar = new Date(localDate.getTime() - daysSinceMonday * 86400000);
    endCalendar = new Date(startCalendar.getTime() + 7 * 86400000);
  } else {
    const monthOffset = previous ? 1 : 0;
    startCalendar = new Date(Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth() - monthOffset, 1));
    endCalendar = new Date(Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth() - monthOffset + 1, 1));
  }

  return {
    start: zonedMidnightUtc(startCalendar, timeZone),
    end: zonedMidnightUtc(endCalendar, timeZone),
  };
}

/** Net (after returns) revenue and cost of a sale in kuruş; cost null = unknown. */
function saleNet(item) {
  if (item.totalMinor !== undefined && item.totalMinor !== null) {
    const revenue = item.totalMinor - (item.returnedMinor || 0);
    let cost = 0;
    for (const line of item.lines || []) {
      if (line.costMinor === null || line.costMinor === undefined) return { revenue, cost: null };
      const kept = line.quantity - (line.returnedQuantity || 0);
      cost += portion(line.costMinor, kept, line.quantity);
    }
    return { revenue, cost };
  }
  const revenue = toCents(item.totalPrice);
  const costKnown = Number.isFinite(item.unitCostAtSale) && item.unitCostAtSale !== null;
  return { revenue, cost: costKnown ? toCents(item.unitCostAtSale) * item.quantity : null };
}

function saleDto(sale) {
  const item = sale.toObject ? sale.toObject() : sale;
  const { revenue, cost } = saleNet(item);
  return {
    ...item,
    customerName: item.customerId && typeof item.customerId === 'object' ? item.customerId.name : '',
    productName: Array.isArray(item.lines) && item.lines.length
      ? item.lines.map((l) => l.productName).join(', ')
      : (item.productId && typeof item.productId === 'object' ? item.productId.name : ''),
    netTotal: fromCents(revenue),
    kar: cost === null ? null : fromCents(revenue - cost),
  };
}

async function getSales(req, period, previous = false) {
  const ctx = tenantContext(req);
  const { start, end } = periodRange(period, previous);
  const sales = await Sale.find({
    businessId: ctx.businessId,
    ...branchScope(ctx, req.query.branch),
    date: { $gte: start, $lt: end },
    status: { $ne: 'cancelled' },
  })
    .populate({ path: 'customerId', select: 'name', match: { businessId: ctx.businessId } })
    .populate({ path: 'productId', select: 'name', match: { businessId: ctx.businessId } })
    .sort({ date: -1 });
  return sales.map(saleDto);
}

router.get('/daily', requirePermission('reports:read'), asyncHandler(async (req, res) => res.json(await getSales(req, 'daily'))));
router.get('/weekly', requirePermission('reports:read'), asyncHandler(async (req, res) => res.json(await getSales(req, 'weekly'))));
router.get('/monthly', requirePermission('reports:read'), asyncHandler(async (req, res) => res.json(await getSales(req, 'monthly', req.query.prev === '1'))));

router.get('/top-sellers', requirePermission('reports:read'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const { start, end } = periodRange('monthly');
  const sales = await Sale.find({
    businessId: ctx.businessId,
    ...branchScope(ctx, req.query.branch),
    date: { $gte: start, $lt: end },
    status: { $ne: 'cancelled' },
  }).populate({ path: 'productId', select: 'name', match: { businessId: ctx.businessId } });

  const grouped = new Map();
  const add = (key, name, quantity, revenueMinor, costMinor) => {
    const current = grouped.get(key) || { urun: name || 'Ürün bilgisi yok', adet: 0, ciro: 0, kar: 0, hasCostData: true };
    current.adet += quantity;
    current.ciro += revenueMinor;
    if (costMinor === null) current.hasCostData = false;
    else current.kar += revenueMinor - costMinor;
    grouped.set(key, current);
  };
  for (const sale of sales) {
    if (Array.isArray(sale.lines) && sale.lines.length) {
      for (const line of sale.lines) {
        const kept = line.quantity - (line.returnedQuantity || 0);
        if (kept <= 0) continue;
        const revenue = portion(line.totalMinor, kept, line.quantity);
        const cost = line.costMinor === null || line.costMinor === undefined ? null : portion(line.costMinor, kept, line.quantity);
        add(String(line.productId), line.productName, kept, revenue, cost);
      }
    } else {
      const key = String(sale.productId?._id ?? sale.productId);
      const revenue = toCents(sale.totalPrice);
      const costKnown = Number.isFinite(sale.unitCostAtSale) && sale.unitCostAtSale !== null;
      add(key, sale.productId?.name, sale.quantity || 0, revenue, costKnown ? toCents(sale.unitCostAtSale) * sale.quantity : null);
    }
  }

  res.json([...grouped.values()]
    .map((item) => ({
      ...item,
      ciro: fromCents(item.ciro),
      kar: item.hasCostData ? fromCents(item.kar) : null,
    }))
    .sort((a, b) => b.adet - a.adet)
    .slice(0, 10));
}));

router.get('/low-stock', requirePermission('reports:read'), asyncHandler(async (req, res) => {
  const { businessId } = tenantContext(req);
  const threshold = parseLowStockThreshold(req.query.threshold);
  const products = await Product.find({ businessId, stock: { $lte: threshold }, isArchived: { $ne: true } })
    .select('name stock')
    .sort({ stock: 1, name: 1 });
  res.json(products.map((product) => ({ isim: product.name, stok: product.stock })));
}));

module.exports = router;
module.exports.periodRange = periodRange;
module.exports.parseLowStockThreshold = parseLowStockThreshold;
module.exports.saleDto = saleDto;
module.exports.saleNet = saleNet;
