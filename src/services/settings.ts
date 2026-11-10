import { applyAppearance, type ThemeMode } from '@/theme';
import { DEFAULT_PALETTE, resolvePaletteId, type PaletteId } from '@/theme/palettes';
import { isLanguage, type Language } from '@/i18n/languages';
import { formatDate as formatLocaleDate, formatMoney, type DateFormat, type NumberFormat } from '@/i18n/format';
import { setI18nPreferences } from '@/i18n';
import { DEFAULT_LOW_STOCK_THRESHOLD, normalizeLowStockThreshold } from '@/services/stockLevels';
import { DEFAULT_MARKET_REFRESH_SECONDS, MARKET_REFRESH_SECONDS } from '@/services/autoRefresh';

export type { Language, ThemeMode, PaletteId, DateFormat, NumberFormat };
export type Density = 'comfortable' | 'compact';
export type SidebarMode = 'hover' | 'pinned' | 'collapsed';
export type Currency = 'TRY' | 'USD' | 'EUR';


export interface SettingsState {
  language: Language;
  themeMode: ThemeMode;
  /** One of the nine palettes in src/theme/palettes.ts. */
  palette: PaletteId;
  density: Density;
  sidebarMode: SidebarMode;
  reducedMotion: boolean;
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
  currency: Currency;
  lowStockThreshold: number;
  toastDuration: number;
  marketAutoRefresh: number;
}


export const defaultSettings: SettingsState = {
  language: 'tr',
  themeMode: 'dark',
  palette: DEFAULT_PALETTE,
  density: 'comfortable',
  sidebarMode: 'pinned',
  reducedMotion: false,
  dateFormat: 'locale',
  numberFormat: 'locale',
  currency: 'TRY',
  lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
  toastDuration: 4000,
  /** Seconds between automatic market-price refreshes; 0 = manual only. */
  marketAutoRefresh: DEFAULT_MARKET_REFRESH_SECONDS,
};

const STORAGE_KEY = 'jeweler_settings';

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];
const DENSITIES: Density[] = ['comfortable', 'compact'];
const SIDEBAR_MODES: SidebarMode[] = ['hover', 'pinned', 'collapsed'];
const DATE_FORMATS: DateFormat[] = ['locale', 'iso', 'day-month-year'];
const NUMBER_FORMATS: NumberFormat[] = ['locale', 'western'];
const CURRENCIES: Currency[] = ['TRY', 'USD', 'EUR'];
const TOAST_DURATIONS = [3000, 4000, 5000, 6000];

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Validates stored preferences field by field so a corrupt or outdated value
 * (e.g. an accent id from before the nine-palette system) can never break the
 * UI; it is migrated or replaced by the default instead.
 */
export function normalizeSettings(stored: Record<string, any>): SettingsState {
  const s = stored || {};
  return {
    language: isLanguage(s.language) ? s.language : defaultSettings.language,
    themeMode: pick(s.themeMode, THEME_MODES, defaultSettings.themeMode),
    palette: resolvePaletteId(s.palette ?? s.accent),
    density: pick(s.density, DENSITIES, defaultSettings.density),
    sidebarMode: pick(s.sidebarMode, SIDEBAR_MODES, defaultSettings.sidebarMode),
    reducedMotion: typeof s.reducedMotion === 'boolean' ? s.reducedMotion : defaultSettings.reducedMotion,
    dateFormat: pick(s.dateFormat, DATE_FORMATS, defaultSettings.dateFormat),
    numberFormat: pick(s.numberFormat, NUMBER_FORMATS, defaultSettings.numberFormat),
    currency: pick(s.currency, CURRENCIES, defaultSettings.currency),
    lowStockThreshold: normalizeLowStockThreshold(s.lowStockThreshold),
    toastDuration: pick(Number(s.toastDuration), TOAST_DURATIONS, defaultSettings.toastDuration),
    marketAutoRefresh: pick(Number(s.marketAutoRefresh), MARKET_REFRESH_SECONDS, defaultSettings.marketAutoRefresh),
  };
}

export function loadSettings(): SettingsState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return normalizeSettings(JSON.parse(raw || '{}'));
  } catch {
    return normalizeSettings({});
  }
}

export function persistSettings(settings: SettingsState): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  } catch (error) {
    console.warn('Settings could not be persisted:', error);
  }
}

/**
 * Applies every presentation preference (theme, palette, motion, density,
 * language, formats) to the document. Idempotent and cheap: safe to call on
 * every preference change and on OS appearance changes.
 */
export function applySettings(settings: SettingsState): void {
  setI18nPreferences({
    language: settings.language,
    numberFormat: settings.numberFormat,
    dateFormat: settings.dateFormat,
  });
  applyAppearance({
    themeMode: settings.themeMode,
    palette: resolvePaletteId(settings.palette ?? (settings as any).accent),
    reducedMotion: settings.reducedMotion,
    density: settings.density,
  });
}

export function formatDate(value: Date, settings: SettingsState): string {
  return formatLocaleDate(settings, value, 'full');
}

/** Formats an amount denominated in `currency` (TRY unless stated). */
export function formatCurrency(value: number, settings: SettingsState, currency: string = 'TRY'): string {
  return formatMoney(settings, value, currency);
}
