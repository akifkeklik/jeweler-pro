/**
 * Market data provider contract and base adapter.
 *
 * Adapters return normalized quotes and never return stale cached data as
 * current live data. Secrets stay in the backend process.
 */
class MarketDataProvider {
  constructor({
    id,
    name,
    termsUrl,
    configured = true,
    priority = 100,
    maxAgeMs = 300000,
    requiresAuth = false,
    isTheoretical = false,
    // Minimum time between two upstream fetches (protects rate-limited / quota APIs).
    minFetchIntervalMs = 0,
    // 'source': quotes carry the publisher's timestamp; 'received': the API
    // gives none, so the timestamp is our receive time (freshness of delivery,
    // not a guarantee about the upstream price).
    timestampSource = 'source',
  }) {
    if (!id || !name) {
      throw new Error('MarketDataProvider requires id and name');
    }
    this.id = id;
    this.name = name;
    this.termsUrl = termsUrl || '';
    this.configured = Boolean(configured);
    this.priority = priority;
    this.maxAgeMs = maxAgeMs;
    this.requiresAuth = Boolean(requiresAuth);
    this.isTheoretical = Boolean(isTheoretical);
    this.minFetchIntervalMs = Number(minFetchIntervalMs) || 0;
    this.timestampSource = timestampSource;
    this.quotaRemaining = null;
  }

  /**
   * Fetch quotes from the underlying data source.
   * Must return an array of normalized quote objects.
   * @returns {Promise<Array<Object>>}
   */
  async fetchQuotes() {
    throw new Error(`${this.id} provider must implement fetchQuotes()`);
  }

  /**
   * Provider metadata descriptor for health inspection and status APIs.
   * Excludes any confidential secrets or API keys.
   */
  metadata() {
    return {
      id: this.id,
      name: this.name,
      configured: this.configured,
      priority: this.priority,
      maxAgeMs: this.maxAgeMs,
      termsUrl: this.termsUrl,
      requiresAuth: this.requiresAuth,
      isTheoretical: this.isTheoretical,
      minFetchIntervalMs: this.minFetchIntervalMs,
      timestampSource: this.timestampSource,
      quotaRemaining: this.quotaRemaining,
    };
  }
}

module.exports = MarketDataProvider;
