const test = require('node:test');
const assert = require('node:assert/strict');
const requestLogger = require('../middleware/requestLogger');
const loginRateLimit = require('../middleware/loginRateLimit');

test('request correlation IDs reject unsafe caller input', () => {
  const req = { headers: { 'x-correlation-id': 'bad value\r\n' } };
  const headers = {};
  const res = { setHeader: (name, value) => { headers[name] = value; } };
  requestLogger(req, res, () => {});

  assert.match(req.correlationId, /^[0-9a-f-]{36}$/);
  assert.equal(headers['X-Correlation-ID'], req.correlationId);
});

test('login rate limiting tracks the normalized account and address', () => {
  const suffix = Date.now().toString();
  const makeRequest = (email) => ({
    ip: `phase6-${suffix}`,
    socket: { remoteAddress: `phase6-${suffix}` },
    body: { email },
  });
  const responses = [];
  const makeResponse = () => ({
    statusCode: 200,
    set() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json() {},
  });

  for (let index = 0; index < 10; index += 1) {
    const res = makeResponse();
    loginRateLimit(makeRequest('User@example.com'), res, () => {});
    responses.push(res.statusCode);
  }
  const blocked = makeResponse();
  loginRateLimit(makeRequest(' user@example.com '), blocked, () => {});
  const separateAccount = makeResponse();
  loginRateLimit(makeRequest('other@example.com'), separateAccount, () => {});

  assert.equal(blocked.statusCode, 429);
  assert.equal(separateAccount.statusCode, 200);
  assert.equal(responses.every((status) => status === 200), true);
});
