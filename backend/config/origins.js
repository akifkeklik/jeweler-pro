/**
 * Canonical origin handling, shared by CORS, the CSRF guards, start-up
 * validation and e-mail link generation so that all of them compare the same
 * representation.
 *
 * canonicalizeOrigin() returns the WHATWG serialised origin
 * ("scheme://host[:port]", lower-case host, default port removed, IDN in
 * punycode) or null when the value is not a plain http(s) origin. One
 * trailing "/" is tolerated (it is a common configuration typo); paths,
 * queries, fragments, credentials, "null" and wildcards are rejected.
 */
const DEFAULT_ALLOWED_ORIGINS = 'http://localhost:8080,http://localhost:3000';
const MAX_ORIGIN_LENGTH = 2048;

function canonicalizeOrigin(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > MAX_ORIGIN_LENGTH) return null;
  // Control characters / whitespace inside an origin are never legitimate.
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  // Reject anything after the authority other than one optional "/"
  // (e.g. "https://a.example/?", "https://a.example/#", "https://a.example//").
  const authorityEnd = text.indexOf('/', text.indexOf('//') + 2);
  if (authorityEnd !== -1 && authorityEnd !== text.length - 1) return null;
  if (/[?#]/.test(text)) return null;
  return url.origin;
}

/** Parses a comma-separated origin list → { origins: canonical[], invalid: raw[] }. */
function parseOriginList(raw) {
  const origins = [];
  const invalid = [];
  for (const entry of String(raw ?? '').split(',').map((e) => e.trim()).filter(Boolean)) {
    const canonical = canonicalizeOrigin(entry);
    if (canonical) {
      if (!origins.includes(canonical)) origins.push(canonical);
    } else {
      invalid.push(entry);
    }
  }
  return { origins, invalid };
}

function configuredOriginList(env = process.env) {
  const raw = env.CORS_ORIGIN === undefined || String(env.CORS_ORIGIN).trim() === ''
    ? DEFAULT_ALLOWED_ORIGINS
    : env.CORS_ORIGIN;
  return parseOriginList(raw);
}

/** Canonical allowlist (invalid entries are dropped; production refuses to start with them). */
function getAllowedOrigins(env = process.env) {
  return configuredOriginList(env).origins;
}

/** True only when the request Origin canonicalises to an allowlisted origin. */
function isAllowedOrigin(origin, env = process.env) {
  const canonical = canonicalizeOrigin(origin);
  return canonical !== null && getAllowedOrigins(env).includes(canonical);
}

/**
 * `origin` callback for the cors middleware. Reflects the request Origin only
 * when it is allowlisted; otherwise no Access-Control-Allow-Origin header is
 * sent (the browser blocks the response).
 */
function corsOriginCallback(origin, callback) {
  callback(null, origin !== undefined && isAllowedOrigin(origin));
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  canonicalizeOrigin,
  parseOriginList,
  getAllowedOrigins,
  isAllowedOrigin,
  corsOriginCallback,
};
