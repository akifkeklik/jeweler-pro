const mongoose = require('mongoose');
const AuthSession = require('../models/AuthSession');
const { getAuthConfig } = require('../config/authConfig');
const { sha256Hex, generateOpaqueToken, isOpaqueToken } = require('../utils/passwords');

const REFRESH_TOKEN_BYTES = 48;
const PREVIOUS_HASHES_KEPT = 5;

function clientContext(req) {
  return {
    ip: String(req?.ip || req?.socket?.remoteAddress || '').slice(0, 64),
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 300),
  };
}

function ttlFor(persistent) {
  const config = getAuthConfig();
  return persistent ? config.rememberMeTtlSeconds : config.sessionTtlSeconds;
}

/**
 * Creates a new device session and returns the raw refresh token exactly once.
 */
async function createSession(user, { persistent, req } = {}) {
  const rawToken = generateOpaqueToken(REFRESH_TOKEN_BYTES);
  const now = Date.now();
  const session = await AuthSession.create({
    userId: user._id,
    businessId: user.businessId || '',
    tokenHash: sha256Hex(rawToken),
    persistent: Boolean(persistent),
    tokenVersion: Number.isSafeInteger(user.tokenVersion) ? user.tokenVersion : 0,
    expiresAt: new Date(now + ttlFor(persistent) * 1000),
    lastUsedAt: new Date(now),
    ...clientContext(req),
  });

  await enforceSessionLimit(user._id);
  return { session, rawToken };
}

async function enforceSessionLimit(userId) {
  const { maxActiveSessionsPerUser } = getAuthConfig();
  const active = await AuthSession.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .select('_id')
    .lean();
  const overflow = active.slice(maxActiveSessionsPerUser).map((s) => s._id);
  if (overflow.length) {
    await AuthSession.updateMany(
      { _id: { $in: overflow } },
      { $set: { revokedAt: new Date(), revokedReason: 'session_limit' } },
    );
  }
}

/**
 * Atomically rotates a refresh token.
 * Result kinds:
 *  - ok:      { session, rawToken } new token issued
 *  - race:    token was rotated moments ago by a parallel request (cookie already replaced)
 *  - reused:  an old token was replayed after the grace window — session revoked
 *  - invalid: unknown, expired or revoked
 */
async function rotateSession(rawToken, { req } = {}) {
  if (!isOpaqueToken(rawToken, REFRESH_TOKEN_BYTES)) return { kind: 'invalid' };

  const presentedHash = sha256Hex(rawToken);
  const now = new Date();
  const newRawToken = generateOpaqueToken(REFRESH_TOKEN_BYTES);

  const session = await AuthSession.findOneAndUpdate(
    { tokenHash: presentedHash, revokedAt: null, expiresAt: { $gt: now } },
    {
      $set: {
        tokenHash: sha256Hex(newRawToken),
        rotatedAt: now,
        lastUsedAt: now,
        ...clientContext(req),
      },
      $push: { previousTokenHashes: { $each: [presentedHash], $slice: -PREVIOUS_HASHES_KEPT } },
    },
    { new: true },
  );

  if (session) return { kind: 'ok', session, rawToken: newRawToken };

  const replayed = await AuthSession.findOne({ previousTokenHashes: presentedHash });
  if (!replayed || replayed.revokedAt || replayed.expiresAt <= now) {
    return { kind: 'invalid', session: replayed || null };
  }

  const { refreshReuseGraceSeconds } = getAuthConfig();
  const isLatestPrevious = replayed.previousTokenHashes[replayed.previousTokenHashes.length - 1] === presentedHash;
  const withinGrace = replayed.rotatedAt
    && now.getTime() - replayed.rotatedAt.getTime() <= refreshReuseGraceSeconds * 1000;

  if (isLatestPrevious && withinGrace) {
    return { kind: 'race', session: replayed };
  }

  await revokeSession(replayed._id, 'refresh_token_reuse');
  return { kind: 'reused', session: replayed };
}

async function findSessionByRawToken(rawToken) {
  if (!isOpaqueToken(rawToken, REFRESH_TOKEN_BYTES)) return null;
  return AuthSession.findOne({ tokenHash: sha256Hex(rawToken) });
}

async function revokeSession(sessionId, reason = 'logout', { userId } = {}) {
  if (!mongoose.isValidObjectId(sessionId)) return false;
  const filter = { _id: sessionId, revokedAt: null };
  if (userId) filter.userId = userId;
  const result = await AuthSession.updateOne(filter, {
    $set: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.modifiedCount > 0;
}

async function revokeAllForUser(userId, reason = 'revoke_all', { exceptSessionId } = {}) {
  const filter = { userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  const result = await AuthSession.updateMany(filter, {
    $set: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.modifiedCount;
}

async function isSessionActive(sessionId, userId) {
  if (!mongoose.isValidObjectId(sessionId)) return false;
  const exists = await AuthSession.exists({
    _id: sessionId,
    userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  return Boolean(exists);
}

async function listActiveSessions(userId) {
  return AuthSession.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .select('persistent expiresAt lastUsedAt createdAt ip userAgent')
    .lean();
}

module.exports = {
  REFRESH_TOKEN_BYTES,
  createSession,
  rotateSession,
  findSessionByRawToken,
  revokeSession,
  revokeAllForUser,
  isSessionActive,
  listActiveSessions,
};
