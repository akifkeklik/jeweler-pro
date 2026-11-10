import { describe, expect, it, vi, beforeEach } from 'vitest';
import marketPriceService from '@/services/marketPriceService';
import apiService from '@/services/api';
import Calculator from '@/components/Calculator.vue';

describe('Market Price Service & Frontend Pricing Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('guarantees NO 3100 TL hardcoded fallback exists in service initial state', () => {
    const hasQuote = marketPriceService.getHasGoldQuote();
    expect(hasQuote).toBeNull();
  });

  it('populates preferredQuotes and resolves Has Gold when backend returns valid quotes', async () => {
    const mockApiResponse = {
      timestamp: '2026-11-07T14:00:00.000Z',
      currencies: [{ currency: 'USD/TL', buyPrice: '50.10', sellPrice: '50.20' }],
      prices: [],
      marketData: {
        isStale: false,
        preferredQuotes: [
          {
            symbol: 'HAS_ALTIN',
            type: 'Has Altın (24K)',
            buy: 6550,
            sell: 6560,
            currency: 'TRY',
            source: 'genelpara',
            isStale: false,
            priceType: 'live',
          },
        ],
        indicativeQuotes: [
          {
            symbol: 'REF_HAS_ALTIN',
            buy: 6545,
            sell: 6545,
            priceType: 'indicative',
          },
        ],
        providers: [{ id: 'genelpara', status: 'ok', quoteCount: 1 }],
      },
    };

    vi.spyOn(apiService, 'get').mockResolvedValueOnce(mockApiResponse);

    const state = await marketPriceService.loadPrices(true);
    expect(state.loading).toBe(false);
    expect(state.preferredQuotes.length).toBe(1);
    expect(state.isStale).toBe(false);

    const has = marketPriceService.getHasGoldQuote();
    expect(has).not.toBeNull();
    expect(has?.sell).toBe(6560);
  });

  it('safely handles backend network failure without unhandled rejection and terminates loading state', async () => {
    vi.spyOn(apiService, 'get').mockRejectedValueOnce(new Error('Internal Server Error'));

    const state = await marketPriceService.loadPrices(true);
    expect(state.loading).toBe(false);
    expect(state.error).toBeTruthy();
    expect(state.error).toBe('Internal Server Error');
  });

  it('safely handles timeout abort and ends spinner', async () => {
    const abortErr = new Error('The user aborted a request.');
    abortErr.name = 'AbortError';
    vi.spyOn(apiService, 'get').mockRejectedValueOnce(abortErr);

    const state = await marketPriceService.loadPrices(true);
    expect(state.loading).toBe(false);
    expect(state.error).toContain('zaman aşımına');
  });

  it('verifies Calculator.vue component definition has NO hardcoded 3100 fallback', () => {
    const dataFn = (Calculator as any).data;
    const initialData = typeof dataFn === 'function' ? dataFn.call({}) : {};
    expect(initialData.pricePerGram).toBeNull();
    expect(initialData.liveHasPrice).toBeNull();
    expect(initialData.pricePerGram).not.toBe(3100);
  });

  it('guarantees getHasGoldQuote strictly rejects CEYREK_ALTIN and only resolves genuine Has Altın', async () => {
    const mockApiResponse = {
      timestamp: '2026-11-07T14:00:00.000Z',
      currencies: [],
      prices: [],
      marketData: {
        isStale: false,
        preferredQuotes: [
          {
            symbol: 'CEYREK_ALTIN',
            type: 'Çeyrek Altın',
            buy: 10600,
            sell: 10750,
            currency: 'TRY',
            source: 'genelpara',
          },
          {
            symbol: '22_AYAR',
            type: '22 Ayar Altın',
            buy: 5900,
            sell: 6100,
            currency: 'TRY',
            source: 'genelpara',
          },
        ],
        indicativeQuotes: [],
        providers: [],
      },
    };

    vi.spyOn(apiService, 'get').mockResolvedValueOnce(mockApiResponse);
    await marketPriceService.loadPrices(true);

    // Has Altın is NOT in preferredQuotes, so getHasGoldQuote MUST return null and NEVER return Çeyrek or 22 Ayar
    const has = marketPriceService.getHasGoldQuote();
    expect(has).toBeNull();
  });
});
