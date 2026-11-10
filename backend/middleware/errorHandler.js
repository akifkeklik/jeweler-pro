const { resolveEnvironment } = require('../config/environment');
const { reportError, jsonLogs } = require('../utils/errorReporter');

/**
 * Centralized Express error handler.
 * Known client errors keep their useful messages; unexpected production errors
 * are returned with a generic message so internal details are not disclosed.
 */
const errorHandler = (err, req, res, next) => {
  const candidateStatus = Number(err.statusCode);
  const status = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus < 600
    ? candidateStatus
    : 500;

  // Query strings can carry personal data (search terms): log the path only.
  // Expected client errors (4xx domain errors) are logged compactly.
  const context = {
    method: req.method,
    path: String(req.originalUrl || '').split('?')[0],
    status,
    correlationId: req.correlationId,
    businessId: req.user?.businessId,
  };
  if (status >= 500) {
    // Unexpected: structured log + optional external report (utils/errorReporter.js).
    reportError(err, context);
  } else if (jsonLogs()) {
    console.error(JSON.stringify({ time: new Date().toISOString(), level: 'warn', event: 'request_rejected', ...context, error: { name: err.name, code: err.code, message: err.message } }));
  } else {
    console.error(`[${new Date().toISOString()}] Request failed`, { ...context, error: { name: err.name, code: err.code, message: err.message } });
  }

  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors || {})
      .map((item) => item.message)
      .filter(Boolean);

    return res.status(400).json({
      error: 'Validation hatası',
      code: 'VALIDATION_ERROR',
      details: messages,
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ error: 'Geçersiz ID formatı', code: 'INVALID_ID' });
  }

  if (err.code === 11000) {
    const duplicateFields = err.keyPattern || err.keyValue || {};
    // Tenant-scoped unique indexes start with businessId; name the business field.
    const field = Object.keys(duplicateFields).filter((key) => key !== 'businessId')[0] || 'kayıt';
    return res.status(409).json({ error: `Bu ${field} zaten kayıtlı`, code: 'DUPLICATE' });
  }

  // Canonical environment: " Production " is production, and an unsupported
  // NODE_ENV fails closed (treated like production, never like development).
  const environment = resolveEnvironment();
  const message = status >= 500 && !(environment.development || environment.test)
    ? 'Sunucuda beklenmeyen bir hata oluştu'
    : (err.message || 'Sunucuda bir hata oluştu');

  // Domain errors carry a stable machine-readable code (e.g. INSUFFICIENT_STOCK).
  const clientCode = status < 500 && typeof err.code === 'string' ? err.code : undefined;
  const details = status < 500 && err.details !== undefined ? err.details : undefined;

  return res.status(status).json({
    error: message,
    ...(clientCode && { code: clientCode }),
    ...(details !== undefined && { details }),
    // Stack traces only ever in an explicit development environment.
    ...(environment.development && { stack: err.stack }),
  });
};

module.exports = errorHandler;
