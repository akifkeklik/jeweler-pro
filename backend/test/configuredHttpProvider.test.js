const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const ConfiguredHttpProvider = require('../providers/configuredHttpProvider');

test('configured provider sends its server-side key and rejects invalid quotes', async () => {
  const originalGet = axios.get;
  let requestConfig;
  axios.get = async (_url, config) => {
    requestConfig = config;
    return {
      data: {
        quotes: [
          { symbol: 'XAU_TRY', asset: 'gold', buy: 100, sell: 101, updatedAt: new Date().toISOString() },
          { symbol: 'BAD', asset: 'gold', buy: -1, sell: 2, updatedAt: new Date().toISOString() },
          { symbol: 'INVERTED', asset: 'gold', buy: 102, sell: 101, updatedAt: new Date().toISOString() },
        ],
      },
    };
  };

  try {
    process.env.TEST_MARKET_URL = 'https://provider.test/quotes';
    process.env.TEST_MARKET_KEY = 'server-only-key';
    const provider = new ConfiguredHttpProvider({
      id: 'test-provider',
      name: 'Test provider',
      envUrl: 'TEST_MARKET_URL',
      envKey: 'TEST_MARKET_KEY',
      termsUrl: 'https://provider.test/terms',
    });

    const quotes = await provider.fetchQuotes();

    assert.equal(requestConfig.headers.Authorization, 'Bearer server-only-key');
    assert.deepEqual(quotes.map((quote) => quote.symbol), ['XAU_TRY']);
  } finally {
    axios.get = originalGet;
    delete process.env.TEST_MARKET_URL;
    delete process.env.TEST_MARKET_KEY;
  }
});
