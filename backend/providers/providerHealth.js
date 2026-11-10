/**
 * Per-provider health tracking and circuit breaker.
 *
 *   closed     normal operation
 *   open       after FAILURE_THRESHOLD consecutive failures (or an HTTP 429):
 *              no upstream calls until `openUntil`; cooldown doubles on each
 *              re-opening up to MAX_COOLDOWN_MS
 *   half_open  cooldown elapsed: exactly one trial request (the in-flight
 *              de-duplication of the market data service guarantees one);
 *              success closes the breaker, failure re-opens it
 *
 * In-process state by design: market data is fetched by the API process
 * itself; with several instances each keeps its own breaker, which only
 * means each instance probes a failing provider on its own schedule.
 */
const FAILURE_THRESHOLD = Number(process.env.MARKET_DATA_BREAKER_THRESHOLD) || 3;
const BASE_COOLDOWN_MS = Number(process.env.MARKET_DATA_BREAKER_COOLDOWN_MS) || 60_000;
const MAX_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_RATE_LIMIT_MS = 60_000;

const registry = new Map();

function fresh() {
  return {
    state: 'closed',
    consecutiveFailures: 0,
    openings: 0,
    openUntil: 0,
    successes: 0,
    failures: 0,
    rateLimited: 0,
    lastLatencyMs: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
  };
}

function healthOf(id) {
  if (!registry.has(id)) registry.set(id, fresh());
  return registry.get(id);
}

/** True when a request may go upstream now (moves open → half_open when the cooldown elapsed). */
function allowRequest(id, now = Date.now()) {
  const h = healthOf(id);
  if (h.state === 'open') {
    if (now < h.openUntil) return false;
    h.state = 'half_open';
  }
  return true;
}

function open(h, durationMs, now) {
  h.state = 'open';
  h.openings += 1;
  h.openUntil = now + durationMs;
}

function recordSuccess(id, latencyMs, now = Date.now()) {
  const h = healthOf(id);
  h.state = 'closed';
  h.consecutiveFailures = 0;
  h.openings = 0;
  h.openUntil = 0;
  h.successes += 1;
  h.lastLatencyMs = latencyMs;
  h.lastSuccessAt = new Date(now).toISOString();
}

function recordFailure(id, error, now = Date.now()) {
  const h = healthOf(id);
  h.failures += 1;
  h.consecutiveFailures += 1;
  h.lastErrorAt = new Date(now).toISOString();
  h.lastError = String(error?.message || error || 'unknown').slice(0, 200);
  const retryAfterMs = rateLimitDelay(error, now);
  if (retryAfterMs !== null) {
    h.rateLimited += 1;
    open(h, retryAfterMs, now);
    return;
  }
  if (h.state === 'half_open' || h.consecutiveFailures >= FAILURE_THRESHOLD) {
    const cooldown = Math.min(BASE_COOLDOWN_MS * 2 ** h.openings, MAX_COOLDOWN_MS);
    open(h, cooldown, now);
  }
}

/** For HTTP 429: the Retry-After delay (seconds or HTTP date), default 60 s. Otherwise null. */
function rateLimitDelay(error, now = Date.now()) {
  const status = error?.response?.status ?? error?.status;
  if (status !== 429) return null;
  const header = error?.response?.headers?.['retry-after'];
  if (header !== undefined) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_COOLDOWN_MS);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(Math.max(date - now, 0), MAX_COOLDOWN_MS);
  }
  return DEFAULT_RATE_LIMIT_MS;
}

/** Network errors, timeouts and 5xx are worth one retry; 4xx / malformed responses are not. */
function isTransient(error) {
  const status = error?.response?.status ?? error?.status;
  if (status === 429) return false;
  if (status >= 500) return true;
  if (status >= 400) return false;
  if (error?.code === 'MALFORMED_RESPONSE') return false;
  return true;
}

function snapshot(id, now = Date.now()) {
  const h = healthOf(id);
  return {
    circuit: h.state === 'open' && now >= h.openUntil ? 'half_open' : h.state,
    retryAt: h.state === 'open' ? new Date(h.openUntil).toISOString() : null,
    consecutiveFailures: h.consecutiveFailures,
    successes: h.successes,
    failures: h.failures,
    rateLimited: h.rateLimited,
    lastLatencyMs: h.lastLatencyMs,
    lastSuccessAt: h.lastSuccessAt,
    lastErrorAt: h.lastErrorAt,
    lastError: h.lastError,
  };
}

function reset() {
  registry.clear();
}

module.exports = {
  FAILURE_THRESHOLD, allowRequest, recordSuccess, recordFailure, rateLimitDelay, isTransient, snapshot, reset,
};
