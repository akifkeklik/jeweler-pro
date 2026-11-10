const express = require('express');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const asyncHandler = require('../middleware/asyncHandler');
const loginRateLimit = require('../middleware/loginRateLimit');
const { createRateLimiter, clientIp, rateLimitIp, normalizedEmail } = require('../middleware/rateLimit');
const { createSharedRateLimit } = require('../middleware/sharedRateLimit');

// Cluster-wide caps (all API instances together); the in-process limiters
// below remain the precise first layer. See middleware/sharedRateLimit.js.
const SHARED_WINDOW_MS = 15 * 60 * 1000;
const sharedLoginIp = createSharedRateLimit({ name: 'shared-login-ip', windowMs: SHARED_WINDOW_MS, max: 100, key: (req) => `ip:${rateLimitIp(req)}`, message: 'Çok fazla giriş denemesi. Bir süre sonra tekrar deneyin.' });
const sharedLoginAccount = createSharedRateLimit({ name: 'shared-login-account', windowMs: SHARED_WINDOW_MS, max: 50, key: (req) => normalizedEmail(req) || null, message: 'Çok fazla giriş denemesi. Bir süre sonra tekrar deneyin.' });
const sharedForgot = createSharedRateLimit({ name: 'shared-forgot', windowMs: 60 * 60 * 1000, max: 10, key: (req) => normalizedEmail(req) || `ip:${rateLimitIp(req)}` });
const sharedReset = createSharedRateLimit({ name: 'shared-reset', windowMs: SHARED_WINDOW_MS, max: 60, key: (req) => `ip:${rateLimitIp(req)}` });
const { requireCsrfHeader, requireCsrfHeaderWhenCookie, requireJsonSameOrigin } = require('../middleware/csrf');
const { signToken, verifyToken, authenticate } = require('../middleware/auth');
const { recordAudit, recordAuditSafely, classifyEmailError } = require('../utils/audit');
const { normalizeEmail, accountLimiterKey } = require('../utils/accountIdentity');
const { auditIpPrefix } = require('../utils/ipAddress');
const {
  hashPassword,
  verifyPassword,
  burnPasswordCheck,
  validatePasswordPolicy,
  sha256Hex,
  generateOpaqueToken,
  isOpaqueToken,
} = require('../utils/passwords');
const { toPublicUser } = require('../utils/userView');
const { PERMISSION_CATALOG } = require('../middleware/authorization');
const { getAuthConfig } = require('../config/authConfig');
const authSessionService = require('../services/authSessionService');
const emailService = require('../services/emailService');

const router = express.Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_RESET_MESSAGE = 'Eğer e-posta adresi sistemimizde kayıtlı ise şifre sıfırlama bağlantısı gönderilmiştir.';

// Generous: many staff of one shop often share a single NAT IP.
const refreshRateLimit = createRateLimiter({
  name: 'auth-refresh',
  windowMs: 60 * 1000,
  max: 120,
  key: (req) => `refresh:${rateLimitIp(req)}`,
  message: 'Çok fazla oturum yenileme isteği. Lütfen biraz bekleyin.',
});
const forgotIpRateLimit = createRateLimiter({
  name: 'forgot-ip',
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: (req) => `forgot-ip:${rateLimitIp(req)}`,
  message: 'Çok fazla şifre sıfırlama talebi. Lütfen daha sonra tekrar deneyin.',
});
const forgotEmailRateLimit = createRateLimiter({
  name: 'forgot-account',
  windowMs: 60 * 60 * 1000,
  max: 5,
  // Keyed hash of the normalised address — no raw e-mail in limiter memory.
  key: (req) => {
    const account = accountLimiterKey(normalizedEmail(req));
    return account ? `forgot:${account}` : null;
  },
  message: 'Bu adres için çok fazla şifre sıfırlama talebi yapıldı. Lütfen daha sonra tekrar deneyin.',
});
const resetRateLimit = createRateLimiter({
  name: 'reset-ip',
  windowMs: 15 * 60 * 1000,
  max: 20,
  key: (req) => `reset-ip:${rateLimitIp(req)}`,
  message: 'Çok fazla şifre sıfırlama denemesi. Lütfen daha sonra tekrar deneyin.',
});

