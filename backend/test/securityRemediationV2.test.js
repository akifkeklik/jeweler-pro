/**
 * Security remediation V2 — database-backed regression tests.
 * Real MongoDB replica set (npm test), real HTTP, real SMTP socket server.
 *
 * M1  login protection end-to-end (IP rotation, e-mail rotation, lockout DoS)
 * M3/L2 one-time, atomic, audited admin recovery
 * M4  audit data minimisation (real HTTP create/update/delete, raw documents)
 * L1  permission revocation while a request is in flight (forced interleaving)
 * L3  reset-token issuance vs. deactivation / deletion / re-activation
 * L4  canonical origins over HTTP (CORS preflight + CSRF)
 * L6  price refresh limiter with the real authenticate() middleware
 * L7  transaction capability detection against live replica-set and standalone servers
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const express = require('express');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'remediation-v2-secret-with-more-than-thirty-two-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';
process.env.APP_URL = 'http://localhost:8080';
process.env.PASSWORD_RESET_COOLDOWN_SECONDS = '0';

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const AuthSession = require('../models/AuthSession');
const AuditLog = require('../models/AuditLog');
const DeletedUser = require('../models/DeletedUser');
const BusinessAdminGuard = require('../models/BusinessAdminGuard');
const AdminRecoveryConsumption = require('../models/AdminRecoveryConsumption');
const { signToken, authenticate } = require('../middleware/auth');
const { hashPassword, verifyPassword, sha256Hex, generateOpaqueToken } = require('../utils/passwords');
const { resetAllRateLimiters } = require('../middleware/rateLimit');
const priceRefreshRateLimit = require('../middleware/priceRateLimit');
const { withBusinessAdminGuard, assertActorStillAuthorized, GuardRejection } = require('../services/adminGuard');
const { getEffectivePermissions } = require('../middleware/authorization');
const { verifyTransactionSupport, TransactionSupportError } = require('../config/databaseCapabilities');
const { DEFAULT_TELEMETRY_RETENTION_DAYS } = require('../utils/audit');
const emailService = require('../services/emailService');
const bootstrapAdmin = require('../scripts/bootstrapAdmin');
const { startSmtpServer, extractResetToken } = require('../testSupport/smtpServer');

const PASSWORD = 'Remediation-V2-Strong-Pass-7';
const uid = () => crypto.randomBytes(5).toString('hex');
const recoveryToken = () => crypto.randomBytes(32).toString('hex');
const DAY_MS = 24 * 60 * 60 * 1000;

let server;
let baseUrl;
let passwordHash;
let smtp;

function request(method, urlPath, { body, token, headers = {}, base = baseUrl } = {}) {
  const url = new URL(urlPath, base);
  const reqHeaders = { ...headers };
  if (token) reqHeaders.Authorization = `Bearer ${token}`;
  const payload = body === undefined ? null : JSON.stringify(body);
  if (payload && !reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
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
    if (payload) req.write(payload);
    req.end();
  });
}

async function createUser({ role = 'staff', businessId, branch = 'Merkez', active = true, customPermissions = [], email } = {}) {
  return User.create({
    email: email || `${role}_${uid()}@remediation-v2.test`,
    name: `Test ${role}`,
    passwordHash,
    role,
    branch,
    businessId,
    customPermissions,
    active,
  });
}

const tokenFor = (user) => signToken(user, 900);

/** Opens a transaction that owns the business guard document until commit(). */
async function holdBusinessGuard(businessId) {
  await BusinessAdminGuard.updateOne({ _id: businessId }, { $setOnInsert: { seq: 0, lastMutationAt: null } }, { upsert: true });
  const session = await mongoose.startSession();
  session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  await BusinessAdminGuard.updateOne({ _id: businessId }, { $inc: { seq: 1 } }, { session });
  return {
    session,
    async commit() {
      try { await session.commitTransaction(); } finally { await session.endSession(); }
    },
  };
}

/** Plain transaction holding a write lock on one user document. */
async function holdUserWrite(userId, update) {
  const session = await mongoose.startSession();
  session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  await User.updateOne({ _id: userId }, update, { session });
  return {
    async commit() {
      try { await session.commitTransaction(); } finally { await session.endSession(); }
    },
  };
}

/**
 * Resolves once the application issues a MongoDB operation matching
 * `predicate` — the deterministic interleaving point: by then the request has
 * passed authentication and authorization with the *old* state.
 */
function waitForOperation(predicate, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      mongoose.set('debug', false);
      reject(new Error('expected database operation was not observed'));
    }, timeoutMs);
    mongoose.set('debug', (collectionName, methodName, ...args) => {
      if (predicate(collectionName, methodName, args)) {
        clearTimeout(timer);
        mongoose.set('debug', false);
        resolve();
      }
    });
  });
}

const guardTouched = (businessId) => (collection, method, args) => collection === 'business_admin_guards'
  && method === 'updateOne' && String(args[0]?._id) === businessId;

const RESET_SELECT = '+passwordResetTokenHash +passwordResetExpires +passwordResetTokenVersion';

