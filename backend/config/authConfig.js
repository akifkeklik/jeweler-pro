/**
 * Central authentication configuration.
 * Values are read lazily (on every call) so tests and operators can change the
 * environment without restarting module caches.
 */
const { isStrictEnvironment } = require('./environment');
// Re-exported for backwards compatibility; canonical origin handling lives in ./origins.
const { getAllowedOrigins } = require('./origins');

function readPositiveInt(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} ${min}-${max} aralığında bir tam sayı olmalıdır`);
  }
  return value;
}

function readBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function getAuthConfig() {
  const sameSiteRaw = String(process.env.AUTH_COOKIE_SAMESITE || 'strict').trim().toLowerCase();
  const sameSite = ['strict', 'lax', 'none'].includes(sameSiteRaw) ? sameSiteRaw : 'strict';
  // SameSite=None is only accepted by browsers together with Secure.
  // Production (and any unsupported NODE_ENV) always uses Secure cookies;
  // runtimeConfig refuses AUTH_COOKIE_SECURE=false in production.
  const secure = sameSite === 'none' || isStrictEnvironment()
    ? true
    : readBoolean('AUTH_COOKIE_SECURE', false);

  return {
    // Short-lived bearer token kept only in browser memory.
    accessTokenTtlSeconds: readPositiveInt('ACCESS_TOKEN_TTL_SECONDS', 15 * 60, { min: 60, max: 24 * 60 * 60 }),
    // "Beni Hatırla" — persistent cookie, absolute lifetime.
    rememberMeTtlSeconds: readPositiveInt('REMEMBER_ME_TTL_DAYS', 30, { min: 1, max: 365 }) * 24 * 60 * 60,
    // Normal login — browser-session cookie with a server-enforced absolute lifetime.
    sessionTtlSeconds: readPositiveInt('SESSION_TTL_HOURS', 12, { min: 1, max: 7 * 24 }) * 60 * 60,
    // Parallel tabs may present the just-rotated token; inside this window it is
    // treated as a benign race instead of token theft.
    refreshReuseGraceSeconds: readPositiveInt('REFRESH_REUSE_GRACE_SECONDS', 30, { min: 0, max: 300 }),
    passwordResetTtlSeconds: readPositiveInt('PASSWORD_RESET_TTL_MINUTES', 60, { min: 5, max: 24 * 60 }) * 60,
    passwordResetCooldownSeconds: readPositiveInt('PASSWORD_RESET_COOLDOWN_SECONDS', 60, { min: 0, max: 3600 }),
    passwordMinLength: readPositiveInt('PASSWORD_MIN_LENGTH', 12, { min: 8, max: 128 }),
    passwordMaxLength: 200,
    maxActiveSessionsPerUser: readPositiveInt('MAX_ACTIVE_SESSIONS_PER_USER', 20, { min: 1, max: 500 }),
    cookie: {
      name: 'jeweler_refresh_token',
      path: '/api/auth',
      secure,
      sameSite,
      domain: process.env.AUTH_COOKIE_DOMAIN || undefined,
    },
  };
}

module.exports = { getAuthConfig, getAllowedOrigins };
