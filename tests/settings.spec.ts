import { beforeEach, describe, expect, it } from 'vitest';
import { applySettings, defaultSettings, loadSettings, persistSettings } from '@/services/settings';
import { languageOptions, t } from '@/i18n';

describe('settings preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('dir');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }),
    });
  });

  it('persists and restores user preferences', () => {
    const next = { ...defaultSettings, language: 'de' as const, themeMode: 'light' as const, currency: 'EUR' as const };
    persistSettings(next);
    expect(loadSettings()).toMatchObject(next);
  });

  it('provides labels for every supported language and applies RTL', () => {
    expect(languageOptions).toHaveLength(8);
    for (const language of languageOptions) expect(t(language.value, 'settings')).toBeTruthy();
    applySettings({ ...defaultSettings, language: 'ar', themeMode: 'system' });
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