describe('Security remediation V2 (real MongoDB)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  before(async () => {
    await mongoose.connect(uri);
    await Promise.all([User.init(), AuthSession.init(), AuditLog.init(), DeletedUser.init(), BusinessAdminGuard.init(), AdminRecoveryConsumption.init()]);
    passwordHash = await hashPassword(PASSWORD);
    smtp = await startSmtpServer();
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    mongoose.set('debug', false);
    await emailService.flushPendingDeliveries();
    await new Promise((r) => server.close(r));
    await smtp.close();
    await mongoose.disconnect();
  });

  beforeEach(() => {
    resetAllRateLimiters();
    smtp.clear();
    smtp.setRejectRecipients(false);
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(smtp.port);
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    emailService.resetCache();
  });

  // =========================================================================
  // M1 — LOGIN PROTECTION (HTTP)
  // =========================================================================
  describe('M1 — multi-dimensional login protection over HTTP', () => {
    const attempt = (email, xff, password = 'Wrong-Password-123') => request('POST', '/api/auth/login', {
      body: { email, password }, headers: { 'X-Forwarded-For': xff },
    });

    it('account limit holds across rotating client IPs; the owner\'s known network still logs in', async () => {
      app.set('trust proxy', 1);
      try {
        const user = await createUser({ businessId: `biz_m1_${uid()}` });
        assert.equal((await attempt(user.email, '192.0.2.10', PASSWORD)).status, 200, 'owner logs in from the office');
        const statuses = [];
        for (let i = 0; i < 40; i += 1) statuses.push((await attempt(user.email, `198.51.100.${i}`)).status);
        assert.equal(statuses.filter((s) => s === 401).length, 20, `account-wide budget: ${statuses}`);
        assert.ok(statuses.slice(20).every((s) => s === 429));
        assert.equal((await attempt(user.email, '203.0.113.200', PASSWORD)).status, 429, 'unknown network blocked, even with the right password');
        assert.equal((await attempt(user.email, '192.0.2.10', PASSWORD)).status, 200, 'owner is not locked out');
      } finally {
        app.set('trust proxy', false);
      }
    });

    it('password spraying with rotating e-mail addresses from one IP stops after 30 failures', async () => {
      app.set('trust proxy', 1);
      try {
        const statuses = [];
        for (let i = 0; i < 35; i += 1) statuses.push((await attempt(`spray${i}_${uid()}@x.test`, '198.51.100.250')).status);
        assert.equal(statuses.filter((s) => s === 401).length, 30, `${statuses}`);
        assert.equal(statuses[34], 429);
      } finally {
        app.set('trust proxy', false);
      }
    });
  });

  // =========================================================================
  // M3 / L2 — ADMIN RECOVERY
  // =========================================================================
  describe('M3/L2 — one-time, atomic admin recovery', () => {
    function capturingLogger() {
      const lines = [];
      const push = (...args) => lines.push(args.join(' '));
      return { lines, log: push, warn: push, error: push };
    }
    const recoveryEnv = (email, token, extra = {}) => ({
      ADMIN_EMAIL: email, ADMIN_PASSWORD: 'Recovered-Password-2026', ADMIN_RECOVERY: 'true', ADMIN_RECOVERY_TOKEN: token, ...extra,
    });

    async function lockedAdminFixture() {
      const businessId = `biz_rec_${uid()}`;
      const locked = await createUser({ role: 'admin', businessId, active: false });
      await User.updateOne({ _id: locked._id }, {
        $set: { passwordResetTokenHash: sha256Hex('stale'), passwordResetExpires: new Date(Date.now() + 3600_000), passwordResetTokenVersion: 0 },
      });
      const sessionDoc = await AuthSession.create({
        userId: locked._id, businessId, tokenHash: crypto.randomBytes(32).toString('hex'),
        tokenVersion: 0, expiresAt: new Date(Date.now() + 3600_000),
      });
      return { businessId, locked, sessionDoc };
    }

    it('a leftover ADMIN_RECOVERY flag without a token never changes an intentionally deactivated admin', async () => {
      const { businessId, locked } = await lockedAdminFixture();
      const logger = capturingLogger();
      const result = await bootstrapAdmin({ env: { ADMIN_EMAIL: locked.email, ADMIN_PASSWORD: 'Recovered-Password-2026', ADMIN_RECOVERY: 'true' }, logger, businessId });
      assert.equal(result.action, 'recovery_refused');
      const stored = await User.findById(locked._id).lean();
      assert.equal(stored.active, false);
      assert.equal(stored.tokenVersion, 0);
      assert.ok(logger.lines.some((l) => /ADMIN_RECOVERY_TOKEN/.test(l)));
    });

    it('recovery replaces the password, increments tokenVersion, kills sessions, refresh and reset tokens, audits — in one go', async () => {
      const { businessId, locked } = await lockedAdminFixture();
      const oldAccessToken = tokenFor(locked);
      const token = recoveryToken();
      const logger = capturingLogger();
      const result = await bootstrapAdmin({ env: recoveryEnv(locked.email, token), logger, businessId });
      assert.equal(result.action, 'recovered');

      const stored = await User.findById(locked._id).select(`+passwordHash ${RESET_SELECT}`).lean();
      assert.equal(stored.role, 'admin');
      assert.equal(stored.active, true);
      assert.equal(stored.tokenVersion, 1);
      assert.ok(await verifyPassword('Recovered-Password-2026', stored.passwordHash));
      assert.equal(stored.passwordResetTokenHash, undefined);
      assert.equal(stored.passwordResetTokenVersion, undefined);
      assert.equal(await AuthSession.countDocuments({ userId: locked._id, revokedAt: null }), 0);
      assert.equal((await request('GET', '/api/auth/me', { token: oldAccessToken })).status, 401, 'old access token dead');

      const auditEntry = await AuditLog.findOne({ action: 'user.admin_recovery', resourceId: String(locked._id) }).lean();
      assert.ok(auditEntry);
      assert.equal(auditEntry.after.method, 'one_time_token');
      assert.equal(auditEntry.after.sessionsRevoked, 1);
      assert.equal(auditEntry.expiresAt, undefined, 'recovery audit is never expired');
      const consumption = await AdminRecoveryConsumption.findById(sha256Hex(token)).lean();
      assert.equal(String(consumption.userId), String(locked._id));
      assert.equal(JSON.stringify(consumption).includes(token), false, 'only the token hash is stored');
      for (const line of logger.lines) {
        assert.equal(line.includes(token) || line.includes('Recovered-Password-2026'), false, 'no credentials in logs');
      }
    });

    it('repeated start-ups with the same (leftover) token change nothing after the first one', async () => {
      const { businessId, locked } = await lockedAdminFixture();
      const env = recoveryEnv(locked.email, recoveryToken());
      assert.equal((await bootstrapAdmin({ env, logger: capturingLogger(), businessId })).action, 'recovered');
      const first = await User.findById(locked._id).select('+passwordHash').lean();
      for (let i = 0; i < 3; i += 1) {
        assert.equal((await bootstrapAdmin({ env, logger: capturingLogger(), businessId })).action, 'recovery_token_consumed');
      }
      const later = await User.findById(locked._id).select('+passwordHash').lean();
      assert.equal(later.tokenVersion, first.tokenVersion);
      assert.equal(later.passwordHash, first.passwordHash);
      assert.equal(await AuditLog.countDocuments({ action: 'user.admin_recovery', resourceId: String(locked._id) }), 1);
    });

    it('leftover flags after a deliberate deactivation: consumed token is inert, a new token is refused while another admin is active, override is explicit and audited', async () => {
      const { businessId, locked } = await lockedAdminFixture();
      const firstToken = recoveryToken();
      assert.equal((await bootstrapAdmin({ env: recoveryEnv(locked.email, firstToken), logger: capturingLogger(), businessId })).action, 'recovered');
      // The recovered admin appoints a second admin, who then deliberately deactivates the first.
      const second = await createUser({ role: 'admin', businessId });
      const off = await request('PATCH', `/api/users/${locked._id}/status`, { token: tokenFor(second), body: { active: false } });
      assert.equal(off.status, 200);

      assert.equal((await bootstrapAdmin({ env: recoveryEnv(locked.email, firstToken), logger: capturingLogger(), businessId })).action, 'recovery_token_consumed');
      const refusedLogger = capturingLogger();
      const refused = await bootstrapAdmin({ env: recoveryEnv(locked.email, recoveryToken()), logger: refusedLogger, businessId });
      assert.equal(refused.action, 'recovery_refused');
      assert.equal(refused.reason, 'active_admin_exists');
      assert.equal((await User.findById(locked._id).lean()).active, false, 'deliberate deactivation respected');

      const emergency = await bootstrapAdmin({
        env: recoveryEnv(locked.email, recoveryToken(), { ADMIN_RECOVERY_OVERRIDE_ACTIVE_ADMINS: 'true' }),
        logger: capturingLogger(),
        businessId,
      });
      assert.equal(emergency.action, 'recovered');
      const overrideAudit = await AuditLog.findOne({ action: 'user.admin_recovery', resourceId: String(locked._id), 'after.overrideActiveAdmins': true }).lean();
      assert.ok(overrideAudit, 'emergency override is audited');
      assert.equal(overrideAudit.after.otherActiveAdmins, 1);
    });

    it('concurrent recovery (several API instances starting at once): exactly one applies', async () => {
      const { businessId, locked } = await lockedAdminFixture();
      const env = recoveryEnv(locked.email, recoveryToken());
      const results = await Promise.all(Array.from({ length: 5 }, () => bootstrapAdmin({ env, logger: capturingLogger(), businessId })));
      const actions = results.map((r) => r.action).sort();
      assert.deepEqual(actions, ['recovered', 'recovery_token_consumed', 'recovery_token_consumed', 'recovery_token_consumed', 'recovery_token_consumed']);
      assert.equal((await User.findById(locked._id).lean()).tokenVersion, 1, 'tokenVersion incremented exactly once');
      assert.equal(await AuditLog.countDocuments({ action: 'user.admin_recovery', resourceId: String(locked._id) }), 1);
      assert.equal(await AdminRecoveryConsumption.countDocuments({ userId: locked._id }), 1);
    });

    it('an already active admin is left untouched (token consumed, attempt audited)', async () => {
      const businessId = `biz_rec_${uid()}`;
      const admin = await createUser({ role: 'admin', businessId });
      const token = recoveryToken();
      const result = await bootstrapAdmin({ env: recoveryEnv(admin.email, token), logger: capturingLogger(), businessId });
      assert.equal(result.action, 'none');
      const stored = await User.findById(admin._id).select('+passwordHash').lean();
      assert.ok(await verifyPassword(PASSWORD, stored.passwordHash), 'password unchanged');
      assert.equal(stored.tokenVersion, 0);
      assert.ok(await AuditLog.findOne({ action: 'user.admin_recovery_skipped', resourceId: String(admin._id) }));
      assert.equal((await bootstrapAdmin({ env: recoveryEnv(admin.email, token), logger: capturingLogger(), businessId })).action, 'recovery_token_consumed');
    });

    it('fails closed when the audit record cannot be written: nothing changes, token stays unused', async () => {
      const { businessId, locked, sessionDoc } = await lockedAdminFixture();
      const token = recoveryToken();
      const originalCreate = AuditLog.create;
      AuditLog.create = async function failingCreate(docs, options) {
        if (Array.isArray(docs) && docs[0]?.action === 'user.admin_recovery') throw new Error('audit store unavailable');
        return originalCreate.call(this, docs, options);
      };
      try {
        await assert.rejects(bootstrapAdmin({ env: recoveryEnv(locked.email, token), logger: capturingLogger(), businessId }), /audit store unavailable/);
      } finally {
        AuditLog.create = originalCreate;
      }
      const stored = await User.findById(locked._id).select(`+passwordHash ${RESET_SELECT}`).lean();
      assert.equal(stored.active, false);
      assert.equal(stored.tokenVersion, 0);
      assert.ok(await verifyPassword(PASSWORD, stored.passwordHash), 'password not replaced');
      assert.ok(stored.passwordResetTokenHash, 'rolled back as a whole');
      assert.equal((await AuthSession.findById(sessionDoc._id).lean()).revokedAt, null, 'sessions untouched');
      assert.equal(await AdminRecoveryConsumption.exists({ _id: sha256Hex(token) }), null, 'token not consumed');
      // The operator can retry with the same token once the audit store is back.
      assert.equal((await bootstrapAdmin({ env: recoveryEnv(locked.email, token), logger: capturingLogger(), businessId })).action, 'recovered');
    });

    it('rejects weak tokens and tokens equal to the password; a token without ADMIN_RECOVERY is ignored', async () => {
      const { businessId, locked } = await lockedAdminFixture();
      await assert.rejects(bootstrapAdmin({ env: recoveryEnv(locked.email, 'short-token'), logger: capturingLogger(), businessId }), /ADMIN_RECOVERY_TOKEN/);
      const same = 'Same-Value-For-Both-Password-And-Token-123';
      await assert.rejects(bootstrapAdmin({ env: recoveryEnv(locked.email, same, { ADMIN_PASSWORD: same }), logger: capturingLogger(), businessId }), /ADMIN_RECOVERY_TOKEN/);
      const logger = capturingLogger();
      const ignored = await bootstrapAdmin({ env: { ADMIN_EMAIL: locked.email, ADMIN_PASSWORD: 'Recovered-Password-2026', ADMIN_RECOVERY_TOKEN: recoveryToken() }, logger, businessId });
      assert.equal(ignored.action, 'none');
      assert.equal((await User.findById(locked._id).lean()).active, false);
    });
  });

  // =========================================================================
  // M4 — AUDIT DATA MINIMISATION
  // =========================================================================
  describe('M4 — audit data minimisation', () => {
    it('create → update → deactivate → delete through HTTP: no audit document contains the person\'s name or e-mail', async () => {
      const businessId = `biz_pii_${uid()}`;
      const admin = await createUser({ role: 'admin', businessId });
      const token = tokenFor(admin);
      const marker = uid();
      const email = `pii.${marker}@private-mail.test`;
      const created = await request('POST', '/api/users', {
        token, body: { email, name: `Ayşe Gizli ${marker}`, password: 'Brand-New-Staff-Pass-2026', role: 'staff', customPermissions: ['cash:closing'] },
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const id = created.body.user.id || created.body.user._id;
      const updated = await request('PUT', `/api/users/${id}`, { token, body: { name: `Ayşe Yeni ${marker}`, role: 'manager' } });
      assert.equal(updated.status, 200, JSON.stringify(updated.body));
      assert.equal((await request('PUT', `/api/users/${id}`, { token, body: { password: 'Another-Admin-Set-Pass-1' } })).status, 200);
      assert.equal((await request('PATCH', `/api/users/${id}/status`, { token, body: { active: false } })).status, 200);
      assert.equal((await request('DELETE', `/api/users/${id}`, { token })).status, 200);

      const raw = await AuditLog.collection.find({ resourceId: String(id) }).toArray();
      const actions = raw.map((d) => d.action).sort();
      assert.deepEqual(actions, ['user.create', 'user.deactivate', 'user.delete', 'user.update', 'user.update_with_password']);
      const serialized = JSON.stringify(raw);
      for (const needle of [email, marker, 'Ayşe', 'Gizli', 'private-mail']) {
        assert.equal(serialized.includes(needle), false, `audit trail contains "${needle}"`);
      }
      const update = raw.find((d) => d.action === 'user.update');
      assert.equal(update.before.role, 'staff');
      assert.equal(update.after.role, 'manager');
      assert.equal(update.after.nameChanged, true, 'the fact of a name change is kept');
      assert.deepEqual(raw.find((d) => d.action === 'user.create').after.customPermissions, ['cash:closing']);
      assert.ok(raw.every((d) => d.expiresAt === undefined), 'state-change records are retained');
    });

    it('authentication telemetry stores a network prefix instead of the IP and expires after the retention period', async () => {
      const user = await createUser({ businessId: `biz_ip_${uid()}` });
      assert.equal((await request('POST', '/api/auth/login', { body: { email: user.email, password: 'Wrong-Password-123' } })).status, 401);
      assert.equal((await request('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } })).status, 200);
      for (const action of ['auth.login_failed', 'auth.login']) {
        const doc = await AuditLog.collection.findOne({ action, actorUserId: user._id });
        assert.ok(doc, action);
        assert.equal(doc.after.ip, undefined, `${action}: no full IP`);
        assert.equal(doc.after.ipPrefix, '127.0.0.0/24');
        assert.equal(JSON.stringify(doc).includes('127.0.0.1'), false);
        const ttl = doc.expiresAt.getTime() - doc.createdAt.getTime();
        assert.ok(Math.abs(ttl - DEFAULT_TELEMETRY_RETENTION_DAYS * DAY_MS) < 60_000, `${action}: retention ${ttl / DAY_MS} days`);
      }
      const indexes = await AuditLog.collection.indexes();
      const ttlIndex = indexes.find((i) => i.key.expiresAt === 1);
      assert.equal(ttlIndex?.expireAfterSeconds, 0, 'TTL index removes only records that carry expiresAt');
    });

    it('SMTP failures are recorded as structured codes, never as raw SMTP text', async () => {
      const businessId = `biz_smtp_${uid()}`;
      const admin = await createUser({ role: 'admin', businessId });
      const target = await createUser({ businessId, email: `smtp.${uid()}@private-mail.test` });
      smtp.setRejectRecipients(true);
      const failed = await request('POST', `/api/users/${target._id}/password-reset`, { token: tokenFor(admin) });
      assert.equal(failed.status, 502);
      assert.equal((await request('POST', '/api/auth/forgot-password', { body: { email: target.email } })).status, 200);
      await emailService.flushPendingDeliveries();

      for (const action of ['user.password_reset_email_failed', 'auth.password_reset_email_failed']) {
        const doc = await AuditLog.collection.findOne({ action, resourceId: String(target._id) });
        assert.ok(doc, action);
        assert.deepEqual(Object.keys(doc.after).sort(), ['errorCode', 'smtpResponseCode'], `${action}: ${JSON.stringify(doc.after)}`);
        assert.match(doc.after.errorCode, /^[A-Z_]+$/);
        assert.equal(doc.after.smtpResponseCode, 550);
        assert.equal(/@|Mailbox|private-mail/.test(JSON.stringify(doc.after)), false);
      }
    });

    it('historical records are never rewritten and stay outside the retention policy', async () => {
      const actor = await createUser({ businessId: `biz_hist_${uid()}` });
      const legacy = {
        actorUserId: actor._id, action: 'user.update', resourceType: 'User', resourceId: String(actor._id),
        correlationId: 'legacy', after: { name: 'Legacy Name', email: 'legacy@example.test', ip: '203.0.113.9' }, createdAt: new Date('2025-01-01'),
      };
      const { insertedId } = await AuditLog.collection.insertOne({ ...legacy });
      // New activity for the same actor/resource.
      assert.equal((await request('POST', '/api/auth/login', { body: { email: actor.email, password: PASSWORD } })).status, 200);
      const stored = await AuditLog.collection.findOne({ _id: insertedId });
      assert.deepEqual(stored.after, legacy.after, 'legacy document untouched (separate, controlled procedure required)');
      assert.equal(stored.expiresAt, undefined, 'never picked up by the TTL index');
    });
  });

  // =========================================================================
  // L1 — PERMISSION REVOCATION RACE
  // =========================================================================
  describe('L1 — permission revocation while a request is in flight', () => {
    async function delegatedFixture(extraPermissions = []) {
      const businessId = `biz_l1_${uid()}`;
      await createUser({ role: 'admin', businessId });
      const manager = await createUser({ role: 'manager', businessId, customPermissions: ['users:read', 'users:write', ...extraPermissions] });
      const staff = await createUser({ role: 'staff', businessId });
      return { businessId, manager, staff, token: tokenFor(manager) };
    }

    it('direct: revoked customPermissions are detected inside the guarded transaction', async () => {
      const { businessId, manager } = await delegatedFixture();
      const reqUser = { _id: manager._id, role: 'manager', businessId, branch: manager.branch, tokenVersion: 0, customPermissions: manager.customPermissions };
      const req = { user: { ...reqUser, permissions: getEffectivePermissions(reqUser) } };
      await withBusinessAdminGuard(businessId, (session) => assertActorStillAuthorized(req, session, { permission: 'users:write' }));
      await User.updateOne({ _id: manager._id }, { $set: { customPermissions: ['users:read'] } });
      await assert.rejects(
        withBusinessAdminGuard(businessId, (session) => assertActorStillAuthorized(req, session, { permission: 'users:write' })),
        (error) => error instanceof GuardRejection && error.status === 409 && error.body.code === 'ACTOR_STATE_CHANGED',
      );
      // A required permission that the actor never had is rejected as well.
      const fresh = { user: { ...reqUser, customPermissions: ['users:read'], permissions: getEffectivePermissions({ ...reqUser, customPermissions: ['users:read'] }) } };
      await assert.rejects(
        withBusinessAdminGuard(businessId, (session) => assertActorStillAuthorized(fresh, session, { permission: 'users:write' })),
        GuardRejection,
      );
    });

    async function interleave({ businessId, managerId, fire, revoke }) {
      const holder = await holdBusinessGuard(businessId);
      const observed = waitForOperation(guardTouched(businessId));
      const pending = fire();
      await observed; // request authenticated + authorised with the old permissions
      if (revoke) await User.updateOne({ _id: managerId }, revoke, { session: holder.session });
      await holder.commit();
      return pending;
    }

    it('control: without a revocation the same interleaving succeeds (harness does not reject by itself)', async () => {
      const { businessId, manager, staff, token } = await delegatedFixture();
      const res = await interleave({
        businessId, managerId: manager._id,
        fire: () => request('PATCH', `/api/users/${staff._id}/status`, { token, body: { active: false } }),
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    });

    it('deactivation: revocation committed mid-request rejects the stale operation', async () => {
      const { businessId, manager, staff, token } = await delegatedFixture();
      const res = await interleave({
        businessId, managerId: manager._id,
        fire: () => request('PATCH', `/api/users/${staff._id}/status`, { token, body: { active: false } }),
        revoke: { $set: { customPermissions: [] } },
      });
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(res.body.code, 'ACTOR_STATE_CHANGED');
      assert.equal((await User.findById(staff._id).lean()).active, true);
    });

    it('privilege delegation: a permission revoked mid-request cannot still be granted (no stale escalation)', async () => {
      const { businessId, manager, staff, token } = await delegatedFixture(['cash:closing']);
      const res = await interleave({
        businessId, managerId: manager._id,
        fire: () => request('PUT', `/api/users/${staff._id}`, { token, body: { customPermissions: ['cash:closing'] } }),
        revoke: { $set: { customPermissions: ['users:read', 'users:write'] } },
      });
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.deepEqual((await User.findById(staff._id).lean()).customPermissions, []);
    });

    it('user creation: revoked users:write mid-request creates nothing', async () => {
      const { businessId, manager, token } = await delegatedFixture();
      const email = `late_${uid()}@remediation-v2.test`;
      const res = await interleave({
        businessId, managerId: manager._id,
        fire: () => request('POST', '/api/users', { token, body: { email, name: 'Late Staff', password: 'Late-Staff-Password-2026', role: 'staff' } }),
        revoke: { $set: { customPermissions: ['users:read'] } },
      });
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(await User.exists({ email }), null);
    });

    it('branch and tenant isolation still hold for delegated managers', async () => {
      const { manager, token } = await delegatedFixture();
      const otherBranch = await createUser({ role: 'staff', businessId: manager.businessId, branch: 'Başka Şube' });
      const otherTenant = await createUser({ role: 'staff', businessId: `biz_other_${uid()}`, branch: manager.branch });
      for (const target of [otherBranch, otherTenant]) {
        const res = await request('PATCH', `/api/users/${target._id}/status`, { token, body: { active: false } });
        assert.equal(res.status, 404);
        assert.equal((await User.findById(target._id).lean()).active, true);
      }
    });
  });

  // =========================================================================
  // L3 — RESET TOKEN RACES
  // =========================================================================
  describe('L3 — reset-token issuance vs. account state changes', () => {
    async function resetFixture() {
      const businessId = `biz_l3_${uid()}`;
      const admin = await createUser({ role: 'admin', businessId });
      const target = await createUser({ businessId });
      return { businessId, admin, target, token: tokenFor(admin) };
    }
    const validate = (rawToken) => request('POST', '/api/auth/reset-password/validate', { body: { token: rawToken } });
    const consume = (rawToken) => request('POST', '/api/auth/reset-password', { body: { token: rawToken, newPassword: 'Attacker-Chosen-Pass-2026' } });

    async function issueAndCapture(target, token) {
      const res = await request('POST', `/api/users/${target._id}/password-reset`, { token });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return extractResetToken(await smtp.waitForMessage((m) => m.to.includes(target.email)));
    }

    it('deactivation committed while the reset request waits on the guard: no token is issued', async () => {
      const { businessId, target, token } = await resetFixture();
      const holder = await holdBusinessGuard(businessId);
      await User.updateOne({ _id: target._id }, {
        $set: { active: false }, $inc: { tokenVersion: 1 },
        $unset: { passwordResetTokenHash: 1, passwordResetExpires: 1, passwordResetRequestedAt: 1, passwordResetTokenVersion: 1 },
      }, { session: holder.session });
      const observed = waitForOperation(guardTouched(businessId));
      const pending = request('POST', `/api/users/${target._id}/password-reset`, { token });
      await observed; // the request saw the account as active before the guard
      await holder.commit();
      const res = await pending;
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body.code, 'USER_INACTIVE');
      const stored = await User.findById(target._id).select(RESET_SELECT).lean();
      assert.equal(stored.passwordResetTokenHash, undefined, 'no token on a deactivated account');
      await emailService.flushPendingDeliveries();
      assert.equal(smtp.messages.filter((m) => m.to.includes(target.email)).length, 0, 'no e-mail sent');
    });

    it('issued → deactivated → re-activated: the old link stays dead', async () => {
      const { target, token } = await resetFixture();
      const rawToken = await issueAndCapture(target, token);
      assert.equal((await validate(rawToken)).status, 200);
      assert.equal((await request('PATCH', `/api/users/${target._id}/status`, { token, body: { active: false } })).status, 200);
      assert.equal((await request('PATCH', `/api/users/${target._id}/status`, { token, body: { active: true } })).status, 200);
      assert.equal((await validate(rawToken)).status, 400);
      assert.equal((await consume(rawToken)).status, 400);
    });

    it('a token left on an inactive account (outcome of the old race) is discarded by re-activation and by the state binding', async () => {
      const { target, token } = await resetFixture();
      const rawToken = generateOpaqueToken(32); // well-formed: rejection must come from the state checks
      // Simulate the pre-fix race result: deactivated, but a token written afterwards.
      await User.updateOne({ _id: target._id }, { $set: { active: false }, $inc: { tokenVersion: 1 } });
      await User.updateOne({ _id: target._id }, {
        $set: { passwordResetTokenHash: sha256Hex(rawToken), passwordResetExpires: new Date(Date.now() + 3600_000), passwordResetTokenVersion: 0 },
      });
      // Even before re-activation the stale version can never match again.
      await User.updateOne({ _id: target._id }, { $set: { active: true } });
      assert.equal((await validate(rawToken)).status, 400, 'tokenVersion binding');
      // Positive control: the same token bound to the current version would be valid.
      await User.updateOne({ _id: target._id }, { $set: { passwordResetTokenVersion: 1 } });
      assert.equal((await validate(rawToken)).status, 200, 'control: binding is what rejected it');
      await User.updateOne({ _id: target._id }, { $set: { active: false } });
      assert.equal((await request('PATCH', `/api/users/${target._id}/status`, { token, body: { active: true } })).status, 200);
      const stored = await User.findById(target._id).select(RESET_SELECT).lean();
      assert.equal(stored.passwordResetTokenHash, undefined, 're-activation clears reset tokens');
      assert.equal((await consume(rawToken)).status, 400);
    });

    it('session revocation / password change after issuance invalidates the link (bound to tokenVersion)', async () => {
      const { target, token } = await resetFixture();
      const rawToken = await issueAndCapture(target, token);
      assert.equal((await request('POST', `/api/users/${target._id}/sessions/revoke`, { token })).status, 200);
      assert.equal((await validate(rawToken)).status, 400);
      assert.equal((await consume(rawToken)).status, 400);
      const stored = await User.findById(target._id).select('+passwordHash').lean();
      assert.ok(await verifyPassword(PASSWORD, stored.passwordHash), 'password unchanged');
    });

    it('forgot-password racing a deactivation transaction issues no token (conditional write)', async () => {
      const { target } = await resetFixture();
      const holder = await holdUserWrite(target._id, {
        $set: { active: false }, $inc: { tokenVersion: 1 },
        $unset: { passwordResetTokenHash: 1, passwordResetExpires: 1, passwordResetRequestedAt: 1, passwordResetTokenVersion: 1 },
      });
      const observed = waitForOperation((collection, method, args) => collection === 'users' && method === 'updateOne'
        && Boolean(args[1]?.$set?.passwordResetTokenHash));
      const pending = request('POST', '/api/auth/forgot-password', { body: { email: target.email } });
      await observed; // lookup saw an active account; the token write now waits on our lock
      await holder.commit();
      const res = await pending;
      assert.equal(res.status, 200, 'generic response (no account enumeration)');
      await emailService.flushPendingDeliveries();
      const stored = await User.findById(target._id).select(RESET_SELECT).lean();
      assert.equal(stored.active, false);
      assert.equal(stored.passwordResetTokenHash, undefined);
      assert.equal(smtp.messages.filter((m) => m.to.includes(target.email)).length, 0);
    });

    it('concurrent reset issuance and deactivation never leave a usable token (20×)', async () => {
      for (let i = 0; i < 20; i += 1) {
        const { target, token } = await resetFixture();
        smtp.clear();
        const [issue, deactivate] = await Promise.all([
          request('POST', `/api/users/${target._id}/password-reset`, { token }),
          request('PATCH', `/api/users/${target._id}/status`, { token, body: { active: false } }),
        ]);
        assert.equal(deactivate.status, 200, `iteration ${i}`);
        assert.ok([200, 400].includes(issue.status), `iteration ${i}: ${issue.status} ${JSON.stringify(issue.body)}`);
        assert.equal((await request('PATCH', `/api/users/${target._id}/status`, { token, body: { active: true } })).status, 200);
        const message = smtp.messages.find((m) => m.to.includes(target.email));
        if (message) {
          assert.equal((await consume(extractResetToken(message))).status, 400, `iteration ${i}: token survived deactivation`);
        }
        assert.equal((await User.findById(target._id).select(RESET_SELECT).lean()).passwordResetTokenHash, undefined, `iteration ${i}`);
      }
    });

    it('deleted accounts cannot receive a reset link', async () => {
      const { target, token } = await resetFixture();
      assert.equal((await request('PATCH', `/api/users/${target._id}/status`, { token, body: { active: false } })).status, 200);
      assert.equal((await request('DELETE', `/api/users/${target._id}`, { token })).status, 200);
      assert.equal((await request('POST', `/api/users/${target._id}/password-reset`, { token })).status, 404);
    });
  });

  // =========================================================================
  // L4 — ORIGINS OVER HTTP
  // =========================================================================
  describe('L4 — CORS and CSRF share one canonical origin representation', () => {
    const preflight = (origin) => request('OPTIONS', '/api/auth/login', {
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });

    it('allowlisted origin is reflected; look-alikes and malformed origins get no CORS grant and fail CSRF', async () => {
      const ok = await preflight('http://localhost:8080');
      assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:8080');
      assert.equal(ok.headers['access-control-allow-credentials'], 'true');
      for (const origin of ['http://localhost:8080.evil.example', 'http://localhost:8081', 'http://localhost:8080/x', 'null']) {
        assert.equal((await preflight(origin)).headers['access-control-allow-origin'], undefined, origin);
        const login = await request('POST', '/api/auth/login', { body: { email: 'x@y.test', password: 'z' }, headers: { Origin: origin } });
        assert.equal(login.status, 403, origin);
        assert.equal(login.body.code, 'CSRF_ORIGIN_REJECTED');
      }
    });

    it('a trailing slash in CORS_ORIGIN no longer breaks (or diverges between) CORS and CSRF', async () => {
      const user = await createUser({ businessId: `biz_l4_${uid()}` });
      const saved = process.env.CORS_ORIGIN;
      process.env.CORS_ORIGIN = 'http://localhost:8080/';
      try {
        assert.equal((await preflight('http://localhost:8080')).headers['access-control-allow-origin'], 'http://localhost:8080');
        const login = await request('POST', '/api/auth/login', {
          body: { email: user.email, password: PASSWORD }, headers: { Origin: 'http://localhost:8080' },
        });
        assert.equal(login.status, 200, JSON.stringify(login.body));
      } finally {
        process.env.CORS_ORIGIN = saved;
      }
    });
  });

  // =========================================================================
  // L6 — PRICE REFRESH WITH REAL AUTHENTICATION
  // =========================================================================
  describe('L6 — price refresh limiter uses the authenticated identity', () => {
    it('users behind one NAT IP have independent budgets; one user cannot reset by changing IP', async () => {
      const mini = express();
      mini.set('trust proxy', 1);
      mini.post('/refresh', authenticate, priceRefreshRateLimit, (req, res) => res.json({ ok: true }));
      const miniServer = await new Promise((resolve) => { const s = mini.listen(0, '127.0.0.1', () => resolve(s)); });
      const base = `http://127.0.0.1:${miniServer.address().port}`;
      try {
        priceRefreshRateLimit.reset();
        const businessId = `biz_l6_${uid()}`;
        const alice = await createUser({ businessId });
        const bob = await createUser({ businessId });
        const call = (user, ip) => request('POST', '/refresh', { base, token: tokenFor(user), headers: { 'X-Forwarded-For': ip } });
        assert.equal((await call(alice, '203.0.113.1')).status, 200);
        assert.equal((await call(bob, '203.0.113.1')).status, 200, 'same NAT IP, different user');
        const again = await call(alice, '2001:db8::99');
        assert.equal(again.status, 429, 'per-user limit survives an IP change');
        assert.ok(again.body.retryAfterSeconds >= 1);
      } finally {
        await new Promise((r) => miniServer.close(r));
      }
    });
  });

  // =========================================================================
  // L7 — MONGODB TRANSACTION REQUIREMENTS
  // =========================================================================
  describe('L7 — MongoDB transaction capability', () => {
    let standalone;
    before(async () => {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      standalone = await MongoMemoryServer.create();
    });
    after(async () => {
      if (standalone) await standalone.stop();
    });

    it('replica set (test deployment): detected from the live server and a real transaction commits', async () => {
      const result = await verifyTransactionSupport(mongoose.connection, { required: true });
      assert.equal(result.supported, true);
      assert.equal(result.topology, 'replicaSet');
    });

    it('standalone server: refused when required (production), warning only otherwise — no URI in messages', async () => {
      const standaloneUri = standalone.getUri('jeweler_standalone_check');
      const connection = await mongoose.createConnection(standaloneUri).asPromise();
      try {
        await assert.rejects(verifyTransactionSupport(connection, { required: true }), (error) => {
          assert.ok(error instanceof TransactionSupportError);
          assert.match(error.message, /standalone/);
          assert.equal(error.message.includes(standaloneUri), false);
          assert.equal(error.message.includes(String(new URL(standaloneUri).port)), false);
          return true;
        });
        const warnings = [];
        const result = await verifyTransactionSupport(connection, { required: false, logger: { warn: (m) => warnings.push(m) } });
        assert.equal(result.supported, false);
        assert.equal(warnings.length, 1);
      } finally {
        await connection.close();
      }
    });

    it('production start-up against a standalone server fails clearly and does not start HTTP', () => {
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jeweler-l7-')); // no .env here
      const serverPath = path.join(__dirname, '..', 'server.js');
      const standaloneUri = standalone.getUri('jeweler_prod_check');
      const env = {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        NODE_ENV: ' Production ',
        JWT_SECRET: crypto.randomBytes(48).toString('hex'),
        MONGO_URI: standaloneUri,
        CORS_ORIGIN: 'https://erp.example.com',
        APP_URL: 'https://erp.example.com',
        TRUST_PROXY: '1',
        PORT: '0',
      };
      const script = `require(${JSON.stringify(serverPath)}).startServer().then((r) => {
        console.log('RESULT=' + (r === null ? 'refused' : 'started'));
        process.exit(process.exitCode || 0);
      });`;
      const child = spawnSync(process.execPath, ['-e', script], { cwd: workDir, env, encoding: 'utf8', timeout: 60_000 });
      fs.rmSync(workDir, { recursive: true, force: true });
      assert.equal(child.status, 1, child.stdout + child.stderr);
      assert.match(child.stdout, /RESULT=refused/);
      // Refused by the transaction gate itself (not by a later start-up step).
      assert.match(child.stderr, /MongoDB üretim gereksinimlerini karşılamıyor/);
      assert.match(child.stderr, /standalone/);
      assert.equal((child.stdout + child.stderr).includes(standaloneUri), false, 'connection string not logged');
      assert.equal(/listening on port/.test(child.stdout), false);
    });
  });
});
