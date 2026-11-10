/**
 * Start-up configuration validation.
 *
 * In production an unsafe or incomplete configuration is a hard error: the
 * server refuses to start instead of silently running with insecure defaults
 * (non-Secure cookies, localhost reset links, spoofable client IPs ...).
 * Development and test keep their permissive defaults; problems are reported
 * as warnings only.
 *
 * Messages name the offending variable but never echo secret values.
 */
const net = require('node:net');
const { SUPPORTED_ENVIRONMENTS, resolveEnvironment } = require('./environment');
const { canonicalizeOrigin, parseOriginList } = require('./origins');
const { isLoopbackHostname } = require('../utils/ipAddress');
const { MIN_MAX_ENTRIES, MAX_MAX_ENTRIES } = require('../middleware/rateLimit');
const { MIN_TELEMETRY_RETENTION_DAYS, MAX_TELEMETRY_RETENTION_DAYS } = require('../utils/audit');

const SAMESITE_VALUES = ['strict', 'lax', 'none'];
const TRUST_PROXY_KEYWORDS = ['loopback', 'linklocal', 'uniquelocal'];
const PLACEHOLDER_SECRETS = new Set([
  'replace-with-a-random-secret-at-least-32-characters',
  'replace-with-a-strong-unique-password',
]);
const MAX_PROXY_HOPS = 10;

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/**
 * Loopback / unspecified host in any equivalent spelling (security finding L5):
 * "localhost.", "LOCALHOST", "*.localhost", "127.1", "2130706433", "[::1]",
 * "[0:0:0:0:0:0:0:1]", "[::ffff:127.0.0.1]", "0.0.0.0", "[::]" …
 */
function isLocalHostname(hostname) {
  return isLoopbackHostname(hostname);
}

function isValidCidrOrIp(entry) {
  const [address, prefix, ...rest] = entry.split('/');
  if (rest.length) return false;
  const family = net.isIP(address);
  if (!family) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return family === 4 ? bits <= 32 : bits <= 128;
}

/**
 * TRUST_PROXY →  Express "trust proxy" setting.
 *   unset / "" / "false" / "0"  → false   (use the socket address)
 *   "true"                      → 1       (exactly one reverse proxy; kept for backwards compatibility)
 *   "1".."10"                   → number of trusted proxy hops
 *   "loopback, 10.0.0.0/8, …"   → explicit trusted proxy addresses / subnets
 * Trusting *every* hop (Express `true`) is never produced: it would let any
 * client choose its own IP through X-Forwarded-For and bypass rate limits.
 */
function parseTrustProxy(raw) {
  if (isBlank(raw)) return { value: false, explicit: false };
  const text = String(raw).trim();
  const lower = text.toLowerCase();
  if (lower === 'false' || lower === '0') return { value: false, explicit: true };
  if (lower === 'true') return { value: 1, explicit: true };
  if (/^\d+$/.test(lower)) {
    const hops = Number(lower);
    if (hops >= 1 && hops <= MAX_PROXY_HOPS) return { value: hops, explicit: true };
    return { error: `TRUST_PROXY hop sayısı 1-${MAX_PROXY_HOPS} aralığında olmalıdır` };
  }
  const entries = text.split(',').map((e) => e.trim()).filter(Boolean);
  const invalid = entries.filter((e) => !TRUST_PROXY_KEYWORDS.includes(e.toLowerCase()) && !isValidCidrOrIp(e));
  if (!entries.length || invalid.length) {
    return { error: 'TRUST_PROXY geçersiz: false, true, 1-10 arası hop sayısı veya virgülle ayrılmış IP/CIDR listesi olmalıdır' };
  }
  return { value: entries.map((e) => (TRUST_PROXY_KEYWORDS.includes(e.toLowerCase()) ? e.toLowerCase() : e)), explicit: true };
}

function parseOrigin(value, name, errors, { production }) {
  let url;
  try {
    url = new URL(value);
  } catch {
    errors.push(`${name} geçerli bir mutlak URL olmalıdır`);
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    errors.push(`${name} http(s) URL olmalıdır`);
    return null;
  }
  if (production) {
    if (url.protocol !== 'https:') errors.push(`${name} üretim ortamında https olmalıdır`);
    if (isLocalHostname(url.hostname)) errors.push(`${name} üretim ortamında localhost/loopback olamaz`);
    if (url.username || url.password) errors.push(`${name} kullanıcı bilgisi içeremez`);
  }
  return url;
}

/**
 * Returns { environment, errors, warnings, trustProxy }.
 * `errors` is non-empty only for configurations that must not start.
 */
function validateRuntimeConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  // Canonical interpretation (config/environment.js): whitespace and casing
  // are normalised (" Production " → production); anything else is refused.
  const resolved = resolveEnvironment(env);
  if (!resolved.valid) {
    // e.g. "prod" would otherwise silently disable every production safeguard.
    errors.push(`NODE_ENV tanınmıyor; ${SUPPORTED_ENVIRONMENTS.join(', ')} değerlerinden biri olmalıdır`);
  }
  const environment = resolved.name;
  const production = resolved.production;

  // --- JWT secret -----------------------------------------------------------
  if (isBlank(env.JWT_SECRET) || Buffer.byteLength(String(env.JWT_SECRET)) < 32) {
    errors.push('JWT_SECRET en az 32 karakter olmalıdır');
  } else if (production && PLACEHOLDER_SECRETS.has(String(env.JWT_SECRET))) {
    errors.push('JWT_SECRET örnek (.env.example) değerinde bırakılmış');
  }
  if (production && !isBlank(env.ADMIN_PASSWORD) && PLACEHOLDER_SECRETS.has(String(env.ADMIN_PASSWORD))) {
    errors.push('ADMIN_PASSWORD örnek (.env.example) değerinde bırakılmış');
  }

  // --- Cookies --------------------------------------------------------------
  const sameSiteRaw = isBlank(env.AUTH_COOKIE_SAMESITE) ? 'strict' : String(env.AUTH_COOKIE_SAMESITE).trim().toLowerCase();
  if (!SAMESITE_VALUES.includes(sameSiteRaw)) {
    (production ? errors : warnings).push('AUTH_COOKIE_SAMESITE strict, lax veya none olmalıdır');
  }
  if (!isBlank(env.AUTH_COOKIE_SECURE)) {
    const v = String(env.AUTH_COOKIE_SECURE).trim().toLowerCase();
    const known = ['1', 'true', 'yes', 'on', '0', 'false', 'no', 'off'];
    if (!known.includes(v)) {
      (production ? errors : warnings).push('AUTH_COOKIE_SECURE true veya false olmalıdır');
    } else if (production && ['0', 'false', 'no', 'off'].includes(v)) {
      errors.push('AUTH_COOKIE_SECURE üretim ortamında kapatılamaz (refresh cookie yalnızca HTTPS üzerinden gönderilmelidir)');
    }
  }

  // --- Origins / public URL -------------------------------------------------
  const corsOrigins = String(env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
  // Same canonical form the CORS and CSRF middleware compare against.
  const canonicalCors = parseOriginList(env.CORS_ORIGIN).origins;
  if (production) {
    if (!corsOrigins.length) errors.push('CORS_ORIGIN üretim ortamında açıkça tanımlanmalıdır');
    for (const origin of corsOrigins) {
      if (origin === '*' || origin === 'null') {
        errors.push('CORS_ORIGIN joker (*) veya "null" içeremez');
        continue;
      }
      const url = parseOrigin(origin, 'CORS_ORIGIN', errors, { production });
      if (url && canonicalizeOrigin(origin) === null) errors.push('CORS_ORIGIN yalnızca origin (şema://alan[:port]) içermelidir');
    }
  } else if (parseOriginList(env.CORS_ORIGIN).invalid.length) {
    warnings.push('CORS_ORIGIN geçersiz origin içeriyor; bu girişler yok sayıldı');
  }

  if (production) {
    if (isBlank(env.APP_URL)) {
      errors.push('APP_URL üretim ortamında zorunludur (şifre sıfırlama bağlantıları için)');
    } else {
      const appUrl = parseOrigin(String(env.APP_URL).trim(), 'APP_URL', errors, { production });
      if (appUrl && corsOrigins.length && !canonicalCors.includes(appUrl.origin)) {
        errors.push('APP_URL origin değeri CORS_ORIGIN listesinde bulunmalıdır');
      }
    }
  } else if (!isBlank(env.APP_URL)) {
    parseOrigin(String(env.APP_URL).trim(), 'APP_URL', warnings, { production: false });
  }

  // --- Reverse proxy --------------------------------------------------------
  const trust = parseTrustProxy(env.TRUST_PROXY);
  let trustProxy = trust.value;
  if (trust.error) {
    if (production) errors.push(trust.error);
    else warnings.push(`${trust.error} — geliştirme ortamında proxy güveni kapatıldı`);
    trustProxy = false;
  } else if (production && !trust.explicit) {
    // Wrong either way: behind a proxy every client shares the proxy IP (one
    // attacker can rate-limit everyone); without a proxy a trusted header lets
    // clients forge their IP. The operator must decide explicitly.
    errors.push('TRUST_PROXY üretim ortamında açıkça tanımlanmalıdır (proxy yoksa false, tek proxy için 1 veya proxy IP/CIDR listesi)');
  }

  // --- Database -------------------------------------------------------------
  if (production && isBlank(env.MONGO_URI)) {
    errors.push('MONGO_URI üretim ortamında açıkça tanımlanmalıdır');
  }

  // --- Rate limiter capacity ------------------------------------------------
  if (!isBlank(env.RATE_LIMIT_MAX_ENTRIES)) {
    const value = Number(env.RATE_LIMIT_MAX_ENTRIES);
    if (!Number.isSafeInteger(value) || value < MIN_MAX_ENTRIES || value > MAX_MAX_ENTRIES) {
      (production ? errors : warnings).push(`RATE_LIMIT_MAX_ENTRIES ${MIN_MAX_ENTRIES}-${MAX_MAX_ENTRIES} aralığında bir tam sayı olmalıdır`);
    }
  }

  // --- Audit retention ------------------------------------------------------
  if (!isBlank(env.AUDIT_TELEMETRY_RETENTION_DAYS)) {
    const value = Number(env.AUDIT_TELEMETRY_RETENTION_DAYS);
    if (!Number.isSafeInteger(value) || value < MIN_TELEMETRY_RETENTION_DAYS || value > MAX_TELEMETRY_RETENTION_DAYS) {
      (production ? errors : warnings).push(`AUDIT_TELEMETRY_RETENTION_DAYS ${MIN_TELEMETRY_RETENTION_DAYS}-${MAX_TELEMETRY_RETENTION_DAYS} aralığında bir tam sayı olmalıdır`);
    }
  }

  if (production) {
    warnings.push('Rate limit sayaçları süreç belleğinde tutulur; birden fazla API örneği çalıştırılıyorsa reverse proxy / paylaşımlı store ile de rate limit uygulayın');
  }

  return { environment, production, errors, warnings, trustProxy };
}

module.exports = { validateRuntimeConfig, parseTrustProxy, isLocalHostname };
