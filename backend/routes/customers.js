const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { getAll, getById, create, update, deleteItem } = require('../utils/crudOperations');
const Customer = require('../models/Customer');

// GET all customers
router.get('/', asyncHandler(async (req, res) => {
  const customers = await getAll(Customer);
  res.json(customers);
}));

// GET customer by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const customer = await getById(Customer, req.params.id);
  res.json(customer);
}));

// CREATE customer
router.post('/', asyncHandler(async (req, res) => {
  const customer = await create(Customer, req.body);
  res.status(201).json(customer);
}));

// UPDATE customer
router.put('/:id', asyncHandler(async (req, res) => {
  const customer = await update(Customer, req.params.id, req.body);
  res.json(customer);
}));

// DELETE customer
router.delete('/:id', asyncHandler(async (req, res) => {
  const customer = await deleteItem(Customer, req.params.id);
  res.json({ message: 'Müşteri silindi', data: customer });
}));

module.exports = router;
