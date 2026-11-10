/**
 * End-to-end API tests for authentication, password reset and user
 * authorization. Runs against a real MongoDB (MONGO_URI, provided by
 * `npm test` via scripts/runTests.js) and a real SMTP socket server.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'integration-secret-with-more-than-thirty-two-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';
process.env.APP_URL = 'http://localhost:8080';
process.env.PASSWORD_RESET_COOLDOWN_SECONDS = '0';

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const AuthSession = require('../models/AuthSession');
const AuditLog = require('../models/AuditLog');
const { verifyToken, signToken } = require('../middleware/auth');
const { ALL_PERMISSIONS, ROLE_PERMISSIONS } = require('../middleware/authorization');
const { hashPassword } = require('../utils/passwords');
const { resetAllRateLimiters } = require('../middleware/rateLimit');
const emailService = require('../services/emailService');
const { startSmtpServer, extractResetToken } = require('../testSupport/smtpServer');

const PASSWORD = 'Correct-Horse-Battery-9';
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const uid = () => crypto.randomBytes(4).toString('hex');

let server;
let baseUrl;
let smtp;

// ---------------------------------------------------------------------------
// HTTP client with a cookie jar (mimics a browser for the refresh cookie)
// ---------------------------------------------------------------------------
function parseSetCookie(header) {
  const [pair, ...attrs] = header.split(';').map((s) => s.trim());
  const eq = pair.indexOf('=');
  const cookie = { name: pair.slice(0, eq), value: pair.slice(eq + 1), attributes: {} };
  for (const attr of attrs) {
    const [k, ...v] = attr.split('=');
    cookie.attributes[k.toLowerCase()] = v.length ? v.join('=') : true;
  }
  return cookie;
}

function createClient() {
  const jar = new Map();
  const client = {
    jar,
    token: null,
    lastSetCookies: [],
    async request(method, path, { body, token, csrf = true, origin, headers = {}, cookies = true } = {}) {
      const url = new URL(path, baseUrl);
      const reqHeaders = { ...headers };
      const bearer = token === undefined ? client.token : token;
      if (bearer) reqHeaders.Authorization = `Bearer ${bearer}`;
      if (csrf) reqHeaders['X-Requested-With'] = 'XMLHttpRequest';
      if (origin) reqHeaders.Origin = origin;
      if (cookies && jar.size) {
        reqHeaders.Cookie = [...jar.values()].map((c) => `${c.name}=${c.value}`).join('; ');
      }
      const payload = body === undefined ? null : JSON.stringify(body);
      if (payload) reqHeaders['Content-Type'] = 'application/json';

      return new Promise((resolve, reject) => {
        const req = http.request(url, { method, headers: reqHeaders }, (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { raw += c; });
          res.on('end', () => {
            const setCookies = (res.headers['set-cookie'] || []).map(parseSetCookie);
            client.lastSetCookies = setCookies;
            for (const c of setCookies) {
              const expires = c.attributes.expires ? new Date(c.attributes.expires) : null;
              if (!c.value || (expires && expires.getTime() <= Date.now())) jar.delete(c.name);
              else jar.set(c.name, c);
            }
            let parsed = null;
            try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
            resolve({ status: res.statusCode, body: parsed, headers: res.headers, setCookies });
          });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
      });
    },
    async login(email, password = PASSWORD, rememberMe = false) {
      const res = await client.request('POST', '/api/auth/login', { body: { email, password, rememberMe } });
      if (res.status === 200) client.token = res.body.token;
      return res;
    },
    refreshCookie() {
      return jar.get('jeweler_refresh_token') || null;
    },
  };
  return client;
}

async function createUser({
  role = 'staff',
  branch = 'Merkez',
  businessId = 'biz_main_test',
  customPermissions = [],
  active = true,
  password = PASSWORD,
  name,
} = {}) {
  return User.create({
    email: `${role}_${uid()}@jeweler.test`,
    name: name || `Test ${role}`,
    passwordHash: await hashPassword(password),
    role,
    branch,
    businessId,
    customPermissions,
    active,
  });
}

async function loggedIn(user, rememberMe = false) {
  const client = createClient();
  const res = await client.login(user.email, PASSWORD, rememberMe);
  assert.equal(res.status, 200, `login failed for ${user.email}: ${JSON.stringify(res.body)}`);
  return client;
}

function configureSmtp() {
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtp.port);
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  emailService.resetCache();
}

function unconfigureSmtp() {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  emailService.resetCache();
}

async function freePort() {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));
  return port;
}

describe('Authentication & authorization (real MongoDB + SMTP)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  before(async () => {
    await mongoose.connect(uri);
    await Promise.all([User.init(), AuthSession.init(), AuditLog.init()]);
    smtp = await startSmtpServer();
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await emailService.flushPendingDeliveries();
    await new Promise((r) => server.close(r));
    await smtp.close();
    await mongoose.disconnect();
  });

  beforeEach(() => {
    resetAllRateLimiters();
    smtp.clear();
    smtp.setRejectRecipients(false);
    configureSmtp();
    delete process.env.REFRESH_REUSE_GRACE_SECONDS;
    delete process.env.ACCESS_TOKEN_TTL_SECONDS;
    delete process.env.REMEMBER_ME_TTL_DAYS;
    delete process.env.SESSION_TTL_HOURS;
    process.env.PASSWORD_RESET_COOLDOWN_SECONDS = '0';
  });

  // =========================================================================
  // A. REMEMBER ME, SESSIONS, TOKEN EXPIRY & ROTATION
  // =========================================================================
  describe('A. Remember Me & session lifecycle', () => {
    it('rememberMe=true issues a persistent HttpOnly/SameSite=Strict refresh cookie; only its hash is stored', async () => {
      const user = await createUser();
      const client = createClient();
      const res = await client.login(user.email, PASSWORD, true);

      assert.equal(res.status, 200);
      const cookie = client.refreshCookie();
      assert.ok(cookie, 'refresh cookie must be set');
      assert.equal(cookie.attributes.httponly, true);
      assert.equal(String(cookie.attributes.samesite).toLowerCase(), 'strict');
      assert.equal(cookie.attributes.path, '/api/auth');
      const expires = new Date(cookie.attributes.expires).getTime();
      const days = (expires - Date.now()) / 86_400_000;
      assert.ok(days > 29.9 && days <= 30, `persistent cookie should last 30 days, got ${days}`);

      assert.equal(JSON.stringify(res.body).includes(cookie.value), false, 'refresh token must never be in the JSON body');
      assert.equal(res.body.session.persistent, true);
      const claims = verifyToken(res.body.token);
      assert.equal(claims.sid, res.body.session.id);

      const stored = await AuthSession.findById(claims.sid).lean();
      assert.equal(stored.tokenHash, sha256(cookie.value));
      assert.equal(JSON.stringify(stored).includes(cookie.value), false, 'raw refresh token must not be persisted');
      assert.equal(stored.persistent, true);
    });

    it('rememberMe=false issues a browser-session cookie (no Expires) with a 12h server-side lifetime', async () => {
      const user = await createUser();
      const client = createClient();
      const res = await client.login(user.email, PASSWORD, false);

      assert.equal(res.status, 200);
      const cookie = client.refreshCookie();
      assert.ok(cookie);
      assert.equal(cookie.attributes.expires, undefined, 'session cookie must not carry Expires');
      assert.equal(cookie.attributes['max-age'], undefined, 'session cookie must not carry Max-Age');
      const session = await AuthSession.findById(res.body.session.id).lean();
      assert.equal(session.persistent, false);
      const hours = (session.expiresAt.getTime() - Date.now()) / 3_600_000;
      assert.ok(hours > 11.9 && hours <= 12, `expected ~12h, got ${hours}`);
    });

    it('session and access token lifetimes are configurable via environment', async () => {
      process.env.ACCESS_TOKEN_TTL_SECONDS = '120';
      process.env.REMEMBER_ME_TTL_DAYS = '7';
      const user = await createUser();
      const client = createClient();
      const res = await client.login(user.email, PASSWORD, true);
      const claims = verifyToken(res.body.token);
      assert.equal(res.body.expiresIn, 120);
      assert.equal(claims.exp - claims.iat, 120);
      const days = (new Date(client.refreshCookie().attributes.expires).getTime() - Date.now()) / 86_400_000;
      assert.ok(days > 6.9 && days <= 7, `expected ~7 days, got ${days}`);
    });

    it('an expired access token is rejected and the refresh cookie obtains a new one', async () => {
      const user = await createUser();
      const client = await loggedIn(user, true);
      const sid = verifyToken(client.token).sid;
      const expired = signToken(user, -5, { sessionId: sid });

      assert.equal((await client.request('GET', '/api/auth/me', { token: expired })).status, 401);

      const refreshed = await client.request('POST', '/api/auth/refresh');
      assert.equal(refreshed.status, 200);
      assert.equal(verifyToken(refreshed.body.token).sid, sid, 'refresh keeps the same device session');
      const me = await client.request('GET', '/api/auth/me', { token: refreshed.body.token });
      assert.equal(me.status, 200);
      assert.equal(me.body.email, user.email);
    });

    it('refresh rotates the token; parallel-tab replay inside the grace window gets 409 without clearing the cookie', async () => {
      const user = await createUser();
      const client = await loggedIn(user, true);
      const original = client.refreshCookie().value;

      const first = await client.request('POST', '/api/auth/refresh');
      assert.equal(first.status, 200);
      const rotated = client.refreshCookie().value;
      assert.notEqual(rotated, original);

      const stale = createClient();
      stale.jar.set('jeweler_refresh_token', { name: 'jeweler_refresh_token', value: original, attributes: {} });
      const race = await stale.request('POST', '/api/auth/refresh');
      assert.equal(race.status, 409);
      assert.equal(race.body.code, 'REFRESH_TOKEN_ROTATED');
      assert.equal(race.setCookies.length, 0, 'must not clear the cookie the other tab just received');

      const again = await client.request('POST', '/api/auth/refresh');
      assert.equal(again.status, 200, 'the latest token keeps working after a benign race');
    });

    it('replaying a rotated refresh token after the grace window revokes the whole session (theft detection)', async () => {
      process.env.REFRESH_REUSE_GRACE_SECONDS = '0';
      const user = await createUser();
      const victim = await loggedIn(user, true);
      const stolen = victim.refreshCookie().value;

      assert.equal((await victim.request('POST', '/api/auth/refresh')).status, 200);
      const victimAccess = (await victim.request('POST', '/api/auth/refresh')).body.token;
      victim.token = victimAccess;

      const attacker = createClient();
      attacker.jar.set('jeweler_refresh_token', { name: 'jeweler_refresh_token', value: stolen, attributes: {} });
      const replay = await attacker.request('POST', '/api/auth/refresh');
      assert.equal(replay.status, 401);
      assert.equal(replay.body.code, 'REFRESH_TOKEN_REUSED');

      assert.equal((await victim.request('POST', '/api/auth/refresh')).status, 401, 'legit token of the compromised session is dead too');
      assert.equal((await victim.request('GET', '/api/auth/me')).status, 401, 'session-bound access token is revoked immediately');
      const audit = await AuditLog.findOne({ action: 'auth.refresh_token_reuse_detected', actorUserId: user._id });
      assert.ok(audit, 'reuse detection must be audited');
    });

    it('refresh is protected against CSRF: custom header required and foreign Origin rejected', async () => {
      const user = await createUser();
      const client = await loggedIn(user, true);

      const noHeader = await client.request('POST', '/api/auth/refresh', { csrf: false });
      assert.equal(noHeader.status, 403);
      assert.equal(noHeader.body.code, 'CSRF_HEADER_MISSING');

      const foreign = await client.request('POST', '/api/auth/refresh', { origin: 'https://evil.example' });
      assert.equal(foreign.status, 403);
      assert.equal(foreign.body.code, 'CSRF_ORIGIN_REJECTED');

      const allowed = await client.request('POST', '/api/auth/refresh', { origin: 'http://localhost:8080' });
      assert.equal(allowed.status, 200);
    });

    it('refresh body tokens are ignored (cookie only) and missing cookie returns 401', async () => {
      const user = await createUser();
      const client = await loggedIn(user, true);
      const raw = client.refreshCookie().value;
      const anonymous = createClient();
      const res = await anonymous.request('POST', '/api/auth/refresh', { body: { refreshToken: raw } });
      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'REFRESH_TOKEN_MISSING');
    });

    it('an expired server-side session cannot be refreshed and the cookie is cleared', async () => {
      const user = await createUser();
      const client = await loggedIn(user, true);
      await AuthSession.updateOne({ _id: verifyToken(client.token).sid }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const res = await client.request('POST', '/api/auth/refresh');
      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'REFRESH_TOKEN_INVALID');
      assert.equal(client.refreshCookie(), null, 'cookie must be cleared');
    });

    it('logout revokes only the current device: its access + refresh tokens die, other devices keep working', async () => {
      const user = await createUser();
      const deviceA = await loggedIn(user, true);
      const deviceB = await loggedIn(user, true);
      const cookieA = deviceA.refreshCookie().value;

      const out = await deviceA.request('POST', '/api/auth/logout');
      assert.equal(out.status, 200);
      assert.equal(deviceA.refreshCookie(), null, 'logout must clear the cookie');

      assert.equal((await deviceA.request('GET', '/api/auth/me')).status, 401);
      const replay = createClient();
      replay.jar.set('jeweler_refresh_token', { name: 'jeweler_refresh_token', value: cookieA, attributes: {} });
      assert.equal((await replay.request('POST', '/api/auth/refresh')).status, 401);

      assert.equal((await deviceB.request('GET', '/api/auth/me')).status, 200);
      assert.equal((await deviceB.request('POST', '/api/auth/refresh')).status, 200);
    });

    it('logout with only the cookie (expired access token) still revokes the refresh session', async () => {
      const user = await createUser();
      const client = await loggedIn(user, true);
      const raw = client.refreshCookie().value;
      const res = await client.request('POST', '/api/auth/logout', { token: null });
      assert.equal(res.status, 200);
      const session = await AuthSession.findOne({ tokenHash: sha256(raw) }).lean();
      assert.ok(session.revokedAt, 'session must be revoked server-side');
      assert.equal(session.revokedReason, 'logout');
    });

    it('cookie-based logout requires the CSRF header', async () => {
      const user = await createUser();
      const client = await loggedIn(user, true);
      const res = await client.request('POST', '/api/auth/logout', { csrf: false, token: null });
      assert.equal(res.status, 403);
    });

    it('logout-all signs the user out everywhere', async () => {
      const user = await createUser();
      const deviceA = await loggedIn(user, true);
      const deviceB = await loggedIn(user, false);
      assert.equal((await deviceA.request('POST', '/api/auth/logout-all')).status, 200);
      assert.equal((await deviceB.request('GET', '/api/auth/me')).status, 401);
      assert.equal((await deviceB.request('POST', '/api/auth/refresh')).status, 401);
      assert.ok(await AuditLog.findOne({ action: 'auth.logout_all', actorUserId: user._id }));
    });

    it('lists own sessions and revokes a single other session', async () => {
      const user = await createUser();
      const deviceA = await loggedIn(user, true);
      const deviceB = await loggedIn(user, false);
      const list = await deviceA.request('GET', '/api/auth/sessions');
      assert.equal(list.status, 200);
      assert.equal(list.body.data.length, 2);
      assert.equal(list.body.data.filter((s) => s.current).length, 1);
      assert.equal(JSON.stringify(list.body).includes('tokenHash'), false);

      const sidB = verifyToken(deviceB.token).sid;
      assert.equal((await deviceA.request('DELETE', `/api/auth/sessions/${sidB}`)).status, 200);
      assert.equal((await deviceB.request('GET', '/api/auth/me')).status, 401);
      assert.equal((await deviceA.request('GET', '/api/auth/me')).status, 200);

      const stranger = await loggedIn(await createUser());
      const sidA = verifyToken(deviceA.token).sid;
      assert.equal((await stranger.request('DELETE', `/api/auth/sessions/${sidA}`)).status, 404, 'cannot revoke someone else\'s session');
    });

    it('failed logins are rejected uniformly and audited for known accounts', async () => {
      const user = await createUser();
      const inactive = await createUser({ active: false });
      const client = createClient();
      const wrong = await client.login(user.email, 'Wrong-Password-123');
      const unknown = await client.login(`nobody_${uid()}@jeweler.test`, 'Wrong-Password-123');
      const disabled = await client.login(inactive.email, PASSWORD);
      for (const res of [wrong, unknown, disabled]) {
        assert.equal(res.status, 401);
        assert.equal(res.body.error, 'E-posta veya şifre hatalı');
        assert.equal(res.setCookies.length, 0);
      }
      assert.ok(await AuditLog.findOne({ action: 'auth.login_failed', actorUserId: user._id }));
      assert.ok(await AuditLog.findOne({ action: 'auth.login_failed', actorUserId: inactive._id }));
    });

    it('login is rate limited per IP + e-mail', async () => {
      const user = await createUser();
      const client = createClient();
      let last;
      for (let i = 0; i < 11; i += 1) last = await client.login(user.email, 'Wrong-Password-123');
      assert.equal(last.status, 429);
      assert.ok(last.headers['retry-after']);
    });
  });

  // =========================================================================
  // B. FORGOT / RESET PASSWORD
  // =========================================================================
  describe('B. Forgot & reset password', () => {
    async function requestReset(email) {
      return createClient().request('POST', '/api/auth/forgot-password', { body: { email } });
    }

    async function receiveToken(email) {
      await emailService.flushPendingDeliveries();
      const message = await smtp.waitForMessage((m) => m.to.includes(email));
      return { message, token: extractResetToken(message) };
    }

    it('returns 503 SMTP_UNCONFIGURED (no fake success) and stores no token when e-mail is not configured', async () => {
      unconfigureSmtp();
      const user = await createUser();
      for (const email of [user.email, `ghost_${uid()}@jeweler.test`]) {
        const res = await requestReset(email);
        assert.equal(res.status, 503);
        assert.equal(res.body.code, 'SMTP_UNCONFIGURED');
      }
      const stored = await User.findById(user._id).select('+passwordResetTokenHash').lean();
      assert.equal(stored.passwordResetTokenHash, undefined);
      assert.equal(smtp.messages.length, 0);
    });

    it('returns 503 SMTP_UNAVAILABLE for every address when the SMTP server is unreachable', async () => {
      process.env.SMTP_PORT = String(await freePort());
      emailService.resetCache();
      const user = await createUser();
      const known = await requestReset(user.email);
      const unknown = await requestReset(`ghost_${uid()}@jeweler.test`);
      assert.equal(known.status, 503);
      assert.equal(unknown.status, 503);
      assert.equal(known.body.code, 'SMTP_UNAVAILABLE');
      assert.deepEqual(known.body, unknown.body, 'outage response must not reveal account existence');
    });

    it('full flow: identical responses, hashed single-use token, real e-mail, sessions revoked, audit trail', async () => {
      const user = await createUser({ name: 'Ayşe Kuyumcu' });
      const oldDevice = await loggedIn(user, true);
      const oldCookie = oldDevice.refreshCookie().value;

      const known = await requestReset(user.email);
      const unknown = await requestReset(`ghost_${uid()}@jeweler.test`);
      assert.equal(known.status, 200);
      assert.deepEqual(known.body, unknown.body, 'known and unknown e-mails must get the same response');

      const { message, token } = await receiveToken(user.email);
      assert.ok(token, 'e-mail must contain a reset link with a 256-bit token');
      assert.equal(message.text.includes(encodeURIComponent(user.email)), false, 'link must not leak the e-mail address');
      assert.ok(message.text.includes('http://localhost:8080/reset-password?token='));
      assert.equal(smtp.messages.length, 1, 'no e-mail for unknown address');

      const stored = await User.findById(user._id).select('+passwordResetTokenHash +passwordResetExpires').lean();
      assert.equal(stored.passwordResetTokenHash, sha256(token), 'only the SHA-256 hash is stored');
      const minutes = (stored.passwordResetExpires.getTime() - Date.now()) / 60_000;
      assert.ok(minutes > 59 && minutes <= 60);

      const anon = createClient();
      const valid = await anon.request('POST', '/api/auth/reset-password/validate', { body: { token } });
      assert.equal(valid.status, 200);
      assert.equal(valid.body.valid, true);

      const newPassword = 'Brand-New-Secret-2026';
      const reset = await anon.request('POST', '/api/auth/reset-password', { body: { token, newPassword } });
      assert.equal(reset.status, 200);

      const reuse = await anon.request('POST', '/api/auth/reset-password', { body: { token, newPassword: 'Another-Secret-2026' } });
      assert.equal(reuse.status, 400);
      assert.equal(reuse.body.code, 'RESET_TOKEN_INVALID');
      assert.equal((await anon.request('POST', '/api/auth/reset-password/validate', { body: { token } })).status, 400);

      assert.equal((await createClient().login(user.email, PASSWORD)).status, 401, 'old password no longer works');
      assert.equal((await createClient().login(user.email, newPassword)).status, 200, 'new password works');

      assert.equal((await oldDevice.request('GET', '/api/auth/me')).status, 401, 'pre-reset access token is invalid');
      const replay = createClient();
      replay.jar.set('jeweler_refresh_token', { name: 'jeweler_refresh_token', value: oldCookie, attributes: {} });
      assert.equal((await replay.request('POST', '/api/auth/refresh')).status, 401, 'pre-reset remember-me session is invalid');

      assert.ok(await AuditLog.findOne({ action: 'auth.password_reset_requested', actorUserId: user._id }));
      assert.ok(await AuditLog.findOne({ action: 'auth.password_reset_completed', actorUserId: user._id }));

      await emailService.flushPendingDeliveries();
      const notice = smtp.messages.find((m) => m.to.includes(user.email) && m.text.includes('şifresi az önce değiştirildi'));
      assert.ok(notice, 'a password-changed notice e-mail must be sent');
    });

    it('expired tokens are rejected', async () => {
      const user = await createUser();
      await requestReset(user.email);
      const { token } = await receiveToken(user.email);
      await User.updateOne({ _id: user._id }, { $set: { passwordResetExpires: new Date(Date.now() - 1000) } });
      const anon = createClient();
      assert.equal((await anon.request('POST', '/api/auth/reset-password/validate', { body: { token } })).status, 400);
      const res = await anon.request('POST', '/api/auth/reset-password', { body: { token, newPassword: 'Brand-New-Secret-2026' } });
      assert.equal(res.status, 400);
      assert.equal((await createClient().login(user.email, PASSWORD)).status, 200, 'password unchanged');
    });

    it('a newer request supersedes the previous token', async () => {
      const user = await createUser();
      await requestReset(user.email);
      const { token: first } = await receiveToken(user.email);
      smtp.clear();
      await requestReset(user.email);
      const { token: second } = await receiveToken(user.email);
      assert.notEqual(first, second);
      const anon = createClient();
      assert.equal((await anon.request('POST', '/api/auth/reset-password', { body: { token: first, newPassword: 'Brand-New-Secret-2026' } })).status, 400);
      assert.equal((await anon.request('POST', '/api/auth/reset-password', { body: { token: second, newPassword: 'Brand-New-Secret-2026' } })).status, 200);
    });

    it('per-account cooldown suppresses e-mail bombing while keeping the generic response', async () => {
      process.env.PASSWORD_RESET_COOLDOWN_SECONDS = '60';
      const user = await createUser();
      const first = await requestReset(user.email);
      const second = await requestReset(user.email);
      assert.equal(first.status, 200);
      assert.deepEqual(second.body, first.body);
      await emailService.flushPendingDeliveries();
      assert.equal(smtp.messages.filter((m) => m.to.includes(user.email)).length, 1);
    });

    it('a weak new password is rejected without consuming the token', async () => {
      const user = await createUser();
      await requestReset(user.email);
      const { token } = await receiveToken(user.email);
      const anon = createClient();
      const weak = await anon.request('POST', '/api/auth/reset-password', { body: { token, newPassword: 'short' } });
      assert.equal(weak.status, 400);
      assert.equal(weak.body.code, 'WEAK_PASSWORD');
      const ok = await anon.request('POST', '/api/auth/reset-password', { body: { token, newPassword: 'Brand-New-Secret-2026' } });
      assert.equal(ok.status, 200);
    });

    it('two concurrent uses of the same token: exactly one succeeds', async () => {
      const user = await createUser();
      await requestReset(user.email);
      const { token } = await receiveToken(user.email);
      const results = await Promise.all([
        createClient().request('POST', '/api/auth/reset-password', { body: { token, newPassword: 'Concurrent-Secret-A1' } }),
        createClient().request('POST', '/api/auth/reset-password', { body: { token, newPassword: 'Concurrent-Secret-B2' } }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    });

    it('SMTP delivery failure: generic response (no enumeration), token invalidated, failure audited', async () => {
      smtp.setRejectRecipients(true);
      const user = await createUser();
      const res = await requestReset(user.email);
      assert.equal(res.status, 200);
      await emailService.flushPendingDeliveries();
      const stored = await User.findById(user._id).select('+passwordResetTokenHash').lean();
      assert.equal(stored.passwordResetTokenHash, undefined, 'undelivered token must not remain usable');
      assert.ok(await AuditLog.findOne({ action: 'auth.password_reset_email_failed', actorUserId: user._id }));
    });

    it('inactive accounts receive no reset e-mail', async () => {
      const user = await createUser({ active: false });
      const res = await requestReset(user.email);
      assert.equal(res.status, 200);
      await emailService.flushPendingDeliveries();
      assert.equal(smtp.messages.length, 0);
    });

    it('rejects malformed tokens and invalid e-mail input', async () => {
      const anon = createClient();
      assert.equal((await anon.request('POST', '/api/auth/reset-password', { body: { token: { $ne: null }, newPassword: 'Brand-New-Secret-2026' } })).status, 400);
      assert.equal((await anon.request('POST', '/api/auth/reset-password', { body: { token: 'abc', newPassword: 'Brand-New-Secret-2026' } })).status, 400);
      assert.equal((await anon.request('POST', '/api/auth/forgot-password', { body: { email: { $gt: '' } } })).status, 400);
      assert.equal((await anon.request('POST', '/api/auth/forgot-password', { body: { email: 'not-an-email' } })).status, 400);
    });

    it('forgot-password is rate limited per e-mail', async () => {
      const email = `ghost_${uid()}@jeweler.test`;
      let last;
      for (let i = 0; i < 6; i += 1) last = await requestReset(email);
      assert.equal(last.status, 429);
    });
  });

  // =========================================================================
  // C. USERS, ROLES, CUSTOM PERMISSIONS & TENANT ISOLATION
  // =========================================================================
  describe('C. Users & authorization', () => {
    let businessId;
    let admin;
    let adminClient;

    beforeEach(async () => {
      businessId = `biz_${uid()}`;
      admin = await createUser({ role: 'admin', businessId, branch: 'Merkez' });
      adminClient = await loggedIn(admin);
    });

    it('rejects anonymous and under-privileged access to user management', async () => {
      const anon = createClient();
      assert.equal((await anon.request('GET', '/api/users')).status, 401);
      assert.equal((await anon.request('GET', '/api/users/metadata')).status, 401);

      const staff = await loggedIn(await createUser({ businessId }));
      const catalog = await staff.request('GET', '/api/auth/permission-catalog');
      assert.equal(catalog.status, 200, 'labels for own permissions are readable by every signed-in user');
      assert.deepEqual(catalog.body.permissions.map((p) => p.id), ALL_PERMISSIONS);
      assert.equal((await anon.request('GET', '/api/auth/permission-catalog')).status, 401);
      assert.equal((await staff.request('GET', '/api/users')).status, 403);
      assert.equal((await staff.request('GET', '/api/users/metadata')).status, 403);
      const create = await staff.request('POST', '/api/users', {
        body: { email: `x_${uid()}@jeweler.test`, name: 'X', password: PASSWORD, role: 'admin' },
      });
      assert.equal(create.status, 403);
      assert.equal((await staff.request('GET', '/api/audit')).status, 403);
    });

    it('/me and login expose effective permissions identical to the backend role matrix', async () => {
      for (const role of ['admin', 'manager', 'staff']) {
        const user = await createUser({ role, businessId });
        const client = createClient();
        const login = await client.login(user.email);
        const expected = ALL_PERMISSIONS.filter((p) => ROLE_PERMISSIONS[role].includes(p));
        assert.deepEqual(login.body.user.permissions, expected, `${role} login permissions`);
        const me = await client.request('GET', '/api/auth/me');
        assert.deepEqual(me.body.permissions, expected, `${role} /me permissions`);
        for (const secret of ['passwordHash', 'passwordResetTokenHash', 'tokenVersion']) {
          assert.equal(JSON.stringify(login.body).includes(secret), false, `${secret} must not leak`);
        }
      }
    });

    it('metadata publishes the permission catalog used by the frontend', async () => {
      const res = await adminClient.request('GET', '/api/users/metadata');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.permissions.map((p) => p.id), ALL_PERMISSIONS);
      assert.deepEqual(res.body.assignableRoles, ['admin', 'manager', 'staff']);
      assert.ok(res.body.roles.every((r) => Array.isArray(r.permissions)));
    });

    it('admin creates a user with custom permissions that take effect immediately; revocation is immediate too', async () => {
      const email = `clerk_${uid()}@jeweler.test`;
      const created = await adminClient.request('POST', '/api/users', {
        body: { email, name: 'Vezne', password: PASSWORD, role: 'staff', branch: 'Kadıköy', customPermissions: ['audit:read', 'not:a-permission'] },
      });
      assert.equal(created.status, 201);
      assert.deepEqual(created.body.user.customPermissions, ['audit:read'], 'unknown permissions are dropped');
      assert.ok(created.body.user.permissions.includes('audit:read'));
      assert.equal(created.body.user.businessId, businessId, 'new users inherit the creator\'s business');
      assert.ok(await AuditLog.findOne({ action: 'user.create', resourceId: created.body.user.id }));

      const clerk = await loggedIn({ email });
      assert.equal((await clerk.request('GET', '/api/audit')).status, 200, 'custom permission grants access');

      const revoke = await adminClient.request('PUT', `/api/users/${created.body.user.id}`, { body: { customPermissions: [] } });
      assert.equal(revoke.status, 200);
      assert.equal((await clerk.request('GET', '/api/audit')).status, 403, 'revocation applies to the existing token');

      const audit = await AuditLog.findOne({ action: 'user.update', resourceId: created.body.user.id }).lean();
      assert.deepEqual(audit.before.customPermissions, ['audit:read']);
      assert.deepEqual(audit.after.customPermissions, []);
    });

    it('role changes are admin-only and apply immediately to existing tokens', async () => {
      const staffUser = await createUser({ businessId });
      const staffClient = await loggedIn(staffUser);
      assert.equal((await staffClient.request('GET', '/api/users')).status, 403);

      assert.equal((await adminClient.request('PUT', `/api/users/${staffUser._id}`, { body: { role: 'admin' } })).status, 200);
      assert.equal((await staffClient.request('GET', '/api/users')).status, 200, 'promotion is effective immediately');

      assert.equal((await adminClient.request('PUT', `/api/users/${staffUser._id}`, { body: { role: 'staff' } })).status, 200);
      assert.equal((await staffClient.request('GET', '/api/users')).status, 403, 'demotion is effective immediately');

      assert.equal((await adminClient.request('PUT', `/api/users/${admin._id}`, { body: { role: 'manager' } })).status, 403, 'nobody changes their own role');
      assert.equal((await adminClient.request('PUT', `/api/users/${staffUser._id}`, { body: { role: 'superuser' } })).status, 400);
    });

    it('a business always keeps at least one active admin', async () => {
      const second = await createUser({ role: 'admin', businessId });
      const secondClient = await loggedIn(second);
      assert.equal((await adminClient.request('PATCH', `/api/users/${second._id}/status`, { body: { active: false } })).status, 200);
      assert.equal((await secondClient.request('GET', '/api/users')).status, 401, 'deactivated admin is signed out');
      // The remaining admin is the last one: self-demotion / self-deactivation are refused.
      assert.equal((await adminClient.request('PUT', `/api/users/${admin._id}`, { body: { role: 'staff' } })).status, 403);
      assert.equal((await adminClient.request('PATCH', `/api/users/${admin._id}/status`, { body: { active: false } })).status, 400);
      assert.equal(await User.countDocuments({ businessId, role: 'admin', active: true }), 1);
    });

    it('delegated manager: own-branch staff only, cannot escalate privileges or touch admins', async () => {
      const manager = await createUser({ role: 'manager', businessId, branch: 'Kadıköy', customPermissions: ['users:read', 'users:write'] });
      const managerClient = await loggedIn(manager);
      const ownStaff = await createUser({ businessId, branch: 'Kadıköy' });
      const otherBranchStaff = await createUser({ businessId, branch: 'Merkez' });

      const list = await managerClient.request('GET', '/api/users');
      assert.equal(list.status, 200);
      const ids = list.body.data.map((u) => u.id);
      assert.ok(ids.includes(String(ownStaff._id)));
      assert.equal(ids.includes(String(otherBranchStaff._id)), false, 'other branch is invisible');
      assert.equal(ids.includes(String(admin._id)), false);

      const meta = await managerClient.request('GET', '/api/users/metadata');
      assert.deepEqual(meta.body.assignableRoles, ['staff']);
      assert.equal(meta.body.assignablePermissions.includes('audit:read'), false);

      const asManager = await managerClient.request('POST', '/api/users', {
        body: { email: `m_${uid()}@jeweler.test`, name: 'M', password: PASSWORD, role: 'manager' },
      });
      assert.equal(asManager.status, 403);

      const escalate = await managerClient.request('POST', '/api/users', {
        body: { email: `e_${uid()}@jeweler.test`, name: 'E', password: PASSWORD, role: 'staff', customPermissions: ['audit:read'] },
      });
      assert.equal(escalate.status, 403, 'cannot grant a permission the manager does not hold');

      const okCreate = await managerClient.request('POST', '/api/users', {
        body: { email: `s_${uid()}@jeweler.test`, name: 'S', password: PASSWORD, role: 'staff', branch: 'Kadıköy', customPermissions: ['sales:cancel'] },
      });
      assert.equal(okCreate.status, 201);
      assert.equal(okCreate.body.user.branch, 'Kadıköy');

      const otherBranchCreate = await managerClient.request('POST', '/api/users', {
        body: { email: `o_${uid()}@jeweler.test`, name: 'O', password: PASSWORD, role: 'staff', branch: 'Merkez' },
      });
      assert.equal(otherBranchCreate.status, 403);

      assert.equal((await managerClient.request('PUT', `/api/users/${otherBranchStaff._id}`, { body: { name: 'Hacked' } })).status, 404);
      assert.equal((await managerClient.request('PUT', `/api/users/${admin._id}`, { body: { name: 'Hacked' } })).status, 404);
      assert.equal((await managerClient.request('PUT', `/api/users/${ownStaff._id}`, { body: { role: 'admin' } })).status, 403);
      assert.equal((await managerClient.request('PUT', `/api/users/${manager._id}`, { body: { customPermissions: ['users:read', 'users:write', 'audit:read'] } })).status, 403);
      assert.equal((await managerClient.request('PUT', `/api/users/${ownStaff._id}`, { body: { name: 'Yeni Ad' } })).status, 200);
      assert.equal((await User.findById(otherBranchStaff._id)).name, otherBranchStaff.name);
    });

    it('cross-business isolation: another tenant\'s admin cannot see, read, edit, disable, delete or audit our users', async () => {
      const intruder = await createUser({ role: 'admin', businessId: `other_${uid()}` });
      const intruderClient = await loggedIn(intruder);
      const victim = await createUser({ businessId });

      const list = await intruderClient.request('GET', '/api/users');
      assert.equal(list.status, 200);
      assert.equal(list.body.data.some((u) => u.id === String(victim._id) || u.id === String(admin._id)), false);

      assert.equal((await intruderClient.request('GET', `/api/users/${victim._id}`)).status, 404);
      assert.equal((await intruderClient.request('PUT', `/api/users/${victim._id}`, { body: { name: 'Breach', role: 'admin' } })).status, 404);
      assert.equal((await intruderClient.request('PATCH', `/api/users/${victim._id}/status`, { body: { active: false } })).status, 404);
      assert.equal((await intruderClient.request('POST', `/api/users/${victim._id}/sessions/revoke`)).status, 404);
      assert.equal((await intruderClient.request('POST', `/api/users/${victim._id}/password-reset`)).status, 404);
      assert.equal((await intruderClient.request('DELETE', `/api/users/${victim._id}`)).status, 404);

      const fresh = await User.findById(victim._id);
      assert.equal(fresh.name, victim.name);
      assert.equal(fresh.role, 'staff');
      assert.equal(fresh.active, true);

      await adminClient.request('PUT', `/api/users/${victim._id}`, { body: { name: 'Tenant Event' } });
      const audit = await intruderClient.request('GET', '/api/audit');
      assert.equal(audit.status, 200);
      assert.equal(audit.body.some((log) => log.actorUserId === String(admin._id)), false, 'audit records of other tenants are invisible');

      const forged = await intruderClient.request('POST', '/api/users', {
        body: { email: `f_${uid()}@jeweler.test`, name: 'F', password: PASSWORD, businessId },
      });
      assert.equal(forged.status, 201);
      assert.equal(forged.body.user.businessId, intruder.businessId, 'businessId in the body is ignored');
    });

    it('self-protection: cannot deactivate, delete or change own permissions', async () => {
      assert.equal((await adminClient.request('PATCH', `/api/users/${admin._id}/status`, { body: { active: false } })).status, 400);
      assert.equal((await adminClient.request('DELETE', `/api/users/${admin._id}`)).status, 400);
      assert.equal((await adminClient.request('PUT', `/api/users/${admin._id}`, { body: { customPermissions: ['audit:read'] } })).status, 403);
      assert.equal((await adminClient.request('PATCH', `/api/users/${admin._id}/status`, { body: { active: 'false' } })).status, 400);
    });

    it('deactivation immediately kills access and refresh tokens; delete requires deactivation first', async () => {
      const user = await createUser({ businessId });
      const client = await loggedIn(user, true);

      assert.equal((await adminClient.request('DELETE', `/api/users/${user._id}`)).status, 400, 'active users cannot be deleted');

      const off = await adminClient.request('PATCH', `/api/users/${user._id}/status`, { body: { active: false } });
      assert.equal(off.status, 200);
      assert.equal((await client.request('GET', '/api/auth/me')).status, 401);
      assert.equal((await client.request('POST', '/api/auth/refresh')).status, 401);
      assert.ok(await AuditLog.findOne({ action: 'user.deactivate', resourceId: String(user._id) }));

      const del = await adminClient.request('DELETE', `/api/users/${user._id}`);
      assert.equal(del.status, 200);
      assert.equal(await User.exists({ _id: user._id }), null);
      assert.ok(await AuditLog.findOne({ action: 'user.delete', resourceId: String(user._id) }));
    });

    it('admin-set password and remote session revocation end the target\'s sessions', async () => {
      const user = await createUser({ businessId });
      const client = await loggedIn(user, true);
      const weak = await adminClient.request('PUT', `/api/users/${user._id}`, { body: { password: 'short' } });
      assert.equal(weak.status, 400);
      const set = await adminClient.request('PUT', `/api/users/${user._id}`, { body: { password: 'Admin-Set-Password-77' } });
      assert.equal(set.status, 200);
      assert.equal((await client.request('POST', '/api/auth/refresh')).status, 401);

      assert.equal((await createClient().login(user.email, PASSWORD)).status, 401, 'old password no longer valid');
      const relog = createClient();
      assert.equal((await relog.login(user.email, 'Admin-Set-Password-77')).status, 200);
      assert.equal((await adminClient.request('POST', `/api/users/${user._id}/sessions/revoke`)).status, 200);
      assert.equal((await relog.request('GET', '/api/auth/me')).status, 401);
    });

    it('admin can e-mail a reset link (real SMTP) and gets an honest error when SMTP is missing', async () => {
      const user = await createUser({ businessId });
      const sent = await adminClient.request('POST', `/api/users/${user._id}/password-reset`);
      assert.equal(sent.status, 200);
      const message = await smtp.waitForMessage((m) => m.to.includes(user.email));
      assert.ok(extractResetToken(message));
      assert.ok(await AuditLog.findOne({ action: 'user.password_reset_sent', resourceId: String(user._id) }));

      unconfigureSmtp();
      const missing = await adminClient.request('POST', `/api/users/${user._id}/password-reset`);
      assert.equal(missing.status, 503);
      assert.equal(missing.body.code, 'SMTP_UNCONFIGURED');

      configureSmtp();
      smtp.setRejectRecipients(true);
      const failed = await adminClient.request('POST', `/api/users/${user._id}/password-reset`);
      assert.equal(failed.status, 502);
      assert.equal(failed.body.code, 'EMAIL_DELIVERY_FAILED');
    });

    it('legacy accounts without stored businessId/branch are migrated, stay visible and can still log in', async () => {
      const migrateAuthData = require('../scripts/migrateAuthData');
      const legacyEmail = `legacy_${uid()}@jeweler.test`;
      // Shape written by the previous bootstrapAdmin: no name/branch/businessId.
      await User.collection.insertOne({
        email: legacyEmail,
        passwordHash: await hashPassword(PASSWORD),
        role: 'staff',
        active: true,
        tokenVersion: 0,
        refreshTokens: [{ tokenHash: 'x', expiresAt: new Date() }],
      });
      const legacyAdminClient = await loggedIn(await createUser({ role: 'admin', businessId: migrateAuthData.DEFAULT_BUSINESS_ID }));

      let list = await legacyAdminClient.request('GET', '/api/users');
      assert.equal(list.body.data.some((u) => u.email === legacyEmail), false, 'precondition: unmigrated user is invisible to scoped queries');

      const result = await migrateAuthData();
      assert.ok(result.businessId >= 1);
      list = await legacyAdminClient.request('GET', '/api/users');
      assert.ok(list.body.data.some((u) => u.email === legacyEmail), 'migrated user is visible');
      const raw = await User.collection.findOne({ email: legacyEmail });
      assert.equal(raw.refreshTokens, undefined, 'legacy embedded refresh tokens removed');
      assert.equal((await createClient().login(legacyEmail)).status, 200);

      const again = await migrateAuthData();
      assert.equal(again.businessId + again.branch + again.legacyRefreshTokens, 0, 'migration is idempotent');
    });

    it('existing permission-protected business routes honour the synchronized matrix', async () => {
      const staff = await loggedIn(await createUser({ businessId }));
      const manager = await loggedIn(await createUser({ role: 'manager', businessId }));
      assert.equal((await staff.request('GET', '/api/customers')).status, 200);
      assert.equal((await staff.request('DELETE', '/api/customers/999999')).status, 403);
      assert.equal((await staff.request('POST', '/api/cash/daily-closing', { body: {} })).status, 403);
      assert.equal((await manager.request('POST', '/api/cash/daily-closing', { body: {} })).status, 403);
      assert.notEqual((await adminClient.request('POST', '/api/cash/daily-closing', { body: {} })).status, 403, 'admins can perform the daily closing again');
    });
  });
});
