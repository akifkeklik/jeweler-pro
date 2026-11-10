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
