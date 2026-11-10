const test = require('node:test');
const assert = require('node:assert/strict');
const { reportError, jsonLogs } = require('../utils/errorReporter');

const quietLogger = () => { const lines = []; return { lines, error: (...a) => lines.push(a) }; };

test('JSON logs are the production default and can be forced either way', () => {
  assert.equal(jsonLogs({ NODE_ENV: 'production' }), true);
  assert.equal(jsonLogs({ NODE_ENV: 'development' }), false);
  assert.equal(jsonLogs({ NODE_ENV: 'development', LOG_FORMAT: 'json' }), true);
  assert.equal(jsonLogs({ NODE_ENV: 'production', LOG_FORMAT: 'text' }), false);
});

test('an unexpected error becomes one JSON line and is posted to ERROR_REPORT_URL', async () => {
  const logger = quietLogger();
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true }; };
  const record = reportError(new Error('boom'), { method: 'POST', path: '/api/sales', status: 500, correlationId: 'c1' }, {
    env: { NODE_ENV: 'production', ERROR_REPORT_URL: 'https://alerts.example/hook' }, fetchImpl, logger,
  });
  assert.equal(record.error.message, 'boom');
  const line = JSON.parse(logger.lines[0][0]);
  assert.equal(line.event, 'request_failed');
  assert.equal(line.path, '/api/sales');
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://alerts.example/hook');
  assert.equal(calls[0].body.service, 'jeweler-pro-api');
});

test('a failing report endpoint never throws', async () => {
  const logger = quietLogger();
  assert.doesNotThrow(() => reportError(new Error('x'), {}, {
    env: { NODE_ENV: 'production', ERROR_REPORT_URL: 'https://down.example' }, fetchImpl: async () => { throw new Error('down'); }, logger,
  }));
  await new Promise((r) => setImmediate(r));
});
