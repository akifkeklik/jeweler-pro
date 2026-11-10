const axios = require('axios');
const xml2js = require('xml2js');
const MarketDataProvider = require('./marketDataProvider');

const CODES = ['USD', 'EUR', 'GBP', 'AUD', 'CHF', 'CAD', 'SAR', 'JPY'];

class TcmbProvider extends MarketDataProvider {
  constructor() {
    super({
      id: 'tcmb',
      name: 'Türkiye Cumhuriyet Merkez Bankası',
      termsUrl: 'https://www.tcmb.gov.tr/kurlar/today.xml',
      priority: 20,
      maxAgeMs: 36 * 60 * 60 * 1000,
      requiresAuth: false,
    });
  }

  async fetchQuotes() {
    try {
      const timeout = Number(process.env.TCMB_TIMEOUT_MS) || 8000;
      const response = await axios.get('https://www.tcmb.gov.tr/kurlar/today.xml', {
        timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });
      const data = await xml2js.parseStringPromise(response.data);
      const currencies = data.Tarih_Date?.Currency || [];
      const dateText = data.Tarih_Date?.$?.Tarih;
      const publishedAt = dateText
        ? new Date(`${dateText.split('.').reverse().join('-')}T00:00:00.000Z`).toISOString()
        : null;

      if (!publishedAt) return [];

      return CODES.map((code) => {
        const currency = currencies.find((item) => item.$?.Kod === code);
        const buy = Number.parseFloat(currency?.ForexBuying?.[0] ?? '');
        const sell = Number.parseFloat(currency?.ForexSelling?.[0] ?? '');
        if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy <= 0 || sell <= 0) return null;

        return {
          symbol: `${code}/TL`,
          type: `${code} (TCMB)`,
          asset: 'currency',
          currency: 'TRY',
          buy,
          sell,
          last: Number(((buy + sell) / 2).toFixed(4)),
          spread: Number(Math.abs(sell - buy).toFixed(4)),
          source: this.id,
          priceType: 'live',
          sourceTimestamp: publishedAt,
          updatedAt: publishedAt,
        };
      }).filter(Boolean);
    } catch (err) {
      // Return empty array gracefully without crashing
      return [];
    }
  }
}

module.exports = TcmbProvider;
