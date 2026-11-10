export type Language = 'tr' | 'en' | 'de' | 'fr' | 'es' | 'ru' | 'ar' | 'zh';

export const LANGUAGES: readonly Language[] = ['tr', 'en', 'de', 'fr', 'es', 'ru', 'ar', 'zh'];

export const RTL_LANGUAGES: readonly Language[] = ['ar'];

/** Native names are shown untranslated so users can always find their language. */
export const languageOptions = [
  { value: 'tr', native: 'Türkçe' },
  { value: 'en', native: 'English' },
  { value: 'de', native: 'Deutsch' },
  { value: 'fr', native: 'Français' },
  { value: 'es', native: 'Español' },
  { value: 'ru', native: 'Русский' },
  { value: 'ar', native: 'العربية' },
  { value: 'zh', native: '中文' },
] as const satisfies readonly { value: Language; native: string }[];

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}
