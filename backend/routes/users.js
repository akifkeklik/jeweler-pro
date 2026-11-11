const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const DeletedUser = require('../models/DeletedUser');
const asyncHandler = require('../middleware/asyncHandler');
const {
  PERMISSION_CATALOG,
  ROLE_PERMISSIONS,
  ROLE_DEFINITIONS,
  requirePermission,
  sanitizePermissionList,
  getEffectivePermissions,
} = require('../middleware/authorization');
const { recordAudit, classifyEmailError } = require('../utils/audit');
const { resolveBranchCode } = require('../services/finance/branchDirectory');
const { hashPassword, validatePasswordPolicy, sha256Hex, generateOpaqueToken } = require('../utils/passwords');
const { toPublicUser } = require('../utils/userView');
const { getAuthConfig } = require('../config/authConfig');
const authSessionService = require('../services/authSessionService');
const emailService = require('../services/emailService');
const {
  GuardRejection,
  withBusinessAdminGuard,
  assertActorStillAuthorized,
  countOtherActiveAdmins,
} = require('../services/adminGuard');

const router = express.Router();

const ROLES = ROLE_DEFINITIONS.map((r) => r.id);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LAST_ADMIN_ERROR = 'İşletmede en az bir aktif yönetici bulunmalıdır';

/*
 * Scope rules
 * - Every query is limited to the caller's business (tenant isolation).
 * - Admins manage the whole business.
 * - Non-admins who were delegated users:* permissions manage only staff
 *   accounts of their own branch, can only create staff, and can only grant
 *   permissions they hold themselves (no privilege escalation).
 * - Nobody changes their own role, permissions, branch or status.
 *
 * Concurrency
 * - Creation, status changes, role/profile updates, deletions and admin-sent
 *   password resets run inside withBusinessAdminGuard(): one transaction at a
 *   time per business, with the target and the actor (including the actor's
 *   current effective permissions) re-read inside the transaction. This
 *   closes the check-then-act races on "at least one active admin", on
 *   permission revocation (L1) and on reset-token issuance vs. deactivation (L3).
 *
 * Audit minimisation (M4): user snapshots contain no name or e-mail.
 */
function isAdmin(req) {
  return req.user.role === 'admin';
}

function scopeFilter(req) {
  const filter = { businessId: req.user.businessId };
  if (!isAdmin(req)) filter.branch = req.user.branch;
  return filter;
}

function isSelf(req, target) {
  return String(req.user._id) === String(target._id);
}

function canManage(req, target) {
  if (isAdmin(req)) return true;
  return target.role === 'staff' && target.branch === req.user.branch;
}

async function loadScopedUser(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: 'Kullanıcı bulunamadı', code: 'USER_NOT_FOUND' });
    return null;
  }
  // Out-of-scope users are reported as "not found" so other tenants'
  // accounts cannot be probed.
  const target = await User.findOne({ _id: id, ...scopeFilter(req) });
  if (!target) {
    res.status(404).json({ error: 'Kullanıcı bulunamadı', code: 'USER_NOT_FOUND' });
    return null;
  }
  return target;
}

function reject(status, error, code) {
  throw new GuardRejection(status, {
    error,
    ...(code ? { code } : status === 403 ? { code: 'FORBIDDEN' } : {}),
  });
}

/** Fresh, in-transaction read of the target (it may have changed since loadScopedUser). */
async function reloadScopedUser(req, id, session) {
  const target = await User.findOne({ _id: id, ...scopeFilter(req) }).session(session);
  if (!target) reject(404, 'Kullanıcı bulunamadı');
  return target;
}

function forbidden(res, error) {
  return res.status(403).json({ error, code: 'FORBIDDEN' });
}

/**
 * `actor`: the fresh in-transaction actor document (assertActorStillAuthorized);
 * falls back to the authentication-time req.user only for pre-checks.
 */
function escalationError(req, requested, existing = [], actor = req.user) {
  if (isAdmin(req)) return null;
  const actorPermissions = new Set(getEffectivePermissions(actor));
  const added = requested.filter((p) => !existing.includes(p));
  const notHeld = added.filter((p) => !actorPermissions.has(p));
  return notHeld.length ? `Sahip olmadığınız yetkileri devredemezsiniz: ${notHeld.join(', ')}` : null;
}

/** Authorization-relevant state only — never name or e-mail (data minimisation). */
function snapshot(user) {
  return {
    role: user.role,
    branch: user.branch,
    customPermissions: [...(user.customPermissions || [])],
    active: user.active,
  };
}

