const crypto = require('node:crypto');

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    const error = new Error('JWT_SECRET en az 32 karakter olmalıdır');
    error.statusCode = 500;
    throw error;
  }
  return secret;
}

function decodeBase64UrlSegment(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  // Reject non-canonical encodings (including alternate final characters that
  // decode to the same bytes). This prevents JWT segment malleability.
  return decoded.toString('base64url') === value ? decoded : null;
}

function signToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: String(user._id),
    email: user.email,
    role: user.role,
    iat: now,
    exp: now + 60 * 60 * 8,
  })).toString('base64url');
  const content = header + '.' + payload;
  const signature = crypto.createHmac('sha256', getSecret()).update(content).digest('base64url');
  return content + '.' + signature;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const headerBytes = decodeBase64UrlSegment(header);
  const payloadBytes = decodeBase64UrlSegment(payload);
  const signatureBytes = decodeBase64UrlSegment(signature);
  if (!headerBytes || !payloadBytes || !signatureBytes) return null;

  const expected = crypto.createHmac('sha256', getSecret()).update(header + '.' + payload).digest();
  if (signatureBytes.length !== expected.length || !crypto.timingSafeEqual(signatureBytes, expected)) return null;

  try {
    const parsedHeader = JSON.parse(headerBytes.toString('utf8'));
    const claims = JSON.parse(payloadBytes.toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') return null;
    if (typeof claims.sub !== 'string' || !claims.sub.trim()) return null;
    if (!Number.isSafeInteger(claims.exp) || claims.exp <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

function authenticate(req, res, next) {
  try {
    const authorization = req.headers.authorization || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    const claims = match && verifyToken(match[1]);
    if (!claims) return res.status(401).json({ error: 'Oturum geçersiz veya süresi dolmuş' });
    req.auth = claims;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz bulunmuyor' });
    }
    return next();
  };
}

module.exports = { signToken, verifyToken, authenticate, requireRole };
