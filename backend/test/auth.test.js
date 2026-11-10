const { inspect } = require('../testSupport/tenantInspection');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Category = inspect(require('../models/Category'));
const authRouter = require('../routes/auth');
const app = require('../server');
const { signToken, verifyToken, authenticate } = require('../middleware/auth');
const { ROLE_PERMISSIONS, ALL_PERMISSIONS } = require('../middleware/authorization');
const authSessionService = require('../services/authSessionService');

const JWT_SECRET = 'test-secret-with-more-than-thirty-two-characters';

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    cookie(name, value, options) {
      this.cookies = { ...(this.cookies || {}), [name]: { value, options } };
      return this;
    },
    clearCookie() {
      return this;
    },
  };
}

async function requestApp(method, path, token, body) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const address = server.address();
    return await new Promise((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1',
        port: address.port,
        method,
        path,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
      }, (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => resolve({
          statusCode: response.statusCode,
          body: responseBody ? JSON.parse(responseBody) : null,
        }));
      });
      request.on('error', reject);
      if (body) request.write(JSON.stringify(body));
      request.end();
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function runAuthentication(user, token = signToken({
  _id: '507f1f77bcf86cd799439011',
  email: 'user@example.com',
  role: 'staff',
  tokenVersion: 0,
  businessId: 'jeweler_main_01',
  branch: 'Merkez Şube - Kapalıçarşı',
})) {
  const originalFindById = User.findById;
  User.findById = async () => user;
  try {
    const req = {
      headers: { authorization: `Bearer ${token}` },
    };
    const res = makeResponse();
    let nextCalled = false;
    await authenticate(req, res, () => {
      nextCalled = true;
    });
    return { req, res, nextCalled };
  } finally {
    User.findById = originalFindById;
  }
}

test('signs and verifies an authenticated user token', () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const token = signToken({ _id: 'user-123', email: 'admin@example.com', role: 'admin' });
  const claims = verifyToken(token);
  assert.equal(claims.sub, 'user-123');
  assert.equal(claims.email, 'admin@example.com');
  assert.equal(claims.role, 'admin');
  assert.equal(claims.tokenVersion, 0);
});

test('rejects malformed, tampered and non-canonical tokens', () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const token = signToken({ _id: 'user-123', email: 'admin@example.com', role: 'admin' });
  const [header, , signature] = token.split('.');
  const alteredPayload = Buffer.from(JSON.stringify({
    sub: 'user-123',
    email: 'admin@example.com',
    role: 'user',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
  })).toString('base64url');

  assert.equal(verifyToken('not-a-token'), null);
  assert.equal(verifyToken(header + '.' + alteredPayload + '.' + signature), null);
  assert.equal(verifyToken(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')), null);
});

test('rejects expired tokens', () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'user-123', exp: 1 })).toString('base64url');
  const content = header + '.' + payload;
  const signature = crypto.createHmac('sha256', process.env.JWT_SECRET).update(content).digest('base64url');
  assert.equal(verifyToken(content + '.' + signature), null);
});

test('accepts a token for an existing active user and exposes a safe user context', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const user = {
    _id: '507f1f77bcf86cd799439011',
    email: 'user@example.com',
    role: 'staff',
    active: true,
    tokenVersion: 0,
    businessId: 'jeweler_main_01',
    branch: 'Merkez Şube - Kapalıçarşı',
  };
  const result = await runAuthentication(user);

  assert.equal(result.res.statusCode, 200);
  assert.equal(result.nextCalled, true);
  assert.deepEqual(result.req.user, {
    _id: user._id,
    email: user.email,
    name: '',
    role: user.role,
    branch: 'Merkez Şube - Kapalıçarşı',
    businessId: 'jeweler_main_01',
    customPermissions: [],
    permissions: ALL_PERMISSIONS.filter((p) => ROLE_PERMISSIONS.staff.includes(p)),
    active: user.active,
    tokenVersion: user.tokenVersion,
    sessionId: null,
  });
  assert.equal(result.req.user.passwordHash, undefined);
});

test('fails closed for an account without business or branch (no silent default tenant)', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  for (const missing of [{ businessId: '' }, { businessId: undefined }, { branch: '' }, { branch: undefined }]) {
    const user = {
      _id: '507f1f77bcf86cd799439011',
      email: 'user@example.com',
      role: 'admin',
      active: true,
      tokenVersion: 0,
      businessId: 'jeweler_main_01',
      branch: 'Merkez Şube - Kapalıçarşı',
      ...missing,
    };
    const result = await runAuthentication(user);
    assert.equal(result.res.statusCode, 403, JSON.stringify(missing));
    assert.equal(result.res.body?.code, 'TENANT_MISSING');
    assert.equal(result.nextCalled, false);
  }
});

