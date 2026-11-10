/**
 * Rate-limit hardening regression tests (pure unit tests, no database).
 *
 * H1  bounded store: 10k/30k/50k distinct keys, rotating e-mails, expiry,
 *     capacity exhaustion, eviction attacks, event-loop responsiveness, memory
 * M1  multi-dimensional login protection (IP, account, IP+account)
 * L6  IPv4 / IPv6 / mapped IPv6 identities and the price-refresh limiter
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');

const {
  BoundedCounterStore,
  createRateLimiter,
  normalizeLimiterKey,
  MAX_KEY_LENGTH,
  SWEEP_BUDGET,
  PRESSURE_SWEEP_BUDGET,
  DEFAULT_MAX_ENTRIES,
} = require('../middleware/rateLimit');
const { createLoginRateLimit } = require('../middleware/loginRateLimit');
const priceRefreshRateLimit = require('../middleware/priceRateLimit');
const { priceRefreshKey } = require('../middleware/priceRateLimit');
const { rateLimitIdentity, normalizeIp } = require('../utils/ipAddress');
const { accountLimiterKey, normalizeEmail } = require('../utils/accountIdentity');

// Worst case entries examined in one call: normal sweep (probation + cursor),
// pressure sweep (probation + cursor) and one eviction.
const MAX_WORK_PER_CALL = 2 * SWEEP_BUDGET + 2 * PRESSURE_SWEEP_BUDGET + 1;

const ipv4 = (i) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
const fakeReq = (ip, body = {}, extra = {}) => ({ ip, socket: { remoteAddress: ip }, body, headers: {}, ...extra });

function fakeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.body = undefined;
  res.set = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

/** Runs a middleware; returns { passed, res }. `outcome` simulates the handler's final status. */
function run(middleware, req, outcome) {
  const res = fakeRes();
  let passed = false;
  middleware(req, res, () => { passed = true; });
  if (passed && outcome !== undefined) {
    res.statusCode = outcome;
    res.emit('finish');
  }
  return { passed, res };
}

