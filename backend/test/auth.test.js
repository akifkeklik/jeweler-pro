const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { signToken, verifyToken } = require('../middleware/auth');

test('signs and verifies an authenticated user token', () => {
  process.env.JWT_SECRET = 'test-secret-with-more-than-thirty-two-characters';
  const token = signToken({ _id: 'user-123', email: 'admin@example.com', role: 'admin' });
  const claims = verifyToken(token);
  assert.equal(claims.sub, 'user-123');
  assert.equal(claims.email, 'admin@example.com');
  assert.equal(claims.role, 'admin');
});

test('rejects malformed, tampered and non-canonical tokens', () => {
  process.env.JWT_SECRET = 'test-secret-with-more-than-thirty-two-characters';
  const token = signToken({ _id: 'user-123', email: 'admin@example.com', role: 'admin' });
  const [header, payload, signature] = token.split('.');
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
  process.env.JWT_SECRET = 'test-secret-with-more-than-thirty-two-characters';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'user-123', exp: 1 })).toString('base64url');
  const content = header + '.' + payload;
  const signature = crypto.createHmac('sha256', process.env.JWT_SECRET).update(content).digest('base64url');
  assert.equal(verifyToken(content + '.' + signature), null);
});