test('rejects alg=none and algorithm-confusion tokens', () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: 'user-123', role: 'admin', tokenVersion: 0, iat: now, exp: now + 600 })).toString('base64url');
  for (const alg of ['none', 'HS512', 'RS256']) {
    const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
    const signature = alg === 'none'
      ? 'AA'
      : crypto.createHmac(alg === 'HS512' ? 'sha512' : 'sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    assert.equal(verifyToken(`${header}.${payload}.${signature}`), null, alg);
  }
});

test('rejects a token for a missing user', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const result = await runAuthentication(null);
  assert.equal(result.res.statusCode, 401);
  assert.equal(result.nextCalled, false);
});

test('rejects a token for an inactive user', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const result = await runAuthentication({
    active: false,
    tokenVersion: 0,
  });
  assert.equal(result.res.statusCode, 401);
});

test('rejects a token with a stale token version', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const token = signToken({
    _id: '507f1f77bcf86cd799439011',
    email: 'user@example.com',
    role: 'staff',
    tokenVersion: 0,
  });
  const result = await runAuthentication({
    active: true,
    tokenVersion: 1,
  }, token);
  assert.equal(result.res.statusCode, 401);
});

test('rejects a token with missing authentication claims', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: '507f1f77bcf86cd799439011',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
  })).toString('base64url');
  const content = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(content).digest('base64url');
  const result = await runAuthentication(null, `${content}.${signature}`);
  assert.equal(result.res.statusCode, 401);
});

test('passes database failures to the error handler instead of authenticating', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const originalFindById = User.findById;
  const databaseError = new Error('database unavailable');
  User.findById = async () => {
    throw databaseError;
  };
  try {
    const req = {
      headers: {
        authorization: `Bearer ${signToken({
          _id: '507f1f77bcf86cd799439011',
          email: 'user@example.com',
          role: 'staff',
          tokenVersion: 0,
        })}`,
      },
    };
    const res = makeResponse();
    let nextError;
    await authenticate(req, res, (error) => {
      nextError = error;
    });

    assert.equal(nextError, databaseError);
    assert.equal(res.body, null);
    assert.equal(req.user, undefined);
  } finally {
    User.findById = originalFindById;
  }
});

test('login signs the token with the current token version', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const salt = 'test-salt';
  const passwordHash = crypto.scryptSync('correct-password', salt, 32).toString('hex');
  const user = {
    _id: '507f1f77bcf86cd799439011',
    email: 'user@example.com',
    role: 'staff',
    active: true,
    tokenVersion: 7,
    businessId: 'jeweler_main_01',
    branch: 'Merkez Şube - Kapalıçarşı',
    passwordHash: `${salt}:${passwordHash}`,
    save: async () => {},
  };
  const originalFindOne = User.findOne;
  const originalAuditCreate = AuditLog.create;
  const originalCreateSession = authSessionService.createSession;
  User.findOne = () => ({ select: async () => user });
  AuditLog.create = async ([entry]) => [entry];
  authSessionService.createSession = async (sessionUser, { persistent }) => ({
    session: { _id: '64b000000000000000000001', persistent, expiresAt: new Date(Date.now() + 3600_000) },
    rawToken: 'a'.repeat(96),
  });
  try {
    const layer = authRouter.stack.find((item) => item.route?.path === '/login');
    const req = {
      // Same headers the SPA sends (login is guarded against login-CSRF).
      headers: { 'content-type': 'application/json', origin: 'http://localhost:8080' },
      body: { email: user.email, password: 'correct-password' },
      ip: 'auth-test-login',
    };
    const res = makeResponse();
    const responsePromise = new Promise((resolve) => {
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        originalJson(body);
        resolve(body);
        return res;
      };
    });
    let nextError;
    const handlers = layer.route.stack.map((item) => item.handle);
    // Run the full middleware chain (CSRF guard → rate limit → handler).
    const run = (index) => handlers[index](req, res, (error) => {
      if (error || index === handlers.length - 1) {
        nextError = error;
        return;
      }
      run(index + 1);
    });
    run(0);
    await responsePromise;

    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 200);
    const claims = verifyToken(res.body.token);
    assert.equal(claims.tokenVersion, 7);
    assert.equal(claims.sid, '64b000000000000000000001', 'access token must be bound to the device session');
    assert.equal(res.body.session.persistent, false);
  } finally {
    User.findOne = originalFindOne;
    AuditLog.create = originalAuditCreate;
    authSessionService.createSession = originalCreateSession;
  }
});

