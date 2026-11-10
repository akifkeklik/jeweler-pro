import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySettings, defaultSettings, loadSettings, persistSettings } from '@/services/settings';
import { PALETTES, buildTokens } from '@/theme/palettes';
import { bindVuetifyTheme, themeState, watchSystemAppearance } from '@/theme';

type Listener = () => void;

function mockMedia({ dark = false, reduced = false } = {}) {
  const listeners: Record<string, Listener[]> = {};
  const state = { dark, reduced };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      get matches() {
        if (query.includes('prefers-color-scheme: dark')) return state.dark;
        if (query.includes('prefers-reduced-motion')) return state.reduced;
        return false;
      },
      addEventListener: (_: string, fn: Listener) => { (listeners[query] ||= []).push(fn); },
      removeEventListener: (_: string, fn: Listener) => { listeners[query] = (listeners[query] || []).filter((l) => l !== fn); },
    }),
  });
  return {
    state,
    fire(query: string) {
      (listeners[query] || []).forEach((fn) => fn());
    },
    count: () => Object.values(listeners).reduce((n, l) => n + l.length, 0),
  };
}

const root = () => document.documentElement;
const cssVar = (name: string) => root().style.getPropertyValue(name);

describe('appearance engine', () => {
  beforeEach(() => {
    localStorage.clear();
    root().removeAttribute('style');
    root().removeAttribute('data-theme');
    root().removeAttribute('data-palette');
    root().classList.remove('jp-reduced-motion');
    mockMedia();
  });

  afterEach(() => bindVuetifyTheme(null));

  it('switches light and dark immediately via data-theme and tokens', () => {
    applySettings({ ...defaultSettings, themeMode: 'light' });
    expect(root().dataset.theme).toBe('light');
    const lightBg = cssVar('--jp-bg');
    applySettings({ ...defaultSettings, themeMode: 'dark' });
    expect(root().dataset.theme).toBe('dark');
    expect(cssVar('--jp-bg')).not.toBe(lightBg);
    expect(root().style.colorScheme).toBe('dark');
  });

  it('applies each of the nine palettes in both modes to the document tokens', () => {
    for (const palette of PALETTES) {
      for (const themeMode of ['light', 'dark'] as const) {
        applySettings({ ...defaultSettings, palette: palette.id, themeMode });
        const tokens = buildTokens(palette.id, themeMode);
        expect(root().dataset.palette).toBe(palette.id);
        expect(cssVar('--jp-primary')).toBe(tokens.base.primary);
        // the historical gold tokens used by component styles follow the palette
        expect(cssVar('--jp-gold')).toBe(tokens.base.primary);
        expect(cssVar('--jp-surface-card')).toBe(tokens.base.card);
        expect(cssVar('--jp-chart-1')).toBe(tokens.chart[0]);
        expect(themeState.chart).toEqual(tokens.chart);
      }
    }
  });

  it('follows the operating system in system mode and reacts to OS changes', () => {
    const media = mockMedia({ dark: true });
    const settings = { ...defaultSettings, themeMode: 'system' as const };
    applySettings(settings);
    expect(root().dataset.theme).toBe('dark');
    const stop = watchSystemAppearance(() => applySettings(settings));
    media.state.dark = false;
    media.fire('(prefers-color-scheme: dark)');
    expect(root().dataset.theme).toBe('light');
    stop();
    expect(media.count()).toBe(0);
  });

  it('enables reduced motion from the user preference or the OS preference', () => {
    applySettings({ ...defaultSettings, reducedMotion: false });
    expect(root().classList.contains('jp-reduced-motion')).toBe(false);
    expect(themeState.reducedMotion).toBe(false);

    applySettings({ ...defaultSettings, reducedMotion: true });
    expect(root().classList.contains('jp-reduced-motion')).toBe(true);

    const media = mockMedia({ reduced: true });
    applySettings({ ...defaultSettings, reducedMotion: false });
    expect(root().classList.contains('jp-reduced-motion')).toBe(true);
    expect(themeState.systemReducedMotion).toBe(true);

    media.state.reduced = false;
    applySettings({ ...defaultSettings, reducedMotion: false });
    expect(root().classList.contains('jp-reduced-motion')).toBe(false);
  });

  it('keeps the Vuetify theme in sync without a reload', () => {
    const vuetify = {
      themes: { value: { light: { dark: false, colors: {} as Record<string, string> }, dark: { dark: true, colors: {} as Record<string, string> } } },
      global: { name: { value: 'dark' } },
      change: vi.fn(function (this: void, name: string) { vuetify.global.name.value = name; }),
    };
    bindVuetifyTheme(vuetify);
    applySettings({ ...defaultSettings, palette: 'emerald', themeMode: 'light' });
    expect(vuetify.change).toHaveBeenCalledWith('light');
    expect(vuetify.themes.value.light.colors.primary).toBe(buildTokens('emerald', 'light').base.primary);
    applySettings({ ...defaultSettings, palette: 'ruby', themeMode: 'dark' });
    expect(vuetify.global.name.value).toBe('dark');
    expect(vuetify.themes.value.dark.colors.primary).toBe(buildTokens('ruby', 'dark').base.primary);
  });

  it('persists the palette and migrates the pre-palette accent setting', () => {
    persistSettings({ ...defaultSettings, palette: 'amethyst', themeMode: 'light' });
    expect(loadSettings()).toMatchObject({ palette: 'amethyst', themeMode: 'light' });

    localStorage.setItem('jeweler_settings', JSON.stringify({ accent: 'platinum', themeMode: 'dark' }));
    expect(loadSettings().palette).toBe('arctic');

    localStorage.setItem('jeweler_settings', JSON.stringify({ palette: 'neon', themeMode: 'sepia', language: 'xx', toastDuration: 99 }));
    const recovered = loadSettings();
    expect(recovered.palette).toBe('obsidian');
    expect(recovered.themeMode).toBe(defaultSettings.themeMode);
    expect(recovered.language).toBe('tr');
    expect(recovered.toastDuration).toBe(4000);
  });
});
