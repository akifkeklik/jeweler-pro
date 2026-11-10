const mongoose = require('mongoose');
const { getMarketData } = require('./marketDataService');
const Price = require('../models/Price');

class MarketDataWorker {
  constructor() {
    this.intervalMs = Number(process.env.MARKET_DATA_INTERVAL_MS) || 30000;
    this.timer = null;
    this.running = false;
    this.isPolling = false;
    this.lastPollTime = null;
    this.lastSuccessTime = null;
    this.consecutiveFailures = 0;
    this.latestData = null;
    this.lastPersistedPrices = new Map(); // symbol -> { buy, sell, time }
  }

  start() {
    if (this.running) {
      return this;
    }
    this.running = true;
    this.poll(); // Run first cycle immediately
    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        console.error('MarketDataWorker error during poll:', err.message);
      });
    }, this.intervalMs);

    if (this.timer.unref) {
      this.timer.unref();
    }
    return this;
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this;
  }

  async poll() {
    if (this.isPolling) {
      return this.latestData;
    }
    this.isPolling = true;
    this.lastPollTime = new Date().toISOString();

    try {
      const data = await getMarketData();
      this.latestData = data;
      this.lastSuccessTime = new Date().toISOString();
      this.consecutiveFailures = 0;

      // Persist latest valid quotes to MongoDB if connected
      await this.persistQuotesToDatabase(data.preferredQuotes);

      return data;
    } catch (err) {
      this.consecutiveFailures += 1;
      console.error(`[MarketDataWorker] Poll error (${this.consecutiveFailures}):`, err.message);
      return this.latestData;
    } finally {
      this.isPolling = false;
    }
  }

  async persistQuotesToDatabase(preferredQuotes) {
    if (!Array.isArray(preferredQuotes) || preferredQuotes.length === 0) {
      return;
    }
    // Check if MongoDB is connected (readyState === 1)
    if (mongoose.connection.readyState !== 1) {
      return;
    }

    const now = new Date();
    const recordsToInsert = [];

    for (const quote of preferredQuotes) {
      if (!quote.symbol || !Number.isFinite(quote.buy) || !Number.isFinite(quote.sell)) {
        continue;
      }

      const lastKnown = this.lastPersistedPrices.get(quote.symbol);
      const isPriceChanged =
        !lastKnown ||
        lastKnown.buy !== quote.buy ||
        lastKnown.sell !== quote.sell;
      const isTimeElapsed =
        lastKnown && now.getTime() - lastKnown.time >= 5 * 60 * 1000; // at least once every 5 minutes

      if (isPriceChanged || isTimeElapsed) {
        recordsToInsert.push({
          symbol: quote.symbol,
          type: quote.type || quote.symbol,
          buy: quote.buy,
          sell: quote.sell,
          last: quote.last || Number(((quote.buy + quote.sell) / 2).toFixed(2)),
          spread: quote.spread || Number(Math.abs(quote.sell - quote.buy).toFixed(2)),
          currency: quote.currency || 'TRY',
          source: quote.source,
          priceType: quote.priceType || (quote.isStale ? 'cached' : 'live'),
          isStale: Boolean(quote.isStale),
          sourceTimestamp: quote.sourceTimestamp ? new Date(quote.sourceTimestamp) : now,
          fetchedAt: now,
          changeRate: quote.changeRate || 0,
          createdAt: now,
        });

        this.lastPersistedPrices.set(quote.symbol, {
          buy: quote.buy,
          sell: quote.sell,
          time: now.getTime(),
        });
      }
    }

    if (recordsToInsert.length > 0) {
      try {
        await Price.insertMany(recordsToInsert, { ordered: false });
      } catch (dbErr) {
        console.error('[MarketDataWorker] DB persist warning:', dbErr.message);
      }
    }
  }

  getStatus() {
    return {
      running: this.running,
      isPolling: this.isPolling,
      intervalMs: this.intervalMs,
      lastPollTime: this.lastPollTime,
      lastSuccessTime: this.lastSuccessTime,
      consecutiveFailures: this.consecutiveFailures,
      quotesCount: this.latestData?.preferredQuotes?.length || 0,
      providers: this.latestData?.providers || [],
    };
  }
}

// Singleton instance
const workerInstance = new MarketDataWorker();

module.exports = workerInstance;
module.exports.MarketDataWorker = MarketDataWorker;

