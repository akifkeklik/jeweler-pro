const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { requireRole } = require('../middleware/auth');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const { createSalesService } = require('../services/salesService');

const salesService = createSalesService({ Sale, Product, Customer });

function toSaleDto(sale) {
  const value = sale.toObject ? sale.toObject() : sale;
  return {
    ...value,
    customerName: value.customerId && typeof value.customerId === 'object' ? value.customerId.name : undefined,
    productName: value.productId && typeof value.productId === 'object' ? value.productId.name : undefined,
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const sales = await Sale.find()
    .populate('customerId', 'name')
    .populate('productId', 'name')
    .sort({ date: -1 });
  res.json(sales.map(toSaleDto));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.id)
    .populate('customerId')
    .populate('productId');
  if (!sale) {
    const error = new Error('Satış bulunamadı');
    error.statusCode = 404;
    throw error;
  }
  res.json(toSaleDto(sale));
}));

router.post('/', asyncHandler(async (req, res) => {
  const sale = await salesService.createSale(req.body);
  const populated = await Sale.findById(sale._id)
    .populate('customerId', 'name')
    .populate('productId', 'name');
  res.status(201).json(toSaleDto(populated || sale));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const sale = await salesService.updateSale(req.params.id, req.body);
  res.json(toSaleDto(sale));
}));

// A sale is a financial record: DELETE means cancel and restore its stock, not erase history.
router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const sale = await salesService.cancelSale(req.params.id);
  res.json({ message: 'Satış iptal edildi; stok geri eklendi', data: sale });
}));

module.exports = router;