describe('H1 — bounded rate-limit store', () => {
  for (const n of [10_000, 30_000, 50_000]) {
    it(`${n} distinct keys: memory-bounded table, O(1) work per request, legitimate first attempts served`, () => {
      const limiter = createRateLimiter({ name: `distinct-${n}`, windowMs: 60_000, max: 5 });
      let slowest = 0;
      const started = performance.now();
      for (let i = 0; i < n; i += 1) {
        const t = performance.now();
        const result = limiter.consume(fakeReq(ipv4(i)));
        slowest = Math.max(slowest, performance.now() - t);
        assert.equal(result.allowed, true, `key ${i}`);
      }
      const elapsed = performance.now() - started;
      const stats = limiter.stats();
      assert.ok(stats.size <= DEFAULT_MAX_ENTRIES, `size ${stats.size} exceeds cap`);
      assert.equal(stats.size, Math.min(n, DEFAULT_MAX_ENTRIES));
      assert.equal(stats.evictions, Math.max(0, n - DEFAULT_MAX_ENTRIES));
      assert.ok(stats.maxWorkPerCall <= MAX_WORK_PER_CALL, `work per call ${stats.maxWorkPerCall}`);
      // Generous wall-clock bounds (CI noise); the deterministic bound is maxWorkPerCall.
      assert.ok(elapsed < 5000, `${n} requests took ${elapsed.toFixed(0)} ms`);
      assert.ok(slowest < 100, `slowest single request ${slowest.toFixed(2)} ms`);
    });
  }

  it('worst case — full table of expired established counters: cleanup is incremental, never a full scan', () => {
    const store = new BoundedCounterStore({ windowMs: 1000, max: 5, maxEntries: 50_000 });
    for (let i = 0; i < 50_000; i += 1) {
      store.hit(`k${i}`, 0);
      store.hit(`k${i}`, 0); // established (not expiry-ordered, needs the cursor)
    }
    assert.equal(store.size, 50_000);
    store.counters.maxWorkPerCall = 0;
    // Everything is expired now; the old implementation scanned all 50k entries in one call.
    for (let i = 0; i < 5000; i += 1) store.hit(`new${i}`, 2000);
    assert.ok(store.counters.maxWorkPerCall <= MAX_WORK_PER_CALL, `work ${store.counters.maxWorkPerCall}`);
    assert.ok(store.stats().expired > 0);
    // Continued traffic eventually reclaims all expired entries.
    for (let i = 5000; i < 60_000; i += 1) store.hit(`new${i}`, 2000);
    assert.equal(store.stats().established, 0, 'all expired established counters reclaimed');
  });

  it('expired entries: a key starts a fresh window and stale keys are reclaimed by later traffic', () => {
    const store = new BoundedCounterStore({ windowMs: 1000, max: 2, maxEntries: 1000 });
    for (let i = 0; i < 500; i += 1) store.hit(`old${i}`, 0);
    assert.equal(store.hit('victim', 0).allowed, true);
    assert.equal(store.hit('victim', 10).allowed, true);
    assert.equal(store.hit('victim', 20).reason, 'limit');
    assert.equal(store.isBlocked('victim', 20), true);
    // Window over: fresh window for the same key.
    assert.equal(store.hit('victim', 1500).allowed, true);
    for (let i = 0; i < 100; i += 1) store.hit(`fresh${i}`, 1500);
    assert.ok(store.stats().expired >= 500, `expired reclaimed: ${store.stats().expired}`);
    assert.ok(store.size <= 102, `size after expiry: ${store.size}`);
  });

  it('capacity exhaustion: new keys are refused explicitly (429 RATE_LIMIT_CAPACITY_EXHAUSTED), tracked keys keep working', () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
      const limiter = createRateLimiter({ name: 'capacity-test', windowMs: 60_000, max: 3, maxEntries: 100 });
      for (let i = 0; i < 100; i += 1) {
        run(limiter, fakeReq(ipv4(i)));
        run(limiter, fakeReq(ipv4(i))); // count 2 → established, not evictable
      }
      assert.equal(limiter.stats().established, 100);
      const refused = run(limiter, fakeReq('192.0.2.1'));
      assert.equal(refused.passed, false);
      assert.equal(refused.res.statusCode, 429);
      assert.equal(refused.res.body.code, 'RATE_LIMIT_CAPACITY_EXHAUSTED');
      assert.ok(Number(refused.res.headers['retry-after']) > 0);
      assert.equal(limiter.stats().capacityRejections, 1);
      // An already tracked client is unaffected: 3rd attempt allowed, 4th limited normally.
      assert.equal(run(limiter, fakeReq(ipv4(7))).passed, true);
      const limited = run(limiter, fakeReq(ipv4(7)));
      assert.equal(limited.res.body.code, 'RATE_LIMITED');
      assert.equal(limiter.stats().size, 100, 'cap is never exceeded');
      assert.equal(warnings.filter((w) => w.includes('capacity-test')).length, 1, 'warning logged once per window');
    } finally {
      console.warn = origWarn;
    }
  });

  it('capacity recovers once the window passes', () => {
    const store = new BoundedCounterStore({ windowMs: 1000, max: 3, maxEntries: 50 });
    for (let i = 0; i < 50; i += 1) { store.hit(`k${i}`, 0); store.hit(`k${i}`, 0); }
    assert.equal(store.hit('late', 10).reason, 'capacity');
    assert.equal(store.hit('late', 1001).allowed, true, 'expired counters free their slots');
  });

  it('eviction attack: flooding fresh keys cannot reset a blocked counter or an established legitimate counter', () => {
    const store = new BoundedCounterStore({ windowMs: 60_000, max: 3, maxEntries: 100 });
    for (let i = 0; i < 3; i += 1) assert.equal(store.hit('attacker', 1).allowed, true);
    assert.equal(store.hit('attacker', 1).reason, 'limit');
    store.hit('legit', 1);
    store.hit('legit', 1); // count 2
    for (let i = 0; i < 100_000; i += 1) store.hit(`flood${i}`, 2);
    assert.ok(store.stats().evictions > 90_000, 'flood keys were evicted among themselves');
    assert.equal(store.hit('attacker', 3).reason, 'limit', 'blocked counter survived the flood');
    assert.equal(store.lookup('legit').entry.count, 2, 'established counter survived the flood');
    assert.ok(store.size <= 100);
  });

  it('a limit of 1 (price refresh) is never evictable either', () => {
    const store = new BoundedCounterStore({ windowMs: 60_000, max: 1, maxEntries: 10 });
    store.hit('user', 0);
    for (let i = 0; i < 1000; i += 1) store.hit(`flood${i}`, 1);
    assert.equal(store.hit('user', 2).reason, 'limit');
  });

  it('event loop stays responsive while 50k distinct keys hit a full limiter', async () => {
    const limiter = createRateLimiter({ name: 'event-loop', windowMs: 60_000, max: 10, maxEntries: 10_000 });
    for (let i = 0; i < 10_000; i += 1) { limiter.consume(fakeReq(ipv4(i))); limiter.consume(fakeReq(ipv4(i))); }
    const histogram = monitorEventLoopDelay({ resolution: 5 });
    histogram.enable();
    for (let batch = 0; batch < 50; batch += 1) {
      for (let i = 0; i < 1000; i += 1) limiter.consume(fakeReq(`2001:db8:${batch}:${i}::1`));
      await new Promise((resolve) => setImmediate(resolve));
    }
    histogram.disable();
    const maxDelayMs = histogram.max / 1e6;
    assert.ok(maxDelayMs < 250, `event loop blocked for ${maxDelayMs.toFixed(1)} ms`);
    assert.ok(limiter.stats().maxWorkPerCall <= MAX_WORK_PER_CALL);
  });

  it('keys are normalised and length-bounded', () => {
    const long = 'x'.repeat(10_000);
    const key = normalizeLimiterKey(long);
    assert.ok(key.length <= MAX_KEY_LENGTH, `key length ${key.length}`);
    assert.equal(normalizeLimiterKey(long), key, 'deterministic');
    assert.notEqual(normalizeLimiterKey(`${long}y`), key);
    const limiter = createRateLimiter({ name: 'long-keys', windowMs: 1000, max: 1, key: (req) => req.body.k });
    limiter.consume({ body: { k: long } });
    assert.ok([...limiter.store.probation.keys(), ...limiter.store.established.keys()].every((k) => k.length <= MAX_KEY_LENGTH));
  });

  it('memory: bytes per entry measured, growth bounded under unlimited key rotation (separate --expose-gc process)', () => {
    const modulePath = path.join(__dirname, '..', 'middleware', 'rateLimit.js');
    const script = `
      const { createRateLimiter } = require(${JSON.stringify(modulePath)});
      const ip = (i) => '10.' + ((i >> 16) & 255) + '.' + ((i >> 8) & 255) + '.' + (i & 255);
      const heap = () => { global.gc(); global.gc(); return process.memoryUsage().heapUsed; };
      const out = {};
      for (const cap of [10000, 50000]) {
        const base = heap();
        const l = createRateLimiter({ name: 'mem' + cap, windowMs: 3600000, max: 5, maxEntries: cap });
        // worst case: every entry established (count 2)
        for (let i = 0; i < cap; i += 1) { const r = { ip: ip(i), body: {} }; l.consume(r); l.consume(r); }
        const filled = heap();
        for (let i = 0; i < 300000; i += 1) l.consume({ ip: '2001:db8:' + i.toString(16) + '::1', body: {} });
        const rotated = heap();
        out[cap] = { size: l.stats().size, perEntry: (filled - base) / cap, rotationGrowth: rotated - filled, refused: l.stats().capacityRejections };
      }
      console.log(JSON.stringify(out));
    `;
    const child = spawnSync(process.execPath, ['--expose-gc', '-e', script], { encoding: 'utf8', timeout: 120_000 });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.trim().split('\n').pop());
    for (const cap of ['10000', '50000']) {
      const r = result[cap];
      assert.equal(r.size, Number(cap), `cap ${cap}: size`);
      assert.ok(r.perEntry < 400, `cap ${cap}: ${r.perEntry.toFixed(0)} bytes per entry`);
      // 300k rotating keys against a full established table add no entries.
      assert.ok(r.rotationGrowth < 1024 * 1024, `cap ${cap}: grew ${r.rotationGrowth} bytes under rotation`);
      assert.equal(r.refused, 300000);
    }
    // Documented projection (SECURITY.md): default cap ≈ 2 MB per limiter table.
    assert.ok(result['10000'].perEntry * 10_000 < 4 * 1024 * 1024);
  });
});

