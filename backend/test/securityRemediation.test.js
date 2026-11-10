/**
 * Security remediation regression tests (real MongoDB replica set via `npm test`).
 *
 * 1. Last-active-admin race (write skew) — real concurrent HTTP requests, ≥50 repetitions
 * 2. Bootstrap admin first-run / recovery behaviour
 * 3. Production configuration validation and refusal to start
 * 4. Login / forgot-password CSRF
 * 5. Audit retention for permanently deleted users (tenant isolated, minimised)
 * 6. Client IP / trust proxy handling of rate limiting
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'remediation-secret-with-more-than-thirty-two-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';
process.env.APP_URL = 'http://localhost:8080';

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const AuthSession = require('../models/AuthSession');
const AuditLog = require('../models/AuditLog');
const DeletedUser = require('../models/DeletedUser');
const BusinessAdminGuard = require('../models/BusinessAdminGuard');
const { signToken } = require('../middleware/auth');
const { hashPassword, verifyPassword } = require('../utils/passwords');
const { resetAllRateLimiters, normalizeIp } = require('../middleware/rateLimit');
const { validateRuntimeConfig, parseTrustProxy } = require('../config/runtimeConfig');
const { withBusinessAdminGuard, assertActorStillAuthorized, GuardRejection } = require('../services/adminGuard');
const bootstrapAdmin = require('../scripts/bootstrapAdmin');

const PASSWORD = 'Remediation-Strong-Pass-7';
const RACE_ITERATIONS = 50;
const uid = () => crypto.randomBytes(5).toString('hex');
const silentLogger = { log() {}, warn() {}, error() {} };

let server;
let baseUrl;
let passwordHash;

function request(method, path, { body, rawBody, token, headers = {} } = {}) {
  const url = new URL(path, baseUrl);
  const reqHeaders = { ...headers };
  if (token) reqHeaders.Authorization = `Bearer ${token}`;
  let payload = null;
  if (rawBody !== undefined) payload = rawBody;
  else if (body !== undefined) {
    payload = JSON.stringify(body);
    if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
  }
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: reqHeaders, agent: false }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function createUser({ role = 'staff', businessId, branch = 'Merkez', active = true, email } = {}) {
  return User.create({
    email: email || `${role}_${uid()}@remediation.test`,
    name: `Test ${role}`,
    passwordHash,
    role,
    branch,
    businessId,
    active,
  });
}

function tokenFor(user) {
  return signToken(user, 900);
}

const activeAdminCount = (businessId) => User.countDocuments({ businessId, role: 'admin', active: true });

describe('Security remediation (real MongoDB)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  before(async () => {
    await mongoose.connect(uri);
    await Promise.all([User.init(), AuthSession.init(), AuditLog.init(), DeletedUser.init(), BusinessAdminGuard.init()]);
    passwordHash = await hashPassword(PASSWORD);
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    await mongoose.disconnect();
  });

  beforeEach(() => resetAllRateLimiters());

  // =========================================================================
  // 1. LAST ACTIVE ADMIN RACE
  // =========================================================================
  describe('1. Last active admin — concurrent requests', () => {
    it(`control: an unguarded check-then-act transaction DOES suffer write skew (proves the harness detects the bug)`, async () => {
      // Two transactions both read "one other active admin" before either
      // writes, then each deactivates a different admin. Snapshot isolation
      // lets both commit — exactly the original bug.
      const businessId = `biz_ctrl_${uid()}`;
      const a = await createUser({ role: 'admin', businessId });
      const b = await createUser({ role: 'admin', businessId });
      const arrived = [];
      let release;
      const bothRead = new Promise((r) => { release = r; });

      async function unguarded(target) {
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            const others = await User.countDocuments({ businessId, role: 'admin', active: true, _id: { $ne: target._id } }).session(session);
            arrived.push(target._id);
            if (arrived.length === 2) release();
            await Promise.race([bothRead, new Promise((r) => setTimeout(r, 2000))]);
            if (others >= 1) await User.updateOne({ _id: target._id }, { $set: { active: false } }, { session });
          }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
        } finally {
          await session.endSession();
        }
      }
      await Promise.all([unguarded(a), unguarded(b)]);
      assert.equal(await activeAdminCount(businessId), 0, 'without coordination both deactivations commit');
    });

    it('guarded: the same forced interleaving can never remove the last admin', async () => {
      const businessId = `biz_guard_${uid()}`;
      const a = await createUser({ role: 'admin', businessId });
      const b = await createUser({ role: 'admin', businessId });
      let waiting = 0;

      async function guarded(target) {
        return withBusinessAdminGuard(businessId, async (session) => {
          const others = await User.countDocuments({ businessId, role: 'admin', active: true, _id: { $ne: target._id } }).session(session);
          waiting += 1;
          // Give the other transaction every chance to interleave.
          const start = Date.now();
          while (waiting < 2 && Date.now() - start < 150) await new Promise((r) => setTimeout(r, 5));
          waiting -= 1;
          if (others < 1) return 'refused';
          await User.updateOne({ _id: target._id }, { $set: { active: false } }, { session });
          return 'deactivated';
        });
      }
      const results = await Promise.all([guarded(a), guarded(b)]);
      assert.equal(await activeAdminCount(businessId), 1);
      assert.deepEqual(results.sort(), ['deactivated', 'refused']);
    });

    it(`two admins deactivating each other at the same time: exactly one succeeds (${RACE_ITERATIONS}×)`, async () => {
      for (let i = 0; i < RACE_ITERATIONS; i += 1) {
        const businessId = `biz_mutual_${uid()}`;
        const a = await createUser({ role: 'admin', businessId });
        const b = await createUser({ role: 'admin', businessId });
        const [r1, r2] = await Promise.all([
          request('PATCH', `/api/users/${b._id}/status`, { token: tokenFor(a), body: { active: false } }),
          request('PATCH', `/api/users/${a._id}/status`, { token: tokenFor(b), body: { active: false } }),
        ]);
        const statuses = [r1.status, r2.status];
        assert.equal(statuses.filter((s) => s === 200).length, 1, `iteration ${i}: ${JSON.stringify([r1.body, r2.body])}`);
        assert.ok(statuses.every((s) => [200, 400, 401, 409].includes(s)), `iteration ${i}: unexpected ${statuses}`);
        assert.equal(await activeAdminCount(businessId), 1, `iteration ${i}: exactly one active admin must remain`);
      }
    });

    it(`three admins: two of them deactivating each other concurrently — the loser is refused (${RACE_ITERATIONS}×)`, async () => {
      for (let i = 0; i < RACE_ITERATIONS; i += 1) {
        const businessId = `biz_three_${uid()}`;
        const a = await createUser({ role: 'admin', businessId });
        const b = await createUser({ role: 'admin', businessId });
        await createUser({ role: 'admin', businessId });
        const [r1, r2] = await Promise.all([
          request('PATCH', `/api/users/${b._id}/status`, { token: tokenFor(a), body: { active: false } }),
          request('PATCH', `/api/users/${a._id}/status`, { token: tokenFor(b), body: { active: false } }),
        ]);
        assert.equal([r1.status, r2.status].filter((s) => s === 200).length, 1,
          `iteration ${i}: a deactivated admin must not complete its own deactivation request (${r1.status}/${r2.status})`);
        assert.equal(await activeAdminCount(businessId), 2, `iteration ${i}`);
      }
    });

    it(`mixed demotion (PUT role) and deactivation (PATCH status) race (${RACE_ITERATIONS}×)`, async () => {
      for (let i = 0; i < RACE_ITERATIONS; i += 1) {
        const businessId = `biz_mixed_${uid()}`;
        const a = await createUser({ role: 'admin', businessId });
        const b = await createUser({ role: 'admin', businessId });
        const [r1, r2] = await Promise.all([
          request('PUT', `/api/users/${b._id}`, { token: tokenFor(a), body: { role: 'staff' } }),
          request('PATCH', `/api/users/${a._id}/status`, { token: tokenFor(b), body: { active: false } }),
        ]);
        assert.equal([r1.status, r2.status].filter((s) => s === 200).length, 1, `iteration ${i}: ${r1.status}/${r2.status}`);
        assert.equal(await activeAdminCount(businessId), 1, `iteration ${i}`);
      }
    });

    it(`ring of four admins each deactivating the next one never empties the business (${RACE_ITERATIONS}×)`, async () => {
      for (let i = 0; i < RACE_ITERATIONS; i += 1) {
        const businessId = `biz_ring_${uid()}`;
        const admins = [];
        for (let k = 0; k < 4; k += 1) admins.push(await createUser({ role: 'admin', businessId }));
        const responses = await Promise.all(admins.map((actor, k) => {
          const target = admins[(k + 1) % admins.length];
          return k % 2 === 0
            ? request('PATCH', `/api/users/${target._id}/status`, { token: tokenFor(actor), body: { active: false } })
            : request('PUT', `/api/users/${target._id}`, { token: tokenFor(actor), body: { role: 'manager' } });
        }));
        const remaining = await activeAdminCount(businessId);
        assert.ok(remaining >= 1, `iteration ${i}: no active admin left`);
        assert.ok(responses.every((r) => [200, 400, 401, 409].includes(r.status)), `iteration ${i}: ${responses.map((r) => r.status)}`);
        // Every successful request removed one admin.
        assert.equal(remaining, 4 - responses.filter((r) => r.status === 200).length, `iteration ${i}`);
      }
    });

    it(`concurrent re-activation and deletion of the same account stay consistent (${RACE_ITERATIONS}×)`, async () => {
      for (let i = 0; i < RACE_ITERATIONS; i += 1) {
        const businessId = `biz_del_${uid()}`;
        const admin = await createUser({ role: 'admin', businessId });
        const target = await createUser({ role: 'staff', businessId, active: false });
        const token = tokenFor(admin);
        const [activate, remove] = await Promise.all([
          request('PATCH', `/api/users/${target._id}/status`, { token, body: { active: true } }),
          request('DELETE', `/api/users/${target._id}`, { token }),
        ]);
        const stored = await User.findById(target._id).lean();
        const tombstone = await DeletedUser.findById(target._id).lean();
        if (remove.status === 200) {
          assert.equal(stored, null, `iteration ${i}`);
          assert.ok(tombstone, `iteration ${i}: deletion must leave a tombstone`);
          assert.notEqual(activate.status, 200, `iteration ${i}: activation of a deleted user cannot succeed`);
        } else {
          assert.equal(stored.active, true, `iteration ${i}`);
          assert.equal(tombstone, null, `iteration ${i}`);
          assert.equal(activate.status, 200, `iteration ${i}`);
          assert.ok([400, 404, 409].includes(remove.status), `iteration ${i}: ${remove.status}`);
        }
      }
    });

    it('in-transaction actor re-check rejects an actor deactivated after authentication', async () => {
      const businessId = `biz_actor_${uid()}`;
      const a = await createUser({ role: 'admin', businessId });
      const b = await createUser({ role: 'admin', businessId });
      // req.user as built by authenticate() before b was deactivated.
      const req = { user: { _id: b._id, role: 'admin', businessId, branch: b.branch, tokenVersion: 0 } };
      await User.updateOne({ _id: b._id }, { $set: { active: false }, $inc: { tokenVersion: 1 } });
      await assert.rejects(
        withBusinessAdminGuard(businessId, (session) => assertActorStillAuthorized(req, session)),
        (error) => error instanceof GuardRejection && error.status === 409 && error.body.code === 'ACTOR_STATE_CHANGED',
      );
      // A still-valid actor passes.
      const ok = { user: { _id: a._id, role: 'admin', businessId, branch: a.branch, tokenVersion: 0 } };
      await withBusinessAdminGuard(businessId, (session) => assertActorStillAuthorized(ok, session));
    });

    it('a deactivated actor whose token is still valid cannot finish a user-management change', async () => {
      const businessId = `biz_stale_${uid()}`;
      const a = await createUser({ role: 'admin', businessId });
      const b = await createUser({ role: 'admin', businessId });
      const staff = await createUser({ role: 'staff', businessId });
      const staleToken = tokenFor(b);
      assert.equal((await request('PATCH', `/api/users/${b._id}/status`, { token: tokenFor(a), body: { active: false } })).status, 200);
      const res = await request('PATCH', `/api/users/${staff._id}/status`, { token: staleToken, body: { active: false } });
      assert.equal(res.status, 401);
      assert.equal((await User.findById(staff._id).lean()).active, true);
    });
  });

  // =========================================================================
  // 2. BOOTSTRAP ADMIN
  // =========================================================================
  describe('2. Bootstrap admin & recovery', () => {
    const envFor = (email, extra = {}) => ({ ADMIN_EMAIL: email, ADMIN_PASSWORD: PASSWORD, ...extra });
    const recoveryToken = () => crypto.randomBytes(32).toString('hex');

    it('first run creates the admin only while the business has no admin', async () => {
      const businessId = `biz_boot_${uid()}`;
      const email = `boot_${uid()}@remediation.test`;
      const first = await bootstrapAdmin({ env: envFor(email), logger: silentLogger, businessId });
      assert.equal(first.action, 'created');
      const created = await User.findOne({ email }).lean();
      assert.equal(created.role, 'admin');
      assert.equal(created.businessId, businessId);
      // Running again is idempotent.
      assert.equal((await bootstrapAdmin({ env: envFor(email), logger: silentLogger, businessId })).action, 'none');
    });

    it('a deliberately deleted bootstrap admin is not resurrected on restart', async () => {
      const businessId = `biz_boot_${uid()}`;
      await createUser({ role: 'admin', businessId });
      const email = `gone_${uid()}@remediation.test`;
      const result = await bootstrapAdmin({ env: envFor(email), logger: silentLogger, businessId });
      assert.equal(result.action, 'none');
      assert.equal(await User.exists({ email }), null);
    });

    it('a demoted or deactivated ADMIN_EMAIL account no longer blocks server start-up', async () => {
      const businessId = `biz_boot_${uid()}`;
      await createUser({ role: 'admin', businessId });
      const demoted = await createUser({ role: 'staff', businessId });
      const result = await bootstrapAdmin({ env: envFor(demoted.email), logger: silentLogger, businessId });
      assert.equal(result.action, 'none');
      const after = await User.findById(demoted._id).lean();
      assert.equal(after.role, 'staff', 'no silent privilege escalation without ADMIN_RECOVERY');
    });

    it('ADMIN_RECOVERY re-activates and promotes the account, resets its password, revokes sessions and audits', async () => {
      const businessId = `biz_boot_${uid()}`;
      const locked = await createUser({ role: 'manager', businessId, active: false });
      await AuthSession.create({
        userId: locked._id, businessId, tokenHash: crypto.randomBytes(32).toString('hex'),
        tokenVersion: 0, expiresAt: new Date(Date.now() + 3600_000),
      });
      const newPassword = 'Recovered-Password-1234';
      const result = await bootstrapAdmin({
        // V2: recovery additionally requires a fresh one-time token (M3).
        env: { ADMIN_EMAIL: locked.email, ADMIN_PASSWORD: newPassword, ADMIN_RECOVERY: 'true', ADMIN_RECOVERY_TOKEN: recoveryToken() },
        logger: silentLogger,
        businessId,
      });
      assert.equal(result.action, 'recovered');
      const recovered = await User.findById(locked._id).select('+passwordHash').lean();
      assert.equal(recovered.role, 'admin');
      assert.equal(recovered.active, true);
      assert.equal(recovered.tokenVersion, 1);
      assert.ok(await verifyPassword(newPassword, recovered.passwordHash));
      assert.equal(await AuthSession.countDocuments({ userId: locked._id, revokedAt: null }), 0);
      assert.ok(await AuditLog.findOne({ action: 'user.admin_recovery', resourceId: String(locked._id) }));

      const login = await request('POST', '/api/auth/login', { body: { email: locked.email, password: newPassword } });
      assert.equal(login.status, 200);
    });

    it('ADMIN_RECOVERY on an already active admin changes nothing (no password reset on every restart)', async () => {
      const businessId = `biz_boot_${uid()}`;
      const admin = await createUser({ role: 'admin', businessId });
      const result = await bootstrapAdmin({
        env: { ADMIN_EMAIL: admin.email, ADMIN_PASSWORD: 'Some-Other-Password-99', ADMIN_RECOVERY: 'true', ADMIN_RECOVERY_TOKEN: recoveryToken() },
        logger: silentLogger,
        businessId,
      });
      assert.equal(result.action, 'none');
      const stored = await User.findById(admin._id).select('+passwordHash').lean();
      assert.ok(await verifyPassword(PASSWORD, stored.passwordHash));
    });

    it('ADMIN_RECOVERY re-creates a deleted bootstrap admin; weak passwords are refused', async () => {
      const businessId = `biz_boot_${uid()}`;
      await createUser({ role: 'admin', businessId, active: false });
      const email = `recreate_${uid()}@remediation.test`;
      const result = await bootstrapAdmin({ env: envFor(email, { ADMIN_RECOVERY: '1', ADMIN_RECOVERY_TOKEN: recoveryToken() }), logger: silentLogger, businessId });
      assert.equal(result.action, 'recovered_created');
      assert.equal((await User.findOne({ email }).lean()).role, 'admin');
      await assert.rejects(
        bootstrapAdmin({ env: { ADMIN_EMAIL: email, ADMIN_PASSWORD: 'short', ADMIN_RECOVERY: 'true', ADMIN_RECOVERY_TOKEN: recoveryToken() }, logger: silentLogger, businessId }),
        /ADMIN_PASSWORD/,
      );
    });
  });

  // =========================================================================
  // 3. PRODUCTION CONFIGURATION
  // =========================================================================
  describe('3. Production configuration', () => {
    const secret = crypto.randomBytes(48).toString('hex');
    const validProd = () => ({
      NODE_ENV: 'production',
      JWT_SECRET: secret,
      MONGO_URI: 'mongodb://db.internal:27017/jeweler?replicaSet=rs0',
      CORS_ORIGIN: 'https://erp.example.com',
      APP_URL: 'https://erp.example.com',
      TRUST_PROXY: '1',
    });

    it('accepts a complete, safe production configuration', () => {
      const result = validateRuntimeConfig(validProd());
      assert.deepEqual(result.errors, []);
      assert.equal(result.trustProxy, 1);
    });

    for (const [label, patch, pattern] of [
      ['missing APP_URL', { APP_URL: '' }, /APP_URL/],
      ['http APP_URL', { APP_URL: 'http://erp.example.com' }, /APP_URL.*https/],
      ['localhost APP_URL', { APP_URL: 'https://localhost:8080', CORS_ORIGIN: 'https://localhost:8080' }, /localhost/],
      ['APP_URL outside CORS_ORIGIN', { APP_URL: 'https://other.example.com' }, /CORS_ORIGIN/],
      ['Secure cookie disabled', { AUTH_COOKIE_SECURE: 'false' }, /AUTH_COOKIE_SECURE/],
      ['invalid SameSite', { AUTH_COOKIE_SAMESITE: 'relaxed' }, /AUTH_COOKIE_SAMESITE/],
      ['TRUST_PROXY not set', { TRUST_PROXY: undefined }, /TRUST_PROXY/],
      ['TRUST_PROXY garbage', { TRUST_PROXY: 'yes' }, /TRUST_PROXY/],
      ['TRUST_PROXY too many hops', { TRUST_PROXY: '11' }, /TRUST_PROXY/],
      ['wildcard CORS', { CORS_ORIGIN: '*' }, /CORS_ORIGIN/],
      ['missing CORS', { CORS_ORIGIN: '' }, /CORS_ORIGIN/],
      ['placeholder JWT secret', { JWT_SECRET: 'replace-with-a-random-secret-at-least-32-characters' }, /JWT_SECRET/],
      ['short JWT secret', { JWT_SECRET: 'short' }, /JWT_SECRET/],
      ['placeholder admin password', { ADMIN_PASSWORD: 'replace-with-a-strong-unique-password' }, /ADMIN_PASSWORD/],
      ['missing MONGO_URI', { MONGO_URI: '' }, /MONGO_URI/],
    ]) {
      it(`refuses production with ${label}`, () => {
        const env = { ...validProd(), ...patch };
        for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
        const { errors } = validateRuntimeConfig(env);
        assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(errors)}`);
        assert.ok(errors.every((e) => !e.includes(secret)), 'secrets are never echoed');
      });
    }

    it('rejects an unknown NODE_ENV such as "prod" (would silently disable production safeguards)', () => {
      const { errors } = validateRuntimeConfig({ ...validProd(), NODE_ENV: 'prod' });
      assert.ok(errors.some((e) => /NODE_ENV/.test(e)));
    });

    it('development keeps working with the existing minimal configuration', () => {
      for (const env of [
        { JWT_SECRET: secret },
        { NODE_ENV: 'development', JWT_SECRET: secret, TRUST_PROXY: 'false', AUTH_COOKIE_SECURE: '', APP_URL: 'http://localhost:8080' },
      ]) {
        assert.deepEqual(validateRuntimeConfig(env).errors, []);
      }
      // Invalid proxy value in development: warning + fail-safe (no trust), not a crash.
      const dev = validateRuntimeConfig({ JWT_SECRET: secret, TRUST_PROXY: 'yes' });
      assert.deepEqual(dev.errors, []);
      assert.equal(dev.trustProxy, false);
      assert.ok(dev.warnings.some((w) => /TRUST_PROXY/.test(w)));
    });

    it('startServer refuses to start (no DB connection attempt) on an unsafe production configuration', async () => {
      const saved = { ...process.env };
      const savedExitCode = process.exitCode;
      const origConnect = mongoose.connect;
      let connectCalled = false;
      const origError = console.error;
      const origWarn = console.warn;
      const logged = [];
      console.error = (...args) => logged.push(args.join(' '));
      console.warn = () => {};
      mongoose.connect = async () => { connectCalled = true; };
      try {
        Object.assign(process.env, validProd(), { AUTH_COOKIE_SECURE: 'false', APP_URL: '' });
        const result = await app.startServer();
        assert.equal(result, null);
        assert.equal(process.exitCode, 1);
        assert.equal(connectCalled, false);
        assert.ok(logged.some((l) => /AUTH_COOKIE_SECURE/.test(l)));
        assert.ok(logged.some((l) => /APP_URL/.test(l)));
      } finally {
        mongoose.connect = origConnect;
        console.error = origError;
        console.warn = origWarn;
        for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
        Object.assign(process.env, saved);
        process.exitCode = savedExitCode;
        app.set('trust proxy', false);
      }
    });
  });

  // =========================================================================
  // 4. LOGIN CSRF
  // =========================================================================
  describe('4. Login / forgot-password CSRF', () => {
    let user;
    before(async () => {
      user = await createUser({ role: 'staff', businessId: `biz_csrf_${uid()}` });
    });

    it('an HTML form (urlencoded) login cannot log the browser in', async () => {
      const res = await request('POST', '/api/auth/login', {
        rawBody: new URLSearchParams({ email: user.email, password: PASSWORD }).toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' },
      });
      assert.equal(res.status, 403);
      assert.equal(res.headers['set-cookie'], undefined);
    });

    it('form posts without Origin are rejected by content type (urlencoded, multipart, text/plain)', async () => {
      for (const [type, rawBody] of [
        ['application/x-www-form-urlencoded', new URLSearchParams({ email: user.email, password: PASSWORD }).toString()],
        ['text/plain', JSON.stringify({ email: user.email, password: PASSWORD })],
        ['multipart/form-data; boundary=x', `--x\r\nContent-Disposition: form-data; name="email"\r\n\r\n${user.email}\r\n--x--`],
      ]) {
        const res = await request('POST', '/api/auth/login', { rawBody, headers: { 'Content-Type': type } });
        assert.equal(res.status, 415, type);
        assert.equal(res.body.code, 'CSRF_CONTENT_TYPE_REJECTED');
        assert.equal(res.headers['set-cookie'], undefined);
      }
    });

    it('foreign, "null" and Sec-Fetch-Site: cross-site origins are rejected even with JSON', async () => {
      for (const headers of [
        { Origin: 'https://evil.example' },
        { Origin: 'null' },
        { 'Sec-Fetch-Site': 'cross-site' },
      ]) {
        const res = await request('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD }, headers });
        assert.equal(res.status, 403, JSON.stringify(headers));
        assert.equal(res.body.code, 'CSRF_ORIGIN_REJECTED');
      }
    });

    it('the SPA (allowed Origin, JSON) and non-browser JSON clients still log in', async () => {
      const spa = await request('POST', '/api/auth/login', {
        body: { email: user.email, password: PASSWORD },
        headers: { Origin: 'http://localhost:8080', 'X-Requested-With': 'XMLHttpRequest', 'Sec-Fetch-Site': 'same-site' },
      });
      assert.equal(spa.status, 200);
      assert.ok(spa.headers['set-cookie']);
      const cli = await request('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } });
      assert.equal(cli.status, 200);
    });

    it('forgot-password and reset-password are protected the same way (before any rate-limit or SMTP work)', async () => {
      const form = await request('POST', '/api/auth/forgot-password', {
        rawBody: `email=${encodeURIComponent(user.email)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      assert.equal(form.status, 415);
      const foreign = await request('POST', '/api/auth/forgot-password', { body: { email: user.email }, headers: { Origin: 'https://evil.example' } });
      assert.equal(foreign.status, 403);
      const reset = await request('POST', '/api/auth/reset-password', { body: { token: 'x', newPassword: 'y' }, headers: { Origin: 'https://evil.example' } });
      assert.equal(reset.status, 403);
      const validate = await request('POST', '/api/auth/reset-password/validate', { rawBody: 'token=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      assert.equal(validate.status, 415);
    });
  });

  // =========================================================================
  // 5. AUDIT RETENTION
  // =========================================================================
  describe('5. Audit retention for deleted users', () => {
    it('history of a permanently deleted user stays visible to its own business only, without personal data', async () => {
      const businessId = `biz_audit_${uid()}`;
      const admin = await createUser({ role: 'admin', businessId });
      const staff = await createUser({ role: 'staff', businessId });
      const intruder = await createUser({ role: 'admin', businessId: `biz_other_${uid()}` });

      const login = await request('POST', '/api/auth/login', { body: { email: staff.email, password: PASSWORD } });
      assert.equal(login.status, 200);
      const loginAudit = await AuditLog.findOne({ action: 'auth.login', actorUserId: staff._id }).lean();
      assert.ok(loginAudit);

      const adminToken = tokenFor(admin);
      assert.equal((await request('PATCH', `/api/users/${staff._id}/status`, { token: adminToken, body: { active: false } })).status, 200);
      assert.equal((await request('DELETE', `/api/users/${staff._id}`, { token: adminToken })).status, 200);
      assert.equal(await User.exists({ _id: staff._id }), null);

      const visible = await request('GET', '/api/audit?limit=100', { token: adminToken });
      assert.equal(visible.status, 200);
      const entry = visible.body.find((log) => String(log._id) === String(loginAudit._id));
      assert.ok(entry, 'deleted user audit history must remain visible to the business');
      assert.equal(entry.actorDeleted, true);
      assert.equal(entry.actorEmail, null, 'no personal data of the deleted actor is exposed');
      assert.equal(entry.before, undefined);
      assert.equal(entry.after, undefined);

      const foreign = await request('GET', '/api/audit?limit=100', { token: tokenFor(intruder) });
      assert.equal(foreign.status, 200);
      assert.equal(foreign.body.some((log) => String(log.actorUserId) === String(staff._id)), false, 'tenant isolation');

      const tombstone = await DeletedUser.findById(staff._id).lean();
      assert.equal(tombstone.businessId, businessId);
      assert.equal(String(tombstone.deletedBy), String(admin._id));
      assert.deepEqual(Object.keys(tombstone).sort(), ['_id', 'businessId', 'deletedAt', 'deletedBy', 'role']);

      const deleteAudit = await AuditLog.findOne({ action: 'user.delete', resourceId: String(staff._id) }).lean();
      assert.ok(deleteAudit);
      assert.equal(deleteAudit.before.email, undefined, 'delete record does not copy the e-mail');
      assert.equal(deleteAudit.before.name, undefined, 'delete record does not copy the name');
    });

    it('audit:read is still required', async () => {
      const businessId = `biz_audit_${uid()}`;
      const staff = await createUser({ role: 'staff', businessId });
      assert.equal((await request('GET', '/api/audit', { token: tokenFor(staff) })).status, 403);
    });
  });

  // =========================================================================
  // 6. CLIENT IP / TRUST PROXY
  // =========================================================================
  describe('6. Rate limiting behind proxies', () => {
    const failLogin = (email, headers) => request('POST', '/api/auth/login', { body: { email, password: 'wrong-password-123' }, headers });

    it('trust proxy is never "trust everything"', () => {
      for (const raw of [undefined, '', 'false', 'true', '1', '3', 'loopback,10.0.0.0/8', 'yes', '99']) {
        assert.notEqual(parseTrustProxy(raw).value, true, String(raw));
      }
      assert.deepEqual(parseTrustProxy('loopback, 10.0.0.0/8 ,::1').value, ['loopback', '10.0.0.0/8', '::1']);
      assert.ok(parseTrustProxy('10.0.0.0/33').error);
      assert.equal(normalizeIp('::ffff:203.0.113.7'), '203.0.113.7');
      assert.equal(normalizeIp('2001:DB8::1'), '2001:db8::1');
    });

    it('without trusted proxy, spoofed X-Forwarded-For cannot bypass the login limiter', async () => {
      app.set('trust proxy', false);
      const email = `spoof_${uid()}@remediation.test`;
      for (let i = 0; i < 10; i += 1) {
        const res = await failLogin(email, { 'X-Forwarded-For': `198.51.100.${i}` });
        assert.equal(res.status, 401);
      }
      const blocked = await failLogin(email, { 'X-Forwarded-For': '198.51.100.250' });
      assert.equal(blocked.status, 429);
    });

    it('with one trusted proxy, only the proxy-appended address counts (client-prepended entries are ignored)', async () => {
      app.set('trust proxy', 1);
      try {
        const email = `proxy_${uid()}@remediation.test`;
        for (let i = 0; i < 10; i += 1) {
          // The client forges the left part; the proxy appends the real address.
          const res = await failLogin(email, { 'X-Forwarded-For': `10.9.9.${i}, 203.0.113.5` });
          assert.equal(res.status, 401);
        }
        assert.equal((await failLogin(email, { 'X-Forwarded-For': '10.9.9.99, 203.0.113.5' })).status, 429);
        // A genuinely different client behind the same proxy is not affected.
        assert.equal((await failLogin(email, { 'X-Forwarded-For': '203.0.113.6' })).status, 401);
      } finally {
        app.set('trust proxy', false);
      }
    });
  });
});
