const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission, validateNumericId } = require('../middleware/authorization');
const { getAll, getById, create, update, deleteItem } = require('../utils/crudOperations');
const Category = require('../models/Category');
const { tenantContext } = require('../services/finance/core');

// Every query is limited to the caller's business (tenant isolation);
// another tenant's id behaves exactly like a missing one.
const scope = (req) => ({ businessId: tenantContext(req).businessId });

router.get('/', requirePermission('catalog:read'), asyncHandler(async (req, res) => {
  res.json(await getAll(Category, scope(req)));
}));

router.get('/:id', validateNumericId, requirePermission('catalog:read'), asyncHandler(async (req, res) => {
  res.json(await getById(Category, req.params.id, scope(req)));
}));

router.post('/', requirePermission('catalog:write'), asyncHandler(async (req, res) => {
  res.status(201).json(await create(Category, req.body, scope(req)));
}));

router.put('/:id', validateNumericId, requirePermission('catalog:write'), asyncHandler(async (req, res) => {
  res.json(await update(Category, req.params.id, req.body, scope(req)));
}));

router.delete('/:id', validateNumericId, requirePermission('catalog:delete'), asyncHandler(async (req, res) => {
  const category = await deleteItem(Category, req.params.id, scope(req));
  res.json({ message: 'Kategori arşivlendi', data: category });
}));

module.exports = router;
