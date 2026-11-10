import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { createStore } from 'vuex';
import settingsModule from '@/store/modules/settings';
import notificationModule from '@/store/modules/notification';
import { i18nPlugin, i18nState, t, money, date, weight, setI18nPreferences, LANGUAGES, loadAllLocales, loadLocale, isLocaleLoaded, messages, type Language } from '@/i18n';
import { localizeApiError } from '@/services/apiErrors';
import { PAYMENT_STATUS_LABELS } from '@/services/finance';

vi.mock('@/services/api', () => ({ default: { get: vi.fn(async () => ({ data: [] })), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('@/services/marketPriceService', () => ({
  default: { loadPrices: vi.fn(async () => ({ providers: [] })), getState: () => ({ providers: [] }), subscribe: () => () => undefined },
}));

beforeAll(async () => {
  await loadAllLocales();
  // jsdom lacks these browser APIs used by Vuetify overlays.
  (globalThis as any).ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (globalThis as any).IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
});

function makeStore(language: Language) {
  const store = createStore({ modules: { settings: settingsModule, notifications: notificationModule } });
  store.commit('settings/setPreference', { key: 'language', value: language });
  return store;
}

const vuetify = createVuetify({ components, directives });

function mountWith(component: any, language: Language, options: Record<string, any> = {}) {
  const store = makeStore(language);
  const wrapper = mount(component, {
    attachTo: document.body,
    global: {
      plugins: [store, vuetify, i18nPlugin],
      mocks: { $route: { path: '/settings', query: {}, meta: {} }, $router: { push: vi.fn(), replace: vi.fn() }, $can: () => true },
      stubs: { 'router-link': { template: '<a><slot /></a>' }, 'router-view': true, transition: false },
    },
    ...options,
  });
  return { wrapper, store };
}

/** Raw keys look like "settings.appearance.title" in rendered text. */
const RAW_KEY = /\b(common|shell|nav|roles|toast|confirm|units|errors|status|purity|payment|palettes|settings|permissions|ledger|auth|dashboard|market|sales|products|customers|reports|finance|transfers|pos|calculator)\.[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)*(?![\p{L}])/u;
const TURKISH_ONLY = /[ğşıİĞŞ]/;

function visibleText(wrapper: any): string {
  return (wrapper.element as HTMLElement).textContent || '';
}

describe('lazy locale loading', () => {
  it('bundles Turkish and loads other languages once, on demand', async () => {
    expect(isLocaleLoaded('tr')).toBe(true);
    const saved = messages.fr;
    delete messages.fr;
    expect(isLocaleLoaded('fr')).toBe(false);
    await Promise.all([loadLocale('fr'), loadLocale('fr')]);
    expect(isLocaleLoaded('fr')).toBe(true);
    expect(messages.fr).toEqual(saved);
  });

  it('switches language only after its catalog has loaded (no mixed text)', async () => {
    delete messages.zh;
    const store = createStore({ modules: { settings: settingsModule, notifications: notificationModule } });
    const pendingSwitch = store.dispatch('settings/setPreference', { key: 'language', value: 'zh' });
    expect(i18nState.language).not.toBe('zh');
    await pendingSwitch;
    expect(i18nState.language).toBe('zh');
    expect(t('nav.items.sales')).toBe('销售');
  });
});

describe('language engine', () => {
  beforeEach(() => setI18nPreferences({ language: 'tr', numberFormat: 'locale', dateFormat: 'locale' }));

  it('switches the active language immediately and sets lang/dir', () => {
    const store = makeStore('en');
    expect(i18nState.language).toBe('en');
    expect(t('nav.items.sales')).toBe('Sales');
    store.commit('settings/setPreference', { key: 'language', value: 'ar' });
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    store.commit('settings/setPreference', { key: 'language', value: 'de' });
    expect(document.documentElement.dir).toBe('ltr');
    expect(t('nav.items.sales')).toBe('Verkäufe');
  });

  it('formats numbers, money, weights and dates per locale and digit preference', () => {
    setI18nPreferences({ language: 'tr' });
    expect(money(1234.5)).toMatch(/1\.234,50/);
    setI18nPreferences({ language: 'en' });
    expect(money(1234.5)).toMatch(/1,234\.50/);
    setI18nPreferences({ language: 'de' });
    expect(weight(12.5, 3)).toMatch(/12,500\s?g/);
    setI18nPreferences({ language: 'ar', numberFormat: 'western' });
    expect(money(10)).toMatch(/10/);
    setI18nPreferences({ language: 'en', numberFormat: 'locale', dateFormat: 'iso' });
    expect(date(new Date(2026, 10, 9))).toBe('2026-11-09');
  });

  it('keeps money in its own currency regardless of language', () => {
    setI18nPreferences({ language: 'en' });
    expect(money(100)).toMatch(/TRY|₺/);
    expect(money(100)).not.toMatch(/\$/);
  });

  it('translates enum labels reactively at read time', () => {
    setI18nPreferences({ language: 'tr' });
    expect(PAYMENT_STATUS_LABELS.paid).toBe('Ödendi');
    setI18nPreferences({ language: 'fr' });
    expect(PAYMENT_STATUS_LABELS.paid).toBe('Payé');
    expect(PAYMENT_STATUS_LABELS.unknown_code).toBe('unknown_code');
  });

  it('localizes API errors without mixing languages', () => {
    setI18nPreferences({ language: 'tr' });
    expect(localizeApiError({ status: 422, serverMessage: 'Yetersiz stok' })).toBe('Yetersiz stok');
    setI18nPreferences({ language: 'en' });
    expect(localizeApiError({ status: 422, serverMessage: 'Yetersiz stok' })).toBe(t('errors.validation'));
    expect(localizeApiError({ status: 403, code: 'FORBIDDEN', serverMessage: 'Yetkiniz yok' })).toBe('You do not have permission for this action.');
    expect(localizeApiError({ status: 503 })).toBe(t('errors.server'));
  });
});

describe('rendered components contain no raw keys or mixed languages', () => {
  const pages = {
    SettingsPage: () => import('@/pages/SettingsPage.vue'),
    LoginPage: () => import('@/pages/LoginPage.vue'),
    App: () => import('@/App.vue'),
  };

  for (const language of LANGUAGES) {
    for (const [name, load] of Object.entries(pages)) {
      it(`${name} renders fully in ${language}`, async () => {
        const component = (await load()).default;
        const { wrapper } = mountWith(component, language);
        await flushPromises();
        const text = visibleText(wrapper);
        expect(text.length).toBeGreaterThan(20);
        const raw = text.match(RAW_KEY);
        expect(raw ? text.slice(Math.max(0, (raw.index || 0) - 30), (raw.index || 0) + 40) : null).toBeNull();
        if (language !== 'tr') {
          // Only user/sample data may contain Turkish letters; strip known data.
          const withoutData = text.replace(/Türkçe/g, '');
          expect(withoutData).not.toMatch(TURKISH_ONLY);
        }
        wrapper.unmount();
      });
    }
  }

  it('re-renders mounted components and toasts when the language changes', async () => {
    const SettingsPage = (await import('@/pages/SettingsPage.vue')).default;
    const ToastHost = (await import('@/components/ToastHost.vue')).default;
    const { wrapper, store } = mountWith(SettingsPage, 'tr');
    await flushPromises();
    expect(visibleText(wrapper)).toContain('Görünüm modu');

    store.commit('settings/setPreference', { key: 'language', value: 'en' });
    await nextTick();
    expect(visibleText(wrapper)).toContain('Appearance mode');
    expect(visibleText(wrapper)).not.toContain('Görünüm modu');

    const toasts = mount(ToastHost, { global: { plugins: [store, vuetify, i18nPlugin] } });
    await store.dispatch('notifications/showSuccess', t('settings.toasts.language'));
    await nextTick();
    expect(toasts.text()).toContain('Language changed');
    expect(toasts.find('[data-testid="toast"]').attributes('role')).toBe('status');
    toasts.unmount();
    wrapper.unmount();
  });
});
