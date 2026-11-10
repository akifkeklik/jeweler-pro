/**
 * Metal price source for financial calculations.
 *
 * A sale or buy-back may only be priced from a LIVE quote: present, not
 * marked stale, inside its provider's freshness window and with a known
 * timestamp. Stale, cached, indicative (theoretical) or missing quotes are
 * never used — the caller gets 409 MARKET_PRICE_UNAVAILABLE and the user can
 * enter an explicit manual price, which is recorded as such in the snapshot.
 *
 * Quote convention: HAS_ALTIN / GUMUS_GRAM are TRY per gram at 1000 milyem.
 * Sales use the dealer's SELL (satış) price, buy-backs the BUY (alış) price.
 */
const { parseDecimal, format } = require('../../domain/decimal');
const { SCALE, LIMITS } = require('../../domain/precision');
const { METALS, assertMetal } = require('../../domain/metals');
const { conflict } = require('./core');

const MAX_QUOTE_AGE_MS = Number(process.env.PRICING_MAX_QUOTE_AGE_MS) || 5 * 60 * 1000;

function defaultQuoteSource() {
  // Lazy: the market data service pulls in HTTP providers.
  const { getMarketData } = require('../marketDataService');
  return getMarketData();
}

/**
 * @param {object} marketData  result of getMarketData()
 * → snapshot or null when no usable live quote exists
 */
function liveQuoteFrom(marketData, metal, side, now = Date.now()) {
  const symbol = METALS[assertMetal(metal)].marketSymbol;
  const quote = (marketData?.preferredQuotes || []).find((q) => q.symbol === symbol);
  if (!quote) return null;
  if (quote.isStale || quote.priceType === 'cached' || quote.priceType === 'indicative' || quote.isCalculated) return null;
  const timestamp = new Date(quote.sourceTimestamp || quote.updatedAt).getTime();
  if (!Number.isFinite(timestamp) || now - timestamp > MAX_QUOTE_AGE_MS || timestamp > now + 60_000) return null;
  const raw = side === 'buy' ? quote.buy : quote.sell;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const pricePerGram = parseDecimal(raw, SCALE.UNIT_PRICE, { field: 'Piyasa fiyatı', round: true, allowZero: false });
  return {
    priceType: 'live',
    symbol,
    source: quote.source,
    side,
    pricePerGram,
    pricePerGramText: format(pricePerGram, SCALE.UNIT_PRICE),
    quotedBuy: String(quote.buy),
    quotedSell: String(quote.sell),
    sourceTimestamp: new Date(timestamp),
    receivedAt: quote.fetchedAt ? new Date(quote.fetchedAt) : new Date(timestamp),
  };
}

/** Explicit price entered by the user (recorded as manual in the snapshot). */
function manualQuote(metal, side, value) {
  assertMetal(metal);
  const pricePerGram = parseDecimal(value, SCALE.UNIT_PRICE, {
    field: 'Manuel gram fiyatı', allowZero: false, max: LIMITS.MAX_UNIT_PRICE,
  });
  return {
    priceType: 'manual',
    symbol: METALS[metal].marketSymbol,
    source: 'manual',
    side,
    pricePerGram,
    pricePerGramText: format(pricePerGram, SCALE.UNIT_PRICE),
    sourceTimestamp: new Date(),
    receivedAt: new Date(),
  };
}

/**
 * Resolves the price for each metal in `metals`:
 * manual prices win when given; otherwise a live quote is required.
 */
async function resolveMetalPrices(metals, side, { manualPrices = {}, quoteSource = defaultQuoteSource } = {}) {
  const prices = {};
  const needLive = [];
  for (const metal of new Set(metals)) {
    const manual = manualPrices?.[metal];
    if (manual !== undefined && manual !== null && manual !== '') prices[metal] = manualQuote(metal, side, manual);
    else needLive.push(metal);
  }
  if (needLive.length) {
    let data = null;
    try {
      data = await quoteSource();
    } catch {
      data = null;
    }
    for (const metal of needLive) {
      const live = liveQuoteFrom(data, metal, side);
      if (!live) {
        throw conflict(
          `${METALS[metal].name} için güncel canlı fiyat alınamadı. Bayat veya hesaplanmış fiyatla işlem yapılmaz; manuel gram fiyatı girin.`,
          'MARKET_PRICE_UNAVAILABLE',
          { metal },
        );
      }
      prices[metal] = live;
    }
  }
  return prices;
}

/** Live quotes only (no throwing) — for valuations / dashboards. */
async function liveMetalPrices(side, { quoteSource = defaultQuoteSource } = {}) {
  let data = null;
  try {
    data = await quoteSource();
  } catch {
    return {};
  }
  const out = {};
  for (const metal of Object.keys(METALS)) {
    const q = liveQuoteFrom(data, metal, side);
    if (q) out[metal] = q;
  }
  return out;
}

function snapshotOf(quote) {
  return {
    priceType: quote.priceType,
    symbol: quote.symbol,
    source: quote.source,
    side: quote.side,
    pricePerGram: quote.pricePerGramText,
    quotedBuy: quote.quotedBuy,
    quotedSell: quote.quotedSell,
    sourceTimestamp: quote.sourceTimestamp,
    receivedAt: quote.receivedAt,
  };
}

module.exports = { MAX_QUOTE_AGE_MS, liveQuoteFrom, manualQuote, resolveMetalPrices, liveMetalPrices, snapshotOf };