const RESET_FIELDS_UNSET = Object.freeze({
  passwordResetTokenHash: 1,
  passwordResetExpires: 1,
  passwordResetRequestedAt: 1,
  passwordResetTokenVersion: 1,
});

/**
 * A reset token is valid only while the account's tokenVersion still equals
 * the version recorded at issuance (accounts created before tokenVersion
 * existed count as version 0). Deactivation, password changes and session
 * revocation therefore invalidate outstanding links permanently (L3).
 */
const RESET_TOKEN_STATE_BINDING = Object.freeze({
  $expr: { $eq: [{ $ifNull: ['$tokenVersion', 0] }, '$passwordResetTokenVersion'] },
});

/** Data-minimised client network for audit records (IPv4 /24, IPv6 /48). */
function auditNetwork(req) {
  const ipPrefix = auditIpPrefix(clientIp(req));
  return ipPrefix ? { ipPrefix } : {};
}

function cookieOptions() {
  const { cookie } = getAuthConfig();
  return {
    httpOnly: true,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
    ...(cookie.domain ? { domain: cookie.domain } : {}),
  };
}

function refreshCookieName() {
  return getAuthConfig().cookie.name;
}

function setRefreshCookie(res, rawToken, session) {
  const options = cookieOptions();
  // "Beni Hatırla" → persistent cookie; otherwise a browser-session cookie
  // that disappears when the browser is closed (server lifetime still applies).
  if (session.persistent) options.expires = session.expiresAt;
  res.cookie(refreshCookieName(), rawToken, options);
}

function clearRefreshCookie(res) {
  res.clearCookie(refreshCookieName(), cookieOptions());
}

function sessionResponse(user, session) {
  const { accessTokenTtlSeconds } = getAuthConfig();
  return {
    token: signToken(user, accessTokenTtlSeconds, { sessionId: session._id }),
    expiresIn: accessTokenTtlSeconds,
    user: toPublicUser(user),
    session: {
      id: String(session._id),
      persistent: Boolean(session.persistent),
      expiresAt: session.expiresAt,
    },
  };
}

function auditContext(req, fallback) {
  return req.correlationId || fallback;
}

/**
 * POST /api/auth/login
 * Issues a short-lived access token (kept in memory by the SPA) and a rotating
 * refresh token in an HttpOnly cookie. rememberMe controls cookie persistence.
 */
router.post('/login', requireJsonSameOrigin, sharedLoginIp, sharedLoginAccount, loginRateLimit, asyncHandler(async (req, res) => {
  // Same normalisation as the login rate limiter (utils/accountIdentity).
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const rememberMe = req.body?.rememberMe === true;

  if (!email || !password || email.length > 254 || password.length > 200) {
    return res.status(400).json({ error: 'E-posta ve şifre zorunludur', code: 'CREDENTIALS_REQUIRED' });
  }

  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || user.active !== true) {
    await burnPasswordCheck(password);
    if (user) {
      await recordAuditSafely({
        AuditLog,
        actorUserId: user._id,
        action: 'auth.login_failed',
        resourceType: 'User',
        resourceId: user._id,
        correlationId: auditContext(req, 'auth-login'),
        after: { reason: 'inactive_account', ...auditNetwork(req) },
      });
    }
    return res.status(401).json({ error: 'E-posta veya şifre hatalı', code: 'INVALID_CREDENTIALS' });
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordAuditSafely({
      AuditLog,
      actorUserId: user._id,
      action: 'auth.login_failed',
      resourceType: 'User',
      resourceId: user._id,
      correlationId: auditContext(req, 'auth-login'),
      after: { reason: 'invalid_password', ...auditNetwork(req) },
    });
    return res.status(401).json({ error: 'E-posta veya şifre hatalı', code: 'INVALID_CREDENTIALS' });
  }

  const { session, rawToken } = await authSessionService.createSession(user, { persistent: rememberMe, req });

  user.lastLoginAt = new Date();
  await user.save();

  await recordAudit({
    AuditLog,
    actorUserId: user._id,
    action: 'auth.login',
    resourceType: 'User',
    resourceId: user._id,
    correlationId: auditContext(req, 'auth-login'),
    after: { rememberMe, sessionId: String(session._id), ...auditNetwork(req) },
  });

  setRefreshCookie(res, rawToken, session);
  return res.json(sessionResponse(user, session));
}));

