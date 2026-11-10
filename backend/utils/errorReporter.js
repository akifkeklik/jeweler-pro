/**
 * Error reporting hook.
 *
 * - Every unexpected (5xx) error is logged as one JSON line when
 *   LOG_FORMAT=json (the default in production), so a log pipeline
 *   (Loki, CloudWatch, ELK, …) can index and alert on it.
 * - When ERROR_REPORT_URL is set, the same record is POSTed to it
 *   (fire-and-forget, 2 s timeout): a webhook, an alerting relay or an
 *   error-tracking ingest endpoint. Reporting never affects the response.
 * - Never reported: request bodies, query strings, headers, tokens or
 *   customer data — only method, path, status, ids and the error.
 */
const { resolveEnvironment } = require('../config/environment');

function jsonLogs(env = process.env) {
  const format = String(env.LOG_FORMAT || '').toLowerCase();
  if (format === 'json') return true;
  if (format === 'text') return false;
  return resolveEnvironment(env).strict; // production default
}

function serializeError(error) {
  if (!error || typeof error !== 'object') return { message: String(error) };
  return {
    name: error.name,
    code: error.code,
    message: error.message,
    stack: typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 15).join('\n') : undefined,
  };
}

function reportError(error, context = {}, { env = process.env, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const record = {
    time: new Date().toISOString(),
    level: 'error',
    event: 'request_failed',
    ...context,
    error: serializeError(error),
  };
  if (jsonLogs(env)) logger.error(JSON.stringify(record));
  else logger.error(`[${record.time}] Request failed`, { ...context, error });

  const url = env.ERROR_REPORT_URL;
  if (url && typeof fetchImpl === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    Promise.resolve()
      .then(() => fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...record, service: 'jeweler-pro-api', environment: resolveEnvironment(env).name }),
        signal: controller.signal,
      }))
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  }
  return record;
}

module.exports = { reportError, jsonLogs, serializeError };
