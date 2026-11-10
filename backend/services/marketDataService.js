const providers = require('../providers');
const MarketDataProvider = require('../providers/marketDataProvider');
const TheoreticalEngine = require('../providers/theoreticalEngine');
const health = require('../providers/providerHealth');

const cache = new Map();
const inFlight = new Map();
const CACHE_TTL_MS = Number(process.env.MARKET_DATA_CACHE_TTL_MS) || 30000;
const RETRY_BASE_MS = Number(process.env.MARKET_DATA_RETRY_BASE_MS ?? 250);
const MAX_ATTEMPTS = 2;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/* ---------------------------------------------------- provider registry */

/**
 * Adds a provider adapter at run time (e.g. a licensed feed). Business
 * logic never references a concrete provider: it consumes the normalised,
 * freshness-checked `preferredQuotes`.
 */
function registerProvider(provider) {
  if (!(provider instanceof MarketDataProvider)) throw new Error('Provider must extend MarketDataProvider');
  if (providers.some((p) => p.id === provider.id)) throw new Error(`Provider already registered: ${provider.id}`);
  providers.push(provider);
  return provider;
}

function unregisterProvider(id) {
  const index = providers.findIndex((p) => p.id === id);
  if (index === -1) return false;
  providers.splice(index, 1);
  cache.delete(id);
  return true;
}

const listProviders = () => providers.map((p) => p.metadata());

/* ------------------------------------------------------------ freshness */

const quoteTime = (quote) => new Date(quote.sourceTimestamp || quote.updatedAt).getTime();

function isFresh(quote, provider) {
  const ts = quoteTime(quote);
  return Number.isFinite(ts) && (Date.now() - ts <= provider.maxAgeMs);
}

function isValidQuote(quote) {
  return Boolean(
    quote &&
    typeof quote.symbol === 'string' &&
    quote.symbol.length > 0 &&
    Number.isFinite(quote.buy) &&
    Number.isFinite(quote.sell) &&
    quote.buy > 0 &&
    quote.sell > 0 &&
    quote.sell >= quote.buy &&
    Number.isFinite(new Date(quote.updatedAt).getTime()) &&
    new Date(quote.updatedAt).getTime() <= Date.now() + 5 * 60 * 1000
  );
}

function hasFreshQuote(result, provider) {
  return (result.quotes || []).some((quote) => isFresh(quote, provider));
}

function cacheTtlFor(provider) {
  return Math.max(CACHE_TTL_MS, provider.minFetchIntervalMs || 0);
}

async function fetchProvider(provider) {
  const cached = cache.get(provider.id);
  if (cached && Date.now() - cached.cachedAt <= cacheTtlFor(provider)) {
    return {
      ...cached,
      stale: !hasFreshQuote(cached, provider),
    };
  }

  if (inFlight.has(provider.id)) {
    return inFlight.get(provider.id);
  }

  const request = (async () => {
    if (!provider.configured) {
      return {
        quotes: [],
        cachedAt: Date.now(),
        stale: false,
        error: 'Provider yapılandırılmamış',
      };
    }

    if (!health.allowRequest(provider.id)) {
      const h = health.snapshot(provider.id);
      const reason = `Devre kesici açık (art arda hata / istek sınırı); ${h.retryAt} sonrası yeniden denenecek`;
      if (cached?.quotes?.length) {
        return {
          quotes: cached.quotes.map((q) => ({ ...q, isStale: true, priceType: 'cached' })), cachedAt: cached.cachedAt, stale: true, error: reason,
        };
      }
      return { quotes: [], cachedAt: Date.now(), stale: false, error: reason };
    }

    let lastError;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const started = Date.now();
      try {
        const rawQuotes = await provider.fetchQuotes();
        if (rawQuotes !== undefined && rawQuotes !== null && !Array.isArray(rawQuotes)) {
          const malformed = new Error('Sağlayıcı yanıtı beklenen biçimde değil');
          malformed.code = 'MALFORMED_RESPONSE';
          throw malformed;
        }
        health.recordSuccess(provider.id, Date.now() - started);
        const quotes = (rawQuotes || [])
          .filter((quote) => isValidQuote(quote) && isFresh(quote, provider))
          .map((quote) => ({
            ...quote,
            isStale: false,
            priceType: quote.priceType || 'live',
            fetchedAt: new Date().toISOString(),
          }));

        const result = { quotes, cachedAt: Date.now(), stale: false };
        if (quotes.length > 0) {
          cache.set(provider.id, result);
        } else {
          // Reachable but nothing current (e.g. TCMB on a weekend): not "ok".
          result.error = 'Sağlayıcıdan güncel (taze) kotasyon alınamadı';
        }
        return result;
      } catch (error) {
        lastError = error;
        health.recordFailure(provider.id, error);
        if (!health.isTransient(error) || !health.allowRequest(provider.id)) break;
        if (attempt + 1 < MAX_ATTEMPTS && RETRY_BASE_MS > 0) {
          // Exponential backoff with jitter before the retry.
          await sleep(RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * RETRY_BASE_MS));
        }
      }
    }

    // Provider failed after retries
    if (cached?.quotes?.length) {
      const staleQuotes = cached.quotes.map((q) => ({
        ...q,
        isStale: true,
        priceType: 'cached',
      }));
      return {
        quotes: staleQuotes,
        cachedAt: cached.cachedAt,
        stale: true,
        error: 'Provider erişilemiyor; önbellekteki veri gösteriliyor',
      };
    }

    return {
      quotes: [],
      cachedAt: Date.now(),
      stale: false,
      error: lastError?.message || 'Provider erişilemiyor',
    };
  })();

  inFlight.set(provider.id, request);
  try {
    return await request;
  } finally {
    inFlight.delete(provider.id);
  }
}