describe('M1 — multi-dimensional login protection', () => {
  const email = (i) => `user${i}@example.com`;

  it('IP + account: the 11th attempt for one account from one IP is blocked; other accounts are not', () => {
    const limit = createLoginRateLimit();
    for (let i = 0; i < 10; i += 1) assert.equal(run(limit, fakeReq('203.0.113.5', { email: 'A@x.test' }), 401).passed, true);
    const blocked = run(limit, fakeReq('203.0.113.5', { email: ' a@x.test ' }), 401);
    assert.equal(blocked.passed, false);
    assert.equal(blocked.res.statusCode, 429);
    assert.equal(run(limit, fakeReq('203.0.113.5', { email: 'b@x.test' }), 401).passed, true);
  });

  it('password spraying: rotating e-mail addresses from one IP is stopped by the per-IP limit', () => {
    const limit = createLoginRateLimit({ ipMax: 30 });
    let allowed = 0;
    for (let i = 0; i < 1000; i += 1) if (run(limit, fakeReq('198.51.100.7', { email: email(i) }), 401).passed) allowed += 1;
    assert.equal(allowed, 30);
    // The IP gate also bounds how many account keys one source can create.
    assert.ok(limit.limiters.account.stats().size <= 30, `account table ${limit.limiters.account.stats().size}`);
    assert.ok(limit.limiters.pair.stats().size <= 30);
  });

  it('IP rotation: distributed brute force on one account is stopped by the per-account limit', () => {
    const limit = createLoginRateLimit({ accountMax: 20 });
    let allowed = 0;
    for (let i = 0; i < 500; i += 1) if (run(limit, fakeReq(ipv4(i), { email: 'victim@x.test' }), 401).passed) allowed += 1;
    assert.equal(allowed, 20);
  });

  it('IPv6 privacy-address rotation inside one /64 counts as one source', () => {
    const limit = createLoginRateLimit({ ipMax: 30 });
    let allowed = 0;
    for (let i = 0; i < 200; i += 1) {
      const addr = `2001:db8:aa:bb:${i.toString(16)}:${(i * 7).toString(16)}:1:2`;
      if (run(limit, fakeReq(addr, { email: email(i) }), 401).passed) allowed += 1;
    }
    assert.equal(allowed, 30);
  });

  it('account lockout DoS: a known client of the owner still gets in; unknown networks stay blocked', () => {
    const limit = createLoginRateLimit({ accountMax: 20, pairMax: 10 });
    const owner = '192.0.2.10';
    assert.equal(run(limit, fakeReq(owner, { email: 'owner@x.test' }), 200).passed, true, 'owner logs in once');
    for (let i = 0; i < 100; i += 1) run(limit, fakeReq(ipv4(i), { email: 'owner@x.test' }), 401);
    assert.equal(run(limit, fakeReq('198.51.100.99', { email: 'owner@x.test' }), 401).passed, false, 'attacker network blocked');
    assert.equal(run(limit, fakeReq(owner, { email: 'owner@x.test' }), 200).passed, true, 'owner not locked out');
    // The owner's own network is still bounded by its IP + account limit.
    for (let i = 0; i < 10; i += 1) run(limit, fakeReq(owner, { email: 'owner@x.test' }), 401);
    assert.equal(run(limit, fakeReq(owner, { email: 'owner@x.test' }), 401).passed, false);
  });

  it('successful logins are refunded: many staff behind one shop NAT are never blocked', () => {
    const limit = createLoginRateLimit({ ipMax: 30 });
    for (let i = 0; i < 300; i += 1) assert.equal(run(limit, fakeReq('203.0.113.50', { email: email(i % 25) }), 200).passed, true);
  });

  it('parallel in-flight attempts are charged up front (no burst bypass)', () => {
    const limit = createLoginRateLimit({ pairMax: 10 });
    // No 'finish' yet — all requests are still in flight.
    const results = Array.from({ length: 25 }, () => run(limit, fakeReq('203.0.113.9', { email: 'burst@x.test' })));
    assert.equal(results.filter((r) => r.passed).length, 10);
  });

  it('limiter keys never contain the raw e-mail address and use the shared normalisation', () => {
    const limit = createLoginRateLimit();
    run(limit, fakeReq('203.0.113.1', { email: '  Secret.Person@Example.COM ' }), 401);
    const keys = Object.values(limit.limiters).flatMap((l) => [...l.store.probation.keys(), ...l.store.established.keys()]);
    assert.ok(keys.length >= 3);
    for (const key of keys) {
      assert.equal(/secret|person|example|@/i.test(key), false, key);
    }
    assert.equal(normalizeEmail('  Secret.Person@Example.COM '), 'secret.person@example.com');
    assert.equal(accountLimiterKey(' A@B.C '), accountLimiterKey('a@b.c'));
    assert.equal(accountLimiterKey(''), null);
    assert.equal(accountLimiterKey({ $gt: '' }), null, 'non-string input is not an account');
  });

  it('requests without an e-mail are still limited per IP', () => {
    const limit = createLoginRateLimit({ ipMax: 5 });
    for (let i = 0; i < 5; i += 1) assert.equal(run(limit, fakeReq('203.0.113.77', {}), 400).passed, true);
    assert.equal(run(limit, fakeReq('203.0.113.77', {}), 400).passed, false);
  });
});

