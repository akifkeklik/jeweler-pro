/**
 * Cluster-wide rate limiting: two limiter instances (= two API processes)
 * share one MongoDB counter, so together they cannot exceed the cap.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const http = require('node:http');
const express = require('express');
const {
  createSharedRateLimit, sharedStoreEnabled, RateLimitCounter, MongoRateLimitStore,
} = require('../middleware/sharedRateLimit');
const { createApiRateLimit } = require('../middleware/apiRateLimit');
const errorHandler = require('../middleware/errorHandler');

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

  it('the general API limit is one budget across API instances', async () => {
    // Two express apps = two API processes, both limited to 3 requests a minute.
    const start = async () => {
      const app = express();
      app.use(createApiRateLimit({ limit: 3, shared: true }));
      app.get('/x', (req, res) => res.json({ ok: true }));
      app.use(errorHandler);
      return new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    };
    const get = (server) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.address().port, path: '/x' }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
    });
    await RateLimitCounter.deleteMany({ _id: /^api\|/ });
    const [a, b] = [await start(), await start()];
    try {
      const statuses = [];
      for (const server of [a, b, a, b, a]) statuses.push((await get(server)).status);
      assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
      const refused = await get(b);
      assert.equal(JSON.parse(refused.body).code, 'RATE_LIMITED');
      assert.ok(refused.headers['retry-after']);
    } finally {
      await Promise.all([a, b].map((s) => new Promise((resolve) => s.close(resolve))));
      await RateLimitCounter.deleteMany({ _id: /^api\|/ });
    }
  });

  it('the API store fails closed (503) when the counters cannot be reached', async () => {
    const store = new MongoRateLimitStore({ name: 'api-down', hitFn: async () => { throw new Error('connection refused'); } });
    store.init({ windowMs: 60_000 });
    await assert.rejects(store.increment('10.0.0.9'), (error) => error.statusCode === 503 && error.code === 'RATE_LIMIT_STORE_UNAVAILABLE');
  });

  it('decrement and resetKey act on the current window only', async () => {
    const store = new MongoRateLimitStore({ name: `d-${crypto.randomBytes(4).toString('hex')}` });
    store.init({ windowMs: 60_000 });
    await store.increment('k');
    await store.increment('k');
    await store.decrement('k');
    assert.equal((await store.increment('k')).totalHits, 2);
    await store.resetKey('k');
    assert.equal((await store.increment('k')).totalHits, 1);
  });
});
