const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { getAll, getById, create, update, deleteItem } = require('../utils/crudOperations');
const Material = require('../models/Material');

// GET all materials
router.get('/', asyncHandler(async (req, res) => {
  const materials = await getAll(Material);
  res.json(materials);
}));

// GET material by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const material = await getById(Material, req.params.id);
  res.json(material);
}));

// CREATE material
router.post('/', asyncHandler(async (req, res) => {
  const material = await create(Material, req.body);
  res.status(201).json(material);
}));

// UPDATE material
router.put('/:id', asyncHandler(async (req, res) => {
  const material = await update(Material, req.params.id, req.body);
  res.json(material);
}));

// DELETE material
router.delete('/:id', asyncHandler(async (req, res) => {
  const material = await deleteItem(Material, req.params.id);
  res.json({ message: 'Hammadde silindi', data: material });
}));

module.exports = router;
