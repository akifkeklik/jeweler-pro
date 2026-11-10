/**
 * Cluster-wide (multi-instance) rate limiting backed by MongoDB.
 *
 * The in-process limiters (middleware/rateLimit.js) stay the first, precise
 * layer. This layer adds a SHARED cap per key and fixed window, enforced
 * with one atomic upsert ($inc) per request, so N API instances together
 * cannot exceed it and counters survive restarts. Window documents expire
 * through a TTL index.
 *
 * Enabled with RATE_LIMIT_SHARED_STORE=mongo (default in production),
 * disabled with "off" (default in development / test). If the store cannot
 * be reached the request is refused (503): authentication endpoints depend
 * on the same database, so failing closed loses nothing.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { resolveEnvironment } = require('../config/environment');

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
}, { versionKey: false, collection: 'rate_limit_counters' });
counterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const RateLimitCounter = mongoose.models.RateLimitCounter || mongoose.model('RateLimitCounter', counterSchema);

function sharedStoreEnabled(env = process.env) {
  const mode = String(env.RATE_LIMIT_SHARED_STORE || '').trim().toLowerCase();
  if (mode === 'mongo') return true;
  if (mode === 'off') return false;
  return resolveEnvironment(env).strict; // production (and unknown, fail-safe) environments
}

const digest = (text) => crypto.createHash('sha256').update(String(text)).digest('base64url').slice(0, 32);

/** Atomically counts one hit; → { count, resetAt }. */
async function hit(name, key, windowMs, now = Date.now()) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const _id = `${name}|${digest(key)}|${windowStart}`;
  const doc = await RateLimitCounter.findOneAndUpdate(
    { _id },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(windowStart + windowMs * 2) } },
    { upsert: true, new: true, lean: true },
  );
  return { count: doc.count, resetAt: windowStart + windowMs };
}

function createSharedRateLimit({
  name, windowMs, max, key, message = 'Çok fazla istek. Bir süre sonra tekrar deneyin.', code = 'RATE_LIMITED', enabled = sharedStoreEnabled,
}) {
  if (!name || !Number.isSafeInteger(windowMs) || !Number.isSafeInteger(max)) throw new Error('shared rate limit needs name, windowMs, max');
  return async function sharedRateLimit(req, res, next) {
    if (!enabled()) return next();
    const k = key(req);
    if (k === null || k === undefined || k === '') return next();
    try {
      const { count, resetAt } = await hit(name, k, windowMs);
      if (count > max) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
        return res.status(429).json({ error: message, code });
      }
      return next();
    } catch (error) {
      console.error(`[rate-limit:${name}] paylaşılan sayaç erişilemedi:`, error.message);
      return res.status(503).json({ error: 'Hizmet geçici olarak kullanılamıyor', code: 'RATE_LIMIT_STORE_UNAVAILABLE' });
    }
  };
}

module.exports = { createSharedRateLimit, sharedStoreEnabled, hit, RateLimitCounter };
