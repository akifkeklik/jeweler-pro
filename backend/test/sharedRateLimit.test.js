/**
 * Cluster-wide rate limiting: two limiter instances (= two API processes)
 * share one MongoDB counter, so together they cannot exceed the cap.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { createSharedRateLimit, sharedStoreEnabled, RateLimitCounter } = require('../middleware/sharedRateLimit');

const uri = process.env.MONGO_URI;

function call(mw, ip) {
  return new Promise((resolve) => {
    const res = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.code = code; return this; },
      json(body) { resolve({ status: this.code, body, headers: this.headers }); },
    };
    mw({ ip, body: {} }, res, () => resolve({ status: 200 }));
  });
}

describe('Shared (multi-instance) rate limit', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  before(async () => { await mongoose.connect(uri); await RateLimitCounter.init(); });
  after(async () => { await mongoose.disconnect(); });

  it('is on by default only in strict (production) environments', () => {
    assert.equal(sharedStoreEnabled({ NODE_ENV: 'production' }), true);
    assert.equal(sharedStoreEnabled({ NODE_ENV: 'test' }), false);
    assert.equal(sharedStoreEnabled({ NODE_ENV: 'test', RATE_LIMIT_SHARED_STORE: 'mongo' }), true);
    assert.equal(sharedStoreEnabled({ NODE_ENV: 'production', RATE_LIMIT_SHARED_STORE: 'off' }), false);
  });

  it('two instances together are capped; concurrent hits are counted atomically', async () => {
    const name = `t-${crypto.randomBytes(4).toString('hex')}`;
    const opts = { name, windowMs: 60_000, max: 5, key: (req) => req.ip, enabled: () => true };
    const instanceA = createSharedRateLimit(opts);
    const instanceB = createSharedRateLimit(opts);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => call(i % 2 ? instanceA : instanceB, '10.0.0.1')));
    assert.equal(results.filter((r) => r.status === 200).length, 5);
    const blocked = results.find((r) => r.status === 429);
    assert.equal(blocked.body.code, 'RATE_LIMITED');
    assert.ok(Number(blocked.headers['Retry-After']) >= 1);
    assert.equal((await call(instanceA, '10.0.0.2')).status, 200, 'other keys unaffected');
    const doc = await RateLimitCounter.findOne({ _id: new RegExp(`^${name}\\|`) }).lean();
    assert.ok(doc.expiresAt > new Date(), 'window documents expire via TTL');
  });
});
