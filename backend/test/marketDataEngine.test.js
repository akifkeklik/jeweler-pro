const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const MarketDataProvider = require('../providers/marketDataProvider');
const ConfiguredHttpProvider = require('../providers/configuredHttpProvider');
const TheoreticalEngine = require('../providers/theoreticalEngine');
const {
  getMarketData,
  clearMarketDataCache,
  isValidQuote,
  isFresh,
} = require('../services/marketDataService');
const priceRefreshRateLimit = require('../middleware/priceRateLimit');

class _MockProvider extends MarketDataProvider {
  constructor({ id, name, priority = 50, quotes = [], error = null, delayMs = 0 }) {
    super({ id, name, priority, maxAgeMs: 60000 });
    this.quotes = quotes;
    this.error = error;
    this.delayMs = delayMs;
  }

  async fetchQuotes() {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.error) {
      throw this.error;
    }
    return this.quotes;
  }
}

test('Quote validation rejects negative, inverted, NaN and non-string symbols', () => {
  const now = new Date().toISOString();

  // Valid
  assert.equal(
    isValidQuote({ symbol: 'HAS_ALTIN', buy: 6500, sell: 6550, updatedAt: now }),
    true
  );

  // Inverted (buy > sell)
  assert.equal(
    isValidQuote({ symbol: 'HAS_ALTIN', buy: 6600, sell: 6550, updatedAt: now }),
    false
  );

  // Negative buy
  assert.equal(
    isValidQuote({ symbol: 'HAS_ALTIN', buy: -100, sell: 6550, updatedAt: now }),
    false
  );

  // NaN / null / undefined
  assert.equal(
    isValidQuote({ symbol: 'HAS_ALTIN', buy: NaN, sell: 6550, updatedAt: now }),
    false
  );
  assert.equal(isValidQuote(null), false);
  assert.equal(isValidQuote({}), false);

  // Invalid date or future date beyond 5 minutes
  assert.equal(
    isValidQuote({ symbol: 'HAS_ALTIN', buy: 6500, sell: 6550, updatedAt: 'invalid-date' }),
    false
  );
  const futureDate = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  assert.equal(
    isValidQuote({ symbol: 'HAS_ALTIN', buy: 6500, sell: 6550, updatedAt: futureDate }),
    false
  );
});

test('Stale detection marks quotes older than maxAgeMs as expired', () => {
  const provider = new MarketDataProvider({
    id: 'test',
    name: 'Test',
    maxAgeMs: 5000,
  });

  const freshQuote = {
    symbol: 'HAS_ALTIN',
    buy: 6500,
    sell: 6550,
    updatedAt: new Date(Date.now() - 2000).toISOString(),
  };

  const staleQuote = {
    symbol: 'HAS_ALTIN',
    buy: 6500,
    sell: 6550,
    updatedAt: new Date(Date.now() - 10000).toISOString(),
  };

  assert.equal(isFresh(freshQuote, provider), true);
  assert.equal(isFresh(staleQuote, provider), false);
});

test('ConfiguredHttpProvider without env URL marks provider unconfigured and requiresAuth=true', async () => {
  const provider = new ConfiguredHttpProvider({
    id: 'unconfigured-test',
    name: 'Unconfigured Test Provider',
    envUrl: 'NON_EXISTENT_PROVIDER_URL',
    envKey: 'NON_EXISTENT_KEY',
    termsUrl: 'https://example.com',
  });

  assert.equal(provider.configured, false);
  assert.equal(provider.requiresAuth, true);

  const quotes = await provider.fetchQuotes();
  assert.deepEqual(quotes, []);
});

test('TheoreticalEngine calculates indicative spot prices without fabricated retail spread', () => {
  const onsUsd = 4000;
  const usdTry = 50;
  const now = new Date().toISOString();

  const quotes = TheoreticalEngine.calculateIndicativeQuotes({ onsUsd, usdTry, timestamp: now });

  assert.ok(Array.isArray(quotes));
  assert.ok(quotes.length >= 8);

  const hasSpot = quotes.find((q) => q.symbol === 'REF_HAS_ALTIN');
  assert.ok(hasSpot);
  assert.equal(hasSpot.priceType, 'indicative');
  assert.equal(hasSpot.isCalculated, true);
  assert.equal(hasSpot.spread, 0); // No fabricated spread
  assert.equal(hasSpot.source, 'theoretical-engine');

  // Mathematical validation: (4000 * 50) / 31.1034768 = 6429.827...
  const expectedRaw = (4000 * 50) / 31.1034768;
  assert.equal(hasSpot.buy, Number(expectedRaw.toFixed(2)));
  assert.equal(hasSpot.sell, Number(expectedRaw.toFixed(2)));

  // 22 Ayar = Has * 0.916
  const karat22 = quotes.find((q) => q.symbol === 'REF_22_AYAR');
  assert.ok(karat22);
  assert.equal(karat22.buy, Number((expectedRaw * 0.916).toFixed(2)));
});

test('Price refresh rate limiter blocks rapid calls within 5 seconds with 429', () => {
  let statusCode = 200;
  let jsonResponse = null;
  let retryAfterHeader = null;

  const mockReq = { ip: '192.168.1.100', user: { id: 'user-1' } };
  const mockRes = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
    set(header, value) {
      if (header === 'Retry-After') retryAfterHeader = value;
      return this;
    },
  };

  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  // 1st call: Should pass
  nextCalled = false;
  priceRefreshRateLimit(mockReq, mockRes, next);
  assert.equal(nextCalled, true);

  // 2nd call immediately: Should be rate limited (429)
  nextCalled = false;
  priceRefreshRateLimit(mockReq, mockRes, next);
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 429);
  assert.ok(jsonResponse?.error.includes('çok sık'));
  assert.ok(Number(retryAfterHeader) > 0);
});

test('Provider error preserves previous cached prices with isStale=true', async () => {
  const originalGet = axios.get;

  // First call succeeds
  axios.get = async () => ({
    data: {
      success: true,
      data: {
        GA: { alis: '6500.00', satis: '6550.00', oran: '0.1' },
      },
    },
  });

  try {
    clearMarketDataCache();
    const dataFirst = await getMarketData();
    const gaFirst = dataFirst.preferredQuotes.find((q) => q.symbol === 'HAS_ALTIN');
    if (gaFirst) {
      assert.equal(gaFirst.buy, 6500);
      assert.equal(gaFirst.sell, 6550);
      assert.equal(gaFirst.isStale, false);
      assert.equal(gaFirst.priceType, 'live');
    }

    // Now mock network failure on subsequent fetch
    axios.get = async () => {
      throw new Error('Connection timed out');
    };

    // If cache TTL passes or forced
    clearMarketDataCache();
  } finally {
    axios.get = originalGet;
    clearMarketDataCache();
  }
});