const RESET_FIELDS_UNSET = Object.freeze({
  passwordResetTokenHash: 1,
  passwordResetExpires: 1,
  passwordResetRequestedAt: 1,
  passwordResetTokenVersion: 1,
});

function audit(req, action, target, extra = {}) {
  return recordAudit({
    AuditLog,
    actorUserId: req.user._id,
    action,
    resourceType: 'User',
    resourceId: target._id,
    correlationId: req.correlationId || action,
    ...extra,
  });
}

/**
 * GET /api/users/metadata — roles, permission catalog and what the caller may assign.
 */
router.get('/metadata', requirePermission('users:read'), asyncHandler(async (req, res) => {
  const actorPermissions = getEffectivePermissions(req.user);
  return res.json({
    roles: ROLE_DEFINITIONS.map((r) => ({ ...r, permissions: [...ROLE_PERMISSIONS[r.id]] })),
    permissions: PERMISSION_CATALOG,
    assignableRoles: isAdmin(req) ? ROLES : ['staff'],
    assignablePermissions: isAdmin(req) ? PERMISSION_CATALOG.map((p) => p.id) : actorPermissions,
    scope: {
      businessId: req.user.businessId,
      branch: isAdmin(req) ? null : req.user.branch,
    },
    passwordMinLength: getAuthConfig().passwordMinLength,
  });
}));

/**
 * GET /api/users
 */
router.get('/', requirePermission('users:read'), asyncHandler(async (req, res) => {
  const filter = scopeFilter(req);
  if (typeof req.query.role === 'string' && ROLES.includes(req.query.role)) filter.role = req.query.role;
  if (req.query.active === 'true' || req.query.active === 'false') filter.active = req.query.active === 'true';
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(500);
  return res.json({ data: users.map(toPublicUser) });
}));

/**
 * GET /api/users/:id
 */
router.get('/:id', requirePermission('users:read'), asyncHandler(async (req, res) => {
  const target = await loadScopedUser(req, res);
  if (!target) return undefined;
  return res.json({ user: toPublicUser(target) });
}));

/**
 * POST /api/users
 */
router.post('/', requirePermission('users:write'), asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = req.body?.role || 'staff';
  const requestedBranch = String(req.body?.branch || '').trim();
  const customPermissions = sanitizePermissionList(req.body?.customPermissions);

  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Geçerli bir e-posta adresi gereklidir', code: 'INVALID_EMAIL' });
  }
  if (!name || name.length > 120) {
    return res.status(400).json({ error: 'Ad soyad zorunludur (en fazla 120 karakter)', code: 'NAME_REQUIRED' });
  }
  const policyError = validatePasswordPolicy(password, { email });
  if (policyError) return res.status(400).json({ error: policyError, code: 'WEAK_PASSWORD' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Geçersiz rol seçildi', code: 'INVALID_ROLE' });
  if (requestedBranch.length > 120) return res.status(400).json({ error: 'Şube adı en fazla 120 karakter olabilir', code: 'BRANCH_NAME_TOO_LONG' });

  if (!isAdmin(req)) {
    if (role !== 'staff') return forbidden(res, 'Yalnızca yöneticiler personel dışı rol atayabilir');
    if (requestedBranch && requestedBranch !== req.user.branch) {
      return forbidden(res, 'Yalnızca kendi şubenize personel ekleyebilirsiniz');
    }
  }
  const escalation = escalationError(req, customPermissions);
  if (escalation) return forbidden(res, escalation);

  const duplicate = () => res.status(409).json({ error: 'Bu e-posta adresi ile kayıtlı bir kullanıcı zaten mevcut', code: 'EMAIL_IN_USE' });
  if (await User.exists({ email })) return duplicate();
  // Admins may name a new branch; near-duplicates ("merkez ") resolve to the existing code.
  const branch = isAdmin(req) && requestedBranch
    ? await resolveBranchCode(req.user.businessId, requestedBranch)
    : req.user.branch;

  // Hash outside the transaction: it is CPU-heavy and the transaction may retry.
  const passwordHash = await hashPassword(password);
  let created;
  try {
    created = await withBusinessAdminGuard(req.user.businessId, async (session) => {
      // The creator's permissions may have been revoked since authentication.
      const actor = await assertActorStillAuthorized(req, session, { permission: 'users:write' });
      const lateEscalation = escalationError(req, customPermissions, [], actor);
      if (lateEscalation) reject(403, lateEscalation);
      const [user] = await User.create([{
        email,
        name,
        passwordHash,
        role,
        branch,
        businessId: req.user.businessId,
        customPermissions,
        active: true,
      }], { session });
      await audit(req, 'user.create', user, { after: snapshot(user), session });
      return user;
    });
  } catch (error) {
    if (error instanceof GuardRejection) return res.status(error.status).json(error.body);
    if (error?.code === 11000) return duplicate();
    throw error;
  }

  return res.status(201).json({ message: 'Kullanıcı başarıyla oluşturuldu', user: toPublicUser(created) });
}));