/**
 * POST /api/auth/refresh
 * Cookie-only (never accepts tokens from JS-readable storage). Rotates the
 * refresh token on every call and detects replay of rotated tokens.
 */
router.post('/refresh', refreshRateLimit, requireCsrfHeader, asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.[refreshCookieName()];
  if (!rawToken) {
    return res.status(401).json({ error: 'Oturum bulunamadı', code: 'REFRESH_TOKEN_MISSING' });
  }

  const result = await authSessionService.rotateSession(rawToken, { req });

  if (result.kind === 'race') {
    // Another tab rotated this token a moment ago; the browser already holds
    // the new cookie. Do not clear it — the client simply retries.
    return res.status(409).json({ error: 'Oturum başka bir sekmede yenilendi', code: 'REFRESH_TOKEN_ROTATED' });
  }

  if (result.kind === 'reused') {
    clearRefreshCookie(res);
    await recordAuditSafely({
      AuditLog,
      actorUserId: result.session.userId,
      action: 'auth.refresh_token_reuse_detected',
      resourceType: 'AuthSession',
      resourceId: result.session._id,
      correlationId: auditContext(req, 'auth-refresh'),
      after: { ...auditNetwork(req), sessionRevoked: true },
    });
    return res.status(401).json({ error: 'Güvenlik nedeniyle oturum sonlandırıldı. Lütfen tekrar giriş yapın.', code: 'REFRESH_TOKEN_REUSED' });
  }

  if (result.kind !== 'ok') {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Oturumun süresi dolmuş veya geçersiz', code: 'REFRESH_TOKEN_INVALID' });
  }

  const { session } = result;
  const user = await User.findById(session.userId);
  const currentVersion = Number.isSafeInteger(user?.tokenVersion) ? user.tokenVersion : 0;
  if (!user || user.active !== true || currentVersion !== session.tokenVersion) {
    await authSessionService.revokeSession(session._id, 'user_invalidated');
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Oturum geçersiz kılınmış. Lütfen tekrar giriş yapın.', code: 'REFRESH_TOKEN_INVALID' });
  }

  setRefreshCookie(res, result.rawToken, session);
  return res.json(sessionResponse(user, session));
}));

/**
 * GET /api/auth/me
 */
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  return res.json({ ...toPublicUser(req.user), sessionId: req.user.sessionId });
}));

/**
 * GET /api/auth/permission-catalog — human-readable labels for permission ids
 * (non-sensitive; lets every signed-in user see what their permissions mean).
 */
router.get('/permission-catalog', authenticate, (req, res) => res.json({ permissions: PERMISSION_CATALOG }));

/**
 * POST /api/auth/logout
 * Revokes the current device session (identified by the refresh cookie and/or
 * the session-bound access token) and clears the cookie. Other devices stay
 * signed in; use /logout-all for those.
 */
router.post('/logout', requireCsrfHeaderWhenCookie('jeweler_refresh_token'), asyncHandler(async (req, res) => {
  let actorUserId = null;
  const revokedSessionIds = [];

  const rawToken = req.cookies?.[refreshCookieName()];
  if (rawToken) {
    const session = await authSessionService.findSessionByRawToken(rawToken);
    if (session) {
      await authSessionService.revokeSession(session._id, 'logout');
      revokedSessionIds.push(String(session._id));
      actorUserId = session.userId;
    }
  }

  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  const claims = match ? verifyToken(match[1]) : null;
  if (claims?.sub) {
    if (claims.sid) {
      if (!revokedSessionIds.includes(claims.sid)) {
        await authSessionService.revokeSession(claims.sid, 'logout', { userId: claims.sub });
        revokedSessionIds.push(claims.sid);
      }
    } else {
      // Legacy token without a session binding: only a full revocation can end it.
      await User.revokeTokens(claims.sub, 'logout');
    }
    actorUserId = actorUserId || claims.sub;
  }

  clearRefreshCookie(res);

  if (actorUserId) {
    await recordAuditSafely({
      AuditLog,
      actorUserId,
      action: 'auth.logout',
      resourceType: 'User',
      resourceId: actorUserId,
      correlationId: auditContext(req, 'auth-logout'),
      after: { sessions: revokedSessionIds },
    });
  }

  return res.json({ message: 'Oturum başarıyla kapatıldı' });
}));