async function getMarketData() {
  const results = await Promise.all(
    providers.map(async (provider) => {
      const fetchResult = await fetchProvider(provider);
      return {
        provider: provider.metadata(),
        ...fetchResult,
      };
    })
  );

  const allQuotes = results.flatMap(({ quotes }) => quotes || []);

  // Preferred quote per symbol: a LIVE quote always beats a stale/cached
  // one (automatic failover to the next provider), then provider priority.
  const preferredBySymbol = new Map();
  for (const result of results) {
    for (const quote of result.quotes || []) {
      const current = preferredBySymbol.get(quote.symbol);
      const better = !current
        || (current.isStale && !quote.isStale)
        || (Boolean(current.isStale) === Boolean(quote.isStale) && result.provider.priority < current.priority);
      if (better) {
        preferredBySymbol.set(quote.symbol, {
          ...quote,
          priority: result.provider.priority,
          sourceName: result.provider.name,
        });
      }
    }
  }

  const preferredQuotes = [...preferredBySymbol.values()].map(({ priority: _priority, sourceName: _sourceName, ...quote }) => quote);

  // Derive theoretical reference prices if ONS and USD/TRY are available
  let onsQuote = preferredQuotes.find((q) => q.symbol === 'ONS_USD' || q.symbol === 'XAUUSD');
  let usdQuote = preferredQuotes.find((q) => q.symbol === 'USD/TRY' || q.symbol === 'USD/TL');

  // Theoretical references only from LIVE inputs, stamped with the OLDER of
  // the two input timestamps — never with "now", never from stale data.
  let indicativeQuotes = [];
  if (onsQuote && usdQuote && !onsQuote.isStale && !usdQuote.isStale) {
    const onsUsd = onsQuote.sell || onsQuote.buy;
    const usdTry = usdQuote.sell || usdQuote.buy;
    const inputTimes = [onsQuote, usdQuote]
      .map((q) => new Date(q.sourceTimestamp || q.updatedAt).getTime())
      .filter(Number.isFinite);
    if (inputTimes.length === 2) {
      indicativeQuotes = TheoreticalEngine.calculateIndicativeQuotes({
        onsUsd,
        usdTry,
        timestamp: new Date(Math.min(...inputTimes)).toISOString(),
      });
    }
  }

  const nowIso = new Date().toISOString();

  return {
    updatedAt: nowIso,
    providers: results.map(({ provider, quotes, error, stale, cachedAt }) => ({
      ...provider,
      health: health.snapshot(provider.id),
      updatedAt: quotes?.[0]?.updatedAt || null,
      quoteCount: quotes?.length || 0,
      cachedAt: cachedAt || null,
      status: error ? (quotes?.length ? 'stale' : 'unavailable') : (stale ? 'stale' : 'ok'),
      error: error || null,
    })),
    quotes: allQuotes,
    preferredQuotes,
    indicativeQuotes,
  };
}

function clearMarketDataCache() {
  cache.clear();
  inFlight.clear();
  health.reset();
}

/** Health / circuit state of every registered provider (no secrets). */
function getProviderHealth() {
  return providers.map((p) => ({ id: p.id, name: p.name, configured: p.configured, priority: p.priority, ...health.snapshot(p.id) }));
}

/**
 * User-requested refresh: expires cached results, except for providers
 * whose minimum fetch interval has not elapsed (quota protection). Those
 * keep serving their cached — still fresh — quotes.
 */
function expireRefreshableCache(now = Date.now()) {
  for (const provider of providers) {
    const cached = cache.get(provider.id);
    if (!cached) continue;
    if (!provider.minFetchIntervalMs || now - cached.cachedAt >= provider.minFetchIntervalMs) cache.delete(provider.id);
  }
}

module.exports = {
  getMarketData,
  getProviderHealth,
  registerProvider,
  unregisterProvider,
  listProviders,
  clearMarketDataCache,
  expireRefreshableCache,
  CACHE_TTL_MS,
  isFresh,
  isValidQuote,
};
