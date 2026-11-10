/**
 * Appearance runtime: resolves the effective appearance (palette × light/dark ×
 * reduced motion) from user preferences plus operating-system signals and
 * applies it to the document and to Vuetify in one place.
 *
 * Consumers that need colours in JavaScript (charts) read `themeState`, which
 * is reactive, instead of hard-coding hex values.
 */
import { reactive } from 'vue';
import { buildTokens, vuetifyColors, type AppearanceMode, type PaletteId, type ThemeTokens } from './palettes';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface AppearancePreferences {
  themeMode: ThemeMode;
  palette: PaletteId;
  reducedMotion: boolean;
  density?: string;
}

interface VuetifyThemeLike {
  themes: { value: Record<string, { dark: boolean; colors: Record<string, string> }> };
  global: { name: { value: string } };
  change?: (name: string) => void;
}

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function media(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

export function systemPrefersDark(): boolean {
  return Boolean(media(DARK_QUERY)?.matches);
}

export function systemPrefersReducedMotion(): boolean {
  return Boolean(media(MOTION_QUERY)?.matches);
}

export function resolveMode(themeMode: ThemeMode): AppearanceMode {
  if (themeMode === 'light' || themeMode === 'dark') return themeMode;
  return systemPrefersDark() ? 'dark' : 'light';
}

export const themeState = reactive({
  mode: 'dark' as AppearanceMode,
  palette: 'obsidian' as PaletteId,
  /** User preference OR operating-system preference. */
  reducedMotion: false,
  /** True when the OS asks for reduced motion (shown as a hint in Settings). */
  systemReducedMotion: false,
  chart: [] as string[],
  tokens: null as ThemeTokens | null,
});

let vuetifyTheme: VuetifyThemeLike | null = null;
let appliedVarKeys: string[] = [];

export function bindVuetifyTheme(theme: VuetifyThemeLike | null): void {
  vuetifyTheme = theme;
  if (themeState.tokens) syncVuetify(themeState.tokens);
}

function syncVuetify(tokens: ThemeTokens): void {
  if (!vuetifyTheme?.themes?.value) return;
  const target = vuetifyTheme.themes.value[tokens.mode];
  if (target) {
    Object.assign(target.colors, vuetifyColors(tokens));
  }
  if (vuetifyTheme.global.name.value !== tokens.mode) {
    if (typeof vuetifyTheme.change === 'function') vuetifyTheme.change(tokens.mode);
    else vuetifyTheme.global.name.value = tokens.mode;
  }
}

export function applyAppearance(prefs: AppearancePreferences): ThemeTokens {
  const mode = resolveMode(prefs.themeMode);
  const tokens = buildTokens(prefs.palette, mode);
  const systemReduced = systemPrefersReducedMotion();
  const reduced = Boolean(prefs.reducedMotion) || systemReduced;

  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    // Remove variables that a previous palette set but this one does not.
    for (const key of appliedVarKeys) {
      if (!(key in tokens.cssVars)) root.style.removeProperty(key);
    }
    for (const [key, value] of Object.entries(tokens.cssVars)) {
      root.style.setProperty(key, value);
    }
    appliedVarKeys = Object.keys(tokens.cssVars);
    root.dataset.theme = mode;
    root.dataset.palette = tokens.palette;
    if (prefs.density) root.dataset.density = prefs.density;
    root.classList.toggle('jp-reduced-motion', reduced);
    root.style.colorScheme = mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', tokens.base.surface);
  }

  themeState.mode = mode;
  themeState.palette = tokens.palette;
  themeState.reducedMotion = reduced;
  themeState.systemReducedMotion = systemReduced;
  themeState.chart = tokens.chart;
  themeState.tokens = tokens;
  syncVuetify(tokens);
  return tokens;
}

/**
 * Re-applies the appearance whenever the OS colour scheme or motion preference
 * changes (only relevant for `system` mode / reduced motion). Returns an
 * unsubscribe function.
 */
export function watchSystemAppearance(onChange: () => void): () => void {
  const lists = [media(DARK_QUERY), media(MOTION_QUERY)].filter(Boolean) as MediaQueryList[];
  const handler = () => onChange();
  for (const list of lists) {
    if (typeof list.addEventListener === 'function') list.addEventListener('change', handler);
    else if (typeof (list as any).addListener === 'function') (list as any).addListener(handler);
  }
  return () => {
    for (const list of lists) {
      if (typeof list.removeEventListener === 'function') list.removeEventListener('change', handler);
      else if (typeof (list as any).removeListener === 'function') (list as any).removeListener(handler);
    }
  };
}

/** Animation helper for JS-driven motion (charts etc.). */
export function motionEnabled(): boolean {
  return !themeState.reducedMotion;
}

export { buildTokens, type PaletteId, type AppearanceMode };
