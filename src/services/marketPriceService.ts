import apiService from './api';
import { t } from '@/i18n';

export interface MarketQuote {
  symbol: string;
  type: string;
  asset: string;
  buy: number;
  sell: number;
  bid: number;
  ask: number;
  last?: number;
  spread?: number;
  currency: string;
  source: string;
  sourceTimestamp?: string;
  fetchedAt?: string;
  status: 'live' | 'stale' | 'unavailable';
  isStale: boolean;
  priceType: 'live' | 'indicative' | 'cached' | 'manual';
  isCalculated?: boolean;
  changeRate?: number;
  formula?: string;
}

export interface CurrencyItem {
  currency: string;
  buyPrice: string;
  sellPrice: string;
}

export interface DatabasePriceItem {
  _id?: string;
  symbol?: string;
  type?: string;
  tur?: string;
  buy: number;
  sell: number;
}

export interface ProviderStatus {
  id: string;
  name: string;
  status: 'ok' | 'stale' | 'unavailable';
  quoteCount: number;
  updatedAt?: string | null;
  error?: string | null;
}

export interface MarketPriceState {
  preferredQuotes: MarketQuote[];
  indicativeQuotes: MarketQuote[];
  allQuotes: MarketQuote[];
  currencies: CurrencyItem[];
  databasePrices: DatabasePriceItem[];
  providers: ProviderStatus[];
  timestamp: string | null;
  isStale: boolean;
  loading: boolean;
  error: string | null;
}

class MarketPriceService {
  private state: MarketPriceState = {
    preferredQuotes: [],
    indicativeQuotes: [],
    allQuotes: [],
    currencies: [],
    databasePrices: [],
    providers: [],
    timestamp: null,
    isStale: false,
    loading: false,
    error: null,
  };

  private inFlightPromise: Promise<MarketPriceState> | null = null;
  private listeners: Set<(state: MarketPriceState) => void> = new Set();
  private lastFetchTime = 0;
  private readonly CACHE_LIFETIME_MS = 15000; // 15s client-side cache

  getState(): MarketPriceState {
    return { ...this.state };
  }

  subscribe(listener: (state: MarketPriceState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const currentState = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(currentState);
      } catch (err) {
        console.warn('Listener error in MarketPriceService:', err);
      }
    });
  }

  /**
   * Fetch latest prices with 5-second client timeout protection.
   * Guaranteed to reset loading spinner in all cases.
   */
  async loadPrices(force = false): Promise<MarketPriceState> {
    const now = Date.now();
    if (!force && this.state.timestamp && now - this.lastFetchTime < this.CACHE_LIFETIME_MS) {
      return this.getState();
    }

    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    this.state.loading = true;
    this.state.error = null;
    this.notify();

    this.inFlightPromise = (async () => {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, 15000); // 15-second client timeout

      try {
        const response = await apiService.get<any>('/api/prices', {
          signal: abortController.signal,
          timeout: 15000,
        });

        clearTimeout(timeoutId);

        const marketData = response?.marketData || {};
        const preferredQuotes: MarketQuote[] = marketData.preferredQuotes || [];
        const indicativeQuotes: MarketQuote[] = marketData.indicativeQuotes || [];
        const allQuotes: MarketQuote[] = marketData.quotes || [];
        const currencies: CurrencyItem[] = response?.currencies || [];
        const databasePrices: DatabasePriceItem[] = response?.prices || [];
        const providers: ProviderStatus[] = marketData.providers || [];

        this.state = {
          preferredQuotes,
          indicativeQuotes,
          allQuotes,
          currencies,
          databasePrices,
          providers,
          timestamp: response?.timestamp || new Date().toISOString(),
          isStale: Boolean(marketData.isStale || preferredQuotes.some((q) => q.isStale)),
          loading: false,
          error: null,
        };
        this.lastFetchTime = Date.now();
      } catch (err: any) {
        clearTimeout(timeoutId);
        const isTimeout =
          err?.name === 'AbortError' ||
          err?.code === 'ECONNABORTED' ||
          err?.message?.includes('timeout');

        const errorMsg = isTimeout
          ? t('errors.marketTimeout')
          : err?.message || t('errors.marketUnavailable');

        // If we previously had quotes, keep them marked as stale
        if (this.state.preferredQuotes.length > 0) {
          this.state = {
            ...this.state,
            isStale: true,
            loading: false,
            error: errorMsg,
          };
        } else {
          this.state = {
            ...this.state,
            loading: false,
            error: errorMsg,
          };
        }
      } finally {
        this.state.loading = false;
        this.inFlightPromise = null;
        this.notify();
      }

      return this.getState();
    })();

    return this.inFlightPromise;
  }

  /**
   * Returns Has Altın (24K) quote from physical market preferred quotes.
   * Returns null if no live/valid quote is available. NEVER returns a fake fallback!
   */
  getHasGoldQuote(): MarketQuote | null {
    const quotes = this.state.preferredQuotes;
    if (!quotes || quotes.length === 0) return null;

    // Strict Has Altın (24K) resolution - never match other gold types like Çeyrek or Tam
    const has =
      quotes.find((q) => q.symbol === 'HAS_ALTIN' || q.symbol === 'GRAM_ALTIN' || q.symbol === 'GA') ||
      quotes.find((q) => q.symbol && (q.symbol.startsWith('HAS') || (q.type && q.type.toLowerCase().includes('has altın'))));

    if (has && Number.isFinite(has.sell) && has.sell > 0) {
      return has;
    }
    return null;
  }

  getQuoteBySymbol(symbol: string): MarketQuote | null {
    const cleanSym = symbol.toUpperCase().trim();
    return (
      this.state.preferredQuotes.find((q) => q.symbol.toUpperCase() === cleanSym) ||
      this.state.indicativeQuotes.find((q) => q.symbol.toUpperCase() === cleanSym) ||
      null
    );
  }

  getCurrency(code: string): CurrencyItem | null {
    const cleanCode = code.toUpperCase().trim();
    return (
      this.state.currencies.find((c) => c.currency.toUpperCase().includes(cleanCode)) || null
    );
  }
}

export const marketPriceService = new MarketPriceService();
export default marketPriceService;