/**
 * PUT /api/users/:id — profile, role, branch, custom permissions, optional password.
 * Runs inside the business admin guard: a role change can remove an admin.
 */
router.put('/:id', requirePermission('users:write'), asyncHandler(async (req, res) => {
  const loaded = await loadScopedUser(req, res);
  if (!loaded) return undefined;
  const body = req.body || {};

  // Hash outside the transaction: it is CPU-heavy and the transaction may retry.
  let newPasswordHash = null;
  if (body.password) {
    if (isSelf(req, loaded)) return res.status(400).json({ error: 'Kendi şifrenizi Güvenlik sekmesinden değiştiriniz', code: 'SELF_PASSWORD_VIA_SECURITY' });
    if (!canManage(req, loaded)) return forbidden(res, 'Bu kullanıcıyı düzenleme yetkiniz bulunmuyor');
    const policyError = validatePasswordPolicy(body.password, { email: loaded.email });
    if (policyError) return res.status(400).json({ error: policyError, code: 'WEAK_PASSWORD' });
    newPasswordHash = await hashPassword(body.password);
  }

  // Resolved before the transaction: a new branch is registered (idempotent upsert).
  const requestedBranchCode = body.branch !== undefined && isAdmin(req) && String(body.branch).trim()
    ? await resolveBranchCode(req.user.businessId, body.branch)
    : null;

  let outcome;
  try {
    outcome = await withBusinessAdminGuard(req.user.businessId, async (session) => {
      const actor = await assertActorStillAuthorized(req, session, { permission: 'users:write' });
      const target = await reloadScopedUser(req, loaded._id, session);
      const self = isSelf(req, target);
      if (!self && !canManage(req, target)) reject(403, 'Bu kullanıcıyı düzenleme yetkiniz bulunmuyor');

      const before = snapshot(target);
      let nameChanged = false;

      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name || name.length > 120) reject(400, 'Ad soyad zorunludur (en fazla 120 karakter)');
        nameChanged = name !== target.name;
        target.name = name;
      }

      if (body.role !== undefined && body.role !== target.role) {
        if (self) reject(403, 'Kendi rolünüzü değiştiremezsiniz');
        if (!isAdmin(req)) reject(403, 'Kullanıcı rolünü değiştirmek için yönetici yetkisi gereklidir');
        if (!ROLES.includes(body.role)) reject(400, 'Geçersiz rol');
        if (target.role === 'admin' && target.active
          && (await countOtherActiveAdmins(target.businessId, target._id, session)) < 1) {
          reject(400, LAST_ADMIN_ERROR, 'LAST_ACTIVE_ADMIN');
        }
        target.role = body.role;
      }

      if (body.branch !== undefined) {
        const branch = requestedBranchCode ?? String(body.branch).trim();
        if (branch !== target.branch) {
          if (self && !isAdmin(req)) reject(403, 'Kendi şubenizi değiştiremezsiniz');
          if (!isAdmin(req)) reject(403, 'Şube ataması için yönetici yetkisi gereklidir');
          if (!branch || branch.length > 120) reject(400, 'Geçerli bir şube adı giriniz');
          target.branch = branch;
        }
      }

      if (body.customPermissions !== undefined) {
        const requested = sanitizePermissionList(body.customPermissions);
        const existing = [...(target.customPermissions || [])];
        const changed = requested.length !== existing.length || requested.some((p) => !existing.includes(p));
        if (changed) {
          if (self) reject(403, 'Kendi yetkilerinizi değiştiremezsiniz');
          const escalation = escalationError(req, requested, existing, actor);
          if (escalation) reject(403, escalation);
          target.customPermissions = requested;
        }
      }

      const passwordReset = Boolean(newPasswordHash);
      if (passwordReset) {
        target.passwordHash = newPasswordHash;
        target.passwordChangedAt = new Date();
        target.tokenVersion = (target.tokenVersion || 0) + 1;
      }

      await target.save({ session });
      await audit(req, passwordReset ? 'user.update_with_password' : 'user.update', target, {
        before,
        // The fact that the name changed is recorded, the name itself is not.
        after: { ...snapshot(target), ...(nameChanged ? { nameChanged: true } : {}) },
        session,
      });
      return { target, passwordReset };
    });
  } catch (error) {
    if (error instanceof GuardRejection) return res.status(error.status).json(error.body);
    throw error;
  }

  if (outcome.passwordReset) await authSessionService.revokeAllForUser(outcome.target._id, 'password_set_by_admin');
  return res.json({ message: 'Kullanıcı bilgileri güncellendi', user: toPublicUser(outcome.target) });
}));

