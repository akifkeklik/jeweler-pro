/**
 * Manual price refresh throttle: one refresh per client every 5 seconds.
 *
 * Identity (security finding L6):
 * - Authenticated callers are limited per user. authenticate() builds
 *   req.user with `_id` (there is no `id`), so the previous `req.user?.id`
 *   lookup always fell through to the IP and every user behind one shop NAT
 *   shared a single bucket. The key also carries the tenant (businessId).
 * - Unauthenticated fallback uses the normalised rate-limit IP identity
 *   (IPv4, or IPv6 /64; IPv4-mapped IPv6 folded into IPv4).
 * Storage is the bounded store from ./rateLimit (no unbounded map, no scans).
 */
const { createRateLimiter, rateLimitIp } = require('./rateLimit');

const REFRESH_WINDOW_MS = 5000;

function priceRefreshKey(req) {
  const userId = req.user?._id;
  if (userId !== undefined && userId !== null && String(userId)) {
    return `price:user:${String(req.user.businessId || '')}:${String(userId)}`;
  }
  return `price:ip:${rateLimitIp(req)}`;
}

const priceRefreshRateLimit = createRateLimiter({
  name: 'price-refresh',
  windowMs: REFRESH_WINDOW_MS,
  max: 1,
  key: priceRefreshKey,
  message: 'Fiyat yenileme isteği çok sık yapıldı. Lütfen birkaç saniye bekleyin.',
});

module.exports = priceRefreshRateLimit;
module.exports.priceRefreshKey = priceRefreshKey;
module.exports.REFRESH_WINDOW_MS = REFRESH_WINDOW_MS;
