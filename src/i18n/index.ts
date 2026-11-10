/**
 * Jeweler Pro i18n engine.
 *
 *  - Messages are authored in ./messages (all eight languages side by side per
 *    key) and compiled to ./locales/<lang>.json by scripts/build-locales.mjs.
 *    Turkish ships in the main bundle; other languages load on demand via
 *    `loadLocale()` *before* the switch, so a page never mixes languages.
 *  - `$t('sales.title')` in templates; `t('sales.title')` in scripts. Both read
 *    the reactive `i18nState.language`, so every mounted component, dialog and
 *    toast re-renders as soon as the language changes.
 *  - `{name}` placeholders are interpolated from the params object.
 *  - Catalog completeness is enforced by tests/i18n-coverage.spec.ts; the
 *    runtime fallback (Turkish → key) exists only as a last-resort safety net
 *    and reports the miss in development.
 */
import { reactive, type App } from 'vue';
import tr from './locales/tr.json';
import type { Catalog } from './messages/define';
import { LANGUAGES, RTL_LANGUAGES, isLanguage, languageOptions, type Language } from './languages';
import * as fmt from './format';
import type { DateFormat, DateStyle, FormatPreferences, NumberFormat } from './format';
import { IS_PRODUCTION } from '@/config/env';

/** Loaded catalogs. Turkish is bundled; the rest arrive through loadLocale(). */
export const messages: Partial<Record<Language, Catalog>> = { tr: tr as Catalog };

const loaders: Record<Exclude<Language, 'tr'>, () => Promise<{ default: unknown }>> = {
  en: () => import(/* webpackChunkName: "locale-en" */ './locales/en.json'),
  de: () => import(/* webpackChunkName: "locale-de" */ './locales/de.json'),
  fr: () => import(/* webpackChunkName: "locale-fr" */ './locales/fr.json'),
  es: () => import(/* webpackChunkName: "locale-es" */ './locales/es.json'),
  ru: () => import(/* webpackChunkName: "locale-ru" */ './locales/ru.json'),
  ar: () => import(/* webpackChunkName: "locale-ar" */ './locales/ar.json'),
  zh: () => import(/* webpackChunkName: "locale-zh" */ './locales/zh.json'),
};

const pending = new Map<Language, Promise<void>>();

export function isLocaleLoaded(language: Language): boolean {
  return Boolean(messages[language]);
}

/** Loads a language catalog once; resolves immediately when already loaded. */
export function loadLocale(language: Language): Promise<void> {
  if (!isLanguage(language) || messages[language]) return Promise.resolve();
  let job = pending.get(language);
  if (!job) {
    job = loaders[language as Exclude<Language, 'tr'>]()
      .then((mod) => {
        messages[language] = ((mod as { default?: unknown }).default ?? mod) as Catalog;
      })
      .finally(() => pending.delete(language));
    pending.set(language, job);
  }
  return job;
}

export function loadAllLocales(): Promise<void> {
  return Promise.all(LANGUAGES.map((l) => loadLocale(l))).then(() => undefined);
}

export const i18nState = reactive<FormatPreferences>({
  language: 'tr',
  numberFormat: 'locale',
  dateFormat: 'locale',
});

export function setI18nPreferences(prefs: Partial<FormatPreferences>): void {
  if (prefs.language && isLanguage(prefs.language)) i18nState.language = prefs.language;
  if (prefs.numberFormat) i18nState.numberFormat = prefs.numberFormat as NumberFormat;
  if (prefs.dateFormat) i18nState.dateFormat = prefs.dateFormat as DateFormat;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = i18nState.language;
    document.documentElement.dir = RTL_LANGUAGES.includes(i18nState.language) ? 'rtl' : 'ltr';
  }
}

/** Raw catalog node (string or sub-tree) for a dotted key. */
export function lookupNode(language: Language, key: string): string | Catalog | undefined {
  let node: string | Catalog | undefined = messages[language];
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return node;
}

export function lookup(language: Language, key: string): string | undefined {
  let node: string | Catalog | undefined = messages[language];
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export type TranslateParams = Record<string, string | number | null | undefined>;

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name];
    return value === undefined || value === null ? '' : String(value);
  });
}

const reported = new Set<string>();

export function translate(language: Language, key: string, params?: TranslateParams): string {
  const hit = lookup(language, key);
  if (hit !== undefined) return interpolate(hit, params);
  if (!IS_PRODUCTION && !reported.has(`${language}:${key}`)) {
    reported.add(`${language}:${key}`);
    console.warn(`[i18n] missing "${key}" for "${language}"`);
  }
  const fallback = lookup('tr', key);
  return fallback !== undefined ? interpolate(fallback, params) : key;
}

