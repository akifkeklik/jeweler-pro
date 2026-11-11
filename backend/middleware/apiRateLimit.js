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
 * - With the shared store (RATE_LIMIT_SHARED_STORE=mongo, the production
 *   default) the counters live in MongoDB, so the budget holds across every
 *   API instance; otherwise they are per process. An unreachable store fails
 *   closed (503 RATE_LIMIT_STORE_UNAVAILABLE).
 */
const { rateLimit } = require('express-rate-limit');
const { rateLimitIdentity } = require('../utils/ipAddress');
const { resolveEnvironment } = require('../config/environment');
const { MongoRateLimitStore, sharedStoreEnabled } = require('./sharedRateLimit');

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

function createApiRateLimit({
  limit = limitFromEnv(), windowMs = 60_000, shared = sharedStoreEnabled(), store,
} = {}) {
  const limiter = rateLimit({
    windowMs,
    limit,
    skip: () => limit === 0,
    // Default memory store when not shared (development, tests, single instance).
    store: store || (shared && limit > 0 ? new MongoRateLimitStore({ name: 'api' }) : undefined),
    // Store errors reach the wrapper below (fail closed).
    passOnStoreError: false,
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
  // The central error handler hides codes of 5xx errors; answer the limiter
  // outage here so clients see RATE_LIMIT_STORE_UNAVAILABLE (as the auth limiters do).
  return function apiRateLimit(req, res, next) {
    return limiter(req, res, (error) => {
      if (error?.code === 'RATE_LIMIT_STORE_UNAVAILABLE') {
        return res.status(503).json({ error: error.message, code: error.code });
      }
      return next(error);
    });
  };
}

module.exports = { createApiRateLimit, limitFromEnv, DEFAULT_PER_MINUTE };
