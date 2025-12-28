const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { getAll, getById, create, update, deleteItem } = require('../utils/crudOperations');
const Sale = require('../models/Sale');

// GET all sales
router.get('/', asyncHandler(async (req, res) => {
  const sales = await Sale.find()
    .populate('customerId', 'name')
    .populate('productId', 'name');
  res.json(sales);
}));

// GET sale by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.id)
    .populate('customerId')
    .populate('productId');
  if (!sale) {
    const error = new Error('Satış bulunamadı');
    error.statusCode = 404;
    throw error;
  }
  res.json(sale);
}));

// CREATE sale
router.post('/', asyncHandler(async (req, res) => {
  const sale = await create(Sale, req.body);
  res.status(201).json(sale);
}));

// UPDATE sale
router.put('/:id', asyncHandler(async (req, res) => {
  const sale = await update(Sale, req.params.id, req.body);
  res.json(sale);
}));

// DELETE sale
router.delete('/:id', asyncHandler(async (req, res) => {
  const sale = await deleteItem(Sale, req.params.id);
  res.json({ message: 'Satış silindi', data: sale });
}));

module.exports = router;
