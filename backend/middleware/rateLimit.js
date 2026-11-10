/**
 * Bounded in-memory fixed-window rate limiting.
 *
 * ─── Complexity & memory (security finding H1) ─────────────────────────────
 * The previous implementation scanned the whole table synchronously on every
 * request once it held ≥1000 keys, and had no size limit; an attacker rotating
 * keys (IPs, e-mail addresses) could grow it without bound and block the event
 * loop. This store guarantees:
 * - a hard cap of `maxEntries` keys per limiter (default 10 000, env
 *   RATE_LIMIT_MAX_ENTRIES); measured cost ≈ 150 bytes per key, i.e. ≈ 1.4 MB
 *   per limiter at the default cap (test/rateLimitHardening.test.js, SECURITY.md);
 * - O(1) work per request: expiry cleanup is incremental with a fixed budget
 *   (SWEEP_BUDGET entries per request, more only under capacity pressure),
 *   never a full scan;
 * - keys longer than MAX_KEY_LENGTH are replaced by their SHA-256 digest.
 *
 * ─── Eviction-attack resistance ────────────────────────────────────────────
 * Keys live in one of two tables:
 *   probation   – seen once in the current window (count = 1)
 *   established – count ≥ 2, or already at the limit
 * When the cap is reached, only the oldest *probation* entry is evicted. A
 * counter that matters (repeated attempts, and every blocked key) is never
 * evicted, so flooding the table with fresh keys cannot reset an attacker's
 * own blocked counter or anyone else's meaningful counter. Evicting a
 * probation entry forgets at most one attempt; each such eviction costs the
 * attacker `maxEntries` fresh keys, which the outer per-IP limits bound.
 *
 * ─── Capacity exhausted (explicit, fail closed) ────────────────────────────
 * If every slot is held by a live established counter, NEW keys are refused
 * with 429 / code RATE_LIMIT_CAPACITY_EXHAUSTED (already tracked keys keep
 * their normal behaviour). A warning is logged at most once per window.
 *
 * ─── Deployment guarantees ─────────────────────────────────────────────────
 * State is per process. With one API process the limits below are exact.
 * With N processes/replicas each process counts on its own, so the shared
 * MongoDB layer (middleware/sharedRateLimit.js, on by default in production)
 * caps login / forgot / reset and the general API limit cluster-wide.
 * Start-up warns in production when that shared store is switched off.
 *
 * Client IP: req.ip, which honours Express "trust proxy" (see
 * config/runtimeConfig.js). X-Forwarded-For is never read directly.
 */
const crypto = require('node:crypto');
const { normalizeIp, rateLimitIdentity } = require('../utils/ipAddress');
const { normalizeEmail } = require('../utils/accountIdentity');

const MAX_KEY_LENGTH = 128;
const SWEEP_BUDGET = 16;
const PRESSURE_SWEEP_BUDGET = 256;
const DEFAULT_MAX_ENTRIES = 10_000;
const MIN_MAX_ENTRIES = 100;
const MAX_MAX_ENTRIES = 1_000_000;

const registry = new Set();

function defaultMaxEntries(env = process.env) {
  const raw = env.RATE_LIMIT_MAX_ENTRIES;
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_MAX_ENTRIES;
  const value = Number(raw);
  // runtimeConfig rejects invalid values at start-up; fall back safely here.
  return Number.isSafeInteger(value) && value >= MIN_MAX_ENTRIES && value <= MAX_MAX_ENTRIES
    ? value
    : DEFAULT_MAX_ENTRIES;
}

/** Bounded, printable limiter key; long keys are digested so key memory is fixed. */
function normalizeLimiterKey(key) {
  const text = String(key);
  if (text.length <= MAX_KEY_LENGTH) return text;
  return `h:${crypto.createHash('sha256').update(text).digest('base64url')}`;
}

