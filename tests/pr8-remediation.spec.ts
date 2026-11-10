/**
 * PR #8 remediation — frontend regressions:
 *  - API base URL fallback matches the backend default port
 *  - manual metal prices keyed by each line's metal (XAU / XAG)
 *  - market auto-refresh setting drives a real timer on the prices screen
 *  - low-stock threshold: one rule everywhere, request carries the setting
 *  - signed settlement amounts (refund-only POS batches)
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'vuex';
import { shallowMount } from '@vue/test-utils';

import { DEFAULT_API_BASE_URL, resolveApiBaseUrl } from '@/services/authSession';
import { gramMetalsOf, manualPricesPayload, quotedMetalPrices } from '@/services/salePricing';
import { createAutoRefresh, normalizeRefreshSeconds } from '@/services/autoRefresh';
import {
  isCriticalStock, lowStockReportPath, normalizeLowStockThreshold, stockLevel,
} from '@/services/stockLevels';
import { normalizeSettings, defaultSettings } from '@/services/settings';
import { isValidSignedAmount, isValidAmount } from '@/services/finance';
import productsModule from '@/store/modules/products';

const ROOT = path.resolve(__dirname, '..');

describe('API base URL fallback', () => {
  it('matches the backend default PORT and the documented .env.example value', () => {
    const server = fs.readFileSync(path.join(ROOT, 'backend/server.js'), 'utf8');
    const backendDefault = server.match(/const PORT = Number\(process\.env\.PORT\) \|\| (\d+);/);
    expect(backendDefault, 'backend default port declaration').not.toBeNull();
    expect(new URL(DEFAULT_API_BASE_URL).port).toBe(backendDefault![1]);

    const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(example).toContain(`VITE_API_URL=${DEFAULT_API_BASE_URL}`);
    const backendExample = fs.readFileSync(path.join(ROOT, 'backend/.env.example'), 'utf8');
    expect(backendExample).toMatch(new RegExp(`^PORT=${backendDefault![1]}$`, 'm'));
  });

  it('uses the configured URL when present, the default only when unset or blank', () => {
    expect(resolveApiBaseUrl('https://api.example.test')).toBe('https://api.example.test');
    expect(resolveApiBaseUrl(' http://localhost:5001 ')).toBe('http://localhost:5001');
    expect(resolveApiBaseUrl(undefined)).toBe('http://localhost:5000');
    expect(resolveApiBaseUrl('')).toBe('http://localhost:5000');
    expect(resolveApiBaseUrl('   ')).toBe('http://localhost:5000');
    expect(resolveApiBaseUrl(null)).toBe('http://localhost:5000');
  });
});

describe('manual metal prices of a sale', () => {
  const products: Record<number, any> = {
    1: { pricingMode: 'gram', metal: 'XAU' },
    2: { pricingMode: 'gram', metal: 'XAG' },
    3: { pricingMode: 'fixed' },
    4: { pricingMode: 'gram', metal: 'XAG' },
  };
  const byId = (id: unknown) => products[Number(id)];

  it('lists the gram metals present in the cart in a stable order', () => {
    expect(gramMetalsOf([{ productId: 2 }, { productId: 1 }, { productId: 4 }], byId)).toEqual(['XAU', 'XAG']);
    expect(gramMetalsOf([{ productId: 2 }], byId)).toEqual(['XAG']);
    expect(gramMetalsOf([{ productId: 3 }, { productId: '' }, {}], byId)).toEqual([]);
    expect(gramMetalsOf([{ productId: 99 }], byId)).toEqual([]);
  });

  it('a silver-only cart sends its price as XAG (the old code sent XAU)', () => {
    expect(manualPricesPayload(['XAG'], { XAU: '', XAG: '41,50' })).toEqual({ XAG: '41.50' });
  });

  it('a gold + silver cart sends both; Turkish formatting is normalised', () => {
    expect(manualPricesPayload(['XAU', 'XAG'], { XAU: '3.000,25', XAG: '40' })).toEqual({ XAU: '3000.25', XAG: '40' });
  });

  it('never sends prices for metals no longer in the cart, nor empty ones', () => {
    expect(manualPricesPayload(['XAU'], { XAU: '', XAG: '40' })).toBeUndefined();
    expect(manualPricesPayload([], { XAU: '3000', XAG: '40' })).toBeUndefined();
    expect(manualPricesPayload(['XAU', 'XAG'], { XAU: '  ', XAG: '40' })).toEqual({ XAG: '40' });
  });

  it('shows the price the quote used for each metal', () => {
    const lines = [
      { pricingMode: 'fixed' },
      { pricingMode: 'gram', metal: 'XAG', price: { priceType: 'manual', pricePerGram: '40.0000' } },
      { pricingMode: 'gram', metal: 'XAU', price: { priceType: 'live', pricePerGram: '3000.0000' } },
      { pricingMode: 'gram', metal: 'XAU', price: { priceType: 'live', pricePerGram: '1.0000' } },
    ];
    const info = quotedMetalPrices(lines);
    expect(info.XAG.priceType).toBe('manual');
    expect(info.XAU.pricePerGram).toBe('3000.0000');
    expect(quotedMetalPrices(undefined)).toEqual({});
  });
});

describe('market auto-refresh scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs every N seconds, re-arms on change, stops on 0 and on stop()', async () => {
    const run = vi.fn();
    const r = createAutoRefresh(run, { isHidden: () => false });
    r.setInterval(15);
    expect(r.seconds).toBe(15);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(run).toHaveBeenCalledTimes(3);
    r.setInterval(60);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(4);
    r.setInterval(0);
    expect(r.seconds).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(run).toHaveBeenCalledTimes(4);
    r.setInterval(30);
    r.stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('never overlaps a slow run, skips while hidden, survives a failing run', async () => {
    let hidden = false;
    let release: () => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const r = createAutoRefresh(run, { isHidden: () => hidden });
    r.setInterval(15);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(2);
    release();
    hidden = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);

    const failing = vi.fn(async () => { throw new Error('offline'); });
    const f = createAutoRefresh(failing, { isHidden: () => false });
    f.setInterval(15);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(failing).toHaveBeenCalledTimes(2);
    f.stop();
    r.stop();
  });

  it('only accepts the offered intervals; settings normalise the same way', () => {
    expect([0, 15, 30, 60].map(normalizeRefreshSeconds)).toEqual([0, 15, 30, 60]);
    expect(normalizeRefreshSeconds(5)).toBe(30);
    expect(normalizeRefreshSeconds('abc')).toBe(30);
    expect(normalizeSettings({ marketAutoRefresh: 0 }).marketAutoRefresh).toBe(0);
    expect(normalizeSettings({ marketAutoRefresh: '60' }).marketAutoRefresh).toBe(60);
    expect(normalizeSettings({ marketAutoRefresh: 45 }).marketAutoRefresh).toBe(defaultSettings.marketAutoRefresh);
  });
});

const market = vi.hoisted(() => ({ loadPrices: vi.fn(async () => ({})), subscribe: vi.fn(() => () => undefined) }));
vi.mock('@/services/marketPriceService', () => ({ default: market }));

describe('PricesPage consumes the auto-refresh setting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    market.loadPrices.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('refreshes on the configured interval, follows changes, stops when unmounted', async () => {
    const { default: PricesPage } = await import('@/pages/PricesPage.vue');
    const store = createStore({
      modules: {
        settings: {
          namespaced: true,
          state: () => ({ ...defaultSettings, marketAutoRefresh: 15 }),
          mutations: { set(state: any, v: number) { state.marketAutoRefresh = v; } },
        },
      },
    });
    const wrapper = shallowMount(PricesPage, { global: { plugins: [store], mocks: { $t: (k: string) => k, $n: String }, stubs: { 'v-icon': true, 'v-btn': true, 'v-alert': true } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(market.loadPrices).toHaveBeenCalledTimes(1); // initial load
    await vi.advanceTimersByTimeAsync(30_000);
    expect(market.loadPrices).toHaveBeenCalledTimes(3);
    expect(market.loadPrices).toHaveBeenLastCalledWith(true);

    store.commit('settings/set', 0); // "manual only"
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(market.loadPrices).toHaveBeenCalledTimes(3);

    store.commit('settings/set', 60);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(market.loadPrices).toHaveBeenCalledTimes(4);

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(market.loadPrices).toHaveBeenCalledTimes(4);
  });
});

describe('low-stock threshold', () => {
  it('one rule: out ≤ 0 < low ≤ threshold < ok', () => {
    expect([-1, 0, 1, 5, 6].map((s) => stockLevel(s, 5))).toEqual(['out', 'out', 'low', 'low', 'ok']);
    expect([1, 10, 11].map((s) => stockLevel(s, 10))).toEqual(['low', 'low', 'ok']);
    expect(stockLevel(undefined, 5)).toBe('out');
    expect(isCriticalStock(0, 3)).toBe(true);
    expect(isCriticalStock(3, 3)).toBe(true);
    expect(isCriticalStock(4, 3)).toBe(false);
  });

  it('normalises the setting: whole pieces 1-50, clamped; junk → 5', () => {
    expect(normalizeLowStockThreshold(10)).toBe(10);
    expect(normalizeLowStockThreshold('12')).toBe(12);
    expect(normalizeLowStockThreshold(7.9)).toBe(7);
    expect(normalizeLowStockThreshold(80)).toBe(50);
    for (const junk of [0, -3, NaN, 'abc', '', null, undefined, true, 0.5]) expect(normalizeLowStockThreshold(junk)).toBe(5);
    expect(normalizeSettings({ lowStockThreshold: 12 }).lowStockThreshold).toBe(12);
    expect(normalizeSettings({ lowStockThreshold: 'x' }).lowStockThreshold).toBe(5);
    expect(normalizeSettings({ lowStockThreshold: 500 }).lowStockThreshold).toBe(50);
  });

  it('the critical-stock report request carries the configured threshold', () => {
    expect(lowStockReportPath(12)).toBe('/api/reports/low-stock?threshold=12');
    expect(lowStockReportPath(undefined)).toBe('/api/reports/low-stock?threshold=5');
    expect(lowStockReportPath(999)).toBe('/api/reports/low-stock?threshold=50');
  });

  it('the products store getter follows the threshold in the settings state', () => {
    const store = createStore({
      modules: {
        settings: { namespaced: true, state: () => ({ lowStockThreshold: 2 }) },
        products: { ...productsModule, state: () => ({ products: [{ stock: 0 }, { stock: 2 }, { stock: 3 }, { stock: 8 }], loading: false, error: null }) },
      },
    });
    const getter = (productsModule as any).namespaced ? 'products/lowStockProducts' : 'lowStockProducts';
    expect(store.getters[getter].map((p: any) => p.stock)).toEqual([0, 2]);
    (store.state as any).settings.lowStockThreshold = 8;
    expect(store.getters[getter].map((p: any) => p.stock)).toEqual([0, 2, 3, 8]);
  });

  it('no screen keeps a hard-coded 5', () => {
    const files = ['src/pages/Products/ProductList.vue', 'src/pages/Products/ProductPage.vue', 'src/store/modules/products.ts', 'src/pages/DashboardPage.vue', 'src/pages/Reports/ReportPage.vue'];
    for (const file of files) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(text, file).not.toMatch(/stock\s*[<>]=?\s*5\b/);
      expect(text, file).not.toMatch(/['"]\/api\/reports\/low-stock['"]/);
    }
  });
});

describe('signed settlement amounts', () => {
  it('accepts negative amounts only where the sign is meaningful', () => {
    expect(isValidSignedAmount('-980,00')).toBe(true);
    expect(isValidSignedAmount('980.00')).toBe(true);
    expect(isValidSignedAmount('-0')).toBe(false);
    expect(isValidSignedAmount('0', 2, { allowZero: true })).toBe(true);
    expect(isValidSignedAmount('--5')).toBe(false);
    expect(isValidSignedAmount('-')).toBe(false);
    expect(isValidSignedAmount('-1.234')).toBe(false);
    expect(isValidSignedAmount('abc')).toBe(false);
    expect(isValidAmount('-5'), 'the unsigned validator is unchanged').toBe(false);
  });
});
