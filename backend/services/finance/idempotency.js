/**
 * Idempotent financial commands.
 *
 * Clients send `Idempotency-Key: <8–128 chars [A-Za-z0-9_-:.]>`. The key is
 * scoped per business and command (e.g. "sale.create"). The record is
 * written in the same transaction as the operation:
 *   - same key, same payload   → the original result is returned (replay)
 *   - same key, other payload  → 422 IDEMPOTENCY_KEY_REUSED
 *   - concurrent duplicates    → exactly one executes; the other replays
 * Without a key the command simply executes (backwards compatible).
 */
const crypto = require('node:crypto');
const IdempotencyRecord = require('../../models/IdempotencyRecord');
const { badRequest, unprocessable } = require('./core');

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;

function readKey(req) {
  const raw = req?.headers?.['idempotency-key'];
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !KEY_PATTERN.test(raw)) {
    throw badRequest('Idempotency-Key 8-128 karakter olmalı ve yalnızca harf, rakam, "-", "_", ":" veya "." içermelidir', 'INVALID_IDEMPOTENCY_KEY');
  }
  return raw;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function requestHash(scope, payload) {
  return crypto.createHash('sha256').update(`${scope}\n${stableStringify(payload ?? null)}`).digest('hex');
}

const recordId = (businessId, scope, key) => `${businessId}|${scope}|${key}`;

/** Returns the stored record for a replay, throws on key reuse, null if new. */
async function findExisting(ctx, scope, key, hash) {
  if (!key) return null;
  const existing = await IdempotencyRecord.findById(recordId(ctx.businessId, scope, key)).lean();
  if (!existing) return null;
  if (existing.requestHash !== hash) {
    throw unprocessable('Bu Idempotency-Key farklı bir istek için kullanılmış', 'IDEMPOTENCY_KEY_REUSED');
  }
  return existing;
}

/** Inserts the record inside the operation's transaction. */
async function remember(session, ctx, scope, key, hash, { resourceType, resourceId, statusCode }) {
  if (!key) return;
  await IdempotencyRecord.create([{
    _id: recordId(ctx.businessId, scope, key),
    businessId: ctx.businessId,
    scope,
    requestHash: hash,
    resourceType,
    resourceId: String(resourceId),
    statusCode,
    createdBy: ctx.userId || null,
  }], { session });
}

/**
 * Wraps a command: replays a completed one, otherwise runs `execute()`.
 * If a concurrent request with the same key committed first, the
 * duplicate-key error is turned into a replay of that request.
 * → { replayed: boolean, record?, result? }
 */
async function withIdempotency(ctx, { scope, key, payload }, execute) {
  const hash = requestHash(scope, payload);
  const existing = await findExisting(ctx, scope, key, hash);
  if (existing) return { replayed: true, record: existing };
  try {
    const result = await execute({
      remember: (session, info) => remember(session, ctx, scope, key, hash, info),
    });
    return { replayed: false, result };
  } catch (error) {
    if (key && (error?.code === 11000 || error?.codeName === 'DuplicateKey')) {
      const winner = await findExisting(ctx, scope, key, hash);
      if (winner) return { replayed: true, record: winner };
    }
    throw error;
  }
}

module.exports = { readKey, requestHash, withIdempotency, KEY_PATTERN };
