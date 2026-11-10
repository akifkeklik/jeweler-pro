const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { requireRole } = require('../middleware/authorization');
const { validateBody } = require('../middleware/validate');
const { tenantContext } = require('../services/finance/core');
const service = require('../services/businessProfileService');

// Every signed-in user needs the profile (receipt header, VAT display).
router.get('/', asyncHandler(async (req, res) => {
  res.json(await service.getProfile(tenantContext(req)));
}));

// Only administrators change the legal identity and fiscal rules (audited).
router.put('/', requireRole('admin'), validateBody(service.updateSchema), asyncHandler(async (req, res) => {
  res.json(await service.updateProfile(tenantContext(req), req.body));
}));

module.exports = router;