/**
 * `t('<key>')` translates into the active language.
 * `t('en', '<key>')` (legacy form) translates into an explicit language.
 */
export function t(keyOrLanguage: string, keyOrParams?: string | TranslateParams, params?: TranslateParams): string {
  if (typeof keyOrParams === 'string' && isLanguage(keyOrLanguage)) {
    return translate(keyOrLanguage, keyOrParams, params);
  }
  return translate(i18nState.language, keyOrLanguage, keyOrParams as TranslateParams | undefined);
}

/** True when the key exists in the active language (for optional data labels). */
export function te(key: string): boolean {
  return lookup(i18nState.language, key) !== undefined;
}

/** Translate a data-driven label (enum, role, status) with a readable fallback. */
export function tOptional(key: string, fallback: string): string {
  return te(key) ? t(key) : fallback;
}

/** Display name of a market instrument code (HAS_ALTIN, USD/TRY, …). */
export function instrumentLabel(symbol: unknown, fallback?: string): string {
  const code = String(symbol ?? '');
  if (!code) return fallback || '—';
  return tOptional(`market.instrument.${code}`, fallback || code.replace(/_/g, ' '));
}

const PAYMENT_KEYS: Record<string, string> = {
  nakit: 'cash', cash: 'cash',
  'kredi kartı': 'card', 'kredi karti': 'card', kart: 'card', card: 'card', pos: 'card',
  havale: 'transfer', eft: 'transfer', 'havale/eft': 'transfer', transfer: 'transfer', banka: 'transfer',
  veresiye: 'account', cari: 'account', account: 'account',
  karma: 'mixed', mixed: 'mixed',
  'altın': 'gold', altin: 'gold', gold: 'gold',
};

/** Localized label for a stored payment-method value ("nakit", "kredi kartı", …). */
export function paymentMethodLabel(method: unknown): string {
  const raw = String(method ?? '').trim();
  if (!raw) return t('payment.cash');
  const key = PAYMENT_KEYS[raw.toLocaleLowerCase('tr-TR')];
  return key ? t(`payment.${key}`) : raw;
}

/**
 * Statement/ledger row label. Rows carry a stable `type` code plus a free-text
 * Turkish description; outside Turkish the translated type (and reference) is
 * shown so statements never mix languages.
 */
export function ledgerEntryLabel(entry: { type?: string; title?: string; reference?: { id?: unknown } } | null | undefined): string {
  if (!entry) return '—';
  if (i18nState.language === 'tr' && entry.title) return entry.title;
  const label = entry.type ? tOptional(`ledger.entry.${entry.type}`, entry.title || entry.type) : entry.title || '—';
  const ref = entry.reference?.id;
  return ref !== undefined && ref !== null && ref !== '' ? `${label} #${ref}` : label;
}

export const n = (value: unknown, options?: Intl.NumberFormatOptions) => fmt.formatNumber(i18nState, value, options);
export const money = (value: unknown, currency = 'TRY', options?: Intl.NumberFormatOptions) => fmt.formatMoney(i18nState, value, currency, options);
export const percent = (value: unknown, digits?: number) => fmt.formatPercent(i18nState, value, digits);
export const weight = (grams: unknown, digits?: number) => fmt.formatWeight(i18nState, grams, digits);
export const date = (value: unknown, style?: DateStyle) => fmt.formatDate(i18nState, value, style);
export const time = (value: unknown, withSeconds?: boolean) => fmt.formatTime(i18nState, value, withSeconds);
export const dateTime = (value: unknown, withSeconds?: boolean) => fmt.formatDateTime(i18nState, value, withSeconds);
export const month = (value: unknown) => fmt.formatMonth(i18nState, value);
export const weekday = (value: unknown) => fmt.formatWeekday(i18nState, value);
export const currentLocaleTag = () => fmt.localeTag(i18nState);

/** Locale-aware, case-insensitive text matching for search boxes. */
export function normalizeSearch(value: unknown): string {
  return String(value ?? '').toLocaleLowerCase(fmt.localeTag(i18nState));
}

export const i18nPlugin = {
  install(app: App) {
    const g = app.config.globalProperties as Record<string, unknown>;
    g.$t = t;
    g.$te = te;
    g.$n = n;
    g.$money = money;
    g.$percent = percent;
    g.$weight = weight;
    g.$date = date;
    g.$time = time;
    g.$dateTime = dateTime;
    g.$i18n = i18nState;
    g.$instrument = instrumentLabel;
    g.$payment = paymentMethodLabel;
    g.$ledger = ledgerEntryLabel;
  },
};

export { LANGUAGES, languageOptions, isLanguage, type Language };
export type TranslationKey = string;