class BoundedCounterStore {
  constructor({ windowMs, max, maxEntries = defaultMaxEntries() }) {
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) throw new Error('windowMs must be a positive integer');
    if (!Number.isSafeInteger(max) || max <= 0) throw new Error('max must be a positive integer');
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new Error('maxEntries must be a positive integer');
    this.windowMs = windowMs;
    this.max = max;
    this.maxEntries = maxEntries;
    this.reset();
  }

  reset() {
    // Insertion order of `probation` equals expiry order (fixed window, entries
    // are only ever appended), so expired entries are always at its head.
    this.probation = new Map();
    this.established = new Map();
    this.cursor = null;
    this.counters = { evictions: 0, capacityRejections: 0, expired: 0, maxWorkPerCall: 0 };
  }

  get size() {
    return this.probation.size + this.established.size;
  }

  /** Removes up to `budget` expired entries; returns the number of entries examined. */
  sweep(now, budget) {
    let work = 0;
    for (const [key, entry] of this.probation) {
      if (work >= budget || entry.resetAt > now) break;
      this.probation.delete(key);
      this.counters.expired += 1;
      work += 1;
    }
    // Established entries are not expiry-ordered; a persistent cursor walks
    // the table incrementally (Map iterators survive concurrent deletes).
    let steps = 0;
    while (steps < budget && this.established.size) {
      if (!this.cursor) this.cursor = this.established.entries();
      const next = this.cursor.next();
      if (next.done) { this.cursor = null; break; }
      steps += 1;
      const [key, entry] = next.value;
      if (entry.resetAt <= now) {
        this.established.delete(key);
        this.counters.expired += 1;
      }
    }
    return work + steps;
  }

  lookup(key) {
    const p = this.probation.get(key);
    if (p) return { entry: p, table: this.probation };
    const e = this.established.get(key);
    return e ? { entry: e, table: this.established } : null;
  }

  trackWork(work) {
    if (work > this.counters.maxWorkPerCall) this.counters.maxWorkPerCall = work;
  }

  /**
   * Counts one attempt for `key`.
   * → { allowed: true, entry } | { allowed: false, reason: 'limit' | 'capacity', retryAfterMs }
   */
  hit(key, now = Date.now()) {
    let work = this.sweep(now, SWEEP_BUDGET);
    let found = this.lookup(key);
    if (found && found.entry.resetAt <= now) {
      found.table.delete(key);
      found = null;
    }

    if (!found) {
      if (this.size >= this.maxEntries) {
        work += this.sweep(now, PRESSURE_SWEEP_BUDGET);
        if (this.size >= this.maxEntries) {
          const oldest = this.probation.keys().next();
          if (oldest.done) {
            this.counters.capacityRejections += 1;
            this.trackWork(work);
            return { allowed: false, reason: 'capacity', retryAfterMs: this.windowMs };
          }
          this.probation.delete(oldest.value);
          this.counters.evictions += 1;
          work += 1;
        }
      }
      const entry = { count: 1, resetAt: now + this.windowMs };
      (this.max <= 1 ? this.established : this.probation).set(key, entry);
      this.trackWork(work);
      return { allowed: true, entry };
    }

    const { entry, table } = found;
    this.trackWork(work);
    if (entry.count >= this.max) {
      return { allowed: false, reason: 'limit', retryAfterMs: entry.resetAt - now };
    }
    entry.count += 1;
    if (table === this.probation && (entry.count >= 2 || entry.count >= this.max)) {
      this.probation.delete(key);
      this.established.set(key, entry);
    }
    return { allowed: true, entry };
  }

  /** Is `key` currently at its limit? (no side effects besides lazy expiry) */
  isBlocked(key, now = Date.now()) {
    const found = this.lookup(key);
    return Boolean(found && found.entry.resetAt > now && found.entry.count >= this.max);
  }

  /**
   * Gives one attempt back (e.g. the attempt turned out to be a successful
   * login). Only applies to the very same window entry that was charged.
   */
  refund(key, entry) {
    const found = this.lookup(key);
    if (!found || found.entry !== entry || entry.count <= 0) return false;
    entry.count -= 1;
    if (entry.count === 0) found.table.delete(key);
    return true;
  }

  stats() {
    return {
      size: this.size,
      probation: this.probation.size,
      established: this.established.size,
      maxEntries: this.maxEntries,
      ...this.counters,
    };
  }
}

/**
 * Bounded set of keys with a fixed time-to-live. When full, the oldest key is
 * dropped — callers must only store *privileges that are safe to forget*
 * (forgetting makes the caller stricter, never more permissive).
 */
class BoundedExpiringSet {
  constructor({ ttlMs, maxEntries = defaultMaxEntries() }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  reset() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }

  sweep(now) {
    let work = 0;
    for (const [key, expiresAt] of this.entries) {
      if (work >= SWEEP_BUDGET || expiresAt > now) break;
      this.entries.delete(key);
      work += 1;
    }
  }

