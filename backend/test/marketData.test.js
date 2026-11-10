const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { clearMarketDataCache, getMarketData } = require('../services/marketDataService');

function tcmbDate() {
  const now = new Date();
  return {
    xml: `${String(now.getUTCDate()).padStart(2, '0')}.${String(now.getUTCMonth() + 1).padStart(2, '0')}.${now.getUTCFullYear()}`,
    iso: `${now.toISOString().slice(0, 10)}T00:00:00.000Z`,
  };
}

test('market data normalizes TCMB quotes and keeps provider metadata', async () => {
  const originalGet = axios.get;
  const date = tcmbDate();
  axios.get = async () => ({
    data: `<Tarih_Date Tarih="${date.xml}"><Currency Kod="USD"><ForexBuying>34.1</ForexBuying><ForexSelling>34.2</ForexSelling></Currency></Tarih_Date>`,
  });

  try {
    clearMarketDataCache();
    const data = await getMarketData();
    const usd = data.quotes.find((quote) => quote.symbol === 'USD/TL');
    const tcmb = data.providers.find((provider) => provider.id === 'tcmb');

    assert.deepEqual({ buy: usd.buy, sell: usd.sell, source: usd.source }, {
      buy: 34.1,
      sell: 34.2,
      source: 'tcmb',
    });
    assert.equal(tcmb.status, 'ok');
    assert.equal(tcmb.quoteCount, 1);
    assert.equal(data.providers.find((provider) => provider.id === 'hasfiyat').status, 'unavailable');
    assert.deepEqual(data.preferredQuotes, [usd]);
  } finally {
    axios.get = originalGet;
    clearMarketDataCache();
  }
});

test('market data does not expose stale provider quotes as current', async () => {
  const originalGet = axios.get;
  const date = tcmbDate();
  axios.get = async () => ({
    data: `<Tarih_Date Tarih="${date.xml}"><Currency Kod="USD"><ForexBuying>34.1</ForexBuying><ForexSelling>34.2</ForexSelling></Currency></Tarih_Date>`,
  });

  try {
    clearMarketDataCache();
    const data = await getMarketData();
    assert.ok(data.quotes.every((quote) => quote.updatedAt === date.iso));
  } finally {
    axios.get = originalGet;
    clearMarketDataCache();
  }
});
