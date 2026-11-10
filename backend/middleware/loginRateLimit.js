/**
 * Multi-dimensional login protection (security finding M1).
 *
 * Three independent fixed-window limits are charged for every attempt:
 *
 *   dimension          default (15 min)  stops
 *   ─────────────────  ────────────────  ──────────────────────────────────────
 *   IP + account       10 attempts       brute force of one account from one place
 *   IP                 30 failures       password spraying (e-mail rotation) from one IP
 *   account            20 failures       distributed brute force (IP rotation) on one account
 *
 * "IP" is the rate-limit identity: the IPv4 address, or the IPv6 /64 network
 * (privacy-address rotation cannot multiply attempts).
 * "Account" is a keyed hash of the normalised e-mail; raw addresses are never
 * stored in limiter tables. Unknown accounts are limited exactly like known
 * ones, so the limiter does not reveal which accounts exist.
 *
 * Successful logins are refunded on every dimension: legitimate users sharing
 * a shop NAT do not consume the IP budget, and a correct password never counts
 * towards a lock.
 *
 * Account-lockout DoS: an attacker can push an account over its account-wide
 * limit from many IPs. To keep that from locking the owner out, a client
 * identity (IP/64 + account) that has logged in successfully within
 * KNOWN_CLIENT_TTL is exempt from the *account-wide* limit — it is still
 * bound by its own IP + account and IP limits. Attackers on other networks
 * remain blocked. The known-client list is bounded; forgetting an entry only
 * makes the limiter stricter.
 *
 * Guarantees are per API process; see middleware/rateLimit.js.
 */
const {
  createRateLimiter,
  BoundedExpiringSet,
  registerResettable,
  rateLimitIp,
  normalizedEmail,
} = require('./rateLimit');
const { accountLimiterKey } = require('../utils/accountIdentity');

const WINDOW_MS = 15 * 60 * 1000;
const KNOWN_CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MESSAGE = 'Çok fazla giriş denemesi. Bir süre sonra tekrar deneyin.';

function createLoginRateLimit({
  windowMs = WINDOW_MS,
  pairMax = 10,
  ipMax = 30,
  accountMax = 20,
  knownClientTtlMs = KNOWN_CLIENT_TTL_MS,
  maxEntries,
} = {}) {
  const sizing = maxEntries ? { maxEntries } : {};
  const ipKey = (req) => `login-ip:${rateLimitIp(req)}`;
  const accountKey = (req) => accountLimiterKey(normalizedEmail(req));
  const pairKey = (req) => {
    const account = accountKey(req);
    return account ? `login-pair:${rateLimitIp(req)}|${account}` : null;
  };

  const pairLimiter = createRateLimiter({ name: 'login-ip-account', windowMs, max: pairMax, key: pairKey, message: MESSAGE, ...sizing });
  const ipLimiter = createRateLimiter({ name: 'login-ip', windowMs, max: ipMax, key: ipKey, message: MESSAGE, ...sizing });
  const accountLimiter = createRateLimiter({ name: 'login-account', windowMs, max: accountMax, key: accountKey, message: MESSAGE, ...sizing });
  const knownClients = new BoundedExpiringSet({ ttlMs: knownClientTtlMs, ...sizing });

  function loginRateLimit(req, res, next) {
    const charged = [];
    const refundAll = () => {
      for (const [limiter, ticket] of charged) limiter.refund(ticket);
    };
    const blocked = (limiter, result) => {
      refundAll();
      return limiter.respondBlocked(res, result);
    };

    // 1. IP — bounds the number of new keys one source can create in the other tables.
    const ip = ipLimiter.consume(req);
    if (ip && !ip.allowed) return blocked(ipLimiter, ip);
    if (ip) charged.push([ipLimiter, ip]);

    // 2. IP + account.
    const pair = pairLimiter.consume(req);
    if (pair && !pair.allowed) return blocked(pairLimiter, pair);
    if (pair) charged.push([pairLimiter, pair]);

    // 3. Account-wide (all sources).
    const knownClient = pair ? knownClients.has(pair.key) : false;
    const account = accountLimiter.consume(req);
    if (account && !account.allowed && !(account.reason === 'limit' && knownClient)) {
      return blocked(accountLimiter, account);
    }
    if (account?.allowed) charged.push([accountLimiter, account]);

    if (typeof res.once === 'function') {
      res.once('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          refundAll();
          if (pair) knownClients.add(pair.key);
        }
      });
    }
    return next();
  }

  loginRateLimit.limiters = { ip: ipLimiter, pair: pairLimiter, account: accountLimiter };
  loginRateLimit.knownClients = knownClients;
  loginRateLimit.reset = () => {
    ipLimiter.reset();
    pairLimiter.reset();
    accountLimiter.reset();
    knownClients.reset();
  };
  registerResettable(loginRateLimit);
  return loginRateLimit;
}

const loginRateLimit = createLoginRateLimit();

module.exports = loginRateLimit;
module.exports.createLoginRateLimit = createLoginRateLimit;
module.exports.LOGIN_WINDOW_MS = WINDOW_MS;
