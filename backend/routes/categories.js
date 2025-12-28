const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { getAll, getById, create, update, deleteItem } = require('../utils/crudOperations');
const Category = require('../models/Category');

// GET all categories
router.get('/', asyncHandler(async (req, res) => {
  const categories = await getAll(Category);
  res.json(categories);
}));

// GET category by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const category = await getById(Category, req.params.id);
  res.json(category);
}));

// CREATE category
router.post('/', asyncHandler(async (req, res) => {
  const category = await create(Category, req.body);
  res.status(201).json(category);
}));

// UPDATE category
router.put('/:id', asyncHandler(async (req, res) => {
  const category = await update(Category, req.params.id, req.body);
  res.json(category);
}));

// DELETE category
router.delete('/:id', asyncHandler(async (req, res) => {
  const category = await deleteItem(Category, req.params.id);
  res.json({ message: 'Kategori silindi', data: category });
}));

module.exports = router;