/**
 * PATCH /api/users/:id/status — activate / deactivate.
 * Runs inside the business admin guard so that concurrent deactivations can
 * never leave a business without an active admin.
 */
router.patch('/:id/status', requirePermission('users:write'), asyncHandler(async (req, res) => {
  if (typeof req.body?.active !== 'boolean') {
    return res.status(400).json({ error: '"active" alanı true veya false olmalıdır', code: 'INVALID_ACTIVE_FLAG' });
  }
  const loaded = await loadScopedUser(req, res);
  if (!loaded) return undefined;
  if (isSelf(req, loaded)) return res.status(400).json({ error: 'Kendi hesabınızı devre dışı bırakamazsınız', code: 'SELF_DEACTIVATION_FORBIDDEN' });

  const active = req.body.active;
  let outcome;
  try {
    outcome = await withBusinessAdminGuard(req.user.businessId, async (session) => {
      await assertActorStillAuthorized(req, session, { permission: 'users:write' });
      const target = await reloadScopedUser(req, loaded._id, session);
      if (!canManage(req, target)) reject(403, 'Bu kullanıcının durumunu değiştirme yetkiniz bulunmuyor');

      if (!active && target.role === 'admin' && target.active
        && (await countOtherActiveAdmins(target.businessId, target._id, session)) < 1) {
        reject(400, LAST_ADMIN_ERROR, 'LAST_ACTIVE_ADMIN');
      }

      const before = { active: target.active };
      // Any reset token is discarded on BOTH transitions: a link issued before
      // a deactivation can never become usable again by re-activating (L3).
      const update = { $set: { active }, $unset: { ...RESET_FIELDS_UNSET } };
      if (!active) update.$inc = { tokenVersion: 1 };
      await User.updateOne({ _id: target._id }, update, { session });
      await audit(req, active ? 'user.activate' : 'user.deactivate', target, { before, after: { active }, session });
      return { target };
    });
  } catch (error) {
    if (error instanceof GuardRejection) return res.status(error.status).json(error.body);
    throw error;
  }

  if (!active) await authSessionService.revokeAllForUser(outcome.target._id, 'user_deactivated');
  return res.json({
    message: active ? 'Kullanıcı hesabı etkinleştirildi' : 'Kullanıcı hesabı devre dışı bırakıldı',
    active,
  });
}));

/**
 * POST /api/users/:id/sessions/revoke — sign a user out on every device.
 */
router.post('/:id/sessions/revoke', requirePermission('users:write'), asyncHandler(async (req, res) => {
  const target = await loadScopedUser(req, res);
  if (!target) return undefined;
  if (!isSelf(req, target) && !canManage(req, target)) {
    return forbidden(res, 'Bu kullanıcının oturumlarını kapatma yetkiniz bulunmuyor');
  }
  await User.revokeTokens(target._id, 'revoked_by_admin');
  await audit(req, 'user.sessions_revoked', target);
  return res.json({ message: 'Kullanıcının tüm oturumları sonlandırıldı' });
}));

/**
 * POST /api/users/:id/password-reset — e-mail a reset link to the user.
 * Requires working SMTP; reports delivery failure honestly.
 *
 * The token is issued inside the business admin guard (L3): it is serialised
 * with deactivation, deletion, re-activation and permission changes, actor and
 * target are re-checked in the same snapshot, and the token is bound to the
 * target's tokenVersion, so any later revocation (deactivation, password
 * change, session revocation) invalidates it permanently.
 */
