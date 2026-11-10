const axios = require('axios');
const MarketDataProvider = require('./marketDataProvider');

/**
 * Optional licensed provider adapter. The provider must document its JSON
 * contract as { quotes: [{ symbol, asset, buy, sell, updatedAt }] }.
 */
class ConfiguredHttpProvider extends MarketDataProvider {
  constructor({ id, name, envUrl, envKey, termsUrl, priority = 5 }) {
    const url = process.env[envUrl];
    super({
      id,
      name,
      termsUrl,
      configured: Boolean(url),
      priority,
      maxAgeMs: 5 * 60 * 1000,
      requiresAuth: true,
    });
    this.url = url;
    this.key = process.env[envKey];
  }

  async fetchQuotes() {
    if (!this.configured) return [];
    const response = await axios.get(this.url, {
      timeout: 8000,
      headers: this.key ? { Authorization: `Bearer ${this.key}` } : undefined,
    });
    if (!Array.isArray(response.data?.quotes)) return [];

    return response.data.quotes.map((quote) => {
      const buy = Number(quote.buy);
      const sell = Number(quote.sell);
      return {
        symbol: String(quote.symbol),
        type: String(quote.type || quote.name || quote.symbol),
        asset: String(quote.asset || 'unknown'),
        buy,
        sell,
        last: Number(quote.last || ((buy + sell) / 2)),
        spread: Number(Math.abs(sell - buy)),
        currency: quote.currency || 'TRY',
        source: this.id,
        priceType: 'live',
        sourceTimestamp: quote.updatedAt,
        updatedAt: quote.updatedAt,
      };
    }).filter((quote) => (
      quote.symbol &&
      quote.buy > 0 &&
      quote.sell > 0 &&
      quote.sell >= quote.buy &&
      Number.isFinite(new Date(quote.updatedAt).getTime()) &&
      new Date(quote.updatedAt).getTime() <= Date.now() + 5 * 60 * 1000
    ));
  }
}

module.exports = ConfiguredHttpProvider;