/**
 * POST /api/auth/logout-all — signs the user out on every device.
 */
router.post('/logout-all', authenticate, asyncHandler(async (req, res) => {
  await User.revokeTokens(req.user._id, 'logout_all');
  clearRefreshCookie(res);
  await recordAudit({
    AuditLog,
    actorUserId: req.user._id,
    action: 'auth.logout_all',
    resourceType: 'User',
    resourceId: req.user._id,
    correlationId: auditContext(req, 'auth-logout-all'),
  });
  return res.json({ message: 'Tüm cihazlardaki oturumlar kapatıldı' });
}));

/**
 * GET /api/auth/sessions — the caller's active device sessions.
 */
router.get('/sessions', authenticate, asyncHandler(async (req, res) => {
  const sessions = await authSessionService.listActiveSessions(req.user._id);
  return res.json({
    data: sessions.map((s) => ({
      id: String(s._id),
      persistent: Boolean(s.persistent),
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      ip: s.ip,
      userAgent: s.userAgent,
      current: String(s._id) === req.user.sessionId,
    })),
  });
}));

/**
 * DELETE /api/auth/sessions/:id — revoke one of the caller's own sessions.
 */
router.delete('/sessions/:id', authenticate, asyncHandler(async (req, res) => {
  const revoked = await authSessionService.revokeSession(req.params.id, 'revoked_by_user', { userId: req.user._id });
  if (!revoked) return res.status(404).json({ error: 'Oturum bulunamadı', code: 'SESSION_NOT_FOUND' });
  await recordAudit({
    AuditLog,
    actorUserId: req.user._id,
    action: 'auth.session_revoked',
    resourceType: 'AuthSession',
    resourceId: req.params.id,
    correlationId: auditContext(req, 'auth-session-revoke'),
  });
  if (req.params.id === req.user.sessionId) clearRefreshCookie(res);
  return res.json({ message: 'Oturum sonlandırıldı' });
}));

/**
 * POST /api/auth/forgot-password
 * - Honest 503 when e-mail is not configured or the SMTP server is unreachable
 *   (checked before the account lookup, so it reveals nothing about accounts).
 * - Identical response for registered and unknown addresses; the e-mail is sent
 *   in the background so response time does not depend on account existence.
 */
