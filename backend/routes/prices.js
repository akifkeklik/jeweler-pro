const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const Price = require('../models/Price');
const { requirePermission } = require('../middleware/authorization');
const TcmbProvider = require('../providers/tcmbProvider');
const priceRefreshRateLimit = require('../middleware/priceRateLimit');
const { getMarketData, expireRefreshableCache, getProviderHealth } = require('../services/marketDataService');
const { MAX_QUOTE_AGE_MS } = require('../services/finance/metalPricing');
const marketDataWorker = require('../services/marketDataWorker');

/**
 * Backward-compatible TCMB response used by existing consumers and tests.
 */
async function getTcmbCurrencies() {
  try {
    const quotes = await new TcmbProvider().fetchQuotes();
    return quotes.map((quote) => ({
      currency: quote.symbol,
      buyPrice: quote.buy.toFixed(4),
      sellPrice: quote.sell.toFixed(4),
    }));
  } catch (err) {
    console.error('⚠️ TCMB verisi alınamadı:', err.message);
    return [];
  }
}

function freshnessOf(quote) {
  if (quote.isCalculated || quote.priceType === 'indicative') return 'indicative';
  if (quote.isStale || quote.priceType === 'cached') return 'delayed';
  const ts = new Date(quote.sourceTimestamp || quote.updatedAt).getTime();
  if (!Number.isFinite(ts) || Date.now() - ts > MAX_QUOTE_AGE_MS) return 'delayed';
  return 'live';
}

/**
 * Normalizes quote object with both bid/ask and buy/sell fields for API clients.
 */
function enrichQuote(quote) {
  const buy = Number(quote.buy);
  const sell = Number(quote.sell);
  const spread = quote.spread !== undefined ? quote.spread : Number(Math.abs(sell - buy).toFixed(4));
  const isStale = Boolean(quote.isStale);

  return {
    symbol: quote.symbol,
    type: quote.type || quote.symbol,
    asset: quote.asset || 'unknown',
    buy,
    sell,
    bid: buy,
    ask: sell,
    last: quote.last !== undefined ? Number(quote.last) : Number(((buy + sell) / 2).toFixed(4)),
    spread,
    currency: quote.currency || 'TRY',
    source: quote.source,
    // Never invent a timestamp: unknown stays null.
    sourceTimestamp: quote.sourceTimestamp || quote.updatedAt || null,
    fetchedAt: quote.fetchedAt || new Date().toISOString(),
    status: isStale ? 'stale' : 'live',
    // live: usable for pricing (fresh, real quote); delayed: display only;
    // indicative: theoretical reference, never used for transactions.
    freshness: freshnessOf(quote),
    isStale,
    priceType: quote.priceType || (isStale ? 'cached' : 'live'),
    isCalculated: Boolean(quote.isCalculated),
    changeRate: quote.changeRate || 0,
    formula: quote.formula || null,
  };
}

/**
 * GET /api/prices
 * Main market data endpoint (Currencies, Physical precious metals, Shop DB prices, Theoretical references)
 */
router.get('/', requirePermission('prices:read'), asyncHandler(async (req, res) => {
  const marketData = await getMarketData();

  // TCMB specific currencies for backward compatibility
  let tcmbPrices = (marketData.quotes || [])
    .filter((quote) => quote.source === 'tcmb')
    .map((quote) => ({
      currency: quote.symbol,
      buyPrice: quote.buy.toFixed(4),
      sellPrice: quote.sell.toFixed(4),
    }));

  // Fallback to active free market currencies if TCMB is temporarily down
  if (tcmbPrices.length === 0) {
    tcmbPrices = (marketData.preferredQuotes || [])
      .filter((quote) => quote.asset === 'currency')
      .map((quote) => ({
        currency: quote.symbol.replace('/TRY', '/TL'),
        buyPrice: quote.buy.toFixed(4),
        sellPrice: quote.sell.toFixed(4),
      }));
  }

  // Retrieve latest distinct prices from MongoDB
  let dbPrices = [];
  try {
    dbPrices = await Price.find().sort({ createdAt: -1 }).limit(50);
  } catch (err) {
    dbPrices = [];
  }

  // Format market data quotes with rich metadata
  const enrichedMarketData = {
    updatedAt: marketData.updatedAt,
    providers: marketData.providers,
    quotes: (marketData.quotes || []).map(enrichQuote),
    preferredQuotes: (marketData.preferredQuotes || []).map(enrichQuote),
    indicativeQuotes: (marketData.indicativeQuotes || []).map(enrichQuote),
    isStale: marketData.preferredQuotes.some((q) => q.isStale),
  };

  res.json({
    timestamp: marketData.updatedAt,
    currencies: tcmbPrices,
    prices: dbPrices,
    marketData: enrichedMarketData,
  });
}));

/**
 * GET /api/prices/tcmb
 * TCMB currencies only (backward compatibility)
 */
router.get('/tcmb', requirePermission('prices:read'), asyncHandler(async (req, res) => {
  const tcmbPrices = await getTcmbCurrencies();
  res.json(tcmbPrices);
}));

/**
 * GET /api/prices/database
 * Database stored prices only
 */
router.get('/database', requirePermission('prices:read'), asyncHandler(async (req, res) => {
  const dbPrices = await Price.find().sort({ createdAt: -1 }).limit(100);
  res.json(dbPrices);
}));

/**
 * POST /api/prices/refresh
 * Force cache invalidation and immediate market re-fetch.
 * Protected with permissions and client rate limiting (1 request per 5 seconds).
 */
router.post('/refresh', requirePermission('prices:read'), priceRefreshRateLimit, asyncHandler(async (req, res) => {
  // Respects provider quotas (a rate-limited API is not re-fetched early).
  expireRefreshableCache();
  const refreshedData = await marketDataWorker.poll();

  const preferredQuotes = (refreshedData?.preferredQuotes || []).map(enrichQuote);
  const indicativeQuotes = (refreshedData?.indicativeQuotes || []).map(enrichQuote);

  res.json({
    success: true,
    timestamp: refreshedData?.updatedAt || new Date().toISOString(),
    preferredQuotes,
    indicativeQuotes,
    providers: refreshedData?.providers || [],
  });
}));

/**
 * GET /api/prices/history
 * Historical quotes query from MongoDB Price collection
 */
router.get('/history', requirePermission('prices:read'), asyncHandler(async (req, res) => {
  const { symbol, limit = 50 } = req.query;
  const filter = {};
  if (symbol && typeof symbol === 'string') {
    filter.symbol = symbol.toUpperCase().trim();
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const history = await Price.find(filter)
    .sort({ createdAt: -1 })
    .limit(safeLimit);

  res.json({
    count: history.length,
    symbol: filter.symbol || 'ALL',
    history,
  });
}));

/**
 * GET /api/prices/status
 * Provider health and background worker metrics
 */
router.get('/status', requirePermission('prices:read'), asyncHandler(async (req, res) => {
  const status = marketDataWorker.getStatus();
  res.json({ ...status, pricingMaxQuoteAgeMs: MAX_QUOTE_AGE_MS, providerHealth: getProviderHealth() });
}));

module.exports = router;
module.exports.getTcmbCurrencies = getTcmbCurrencies;
