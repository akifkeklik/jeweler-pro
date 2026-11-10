/**
 * HTTP hardening: helmet security headers and the request body limit.
 * Runs without a database (the endpoints used never reach MongoDB).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.JWT_SECRET = 'http-hardening-secret-with-more-than-32-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';

const app = require('../server');

async function send(method, path, body) {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path, headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {} }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('security headers are set on every response', async () => {
  const res = await send('GET', '/health');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['cross-origin-resource-policy'], 'same-site');
  assert.match(res.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(res.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
  assert.equal(res.headers['x-powered-by'], undefined);
});

test('request bodies above 1 MB are refused with 413 before authentication', async () => {
  const big = JSON.stringify({ data: 'x'.repeat(1024 * 1024 + 10) });
  const res = await send('POST', '/api/auth/login', big);
  assert.equal(res.status, 413);
});

test('the general API rate limit answers 429 RATE_LIMITED with standard headers', async () => {
  const express = require('express');
  const { createApiRateLimit, limitFromEnv } = require('../middleware/apiRateLimit');
  assert.equal(limitFromEnv({ NODE_ENV: 'production' }), 600);
  assert.equal(limitFromEnv({ NODE_ENV: 'test' }), 0, 'disabled for the integration suites');
  assert.equal(limitFromEnv({ NODE_ENV: 'production', API_RATE_LIMIT_PER_MINUTE: '120' }), 120);

  const limited = express();
  limited.use(createApiRateLimit({ limit: 2 }));
  limited.get('/x', (req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => { const s = limited.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const call = () => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.address().port, path: '/x' }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
    });
    assert.equal((await call()).status, 200);
    assert.equal((await call()).status, 200);
    const third = await call();
    assert.equal(third.status, 429);
    assert.equal(JSON.parse(third.body).code, 'RATE_LIMITED');
    assert.ok(third.headers['retry-after']);
    assert.ok(third.headers.ratelimit || third.headers['ratelimit-policy']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a pathological Authorization header is rejected quickly (no regex backtracking)', async () => {
  const { authenticate } = require('../middleware/auth');
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  // Worst case for the former /^Bearer\s+(.+)$/: whitespace that both groups
  // can take, then "\t\n" so the match fails only at the end (O(n²)
  // backtracking: ~360 ms for 20 000 spaces, ~2.4 s for 50 000).
  const req = { headers: { authorization: `Bearer ${' '.repeat(20_000)}\t\n` } };
  const started = process.hrtime.bigint();
  await authenticate(req, res, () => assert.fail('must not authenticate'));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(res.statusCode, 401);
  assert.ok(elapsedMs < 50, `took ${elapsedMs} ms`);
});