router.post('/forgot-password', requireJsonSameOrigin, sharedForgot, forgotIpRateLimit, forgotEmailRateLimit, asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Geçerli bir e-posta adresi gereklidir', code: 'INVALID_EMAIL' });
  }

  if (!emailService.isEmailConfigured()) {
    return res.status(503).json({
      error: 'E-posta servisi yapılandırılmamış. Şifre sıfırlama e-postası gönderilemez; lütfen sistem yöneticinizle iletişime geçin.',
      code: 'SMTP_UNCONFIGURED',
    });
  }

  try {
    await emailService.ensureReady();
  } catch (error) {
    console.error('[auth] SMTP hazır değil', { code: error.code, cause: error.cause?.message });
    return res.status(503).json({ error: error.message, code: error.code || 'SMTP_UNAVAILABLE' });
  }

  const user = await User.findOne({ email, active: true }).select('+passwordResetRequestedAt');
  if (!user) {
    console.info('[auth] Kayıtlı olmayan/pasif hesap için şifre sıfırlama talebi', { correlationId: req.correlationId });
    return res.json({ message: GENERIC_RESET_MESSAGE });
  }

  const config = getAuthConfig();
  const now = Date.now();
  const lastRequest = user.passwordResetRequestedAt ? user.passwordResetRequestedAt.getTime() : 0;
  if (now - lastRequest < config.passwordResetCooldownSeconds * 1000) {
    // Silently throttle e-mail bombing of a single mailbox.
    return res.json({ message: GENERIC_RESET_MESSAGE });
  }

  const rawToken = generateOpaqueToken(32);
  const tokenHash = sha256Hex(rawToken);
  const tokenVersion = Number.isSafeInteger(user.tokenVersion) ? user.tokenVersion : 0;
  // Conditional write (L3): if the account was deactivated / its sessions
  // revoked after the lookup above, nothing is issued. A concurrent
  // deactivation transaction either commits first (no match here) or unsets
  // this token when it commits after us.
  const issued = await User.updateOne(
    {
      _id: user._id,
      active: true,
      $expr: { $eq: [{ $ifNull: ['$tokenVersion', 0] }, tokenVersion] },
    },
    {
      $set: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpires: new Date(now + config.passwordResetTtlSeconds * 1000),
        passwordResetRequestedAt: new Date(now),
        passwordResetTokenVersion: tokenVersion,
      },
    },
  );
  if (issued.matchedCount !== 1) {
    return res.json({ message: GENERIC_RESET_MESSAGE });
  }

  await recordAuditSafely({
    AuditLog,
    actorUserId: user._id,
    action: 'auth.password_reset_requested',
    resourceType: 'User',
    resourceId: user._id,
    correlationId: auditContext(req, 'auth-forgot'),
    after: { ...auditNetwork(req) },
  });

  const correlationId = auditContext(req, 'auth-forgot');
  emailService.dispatch(async () => {
    try {
      await emailService.sendPasswordResetEmail(user.email, rawToken, {
        expiresInMinutes: Math.round(config.passwordResetTtlSeconds / 60),
        name: user.name,
      });
    } catch (error) {
      const failure = classifyEmailError(error);
      // Raw SMTP text may contain the recipient address; log the code only.
      console.error('[auth] Şifre sıfırlama e-postası gönderilemedi', { userId: String(user._id), ...failure });
      // The undelivered token must not stay usable.
      await User.updateOne(
        { _id: user._id, passwordResetTokenHash: tokenHash },
        { $unset: { ...RESET_FIELDS_UNSET } },
      );
      await recordAuditSafely({
        AuditLog,
        actorUserId: user._id,
        action: 'auth.password_reset_email_failed',
        resourceType: 'User',
        resourceId: user._id,
        correlationId,
        after: failure,
      });
    }
  });

  return res.json({ message: GENERIC_RESET_MESSAGE });
}));

async function findUserByResetToken(rawToken) {
  if (!isOpaqueToken(rawToken, 32)) return null;
  // Expiry, account status and token/account-state binding are all checked
  // at use time, not only at issuance.
  return User.findOne({
    passwordResetTokenHash: sha256Hex(rawToken),
    passwordResetExpires: { $gt: new Date() },
    active: true,
    ...RESET_TOKEN_STATE_BINDING,
  }).select('+passwordResetExpires');
}

/**
 * POST /api/auth/reset-password/validate — lets the reset screen show a clear
 * "link expired" state before the user types a new password.
 */
router.post('/reset-password/validate', requireJsonSameOrigin, sharedReset, resetRateLimit, asyncHandler(async (req, res) => {
  const user = await findUserByResetToken(String(req.body?.token || '').trim());
  if (!user) {
    return res.status(400).json({ error: 'Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş', code: 'RESET_TOKEN_INVALID' });
  }
  return res.json({ valid: true, expiresAt: user.passwordResetExpires });
}));

/**
 * POST /api/auth/reset-password
 * Consumes the token atomically (single use), sets the new password and
 * invalidates every existing session of the account.
 */