test('logout invalidates the current token through the real HTTP authentication flow', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const user = {
    _id: '507f1f77bcf86cd799439011',
    email: 'user@example.com',
    role: 'staff',
    active: true,
    tokenVersion: 0,
    businessId: 'jeweler_main_01',
    branch: 'Merkez Şube - Kapalıçarşı',
  };
  const token = signToken(user);
  const originalFindById = User.findById;
  const originalRevokeTokens = User.revokeTokens;
  const originalAuditCreate = AuditLog.create;
  User.findById = async () => user;
  AuditLog.create = async ([entry]) => [entry];
  User.revokeTokens = async () => {
    user.tokenVersion += 1;
    return user;
  };
  try {
    const logout = await requestApp('POST', '/api/auth/logout', token);
    const afterLogout = await requestApp('GET', '/api/auth/me', token);

    assert.equal(logout.statusCode, 200);
    assert.equal(afterLogout.statusCode, 401);
  } finally {
    User.findById = originalFindById;
    User.revokeTokens = originalRevokeTokens;
    AuditLog.create = originalAuditCreate;
  }
});

test('password changes invalidate previously issued tokens through the real HTTP flow', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const salt = 'password-test-salt';
  const user = {
    _id: '507f1f77bcf86cd799439011',
    email: 'user@example.com',
    role: 'staff',
    active: true,
    tokenVersion: 0,
    businessId: 'jeweler_main_01',
    branch: 'Merkez Şube - Kapalıçarşı',
    passwordHash: `${salt}:${crypto.scryptSync('old-password', salt, 64).toString('hex')}`,
  };
  const token = signToken(user);
  const originalFindById = User.findById;
  const originalFindOne = User.findOne;
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  const originalAuditCreate = AuditLog.create;
  const originalRevokeAll = authSessionService.revokeAllForUser;
  let revokedSessionsFor = null;
  authSessionService.revokeAllForUser = async (userId) => { revokedSessionsFor = String(userId); return 1; };
  User.findById = async () => user;
  User.findOne = () => ({ select: async () => user });
  AuditLog.create = async ([entry]) => [entry];
  User.findByIdAndUpdate = async (id, update) => {
    assert.equal(String(id), user._id);
    user.passwordHash = update.passwordHash;
    user.tokenVersion += update.$inc.tokenVersion;
    return user;
  };
  try {
    const changed = await requestApp('POST', '/api/auth/password', token, {
      currentPassword: 'old-password',
      newPassword: 'new-password-123',
    });
    const afterChange = await requestApp('GET', '/api/auth/me', token);

    assert.equal(changed.statusCode, 200);
    assert.equal(afterChange.statusCode, 401);
    assert.notEqual(user.passwordHash, `${salt}:${crypto.scryptSync('old-password', salt, 64).toString('hex')}`);
    assert.equal(revokedSessionsFor, user._id, 'refresh sessions must be revoked on password change');
  } finally {
    authSessionService.revokeAllForUser = originalRevokeAll;
    User.findById = originalFindById;
    User.findOne = originalFindOne;
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
    AuditLog.create = originalAuditCreate;
  }
});

test('deactivation and role downgrade take effect for an existing token on protected HTTP routes', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const user = {
    _id: '507f1f77bcf86cd799439011',
    email: 'admin@example.com',
    role: 'admin',
    active: true,
    tokenVersion: 0,
    businessId: 'jeweler_main_01',
    branch: 'Merkez Şube - Kapalıçarşı',
  };
  const token = signToken(user);
  const originalFindById = User.findById;
  const originalFindOneAndUpdate = Category.findOneAndUpdate;
  User.findById = async () => user;
  Category.findOneAndUpdate = async () => ({ _id: 1, isArchived: true });
  try {
    const activeAdmin = await requestApp('DELETE', '/api/categories/1', token);
    user.role = 'staff';
    const downgraded = await requestApp('DELETE', '/api/categories/1', token);
    user.active = false;
    const deactivated = await requestApp('GET', '/api/auth/me', token);

    assert.equal(activeAdmin.statusCode, 200);
    assert.equal(downgraded.statusCode, 403);
    assert.equal(deactivated.statusCode, 401);
  } finally {
    User.findById = originalFindById;
    Category.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
