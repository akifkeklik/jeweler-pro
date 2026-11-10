/**
 * Request logging with correlation IDs.
 *
 * - Every request gets a correlation id (a valid client-supplied
 *   X-Correlation-ID is kept so a browser action can be traced end to end).
 *   It is returned in the response header and stored on every ledger entry,
 *   stock movement, POS transaction and audit record the request writes.
 * - One structured line per completed request (JSON in production or with
 *   LOG_FORMAT=json; LOG_FORMAT=text forces the readable line). Logged: method, route path WITHOUT query
 *   string, status, duration, correlation id, business / user id. Never
 *   logged: bodies, query strings, headers, tokens, customer data.
 * - Failed financial commands (4xx/5xx on POST/PUT/DELETE) are tagged
 *   `financial: true` for transaction-failure monitoring.
 */
const crypto = require('node:crypto');
const { jsonLogs } = require('../utils/errorReporter');

const FINANCIAL_PREFIXES = ['/api/sales', '/api/purchases', '/api/cash', '/api/transfers', '/api/pos', '/api/products', '/api/suppliers'];

function logLine(record) {
  // JSON by default in production (LOG_FORMAT=text forces the readable line).
  if (jsonLogs()) {
    console.log(JSON.stringify(record));
    return;
  }
  const tag = record.status >= 500 ? '🔴' : record.status >= 400 ? '🟡' : '📨';
  console.log(`${tag} [${record.time}] ${record.method} ${record.path} ${record.status} ${record.durationMs}ms cid=${record.correlationId}${record.financial ? ' financial' : ''}`);
}

const requestLogger = (req, res, next) => {
  const supplied = req.headers['x-correlation-id'];
  req.correlationId = typeof supplied === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
  res.setHeader('X-Correlation-ID', req.correlationId);
  const started = process.hrtime.bigint();
  if (typeof res.on !== 'function') return next(); // minimal response objects (unit tests)
  res.on('finish', () => {
    if (process.env.REQUEST_LOG === 'off') return;
    const path = req.originalUrl.split('?')[0];
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    logLine({
      time: new Date().toISOString(),
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
      correlationId: req.correlationId,
      businessId: req.user?.businessId,
      userId: req.user?._id ? String(req.user._id) : undefined,
      financial: mutating && res.statusCode >= 400 && FINANCIAL_PREFIXES.some((p) => path.startsWith(p)) ? true : undefined,
    });
  });
  next();
};

module.exports = requestLogger;
