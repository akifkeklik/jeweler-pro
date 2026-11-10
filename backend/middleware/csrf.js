// Same canonical origin representation as the CORS middleware (config/origins).
const { isAllowedOrigin } = require('../config/origins');

function originRejected(res) {
  return res.status(403).json({ error: 'İstek kaynağı doğrulanamadı', code: 'CSRF_ORIGIN_REJECTED' });
}

/**
 * CSRF guard for endpoints authenticated by the refresh cookie.
 *
 * 1. A custom header is mandatory. HTML forms cannot set it and cross-origin
 *    scripts must pass a CORS preflight, which only allows CORS_ORIGIN.
 * 2. When the browser sends Origin, it must be one of CORS_ORIGIN.
 * Combined with SameSite cookies this blocks cross-site refresh/logout forgery.
 */
function requireCsrfHeader(req, res, next) {
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    return originRejected(res);
  }
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    return res.status(403).json({ error: 'Güvenlik başlığı eksik', code: 'CSRF_HEADER_MISSING' });
  }
  return next();
}

/**
 * Applies the CSRF guard only when the refresh cookie is actually present —
 * bearer-only requests (no ambient credential) cannot be forged cross-site.
 */
function requireCsrfHeaderWhenCookie(cookieName) {
  return (req, res, next) => {
    if (!req.cookies?.[cookieName]) return next();
    return requireCsrfHeader(req, res, next);
  };
}

function isJsonContentType(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  return type === 'application/json';
}

/**
 * Login-CSRF guard for unauthenticated, state-changing endpoints (login,
 * forgot/reset password). These carry no ambient credential, so the threat is
 * a foreign site making the victim's browser submit them (e.g. logging the
 * victim into an attacker-controlled account, or mass-triggering reset mails).
 *
 * - A browser Origin must be one of CORS_ORIGIN; "null" (sandboxed frames,
 *   file://) is rejected as well.
 * - Without Origin, a browser-declared cross-site request (Sec-Fetch-Site) is
 *   rejected.
 * - The body must be application/json. HTML forms can only send
 *   urlencoded / multipart / text/plain, and a cross-origin script sending
 *   JSON has to pass a CORS preflight that only CORS_ORIGIN can satisfy.
 *
 * Same-origin SPA requests and non-browser API clients that send JSON keep
 * working; X-Requested-With is not required here.
 */
function requireJsonSameOrigin(req, res, next) {
  const origin = req.headers.origin;
  if (origin !== undefined && !isAllowedOrigin(origin)) {
    return originRejected(res);
  }
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (origin === undefined && fetchSite === 'cross-site') {
    return originRejected(res);
  }
  if (!isJsonContentType(req)) {
    return res.status(415).json({ error: 'İstek gövdesi application/json olmalıdır', code: 'CSRF_CONTENT_TYPE_REJECTED' });
  }
  return next();
}

module.exports = { requireCsrfHeader, requireCsrfHeaderWhenCookie, requireJsonSameOrigin };
