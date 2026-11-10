/**
 * Locale-aware formatting. All numbers, money, weights and dates shown in the
 * UI go through these helpers so they follow the selected language and the
 * regional preferences (digit system, date style) consistently.
 *
 * Money is always formatted in the currency the amount is denominated in
 * (TRY by default). The UI never relabels a TRY amount with another currency
 * symbol — that would misstate financial data.
 */
import type { Language } from './languages';

export type DateFormat = 'locale' | 'iso' | 'day-month-year';
export type NumberFormat = 'locale' | 'western';

export interface FormatPreferences {
  language: Language;
  numberFormat: NumberFormat;
  dateFormat: DateFormat;
}

const REGION: Record<Language, string> = {
  tr: 'tr-TR',
  en: 'en-GB',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  ru: 'ru-RU',
  ar: 'ar',
  zh: 'zh-CN',
};

export function localeTag(prefs: Pick<FormatPreferences, 'language' | 'numberFormat'>): string {
  const base = REGION[prefs.language] || 'tr-TR';
  return prefs.numberFormat === 'western' ? `${base}-u-nu-latn` : base;
}

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function numberFormatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n|${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key) as Intl.NumberFormat | undefined;
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    cache.set(key, f);
  }
  return f;
}

function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d|${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key) as Intl.DateTimeFormat | undefined;
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    cache.set(key, f);
  }
  return f;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const DASH = '—';

export function formatNumber(prefs: FormatPreferences, value: unknown, options: Intl.NumberFormatOptions = {}): string {
  const n = toNumber(value);
  if (n === null) return DASH;
  return numberFormatter(localeTag(prefs), { maximumFractionDigits: 2, ...options }).format(n);
}

export function formatMoney(prefs: FormatPreferences, value: unknown, currency = 'TRY', options: Intl.NumberFormatOptions = {}): string {
  const n = toNumber(value);
  if (n === null) return DASH;
  return numberFormatter(localeTag(prefs), {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  }).format(n);
}

export function formatPercent(prefs: FormatPreferences, value: unknown, digits = 1): string {
  const n = toNumber(value);
  if (n === null) return DASH;
  return numberFormatter(localeTag(prefs), {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n / 100);
}

export function formatWeight(prefs: FormatPreferences, grams: unknown, digits = 2): string {
  const n = toNumber(grams);
  if (n === null) return DASH;
  return numberFormatter(localeTag(prefs), {
    style: 'unit',
    unit: 'gram',
    unitDisplay: 'short',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type DateStyle = 'short' | 'medium' | 'long' | 'full';

export function formatDate(prefs: FormatPreferences, value: unknown, style: DateStyle = 'short'): string {
  const d = toDate(value);
  if (!d) return DASH;
  if (prefs.dateFormat === 'iso') return isoDate(d);
  const locale = localeTag(prefs);
  if (prefs.dateFormat === 'day-month-year' && (style === 'short' || style === 'medium')) {
    return dateFormatter(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  }
  const options: Record<DateStyle, Intl.DateTimeFormatOptions> = {
    short: { day: '2-digit', month: '2-digit', year: 'numeric' },
    medium: { day: 'numeric', month: 'short', year: 'numeric' },
    long: { day: 'numeric', month: 'long', year: 'numeric' },
    full: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  };
  return dateFormatter(locale, options[style]).format(d);
}

export function formatTime(prefs: FormatPreferences, value: unknown, withSeconds = false): string {
  const d = toDate(value);
  if (!d) return DASH;
  return dateFormatter(localeTag(prefs), {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  }).format(d);
}

export function formatDateTime(prefs: FormatPreferences, value: unknown, withSeconds = false): string {
  const d = toDate(value);
  if (!d) return DASH;
  return `${formatDate(prefs, d, 'short')} ${formatTime(prefs, d, withSeconds)}`;
}

export function formatMonth(prefs: FormatPreferences, value: unknown): string {
  const d = toDate(value);
  if (!d) return DASH;
  return dateFormatter(localeTag(prefs), { month: 'short', year: 'numeric' }).format(d);
}

export function formatWeekday(prefs: FormatPreferences, value: unknown): string {
  const d = toDate(value);
  if (!d) return DASH;
  return dateFormatter(localeTag(prefs), { weekday: 'short' }).format(d);
}