  add(key, now = Date.now()) {
    this.sweep(now);
    this.entries.delete(key); // re-append keeps insertion order == expiry order
    while (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
    this.entries.set(key, now + this.ttlMs);
  }

  has(key, now = Date.now()) {
    this.sweep(now);
    const expiresAt = this.entries.get(key);
    return expiresAt !== undefined && expiresAt > now;
  }
}

const capacityWarnings = new Map();
function warnCapacityExhausted(name, windowMs, logger = console) {
  const now = Date.now();
  if ((capacityWarnings.get(name) || 0) > now) return;
  capacityWarnings.set(name, now + windowMs);
  logger.warn(`[rate-limit] "${name}" kapasitesi doldu; yeni istemciler pencere sonuna kadar reddediliyor (olası dağıtık saldırı).`);
}

function sendRateLimited(res, { retryAfterMs, message, code }) {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  res.set('Retry-After', String(retryAfterSeconds));
  return res.status(429).json({ error: message, code, retryAfterSeconds });
}

const CAPACITY_MESSAGE = 'Sunucu şu anda yoğun saldırı koruması altında. Lütfen birkaç dakika sonra tekrar deneyin.';

function createRateLimiter({
  name = 'rate-limit',
  windowMs,
  max,
  key = (req) => `ip:${rateLimitIp(req)}`,
  message = 'Çok fazla deneme yapıldı. Bir süre sonra tekrar deneyin.',
  code = 'RATE_LIMITED',
  maxEntries,
}) {
  const store = new BoundedCounterStore({ windowMs, max, ...(maxEntries ? { maxEntries } : {}) });

  /** Charges one attempt. → null (not limited) | { allowed, key, entry, reason, retryAfterMs } */
  function consume(req, now = Date.now()) {
    const raw = key(req);
    if (raw === null || raw === undefined) return null;
    const k = normalizeLimiterKey(raw);
    return { key: k, ...store.hit(k, now) };
  }

  function respondBlocked(res, result) {
    if (result.reason === 'capacity') {
      warnCapacityExhausted(name, windowMs);
      return sendRateLimited(res, { retryAfterMs: result.retryAfterMs, message: CAPACITY_MESSAGE, code: 'RATE_LIMIT_CAPACITY_EXHAUSTED' });
    }
    return sendRateLimited(res, { retryAfterMs: result.retryAfterMs, message, code });
  }

  function limiter(req, res, next) {
    const result = consume(req);
    if (!result || result.allowed) return next();
    return respondBlocked(res, result);
  }

  limiter.limiterName = name;
  limiter.store = store;
  limiter.consume = consume;
  limiter.respondBlocked = respondBlocked;
  limiter.refund = (ticket) => Boolean(ticket?.allowed && store.refund(ticket.key, ticket.entry));
  limiter.isBlocked = (rawKey, now) => store.isBlocked(normalizeLimiterKey(rawKey), now);
  limiter.stats = () => store.stats();
  limiter.reset = () => store.reset();
  registry.add(limiter);
  return limiter;
}

/** Registers any object with a reset() method (composite limiters, trust stores). */
function registerResettable(resettable) {
  registry.add(resettable);
  return resettable;
}

function resetAllRateLimiters() {
  for (const limiter of registry) limiter.reset();
  capacityWarnings.clear();
}

function clientIp(req) {
  return normalizeIp(req.ip || req.socket?.remoteAddress);
}

/** Rate-limit identity of the caller: IPv4 address or IPv6 /64 (see utils/ipAddress). */
function rateLimitIp(req) {
  return rateLimitIdentity(req.ip || req.socket?.remoteAddress);
}

function normalizedEmail(req) {
  return normalizeEmail(req.body?.email).slice(0, 254);
}

module.exports = {
  MAX_KEY_LENGTH,
  SWEEP_BUDGET,
  PRESSURE_SWEEP_BUDGET,
  DEFAULT_MAX_ENTRIES,
  MIN_MAX_ENTRIES,
  MAX_MAX_ENTRIES,
  BoundedCounterStore,
  BoundedExpiringSet,
  createRateLimiter,
  registerResettable,
  resetAllRateLimiters,
  sendRateLimited,
  normalizeLimiterKey,
  defaultMaxEntries,
  clientIp,
  rateLimitIp,
  normalizeIp,
  normalizedEmail,
};
