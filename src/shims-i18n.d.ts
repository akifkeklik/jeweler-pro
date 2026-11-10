import type { TranslateParams } from '@/i18n';
import type { FormatPreferences } from '@/i18n/format';

declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    $t: (key: string, params?: TranslateParams | string, extra?: TranslateParams) => string;
    $te: (key: string) => boolean;
    $n: (value: unknown, options?: Intl.NumberFormatOptions) => string;
    $money: (value: unknown, currency?: string, options?: Intl.NumberFormatOptions) => string;
    $percent: (value: unknown, digits?: number) => string;
    $weight: (grams: unknown, digits?: number) => string;
    $date: (value: unknown, style?: 'short' | 'medium' | 'long' | 'full') => string;
    $time: (value: unknown, withSeconds?: boolean) => string;
    $dateTime: (value: unknown, withSeconds?: boolean) => string;
    $i18n: FormatPreferences;
    $instrument: (symbol: unknown, fallback?: string) => string;
    $payment: (method: unknown) => string;
    $ledger: (entry: { type?: string; title?: string; reference?: { id?: unknown } } | null | undefined) => string;
    $can: (permission: string) => boolean;
  }
}

export {};
