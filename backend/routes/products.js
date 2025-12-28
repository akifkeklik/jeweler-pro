const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { getAll, getById, create, update, deleteItem } = require('../utils/crudOperations');
const Product = require('../models/Product');

// GET all products
router.get('/', asyncHandler(async (req, res) => {
  const products = await Product.find()
    .populate('categoryId')
    .populate('materialId');
  res.json(products);
}));

// GET product by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate('categoryId')
    .populate('materialId');
  if (!product) {
    const error = new Error('Ürün bulunamadı');
    error.statusCode = 404;
    throw error;
  }
  res.json(product);
}));

// CREATE product
router.post('/', asyncHandler(async (req, res) => {
  const product = await create(Product, req.body);
  res.status(201).json(product);
}));

// UPDATE product
router.put('/:id', asyncHandler(async (req, res) => {
  const product = await update(Product, req.params.id, req.body);
  res.json(product);
}));

// DELETE product
router.delete('/:id', asyncHandler(async (req, res) => {
  const product = await deleteItem(Product, req.params.id);
  res.json({ message: 'Ürün silindi', data: product });
}));

module.exports = router;
