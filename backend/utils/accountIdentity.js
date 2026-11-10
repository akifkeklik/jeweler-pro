const crypto = require('node:crypto');

/**
 * Account identifier normalisation shared by the login/reset routes and the
 * rate limiters, so that " User@Example.com " and "user@example.com" are the
 * same account everywhere. Must stay identical to the normalisation used when
 * users are stored (User.email: trim + lowercase).
 */
const MAX_EMAIL_LENGTH = 254;

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

// Per-process random key: rate-limiter keys are keyed hashes, so neither the
// in-memory tables nor a heap dump contain raw e-mail addresses, and an
// unsalted dictionary of known addresses cannot reverse them.
const LIMITER_KEY_SECRET = crypto.randomBytes(32);

/** Pseudonymous, fixed-length limiter key for an account, or null when empty/oversized. */
function accountLimiterKey(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > MAX_EMAIL_LENGTH) return normalized ? 'acct:oversized' : null;
  return `acct:${crypto.createHmac('sha256', LIMITER_KEY_SECRET).update(normalized).digest('base64url').slice(0, 32)}`;
}

module.exports = { MAX_EMAIL_LENGTH, normalizeEmail, accountLimiterKey };