describe('L6 — IPv6 identities and price-refresh limiting', () => {
  it('rate-limit identities: IPv4, IPv4-mapped IPv6, IPv6 /64, non-IP input', () => {
    assert.equal(rateLimitIdentity('203.0.113.7'), 'v4:203.0.113.7');
    assert.equal(rateLimitIdentity('::ffff:203.0.113.7'), 'v4:203.0.113.7');
    assert.equal(rateLimitIdentity('::FFFF:cb00:7107'), 'v4:203.0.113.7', 'hex-mapped form');
    assert.equal(rateLimitIdentity('2001:db8:1:2:aaaa::1'), rateLimitIdentity('2001:DB8:1:2:ffff:eeee:dddd:cccc'));
    assert.equal(rateLimitIdentity('2001:db8:1:2::1'), 'v6:2001:db8:1:2::/64');
    assert.notEqual(rateLimitIdentity('2001:db8:1:2::1'), rateLimitIdentity('2001:db8:1:3::1'));
    assert.equal(rateLimitIdentity('fe80::1%eth0'), rateLimitIdentity('fe80::2'));
    assert.equal(rateLimitIdentity('[2001:db8::1]'), rateLimitIdentity('2001:db8::1'));
    assert.equal(rateLimitIdentity('not-an-ip'), 'raw:not-an-ip');
    assert.equal(normalizeIp('2001:0DB8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  });

  it('authenticated callers are limited per user (req.user._id), not per shared IP', () => {
    priceRefreshRateLimit.reset();
    const nat = '203.0.113.200';
    const alice = { _id: { toString: () => '64b000000000000000000a11' }, businessId: 'biz1' };
    const bob = { _id: { toString: () => '64b000000000000000000b0b' }, businessId: 'biz1' };
    assert.equal(run(priceRefreshRateLimit, fakeReq(nat, {}, { user: alice })).passed, true);
    assert.equal(run(priceRefreshRateLimit, fakeReq(nat, {}, { user: bob })).passed, true, 'bob is not blocked by alice');
    const again = run(priceRefreshRateLimit, fakeReq('198.51.100.1', {}, { user: alice }));
    assert.equal(again.passed, false, 'identity change of IP does not reset the per-user limit');
    assert.equal(again.res.statusCode, 429);
    assert.ok(again.res.body.retryAfterSeconds >= 1, 'existing response contract kept');
    assert.match(again.res.body.error, /Fiyat yenileme/);
  });

  it('price keys carry the tenant and use _id; the legacy `id` property is not trusted', () => {
    assert.equal(priceRefreshKey({ user: { _id: 'u1', businessId: 'b1' } }), 'price:user:b1:u1');
    assert.notEqual(priceRefreshKey({ user: { _id: 'u1', businessId: 'b1' } }), priceRefreshKey({ user: { _id: 'u1', businessId: 'b2' } }));
    assert.equal(priceRefreshKey({ user: { id: 'spoof' }, ip: '203.0.113.4' }), 'price:ip:v4:203.0.113.4');
  });

  it('unauthenticated fallback: mapped IPv6 and the plain IPv4 share a bucket, IPv6 /64 rotation shares a bucket', () => {
    priceRefreshRateLimit.reset();
    assert.equal(run(priceRefreshRateLimit, fakeReq('::ffff:198.51.100.20')).passed, true);
    assert.equal(run(priceRefreshRateLimit, fakeReq('198.51.100.20')).passed, false);
    assert.equal(run(priceRefreshRateLimit, fakeReq('2001:db8:5:6::1')).passed, true);
    assert.equal(run(priceRefreshRateLimit, fakeReq('2001:db8:5:6:dead:beef:1:2')).passed, false);
    assert.equal(run(priceRefreshRateLimit, fakeReq('2001:db8:5:7::1')).passed, true, 'another /64 is another client');
  });
});
