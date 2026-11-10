const axios = require('axios');
const MarketDataProvider = require('./marketDataProvider');

/**
 * Extensible Borsa Istanbul (BIST) Provider Adapter.
 * Supports equity indices (XU100) and Darphane Gold Certificates (ALTIN.S1).
 */
class BistProvider extends MarketDataProvider {
  constructor() {
    const url = process.env.BIST_API_URL;
    const key = process.env.BIST_API_KEY;
    super({
      id: 'bist',
      name: 'Borsa İstanbul (BIST)',
      termsUrl: 'https://www.borsaistanbul.com/',
      configured: Boolean(url),
      priority: 40,
      maxAgeMs: 5 * 60 * 1000,
      requiresAuth: true,
    });
    this.url = url;
    this.key = key;
  }

  async fetchQuotes() {
    if (!this.configured) return [];

    try {
      const response = await axios.get(this.url, {
        timeout: 5000,
        headers: this.key ? { Authorization: `Bearer ${this.key}` } : undefined,
      });

      if (!Array.isArray(response.data?.quotes)) return [];

      return response.data.quotes.map((q) => {
        const buy = Number(q.buy);
        const sell = Number(q.sell);
        return {
          symbol: String(q.symbol),
          type: String(q.type || q.name || q.symbol),
          asset: 'bist',
          buy,
          sell,
          last: Number(q.last || ((buy + sell) / 2)),
          spread: Number(Math.abs(sell - buy)),
          currency: q.currency || 'TRY',
          source: this.id,
          priceType: 'live',
          sourceTimestamp: q.updatedAt || new Date().toISOString(),
          updatedAt: q.updatedAt || new Date().toISOString(),
        };
      }).filter((q) => q.symbol && q.buy > 0 && q.sell > 0 && q.sell >= q.buy);
    } catch (err) {
      return [];
    }
  }
}

module.exports = BistProvider;

