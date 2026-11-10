const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission } = require('../middleware/authorization');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const DeletedUser = require('../models/DeletedUser');

const router = express.Router();

/**
 * GET /api/audit
 * Only records produced by members of the caller's business are visible —
 * including members that were permanently deleted (tracked by a minimal
 * tombstone). Deleted actors are shown without any personal data.
 */
router.get('/', requirePermission('audit:read'), asyncHandler(async (req, res) => {
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 100)
    : 100;
  const [members, deletedMembers] = await Promise.all([
    User.find({ businessId: req.user.businessId }).select('_id email name').lean(),
    DeletedUser.find({ businessId: req.user.businessId }).select('_id').lean(),
  ]);
  const memberById = new Map(members.map((m) => [String(m._id), m]));
  const deletedIds = new Set(deletedMembers.map((d) => String(d._id)));
  const actorIds = [...members.map((m) => m._id), ...deletedMembers.map((d) => d._id)];

  const logs = await AuditLog.find({ actorUserId: { $in: actorIds } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('-before -after');
  return res.json(logs.map((log) => {
    const plain = typeof log.toObject === 'function' ? log.toObject() : log;
    const actorId = String(plain.actorUserId);
    const member = memberById.get(actorId);
    return {
      ...plain,
      actorEmail: member?.email || null,
      actorDeleted: !member && deletedIds.has(actorId),
    };
  }));
}));

module.exports = router;
