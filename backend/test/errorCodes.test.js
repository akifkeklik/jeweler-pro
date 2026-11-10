/**
 * Stable, machine-readable error codes on reachable API failures.
 *
 * The frontend translates `code` into eight languages, so each failure a user
 * can trigger must carry one. HTTP statuses are unchanged, and no response
 * leaks a stack trace or internal detail.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'error-codes-secret-with-more-than-thirty-two-characters';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const { hashPassword } = require('../utils/passwords');
const { resetAllRateLimiters } = require('../middleware/rateLimit');
const { createHarness, expectError } = require('../testSupport/financeHarness');

const PASSWORD = 'Error-Codes-Strong-Pass-2026';
const harness = createHarness({ app, signToken, User, hashPassword, password: PASSWORD });

function assertSafe(res) {
  assert.equal(typeof res.body?.code, 'string', `code present: ${JSON.stringify(res.body)}`);
  assert.match(res.body.code, /^[A-Z][A-Z0-9_]+$/);
  assert.equal(res.body.stack, undefined, 'no stack trace');
  assert.doesNotMatch(JSON.stringify(res.body), /node_modules|\.js:\d+|at [A-Za-z]+ \(/, 'no internal detail');
}

describe('API error codes (real MongoDB, HTTP)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  let t;

  before(async () => {
    await mongoose.connect(uri);
    await User.init();
    await harness.start();
    t = await harness.tenant();
  });

  after(async () => {
    await harness.stop();
    await mongoose.disconnect();
  });

  beforeEach(() => resetAllRateLimiters());

  it('login failures carry codes; unknown account and wrong password are indistinguishable', async () => {
    const missing = await harness.request('POST', '/api/auth/login', { body: { email: '' } });
    expectError(missing, 400, 'CREDENTIALS_REQUIRED');
    assertSafe(missing);

    const wrong = await harness.request('POST', '/api/auth/login', { body: { email: t.adminUser.email, password: 'definitely-not-it-123' } });
    const unknown = await harness.request('POST', '/api/auth/login', { body: { email: 'nobody@nowhere.test', password: 'definitely-not-it-123' } });
    expectError(wrong, 401, 'INVALID_CREDENTIALS');
    expectError(unknown, 401, 'INVALID_CREDENTIALS');
    assert.deepEqual(wrong.body, unknown.body);
    assertSafe(wrong);
  });

  it('invalid bearer tokens are SESSION_INVALID', async () => {
    const res = await harness.request('GET', '/api/products', { token: 'not-a-valid-token' });
    expectError(res, 401, 'SESSION_INVALID');
    assertSafe(res);
  });

  it('unknown endpoints and records carry codes', async () => {
    expectError(await harness.request('GET', '/no-such-endpoint'), 404, 'ENDPOINT_NOT_FOUND');
    expectError(await t.admin.get('/api/no-such-endpoint'), 404, 'ENDPOINT_NOT_FOUND');
    const invalidId = await t.admin.get('/api/products/abc');
    expectError(invalidId, 400, 'INVALID_ID');
    assertSafe(invalidId);
    const missing = await t.admin.get('/api/products/99999999');
    expectError(missing, 404, 'PRODUCT_NOT_FOUND');
    assertSafe(missing);
  });

  it('password change validation carries codes', async () => {
    const res = await t.admin.post('/api/auth/password', { currentPassword: '', newPassword: 'Another-Strong-Pass-2026' });
    expectError(res, 400, 'CURRENT_PASSWORD_REQUIRED');
    const same = await t.admin.post('/api/auth/password', { currentPassword: 'Same-Strong-Pass-2026!', newPassword: 'Same-Strong-Pass-2026!' });
    expectError(same, 400, 'PASSWORD_UNCHANGED');
  });

  it('user management failures carry codes', async () => {
    expectError(await t.admin.post('/api/users', { email: 'not-an-email', name: 'X', password: PASSWORD, role: 'staff' }), 400, 'INVALID_EMAIL');
    expectError(await t.admin.post('/api/users', { email: 'new.person@qa.test', name: '', password: PASSWORD, role: 'staff' }), 400, 'NAME_REQUIRED');
    expectError(await t.admin.post('/api/users', { email: 'new.person@qa.test', name: 'New Person', password: PASSWORD, role: 'emperor' }), 400, 'INVALID_ROLE');
    expectError(await t.admin.post('/api/users', { email: t.adminUser.email, name: 'Dup', password: PASSWORD, role: 'staff' }), 409, 'EMAIL_IN_USE');

    const self = String(t.adminUser._id);
    const flag = await harness.request('PATCH', `/api/users/${self}/status`, { token: signToken(t.adminUser, 900), body: { active: 'no' } });
    expectError(flag, 400, 'INVALID_ACTIVE_FLAG');
    const deactivate = await harness.request('PATCH', `/api/users/${self}/status`, { token: signToken(t.adminUser, 900), body: { active: false } });
    expectError(deactivate, 400, 'SELF_DEACTIVATION_FORBIDDEN');
    expectError(await t.admin.del(`/api/users/${self}`), 400, 'SELF_DELETION_FORBIDDEN');
    expectError(await t.admin.del('/api/users/507f1f77bcf86cd799439099'), 404, 'USER_NOT_FOUND');
    expectError(await t.admin.del('/api/users/not-an-object-id'), 404, 'USER_NOT_FOUND');
  });
});
