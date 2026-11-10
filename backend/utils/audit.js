const { auditIpPrefix } = require('./ipAddress');

/**
 * Audit trail writer with a central data-minimisation policy (finding M4).
 * Policy details and rationale: backend/SECURITY.md → "Audit data retention".
 *
 * Applied to every new record, regardless of the caller:
 * 1. Secrets are never stored (SENSITIVE_KEYS, recursively).
 * 2. A client address stored under `ip` is reduced to its network prefix
 *    (`ipPrefix`: IPv4 /24, IPv6 /48). Full addresses live only in the
 *    short-lived AuthSession documents (TTL: session expiry + 1 day).
 * 3. User-resource snapshots never contain the person's name or e-mail; the
 *    resource id identifies the account while it exists, and once it is
 *    deleted nothing personal remains in the audit trail.
 * 4. High-volume security telemetry (TELEMETRY_ACTIONS) receives `expiresAt`
 *    and is removed by a TTL index after AUDIT_TELEMETRY_RETENTION_DAYS
 *    (default 180). Business and state-change records are kept indefinitely.
 * Historical records are never rewritten by this code.
 */
function requireAuditContext(context) {
  if (!context?.actorUserId || !context.correlationId) {
    throw new Error('Audit context eksik');
  }
}

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'authorization',
]);

const USER_PII_KEYS = new Set(['name', 'email']);

const TELEMETRY_ACTIONS = new Set([
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.password_reset_requested',
  'auth.password_reset_email_failed',
  'user.password_reset_email_failed',
]);

const DEFAULT_TELEMETRY_RETENTION_DAYS = 180;
const MIN_TELEMETRY_RETENTION_DAYS = 30;
const MAX_TELEMETRY_RETENTION_DAYS = 3650;

function telemetryRetentionDays(env = process.env) {
  const raw = env.AUDIT_TELEMETRY_RETENTION_DAYS;
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_TELEMETRY_RETENTION_DAYS;
  const value = Number(raw);
  // runtimeConfig rejects invalid values at start-up; keep the default here.
  return Number.isSafeInteger(value) && value >= MIN_TELEMETRY_RETENTION_DAYS && value <= MAX_TELEMETRY_RETENTION_DAYS
    ? value
    : DEFAULT_TELEMETRY_RETENTION_DAYS;
}

function sanitizeSnapshot(value, { stripUserPii = false, depth = 0 } = {}) {
  if (Array.isArray(value)) return value.map((item) => sanitizeSnapshot(item, { stripUserPii, depth: depth + 1 }));
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  if (typeof value.toHexString === 'function') return value; // ObjectId
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (stripUserPii && depth === 0 && USER_PII_KEYS.has(key)) continue;
    if (key === 'ip') {
      const prefix = auditIpPrefix(item);
      if (prefix) out.ipPrefix = prefix;
      continue;
    }
    out[key] = sanitizeSnapshot(item, { stripUserPii, depth: depth + 1 });
  }
  return out;
}

/**
 * Structured, non-sensitive classification of an e-mail delivery failure.
 * Raw SMTP error text can contain recipient addresses, host names or
 * server banners, so only an allowlisted code (and the numeric SMTP reply
 * code) is persisted.
 */
const SMTP_ERROR_CODES = new Set([
  'EAUTH', 'ECONNECTION', 'EDNS', 'EENVELOPE', 'EMESSAGE', 'ESOCKET', 'ETIMEDOUT',
  'ETLS', 'EPROTOCOL', 'ESTREAM', 'EMAXLIMIT', 'ECONNREFUSED', 'ECONNRESET',
  'SMTP_UNCONFIGURED', 'SMTP_UNAVAILABLE',
]);

function classifyEmailError(error) {
  const code = typeof error?.code === 'string' && SMTP_ERROR_CODES.has(error.code) ? error.code : 'UNKNOWN';
  const responseCode = Number(error?.responseCode);
  return {
    errorCode: code,
    ...(Number.isInteger(responseCode) && responseCode >= 200 && responseCode <= 599 ? { smtpResponseCode: responseCode } : {}),
  };
}

async function recordAudit({
  AuditLog,
  session,
  actorUserId,
  action,
  resourceType,
  resourceId,
  correlationId,
  before,
  after,
  now = new Date(),
}) {
  if (!AuditLog) throw new Error('AuditLog modeli yapılandırılmamış');
  requireAuditContext({ actorUserId, correlationId });

  const stripUserPii = resourceType === 'User';
  const entry = {
    actorUserId,
    action,
    resourceType,
    resourceId: String(resourceId),
    correlationId,
    ...(before === undefined ? {} : { before: sanitizeSnapshot(before, { stripUserPii }) }),
    ...(after === undefined ? {} : { after: sanitizeSnapshot(after, { stripUserPii }) }),
    ...(TELEMETRY_ACTIONS.has(action)
      ? { expiresAt: new Date(now.getTime() + telemetryRetentionDays() * 24 * 60 * 60 * 1000) }
      : {}),
  };
  const options = session ? { session } : undefined;
  const created = await AuditLog.create([entry], options);
  return created[0];
}

/**
 * Best-effort audit for security telemetry (failed logins, reset requests)
 * where an audit-store outage must not turn into an authentication outage.
 */
async function recordAuditSafely(entry) {
  try {
    return await recordAudit(entry);
  } catch (error) {
    console.error('[audit] kayıt yazılamadı', { action: entry?.action, error: error.message });
    return null;
  }
}

module.exports = {
  TELEMETRY_ACTIONS,
  DEFAULT_TELEMETRY_RETENTION_DAYS,
  MIN_TELEMETRY_RETENTION_DAYS,
  MAX_TELEMETRY_RETENTION_DAYS,
  telemetryRetentionDays,
  sanitizeSnapshot,
  classifyEmailError,
  recordAudit,
  recordAuditSafely,
};
