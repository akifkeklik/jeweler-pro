const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const AuditLog = require('../models/AuditLog');
const { recordAudit } = require('../utils/audit');
const { forbidden } = require('../services/finance/core');
const { listBranchRecords, renameBranch } = require('../services/finance/branchDirectory');

/**
 * Branch registry (ADR 0001, phase 1): stable codes with editable display names.
 */

/** GET /api/branches — operational branches of the business: { current, branches: [{ code, name }] }. */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ current: req.user.branch || null, branches: await listBranchRecords(req.user.businessId) });
}));

/** PATCH /api/branches/:code — changes the display name only (admins). The code and all history stay. */
router.patch('/:code', asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') throw forbidden('Şube adını yalnızca yöneticiler değiştirebilir');
  const { branch, before } = await renameBranch(req.user.businessId, req.params.code, req.body?.name);
  await recordAudit({
    AuditLog,
    actorUserId: req.user._id,
    action: 'branch.rename',
    resourceType: 'Branch',
    resourceId: branch.code,
    correlationId: req.correlationId || 'branch.rename',
    before,
    after: { name: branch.name },
  });
  res.json(branch);
}));

module.exports = router;
