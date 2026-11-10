/**
 * IP address parsing and canonicalisation shared by rate limiting, loopback
 * detection and audit-data minimisation. One parser means every consumer
 * agrees on what "the same address" is.
 */
const net = require('node:net');

const LOOPBACK_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);
// Default IPv6 rate-limit granularity. A /64 is the smallest network normally
// assigned to one subscriber; privacy extensions (RFC 4941) rotate the low 64
// bits, so per-address limits would be trivially bypassed by one client.
const DEFAULT_IPV6_RATE_LIMIT_PREFIX = 64;

function stripBracketsAndZone(value) {
  let text = String(value ?? '').trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  return text;
}

function parseIpv4(text) {
  if (net.isIPv4(text) !== true) return null;
  return Uint8Array.from(text.split('.').map(Number));
}

function parseIpv6(text) {
  if (!net.isIPv6(text)) return null;
  const halves = text.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const toGroups = (part) => {
    if (!part) return [];
    const groups = [];
    for (const piece of part.split(':')) {
      if (piece.includes('.')) {
        const v4 = parseIpv4(piece);
        if (!v4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        groups.push(parseInt(piece, 16));
      }
    }
    return groups;
  };
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...new Array(halves.length === 2 ? missing : 0).fill(0), ...tail];
  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => { bytes[i * 2] = g >> 8; bytes[i * 2 + 1] = g & 0xff; });
  return bytes;
}

/** { family: 4 | 6, bytes } or null for anything that is not an IP literal. */
function parseIp(value) {
  const text = stripBracketsAndZone(value);
  if (!text) return null;
  const v4 = parseIpv4(text);
  if (v4) return { family: 4, bytes: v4 };
  const v6 = parseIpv6(text);
  return v6 ? { family: 6, bytes: v6 } : null;
}

/** IPv4 address embedded as an IPv4-mapped IPv6 address (::ffff:a.b.c.d), else null. */
function mappedIpv4(bytes) {
  for (let i = 0; i < 10; i += 1) if (bytes[i] !== 0) return null;
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return null;
  return bytes.slice(12);
}

/** Deprecated IPv4-compatible IPv6 address (::a.b.c.d, RFC 4291 §2.5.5.1), else null. */
function compatibleIpv4(bytes) {
  for (let i = 0; i < 12; i += 1) if (bytes[i] !== 0) return null;
  const v4 = bytes.slice(12);
  // ::, ::1 are their own addresses, not embedded IPv4.
  if (v4[0] === 0 && v4[1] === 0 && v4[2] === 0 && v4[3] <= 1) return null;
  return v4;
}

const formatIpv4 = (bytes) => Array.from(bytes).join('.');

/** RFC 5952 canonical text form (lower case, longest zero run compressed). */
function formatIpv6(bytes) {
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) { i += 1; continue; }
    let j = i;
    while (j < 8 && groups[j] === 0) j += 1;
    if (j - i > bestLength && j - i >= 2) { bestStart = i; bestLength = j - i; }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart === -1) return hex.join(':');
  const left = hex.slice(0, bestStart).join(':');
  const right = hex.slice(bestStart + bestLength).join(':');
  return `${left}::${right}`;
}

function maskBytes(bytes, prefixLength) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    const bits = Math.max(0, Math.min(8, prefixLength - i * 8));
    out[i] = bits === 0 ? 0 : bytes[i] & ((0xff << (8 - bits)) & 0xff);
  }
  return out;
}

/** Canonical { family, bytes } with IPv4-mapped IPv6 folded into IPv4. */
function canonicalIp(value) {
  const parsed = parseIp(value);
  if (!parsed) return null;
  if (parsed.family === 6) {
    const v4 = mappedIpv4(parsed.bytes);
    if (v4) return { family: 4, bytes: v4 };
  }
  return parsed;
}

/**
 * Normalised client address. IPv4-mapped IPv6 ("::ffff:203.0.113.7") and the
 * plain IPv4 form are the same client; IPv6 is printed in RFC 5952 form so
 * "2001:DB8:0:0::1" and "2001:db8::1" are equal. Non-IP input is returned
 * trimmed and lower-cased (callers bound its length).
 */
function normalizeIp(address) {
  const ip = canonicalIp(address);
  if (ip) return ip.family === 4 ? formatIpv4(ip.bytes) : formatIpv6(ip.bytes);
  const value = String(address ?? '').trim().toLowerCase();
  return value || 'unknown';
}

/**
 * Rate-limit identity of a client address.
 *   IPv4 / IPv4-mapped IPv6 → the full IPv4 address
 *   IPv6                    → its /64 network (privacy-address rotation safe)
 *   anything else           → "raw:<value>" (never throws; the limiter bounds key length)
 */
function rateLimitIdentity(address, { ipv6Prefix = DEFAULT_IPV6_RATE_LIMIT_PREFIX } = {}) {
  const ip = canonicalIp(address);
  if (!ip) return `raw:${normalizeIp(address)}`;
  if (ip.family === 4) return `v4:${formatIpv4(ip.bytes)}`;
  return `v6:${formatIpv6(maskBytes(ip.bytes, ipv6Prefix))}/${ipv6Prefix}`;
}

/**
 * Data-minimised network prefix kept in long-lived audit records instead of
 * the full client address: IPv4 /24, IPv6 /48. Returns null for non-IP input.
 */
function auditIpPrefix(address) {
  const ip = canonicalIp(address);
  if (!ip) return null;
  if (ip.family === 4) return `${formatIpv4(maskBytes(ip.bytes, 24))}/24`;
  return `${formatIpv6(maskBytes(ip.bytes, 48))}/48`;
}

/**
 * True for every textual form of a loopback or unspecified address:
 * 127.0.0.0/8, 0.0.0.0/8, ::1, ::, IPv4-mapped (::ffff:127.0.0.1) and
 * IPv4-compatible (::127.0.0.1) forms. Unspecified addresses are included
 * because connecting to them reaches the local host.
 */
function isLoopbackIp(address) {
  const parsed = parseIp(address);
  if (!parsed) return false;
  let v4 = parsed.family === 4 ? parsed.bytes : (mappedIpv4(parsed.bytes) || compatibleIpv4(parsed.bytes));
  if (v4) return v4[0] === 127 || v4[0] === 0;
  const b = parsed.bytes;
  for (let i = 0; i < 15; i += 1) if (b[i] !== 0) return false;
  return b[15] === 0 || b[15] === 1; // :: or ::1
}

/**
 * True for loopback host names and literals in any equivalent spelling:
 * case, trailing dots ("localhost."), brackets, *.localhost (RFC 6761), and
 * IPv4 shorthand that resolvers/URL parsers expand to 127.0.0.1
 * ("127.1", "2130706433", "0x7f.1").
 */
function isLoopbackHostname(hostname) {
  let host = String(hostname ?? '').trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.replace(/\.+$/, '');
  if (!host) return false;
  if (LOOPBACK_HOSTNAMES.has(host) || host.endsWith('.localhost')) return true;
  if (isLoopbackIp(host)) return true;
  if (host.includes(':')) return false; // IPv6 literal, already checked
  // Let the WHATWG host parser expand IPv4 shorthand / numeric forms.
  try {
    const expanded = new URL(`http://${host}/`).hostname;
    return expanded !== host && isLoopbackHostname(expanded);
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_IPV6_RATE_LIMIT_PREFIX,
  parseIp,
  canonicalIp,
  formatIpv6,
  normalizeIp,
  rateLimitIdentity,
  auditIpPrefix,
  isLoopbackIp,
  isLoopbackHostname,
};
