const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission, validateNumericId } = require('../middleware/authorization');
const { deleteItem } = require('../utils/crudOperations');
const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const catalogService = require('../services/catalogService');
const { tenantContext, branchScope } = require('../services/finance/core');

/** Non-admins act on their own branch's products and shared (branch-less) ones only. */
function productWriteScope(ctx) {
  if (ctx.isAdmin) return { businessId: ctx.businessId };
  return { businessId: ctx.businessId, branch: { $in: [ctx.branch, '', null] } };
}

// GET all products of the caller's business
router.get('/', requirePermission('catalog:read'), asyncHandler(async (req, res) => {
  const { businessId } = tenantContext(req);
  const products = await Product.find({ businessId, isArchived: { $ne: true } })
    .populate({ path: 'categoryId', match: { businessId } })
    .populate({ path: 'materialId', match: { businessId } });
  res.json(products);
}));

// GET product by ID
router.get('/:id', validateNumericId, requirePermission('catalog:read'), asyncHandler(async (req, res) => {
  const { businessId } = tenantContext(req);
  const product = await Product.findOne({ _id: req.params.id, businessId, isArchived: { $ne: true } })
    .populate({ path: 'categoryId', match: { businessId } })
    .populate({ path: 'materialId', match: { businessId } });
  if (!product) {
    const error = new Error('Ürün bulunamadı');
    error.statusCode = 404;
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  res.json(product);
}));

// Stock movement history of one product (every change is traceable).
router.get('/:id/movements', validateNumericId, requirePermission('catalog:read'), asyncHandler(async (req, res) => {
  const { businessId } = tenantContext(req);
  if (!(await Product.exists({ _id: Number(req.params.id), businessId }))) {
    const error = new Error('Ürün bulunamadı');
    error.statusCode = 404;
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  // Movement history is branch data: non-admins see their own branch's movements.
  const movements = await StockMovement.find({ businessId, productId: Number(req.params.id), ...branchScope(tenantContext(req)) })
    .sort({ createdAt: -1 }).limit(500).populate('createdBy', 'name').lean();
  res.json(movements.map((m) => ({ ...m, cost: m.costMinor === null ? null : m.costMinor / 100 })));
}));

// CREATE product (opening stock is recorded as an inventory movement)
router.post('/', requirePermission('catalog:write'), asyncHandler(async (req, res) => {
  const product = await catalogService.createProduct(tenantContext(req), req.body);
  res.status(201).json(product);
}));

// UPDATE product (stock / cost changes become audited adjustments)
router.put('/:id', validateNumericId, requirePermission('catalog:write'), asyncHandler(async (req, res) => {
  const product = await catalogService.updateProduct(tenantContext(req), req.params.id, req.body, { user: req.user });
  res.json(product);
}));

// DELETE product (archive; sales and stock history are preserved)
router.delete('/:id', validateNumericId, requirePermission('catalog:delete'), asyncHandler(async (req, res) => {
  const product = await deleteItem(Product, req.params.id, productWriteScope(tenantContext(req)));
  res.json({ message: 'Ürün arşivlendi; satış geçmişi korundu', data: product });
}));

module.exports = router;