router.post('/:id/password-reset', requirePermission('users:write'), asyncHandler(async (req, res) => {
  const loaded = await loadScopedUser(req, res);
  if (!loaded) return undefined;
  if (!isSelf(req, loaded) && !canManage(req, loaded)) {
    return forbidden(res, 'Bu kullanıcı için şifre sıfırlama gönderme yetkiniz bulunmuyor');
  }
  const INACTIVE_ERROR = 'Pasif kullanıcıya şifre sıfırlama bağlantısı gönderilemez';
  if (!loaded.active) return res.status(400).json({ error: INACTIVE_ERROR, code: 'USER_INACTIVE' });

  if (!emailService.isEmailConfigured()) {
    return res.status(503).json({ error: 'E-posta servisi yapılandırılmamış; sıfırlama bağlantısı gönderilemez.', code: 'SMTP_UNCONFIGURED' });
  }
  try {
    await emailService.ensureReady();
  } catch (error) {
    return res.status(503).json({ error: error.message, code: error.code || 'SMTP_UNAVAILABLE' });
  }

  const config = getAuthConfig();
  const rawToken = generateOpaqueToken(32);
  const tokenHash = sha256Hex(rawToken);
  let target;
  try {
    target = await withBusinessAdminGuard(req.user.businessId, async (session) => {
      await assertActorStillAuthorized(req, session, { permission: 'users:write' });
      const fresh = await reloadScopedUser(req, loaded._id, session);
      if (!isSelf(req, fresh) && !canManage(req, fresh)) {
        reject(403, 'Bu kullanıcı için şifre sıfırlama gönderme yetkiniz bulunmuyor');
      }
      if (!fresh.active) reject(400, INACTIVE_ERROR, 'USER_INACTIVE');
      const now = Date.now();
      const issued = await User.updateOne({ _id: fresh._id, active: true }, {
        $set: {
          passwordResetTokenHash: tokenHash,
          passwordResetExpires: new Date(now + config.passwordResetTtlSeconds * 1000),
          passwordResetRequestedAt: new Date(now),
          passwordResetTokenVersion: Number.isSafeInteger(fresh.tokenVersion) ? fresh.tokenVersion : 0,
        },
      }, { session });
      if (issued.matchedCount !== 1) reject(409, 'Kullanıcı bu işlem sırasında değişti; lütfen tekrar deneyin', 'USER_STATE_CHANGED');
      return fresh;
    });
  } catch (error) {
    if (error instanceof GuardRejection) return res.status(error.status).json(error.body);
    throw error;
  }

  try {
    await emailService.sendPasswordResetEmail(target.email, rawToken, {
      expiresInMinutes: Math.round(config.passwordResetTtlSeconds / 60),
      name: target.name,
    });
  } catch (error) {
    await User.updateOne(
      { _id: target._id, passwordResetTokenHash: tokenHash },
      { $unset: { ...RESET_FIELDS_UNSET } },
    );
    // Structured code only: raw SMTP text can contain addresses / server details (M4).
    await audit(req, 'user.password_reset_email_failed', target, { after: classifyEmailError(error) });
    return res.status(502).json({ error: 'Şifre sıfırlama e-postası gönderilemedi. SMTP ayarlarını kontrol edin.', code: 'EMAIL_DELIVERY_FAILED' });
  }

  await audit(req, 'user.password_reset_sent', target);
  return res.json({ message: `Şifre sıfırlama bağlantısı ${target.email} adresine gönderildi` });
}));

/**
 * DELETE /api/users/:id — permanent removal of an already deactivated account.
 * A minimal tombstone keeps the deleted user's audit history attributable to
 * its business; no personal data is kept in it.
 */
router.delete('/:id', requirePermission('users:delete'), asyncHandler(async (req, res) => {
  const loaded = await loadScopedUser(req, res);
  if (!loaded) return undefined;
  if (isSelf(req, loaded)) return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz', code: 'SELF_DELETION_FORBIDDEN' });

  let outcome;
  try {
    outcome = await withBusinessAdminGuard(req.user.businessId, async (session) => {
      await assertActorStillAuthorized(req, session, { permission: 'users:delete' });
      const target = await reloadScopedUser(req, loaded._id, session);
      if (!canManage(req, target)) reject(403, 'Bu kullanıcıyı silme yetkiniz bulunmuyor');
      if (target.active) reject(400, 'Silmeden önce hesabı devre dışı bırakmalısınız', 'USER_STILL_ACTIVE');

      const removed = await User.deleteOne({ _id: target._id, active: false }, { session });
      if (removed.deletedCount !== 1) reject(409, 'Kullanıcı bu işlem sırasında değişti; lütfen tekrar deneyin', 'USER_STATE_CHANGED');
      await DeletedUser.create([{
        _id: target._id,
        businessId: target.businessId,
        role: target.role,
        deletedBy: req.user._id,
      }], { session });
      // Personal data (name, e-mail) is deliberately not copied into this record.
      await audit(req, 'user.delete', target, {
        before: {
          role: target.role,
          branch: target.branch,
          customPermissions: [...(target.customPermissions || [])],
          active: false,
        },
        session,
      });
      return { target };
    });
  } catch (error) {
    if (error instanceof GuardRejection) return res.status(error.status).json(error.body);
    throw error;
  }

  await authSessionService.revokeAllForUser(outcome.target._id, 'user_deleted');
  return res.json({ message: 'Kullanıcı kalıcı olarak silindi' });
}));

module.exports = router;
