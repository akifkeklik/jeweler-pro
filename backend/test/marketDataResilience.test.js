/**
 * Market data resilience: circuit breaker, rate limits, malformed
 * responses, failover from a stale to a live provider, and the guarantee
 * that no live quote is fabricated when every provider is down.
 */
process.env.MARKET_DATA_RETRY_BASE_MS = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const MarketDataProvider = require('../providers/marketDataProvider');
const health = require('../providers/providerHealth');
const {
  getMarketData, clearMarketDataCache, registerProvider, unregisterProvider, getProviderHealth,
} = require('../services/marketDataService');
const { liveQuoteFrom, resolveMetalPrices } = require('../services/finance/metalPricing');

class ScriptedProvider extends MarketDataProvider {
  constructor(id, priority, script) {
    super({ id, name: id, priority, maxAgeMs: 5 * 60 * 1000 });
    this.script = script;
    this.calls = 0;
  }

  async fetchQuotes() {
    this.calls += 1;
    return this.script(this.calls);
  }
}

const gold = (source, buy = 6500, sell = 6550) => ({
  symbol: 'HAS_ALTIN', type: 'Has', asset: 'gold', buy, sell, source, updatedAt: new Date(Date.now()).toISOString(), sourceTimestamp: new Date(Date.now()).toISOString(),
});

async function withProviders(list, fn) {
  const originalGet = axios.get;
  // Built-in providers must not reach the network in tests.
  axios.get = async () => { throw new Error('network disabled in tests'); };
  clearMarketDataCache();
  for (const p of list) registerProvider(p);
  try {
    await fn();
  } finally {
    for (const p of list) unregisterProvider(p.id);
    axios.get = originalGet;
    clearMarketDataCache();
  }
}

test('breaker: opens after consecutive failures, half-opens after cooldown, closes on success', () => {
  health.reset();
  const now = 1_000_000;
  for (let i = 0; i < health.FAILURE_THRESHOLD; i += 1) health.recordFailure('x', new Error('boom'), now);
  assert.equal(health.allowRequest('x', now + 1), false, 'open: no upstream call');
  assert.equal(health.snapshot('x', now + 1).circuit, 'open');
  assert.equal(health.allowRequest('x', now + 61_000), true, 'cooldown elapsed: one trial');
  health.recordFailure('x', new Error('still down'), now + 61_000);
  assert.equal(health.allowRequest('x', now + 62_000), false, 'failed trial re-opens');
  assert.ok(new Date(health.snapshot('x', now + 62_000).retryAt).getTime() >= now + 61_000 + 120_000, 'cooldown doubled');
  health.recordSuccess('x', 12, now + 500_000);
  assert.equal(health.snapshot('x').circuit, 'closed');
});

test('429: Retry-After opens the breaker immediately for the given time; not retried', () => {
  health.reset();
  const now = 5_000_000;
  const err = Object.assign(new Error('Too Many Requests'), { response: { status: 429, headers: { 'retry-after': '120' } } });
  assert.equal(health.isTransient(err), false);
  health.recordFailure('q', err, now);
  assert.equal(health.allowRequest('q', now + 119_000), false);
  assert.equal(health.allowRequest('q', now + 120_001), true);
  assert.equal(health.isTransient(Object.assign(new Error('x'), { response: { status: 503 } })), true);
  assert.equal(health.isTransient(Object.assign(new Error('x'), { code: 'ECONNABORTED' })), true);
});

test('failover: a stale quote of a higher-priority provider never hides a live one', async () => {
  const realNow = Date.now;
  let offset = 0;
  const primary = new ScriptedProvider('t-primary', 1, (n) => {
    if (n === 1) return [gold('t-primary', 6400, 6450)];
    throw new Error('primary down');
  });
  const secondary = new ScriptedProvider('t-secondary', 2, () => [gold('t-secondary', 6500, 6550)]);
  try {
    Date.now = () => realNow() + offset;
    await withProviders([primary, secondary], async () => {
      let data = await getMarketData();
      assert.equal(data.preferredQuotes.find((q) => q.symbol === 'HAS_ALTIN').source, 't-primary');
      offset = 6 * 60 * 1000; // cache expired; primary now failing → only stale cached data
      data = await getMarketData();
      const preferred = data.preferredQuotes.find((q) => q.symbol === 'HAS_ALTIN');
      assert.equal(preferred.source, 't-secondary', 'live secondary wins over stale primary');
      assert.equal(preferred.isStale, false);
      assert.ok(data.quotes.some((q) => q.source === 't-primary' && q.isStale), 'stale primary still visible, flagged');
      assert.ok(liveQuoteFrom(data, 'XAU', 'sell'), 'priced from the live provider');
      assert.equal(data.providers.find((p) => p.id === 't-primary').status, 'stale');
    });
  } finally {
    Date.now = realNow;
  }
});

test('malformed responses are rejected without retry; repeated failures open the breaker and stop polling', async () => {
  const malformed = new ScriptedProvider('t-malformed', 1, () => ({ not: 'an array' }));
  const flaky = new ScriptedProvider('t-flaky', 2, () => { throw new Error('ETIMEDOUT'); });
  await withProviders([malformed, flaky], async () => {
    let data = await getMarketData();
    assert.equal(malformed.calls, 1, 'malformed: no retry');
    assert.equal(data.providers.find((p) => p.id === 't-malformed').status, 'unavailable');
    assert.equal(flaky.calls, 2, 'transient: one retry');
    data = await getMarketData(); // 2 more failures → 4 ≥ threshold → open
    const before = flaky.calls;
    data = await getMarketData();
    assert.equal(flaky.calls, before, 'open breaker: provider not called');
    const status = data.providers.find((p) => p.id === 't-flaky');
    assert.match(status.error, /Devre kesici/);
    assert.equal(status.health.circuit, 'open');
    assert.ok(getProviderHealth().some((h) => h.id === 't-flaky' && h.failures >= 3));
  });
});

test('never fabricates: every provider down → no live quote, pricing refuses (manual price required)', async () => {
  const down = new ScriptedProvider('t-down', 1, () => { throw new Error('down'); });
  await withProviders([down], async () => {
    const data = await getMarketData();
    assert.equal(data.preferredQuotes.filter((q) => q.symbol === 'HAS_ALTIN').length, 0);
    assert.equal(liveQuoteFrom(data, 'XAU', 'sell'), null);
    await assert.rejects(
      resolveMetalPrices(['XAU'], 'sell', { quoteSource: async () => data }),
      (e) => e.code === 'MARKET_PRICE_UNAVAILABLE',
    );
    const manual = await resolveMetalPrices(['XAU'], 'sell', { manualPrices: { XAU: '6500.1234' }, quoteSource: async () => data });
    assert.equal(manual.XAU.priceType, 'manual', 'manual prices are explicitly labelled');
  });
});

test('registry rejects duplicates and non-adapters', () => {
  assert.throws(() => registerProvider({ id: 'plain-object' }), /extend MarketDataProvider/);
  const p = new ScriptedProvider('t-dup', 9, () => []);
  registerProvider(p);
  try {
    assert.throws(() => registerProvider(new ScriptedProvider('t-dup', 9, () => [])), /already registered/);
  } finally {
    unregisterProvider('t-dup');
  }
});
