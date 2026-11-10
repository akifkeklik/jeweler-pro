const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { requireRole, getEffectivePermissions } = require('./authorization');
const authSessionService = require('../services/authSessionService');

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    const error = new Error('JWT_SECRET en az 32 karakter olmalıdır');
    error.statusCode = 500;
    throw error;
  }
  return secret;
}

const JWT_ALGORITHM = 'HS256';
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * Defence in depth before the library sees the token: exactly three
 * canonical base64url segments (alternate encodings that decode to the same
 * bytes are rejected, so a token has exactly one valid spelling).
 */
function isCanonicalCompactJws(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  return parts.every((part) => BASE64URL_SEGMENT.test(part)
    && Buffer.from(part, 'base64url').toString('base64url') === part);
}

/**
 * Signs an HS256 access token (jsonwebtoken). `sessionId` binds the token to
 * a refresh session so logging out a device revokes its access token
 * immediately.
 */
function signToken(user, expiresInSeconds = 60 * 60 * 8, { sessionId } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const tokenVersion = Number.isSafeInteger(user.tokenVersion) && user.tokenVersion >= 0
    ? user.tokenVersion
    : 0;
  return jwt.sign({
    sub: String(user._id),
    email: user.email,
    role: user.role,
    tokenVersion,
    ...(sessionId ? { sid: String(sessionId) } : {}),
    iat: now,
    exp: now + expiresInSeconds,
  }, getSecret(), { algorithm: JWT_ALGORITHM, header: { alg: JWT_ALGORITHM, typ: 'JWT' } });
}

/**
 * Verifies signature, algorithm (HS256 only: no `none`, no RS/HS
 * confusion) and expiry with jsonwebtoken, then applies the application's
 * own strict claim rules. Returns the claims or null.
 */
function verifyToken(token) {
  if (!isCanonicalCompactJws(token)) return null;
  let claims;
  let header;
  try {
    const decoded = jwt.verify(token, getSecret(), { algorithms: [JWT_ALGORITHM], complete: true, clockTolerance: 0 });
    claims = decoded.payload;
    header = decoded.header;
  } catch (error) {
    if (error?.statusCode === 500) throw error; // misconfigured secret, not a bad token
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (!header || header.typ !== 'JWT') return null;
  if (!claims || typeof claims !== 'object') return null;
  if (typeof claims.sub !== 'string' || !claims.sub.trim()) return null;
  if (!Number.isSafeInteger(claims.iat) || claims.iat > now) return null;
  if (!Number.isSafeInteger(claims.exp) || claims.exp <= now) return null;
  if (!Number.isSafeInteger(claims.tokenVersion) || claims.tokenVersion < 0) return null;
  if (claims.sid !== undefined && (typeof claims.sid !== 'string' || !/^[0-9a-f]{24}$/.test(claims.sid))) return null;
  return claims;
}

async function authenticate(req, res, next) {
  try {
    const authorization = req.headers.authorization || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    const claims = match && verifyToken(match[1]);
    if (!claims) return res.status(401).json({ error: 'Oturum geçersiz veya süresi dolmuş', code: 'SESSION_INVALID' });

    let user;
    try {
      user = await User.findById(claims.sub);
    } catch (error) {
      if (error.name === 'CastError') {
        return res.status(401).json({ error: 'Oturum geçersiz veya süresi dolmuş', code: 'SESSION_INVALID' });
      }
      throw error;
    }

    const currentTokenVersion = Number.isSafeInteger(user?.tokenVersion) && user.tokenVersion >= 0
      ? user.tokenVersion
      : 0;
    if (!user || user.active !== true || claims.tokenVersion !== currentTokenVersion) {
      return res.status(401).json({ error: 'Oturum geçersiz veya süresi dolmuş', code: 'SESSION_INVALID' });
    }

    // Session-bound tokens die together with their device session (logout,
    // remote revocation, refresh-token replay detection).
    if (claims.sid && !(await authSessionService.isSessionActive(claims.sid, user._id))) {
      return res.status(401).json({ error: 'Oturum sonlandırılmış', code: 'SESSION_REVOKED' });
    }

    // Fail closed: an account without tenant attribution must never be
    // silently mapped onto another business (the start-up migration fills
    // legacy accounts, so this only triggers on corrupted data).
    if (typeof user.businessId !== 'string' || !user.businessId.trim()
      || typeof user.branch !== 'string' || !user.branch.trim()) {
      return res.status(403).json({ error: 'Hesabın işletme veya şube ataması eksik', code: 'TENANT_MISSING' });
    }

    req.auth = claims;
    req.user = {
      _id: user._id,
      email: user.email,
      name: user.name || '',
      role: user.role,
      branch: user.branch,
      businessId: user.businessId,
      customPermissions: user.customPermissions || [],
      permissions: getEffectivePermissions(user),
      active: user.active,
      tokenVersion: currentTokenVersion,
      sessionId: claims.sid || null,
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { signToken, verifyToken, authenticate, requireRole };
