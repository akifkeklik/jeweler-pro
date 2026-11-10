const mongoose = require('mongoose');
const BusinessAdminGuard = require('../models/BusinessAdminGuard');
const User = require('../models/User');
const { getEffectivePermissions } = require('../middleware/authorization');

/**
 * Raised inside a guarded transaction to abort it with an HTTP response.
 * withTransaction() aborts on any non-transient error and rethrows it.
 */
class GuardRejection extends Error {
  constructor(status, body) {
    super(body?.error || 'Guard rejection');
    this.name = 'GuardRejection';
    this.status = status;
    this.body = body;
  }
}

async function ensureGuardDocument(businessId) {
  // Created outside the transaction: two transactions upserting the same new
  // _id would end in a non-retryable duplicate-key error instead of a
  // retryable write conflict.
  try {
    await BusinessAdminGuard.updateOne(
      { _id: businessId },
      { $setOnInsert: { seq: 0, lastMutationAt: null } },
      { upsert: true },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
}

/**
 * Runs `work(session)` in a transaction that is serialised with every other
 * guarded transaction of the same business. `work` may be executed more than
 * once (automatic retry after a write conflict), so it must only touch the
 * database through `session` and must not send the HTTP response.
 */
async function withBusinessAdminGuard(businessId, work) {
  if (!businessId) throw new Error('businessId zorunludur');
  await ensureGuardDocument(businessId);

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const claimed = await BusinessAdminGuard.updateOne(
        { _id: businessId },
        { $inc: { seq: 1 }, $set: { lastMutationAt: new Date() } },
        { session },
      );
      if (claimed.matchedCount !== 1) throw new Error('İşletme koordinasyon kaydı bulunamadı');
      result = await work(session);
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function samePermissionSet(a, b) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((p) => set.has(p));
}

/**
 * Re-reads the acting user inside the guarded transaction. An actor who was
 * deactivated, moved to another tenant/branch, whose role changed or whose
 * effective permissions (role + customPermissions) changed after
 * authentication must not complete a user-management change — this is what
 * stops two admins from deactivating each other at the same moment, and what
 * makes a permission revocation effective for requests already in flight
 * (security finding L1).
 *
 * `permission`: the permission the operation requires; it must still be part
 * of the actor's *current* effective permissions.
 * Returns the fresh actor document; callers must base further authorization
 * decisions (e.g. "may only grant what you hold") on it, not on req.user.
 */
async function assertActorStillAuthorized(req, session, { permission } = {}) {
  const actor = await User.findOne({ _id: req.user._id }).session(session);
  const authenticatedPermissions = Array.isArray(req.user.permissions)
    ? req.user.permissions
    : getEffectivePermissions(req.user);
  const currentPermissions = actor ? getEffectivePermissions(actor) : [];
  const stale = !actor
    || actor.active !== true
    || actor.role !== req.user.role
    || (actor.businessId || '') !== (req.user.businessId || '')
    || (actor.branch || '') !== (req.user.branch || '')
    || (actor.tokenVersion || 0) !== (req.user.tokenVersion || 0)
    || !samePermissionSet(currentPermissions, authenticatedPermissions)
    || (permission !== undefined && !currentPermissions.includes(permission));
  if (stale) {
    throw new GuardRejection(409, {
      error: 'Yetkiniz bu işlem sırasında değişti. Lütfen sayfayı yenileyip tekrar deneyin.',
      code: 'ACTOR_STATE_CHANGED',
    });
  }
  return actor;
}

async function countOtherActiveAdmins(businessId, excludeId, session) {
  return User.countDocuments({ businessId, role: 'admin', active: true, _id: { $ne: excludeId } }).session(session);
}

module.exports = {
  GuardRejection,
  withBusinessAdminGuard,
  assertActorStillAuthorized,
  countOtherActiveAdmins,
};
