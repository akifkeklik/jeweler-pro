const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission, validateNumericId } = require('../middleware/authorization');
const { getById, create, update, deleteItem } = require('../utils/crudOperations');
const Supplier = require('../models/Supplier');
const cashService = require('../services/cashService');
const { tenantContext, conflict } = require('../services/finance/core');

const scope = (req) => ({ businessId: tenantContext(req).businessId });

function dto(supplier) {
  const s = supplier.toObject ? supplier.toObject() : supplier;
  // Positive = the business owes the supplier.
  return { ...s, balanceTry: (s.balanceTryMinor || 0) / 100 };
}

router.get('/', requirePermission('purchases:read'), asyncHandler(async (req, res) => {
  const suppliers = await Supplier.find({ ...scope(req), isArchived: { $ne: true } }).sort({ name: 1 }).lean();
  res.json(suppliers.map(dto));
}));

router.get('/:id', validateNumericId, requirePermission('purchases:read'), asyncHandler(async (req, res) => {
  res.json(dto(await getById(Supplier, req.params.id, scope(req))));
}));

router.get('/:id/statement', validateNumericId, requirePermission('purchases:read'), asyncHandler(async (req, res) => {
  res.json(await cashService.supplierStatement(tenantContext(req), req.params.id));
}));

router.post('/', requirePermission('purchases:write'), asyncHandler(async (req, res) => {
  res.status(201).json(dto(await create(Supplier, req.body, scope(req))));
}));

router.put('/:id', validateNumericId, requirePermission('purchases:write'), asyncHandler(async (req, res) => {
  res.json(dto(await update(Supplier, req.params.id, req.body, scope(req))));
}));

router.delete('/:id', validateNumericId, requirePermission('purchases:write'), asyncHandler(async (req, res) => {
  // An open payable / credit must be settled first (it would vanish from every list).
  const current = await getById(Supplier, req.params.id, scope(req));
  if ((current.balanceTryMinor || 0) !== 0) {
    throw conflict('Açık bakiyesi olan tedarikçi arşivlenemez; önce bakiyeyi kapatın', 'OPEN_BALANCE', { balanceTry: current.balanceTryMinor / 100 });
  }
  const supplier = await deleteItem(Supplier, req.params.id, { ...scope(req), balanceTryMinor: { $in: [0, null] } });
  res.json({ message: 'Tedarikçi arşivlendi; alış geçmişi korundu', data: dto(supplier) });
}));

module.exports = router;