router.post('/reset-password', requireJsonSameOrigin, sharedReset, resetRateLimit, asyncHandler(async (req, res) => {
  const rawToken = String(req.body?.token || '').trim();
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (!isOpaqueToken(rawToken, 32)) {
    return res.status(400).json({ error: 'Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş', code: 'RESET_TOKEN_INVALID' });
  }
  const policyError = validatePasswordPolicy(newPassword);
  if (policyError) {
    return res.status(400).json({ error: policyError, code: 'WEAK_PASSWORD' });
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();
  const user = await User.findOneAndUpdate(
    {
      passwordResetTokenHash: sha256Hex(rawToken),
      passwordResetExpires: { $gt: now },
      active: true,
      ...RESET_TOKEN_STATE_BINDING,
    },
    {
      $set: { passwordHash, passwordChangedAt: now },
      $inc: { tokenVersion: 1 },
      $unset: { ...RESET_FIELDS_UNSET },
    },
    { new: true },
  );

  if (!user) {
    console.warn('[auth] Geçersiz/kullanılmış şifre sıfırlama tokenı denendi', { correlationId: req.correlationId, ip: clientIp(req) });
    return res.status(400).json({ error: 'Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş', code: 'RESET_TOKEN_INVALID' });
  }

  await authSessionService.revokeAllForUser(user._id, 'password_reset');
  clearRefreshCookie(res);

  await recordAudit({
    AuditLog,
    actorUserId: user._id,
    action: 'auth.password_reset_completed',
    resourceType: 'User',
    resourceId: user._id,
    correlationId: auditContext(req, 'auth-reset'),
    after: { sessionsRevoked: true, ...auditNetwork(req) },
  });

  if (emailService.isEmailConfigured()) {
    emailService.dispatch(async () => {
      try {
        await emailService.sendPasswordChangedNotice(user.email, { name: user.name });
      } catch (error) {
        console.error('[auth] Şifre değişikliği bildirimi gönderilemedi', { userId: String(user._id), error: error.message });
      }
    });
  }

  return res.json({ message: 'Şifreniz başarıyla sıfırlandı. Yeni şifrenizle giriş yapabilirsiniz.' });
}));

/**
 * POST /api/auth/password — in-app password change; ends all sessions.
 */
router.post('/password', authenticate, asyncHandler(async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  if (!currentPassword) {
    return res.status(400).json({ error: 'Mevcut şifre zorunludur', code: 'CURRENT_PASSWORD_REQUIRED' });
  }
  const policyError = validatePasswordPolicy(newPassword, { email: req.user.email });
  if (policyError) {
    return res.status(400).json({ error: policyError, code: 'WEAK_PASSWORD' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'Yeni şifre mevcut şifreden farklı olmalıdır', code: 'PASSWORD_UNCHANGED' });
  }

  const user = await User.findOne({ _id: req.user._id }).select('+passwordHash');
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    // 400, not 401: a wrong current password must not look like an expired session.
    return res.status(400).json({ error: 'Mevcut şifre hatalı', code: 'INVALID_CURRENT_PASSWORD' });
  }

  await User.findByIdAndUpdate(req.user._id, {
    passwordHash: await hashPassword(newPassword),
    passwordChangedAt: new Date(),
    $inc: { tokenVersion: 1 },
  });
  await authSessionService.revokeAllForUser(req.user._id, 'password_changed');
  clearRefreshCookie(res);

  await recordAudit({
    AuditLog,
    actorUserId: req.user._id,
    action: 'auth.password_changed',
    resourceType: 'User',
    resourceId: req.user._id,
    correlationId: auditContext(req, 'auth-password'),
    after: { sessionsRevoked: true },
  });

  if (emailService.isEmailConfigured()) {
    emailService.dispatch(async () => {
      try {
        await emailService.sendPasswordChangedNotice(req.user.email, { name: req.user.name });
      } catch (error) {
        console.error('[auth] Şifre değişikliği bildirimi gönderilemedi', { error: error.message });
      }
    });
  }

  return res.json({ message: 'Şifre güncellendi. Lütfen yeni şifrenizle yeniden giriş yapın.' });
}));

module.exports = router;
module.exports.REFRESH_COOKIE_NAME = 'jeweler_refresh_token';
