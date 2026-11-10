/**
 * General API rate limit (express-rate-limit).
 *
 * The targeted limiters (login, password reset, refresh, price refresh) stay
 * in place; this is the outer bound for every /api request, so a stolen token
 * or a runaway client cannot hammer the database.
 *
 * - Key: the client address (req.ip, honours TRUST_PROXY). One shop behind
 *   one NAT address shares the budget; the default (600 requests/minute)
 *   leaves ample room for several tills with auto-refreshing screens.
 * - API_RATE_LIMIT_PER_MINUTE configures it; 0 disables it (only for a
 *   deployment that limits at the reverse proxy instead).
 * - Responses carry the standard RateLimit-* headers; a refusal is
 *   429 RATE_LIMITED with Retry-After.
 * - The store is per process (see SECURITY.md: multi-instance deployments
 *   must also limit at the proxy).
 */
const { rateLimit } = require('express-rate-limit');
const { rateLimitIdentity } = require('../utils/ipAddress');
const { resolveEnvironment } = require('../config/environment');

const DEFAULT_PER_MINUTE = 600;

function limitFromEnv(env = process.env) {
  const raw = env.API_RATE_LIMIT_PER_MINUTE;
  if (raw === undefined || String(raw).trim() === '') {
    // The integration suites drive thousands of requests from 127.0.0.1.
    return resolveEnvironment(env).test ? 0 : DEFAULT_PER_MINUTE;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : DEFAULT_PER_MINUTE;
}

function createApiRateLimit({ limit = limitFromEnv(), windowMs = 60_000 } = {}) {
  return rateLimit({
    windowMs,
    limit,
    skip: () => limit === 0,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // rateLimitIdentity already groups IPv6 clients by /64 network.
    keyGenerator: (req) => rateLimitIdentity(req.ip),
    validate: { keyGeneratorIpFallback: false },
    handler: (req, res, _next, options) => {
      res.status(options.statusCode).json({
        error: 'Çok fazla istek gönderildi; lütfen biraz sonra tekrar deneyin',
        code: 'RATE_LIMITED',
      });
    },
  });
}

module.exports = { createApiRateLimit, limitFromEnv, DEFAULT_PER_MINUTE };
