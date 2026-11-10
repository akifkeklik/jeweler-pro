/**
 * Jeweler Pro palette registry — the single source of truth for colour.
 *
 * Each palette declares a small set of hand-tuned base colours per appearance
 * (light / dark). Everything else the UI needs (CSS custom properties, the
 * Vuetify theme, chart series, preview swatches) is *derived* from these by
 * `buildTokens()` so the nine palettes cannot drift apart structurally.
 *
 * Contrast targets (verified by tests/theme-palettes.spec.ts):
 *   text / textMuted on bg & card  ≥ 4.5 : 1   (WCAG AA body text)
 *   primary used as text on card   ≥ 4.5 : 1
 *   onPrimary on primary           ≥ 4.5 : 1
 *   semantic colours on card       ≥ 4.5 : 1
 *   textSubtle on every surface    ≥ 4.5 : 1   (captions, table headers: small text)
 */

export type PaletteId =
  | 'obsidian'
  | 'sapphire'
  | 'emerald'
  | 'amethyst'
  | 'ruby'
  | 'amber'
  | 'arctic'
  | 'rose'
  | 'graphite';

export type AppearanceMode = 'light' | 'dark';

export interface PaletteBase {
  bg: string;
  surface: string;
  card: string;
  cardHover: string;
  muted: string;
  elevated: string;
  border: string;
  text: string;
  textEmphasis: string;
  textMuted: string;
  textSubtle: string;
  primary: string;
  primaryHover: string;
  onPrimary: string;
  secondary: string;
  accent: string;
}

export interface PaletteDefinition {
  id: PaletteId;
  light: PaletteBase;
  dark: PaletteBase;
}

const SEMANTIC: Record<AppearanceMode, { success: string; warning: string; danger: string; info: string }> = {
  dark: { success: '#3ecf8e', warning: '#f0b429', danger: '#f2555a', info: '#4fb3f0' },
  light: { success: '#137a4b', warning: '#9a5800', danger: '#c22a32', info: '#0a69a6' },
};

export const PALETTES: readonly PaletteDefinition[] = [
  {
    id: 'obsidian',
    dark: {
      bg: '#0c0d10', surface: '#111216', card: '#16181d', cardHover: '#1c1e24', muted: '#1f2228', elevated: '#282b32',
      border: '#2a2c32', text: '#eceae6', textEmphasis: '#ffffff', textMuted: '#a6a49f', textSubtle: '#8c8a85',
      primary: '#c9a961', primaryHover: '#b8954a', onPrimary: '#16130b', secondary: '#9aa3b2', accent: '#dccba3',
    },
    light: {
      bg: '#f4f3f0', surface: '#ffffff', card: '#ffffff', cardHover: '#faf9f6', muted: '#efede8', elevated: '#e5e2db',
      border: '#e1ddd4', text: '#25231f', textEmphasis: '#121110', textMuted: '#5d5950', textSubtle: '#6d6962',
      primary: '#86661c', primaryHover: '#6f5415', onPrimary: '#ffffff', secondary: '#4f5868', accent: '#a7843a',
    },
  },
  {
    id: 'sapphire',
    dark: {
      bg: '#0a0f1c', surface: '#0d1424', card: '#121a2e', cardHover: '#172139', muted: '#1a2540', elevated: '#22304f',
      border: '#232f4a', text: '#e8edf7', textEmphasis: '#ffffff', textMuted: '#9dabc6', textSubtle: '#818ea9',
      primary: '#6b97f2', primaryHover: '#5482e6', onPrimary: '#06112a', secondary: '#b7c3da', accent: '#a9c6ff',
    },
    light: {
      bg: '#f2f5fb', surface: '#ffffff', card: '#ffffff', cardHover: '#f7f9fd', muted: '#e9eef8', elevated: '#dde5f3',
      border: '#d9e0ee', text: '#182033', textEmphasis: '#0b1222', textMuted: '#4b5975', textSubtle: '#5e6b85',
      primary: '#1f4fbf', primaryHover: '#183f9c', onPrimary: '#ffffff', secondary: '#4a5a7a', accent: '#3366d6',
    },
  },
  {
    id: 'emerald',
    dark: {
      bg: '#08110d', surface: '#0b1611', card: '#101c16', cardHover: '#15241d', muted: '#182a21', elevated: '#20362b',
      border: '#1f3328', text: '#e6efe9', textEmphasis: '#ffffff', textMuted: '#9cb1a5', textSubtle: '#7f9388',
      primary: '#4cb88a', primaryHover: '#3aa077', onPrimary: '#04140c', secondary: '#c6b37a', accent: '#a5d9c0',
    },
    light: {
      bg: '#f1f5f2', surface: '#ffffff', card: '#ffffff', cardHover: '#f7faf8', muted: '#e6eee9', elevated: '#d9e5de',
      border: '#d5e0d9', text: '#17241d', textEmphasis: '#0b1510', textMuted: '#4a5f53', textSubtle: '#5a6d62',
      primary: '#1c6a49', primaryHover: '#155639', onPrimary: '#ffffff', secondary: '#7a6a2e', accent: '#2a805b',
    },
  },
  {
    id: 'amethyst',
    dark: {
      bg: '#0f0b17', surface: '#140f1f', card: '#1a1428', cardHover: '#211a32', muted: '#251d38', elevated: '#2e2545',
      border: '#2d2442', text: '#eee9f6', textEmphasis: '#ffffff', textMuted: '#aca2c4', textSubtle: '#8e85a3',
      primary: '#ab8af0', primaryHover: '#9775e2', onPrimary: '#160b2b', secondary: '#e0c78e', accent: '#cdb8fa',
    },
    light: {
      bg: '#f5f2fa', surface: '#ffffff', card: '#ffffff', cardHover: '#faf8fd', muted: '#ece7f5', elevated: '#e1d9ef',
      border: '#e0d8ed', text: '#221a33', textEmphasis: '#140e21', textMuted: '#594f6f', textSubtle: '#6c647d',
      primary: '#6a3fc0', primaryHover: '#5631a3', onPrimary: '#ffffff', secondary: '#7e6420', accent: '#7f55d4',
    },
  },
  {
    id: 'ruby',
    dark: {
      bg: '#130a0d', surface: '#190f13', card: '#201318', cardHover: '#28191f', muted: '#2c1c23', elevated: '#37242c',
      border: '#3a252d', text: '#f3e9eb', textEmphasis: '#ffffff', textMuted: '#bba3a9', textSubtle: '#9a848b',
      primary: '#de6680', primaryHover: '#d05a73', onPrimary: '#1f070d', secondary: '#d4b07a', accent: '#f0a3b3',
    },
    light: {
      bg: '#f8f3f4', surface: '#ffffff', card: '#ffffff', cardHover: '#fcf8f9', muted: '#f1e7e9', elevated: '#e8dade',
      border: '#e8d9dd', text: '#2a1a1f', textEmphasis: '#1a0d11', textMuted: '#664f58', textSubtle: '#776269',
      primary: '#951b38', primaryHover: '#7d152e', onPrimary: '#ffffff', secondary: '#7d5a24', accent: '#b02a4b',
    },
  },
  {
    id: 'amber',
    dark: {
      bg: '#120e08', surface: '#18130b', card: '#1f180e', cardHover: '#271e12', muted: '#2b2215', elevated: '#362b1b',
      border: '#3a2e1d', text: '#f3ece0', textEmphasis: '#ffffff', textMuted: '#bbac93', textSubtle: '#968a74',
      primary: '#e3a840', primaryHover: '#cc922c', onPrimary: '#1c1204', secondary: '#c98a55', accent: '#f2cc85',
    },
    light: {
      bg: '#f8f4ec', surface: '#ffffff', card: '#ffffff', cardHover: '#fcfaf5', muted: '#f1eadc', elevated: '#e7dcc6',
      border: '#e6dcc8', text: '#2a2116', textEmphasis: '#19130a', textMuted: '#625440', textSubtle: '#736752',
      primary: '#94590b', primaryHover: '#7a4808', onPrimary: '#ffffff', secondary: '#8a4e22', accent: '#b0700f',
    },
  },
  {
    id: 'arctic',
    dark: {
      bg: '#0a1216', surface: '#0d171c', card: '#121f25', cardHover: '#17272e', muted: '#1a2c34', elevated: '#22383f',
      border: '#21343b', text: '#e7f1f4', textEmphasis: '#ffffff', textMuted: '#9bb2ba', textSubtle: '#80969d',
      primary: '#62cbe2', primaryHover: '#46b5ce', onPrimary: '#04161b', secondary: '#bcd3dc', accent: '#a8e6f3',
    },
    light: {
      bg: '#f1f7f9', surface: '#ffffff', card: '#ffffff', cardHover: '#f6fafb', muted: '#e5f0f3', elevated: '#d6e6eb',
      border: '#d3e2e7', text: '#142227', textEmphasis: '#0a1519', textMuted: '#465f67', textSubtle: '#596e75',
      primary: '#0b6a81', primaryHover: '#08576a', onPrimary: '#ffffff', secondary: '#4c6670', accent: '#0f7f99',
    },
  },
  {
    id: 'rose',
    dark: {
      bg: '#140e11', surface: '#1a1216', card: '#21181d', cardHover: '#291e24', muted: '#2d2228', elevated: '#382b32',
      border: '#3a2c33', text: '#f3eaee', textEmphasis: '#ffffff', textMuted: '#bca6b0', textSubtle: '#9c8893',
      primary: '#dc9bb0', primaryHover: '#cb849b', onPrimary: '#23101a', secondary: '#bba5cb', accent: '#ecc3d0',
    },
    light: {
      bg: '#f9f4f6', surface: '#ffffff', card: '#ffffff', cardHover: '#fcf9fa', muted: '#f2e8ec', elevated: '#e9dbe1',
      border: '#e8dae0', text: '#2b1d23', textEmphasis: '#1b1015', textMuted: '#68535e', textSubtle: '#76636c',
      primary: '#9e4467', primaryHover: '#863756', onPrimary: '#ffffff', secondary: '#6e5684', accent: '#b4577b',
    },
  },
  {
    id: 'graphite',
    dark: {
      bg: '#111213', surface: '#151617', card: '#1b1c1e', cardHover: '#222325', muted: '#262729', elevated: '#2f3033',
      border: '#2e2f32', text: '#ebebec', textEmphasis: '#ffffff', textMuted: '#a7a8ab', textSubtle: '#8e8f92',
      primary: '#b7c0cc', primaryHover: '#a0aab8', onPrimary: '#111316', secondary: '#8fa3b8', accent: '#d5dbe3',
    },
    light: {
      bg: '#f3f3f4', surface: '#ffffff', card: '#ffffff', cardHover: '#f8f8f9', muted: '#ebebed', elevated: '#dedee1',
      border: '#dcdcdf', text: '#1f2023', textEmphasis: '#111214', textMuted: '#55575c', textSubtle: '#67696e',
      primary: '#3d4857', primaryHover: '#2f3844', onPrimary: '#ffffff', secondary: '#5b6b7d', accent: '#4f5d70',
    },
  },
] as const;

export const PALETTE_IDS: readonly PaletteId[] = PALETTES.map((p) => p.id);
export const DEFAULT_PALETTE: PaletteId = 'obsidian';

/** Maps the twelve accent ids used before Phase 2 onto the nine palettes. */
export const LEGACY_ACCENT_MAP: Record<string, PaletteId> = {
  gold: 'obsidian',
  champagne: 'amber',
  bronze: 'amber',
  sapphire: 'sapphire',
  indigo: 'sapphire',
  emerald: 'emerald',
  amethyst: 'amethyst',
  plum: 'amethyst',
  ruby: 'ruby',
  onyx: 'obsidian',
  platinum: 'arctic',
  slate: 'graphite',
};

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && (PALETTE_IDS as readonly string[]).includes(value);
}

export function resolvePaletteId(value: unknown): PaletteId {
  if (isPaletteId(value)) return value;
  if (typeof value === 'string' && LEGACY_ACCENT_MAP[value]) return LEGACY_ACCENT_MAP[value];
  return DEFAULT_PALETTE;
}

export function getPalette(id: unknown): PaletteDefinition {
  const resolved = resolvePaletteId(id);
  return PALETTES.find((p) => p.id === resolved) as PaletteDefinition;
}

/* ---------------------------------------------------------------- colour math */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function mix(a: string, b: string, weight: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const out = ca.map((v, i) => Math.round(v * (1 - weight) + cb[i] * weight));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------------------------------------------------------------- derivation */

export interface ThemeTokens {
  mode: AppearanceMode;
  palette: PaletteId;
  base: PaletteBase;
  semantic: { success: string; warning: string; danger: string; info: string };
  chart: string[];
  cssVars: Record<string, string>;
}

export function buildTokens(paletteId: unknown, mode: AppearanceMode): ThemeTokens {
  const palette = getPalette(paletteId);
  const base = palette[mode];
  const semantic = SEMANTIC[mode];
  const dark = mode === 'dark';
  const shadowInk = dark ? '#000000' : mix(base.text, '#000000', 0.4);

  const chart = [
    base.primary,
    base.secondary,
    semantic.info,
    semantic.success,
    base.accent,
    semantic.warning,
  ];

  const cssVars: Record<string, string> = {
    '--jp-theme': mode,
    // Canvas & surfaces
    '--jp-bg': base.bg,
    '--jp-surface': base.surface,
    '--jp-surface-card': base.card,
    '--jp-surface-card-hover': base.cardHover,
    '--jp-surface-muted': base.muted,
    '--jp-surface-elevated': base.elevated,
    '--jp-overlay-scrim': alpha(dark ? '#000000' : base.textEmphasis, dark ? 0.6 : 0.32),
    // Brand. `--jp-gold*` is the historical name of the brand accent token and
    // is used by most component styles, so it now follows the palette.
    '--jp-primary': base.primary,
    '--jp-primary-hover': base.primaryHover,
    '--jp-on-primary': base.onPrimary,
    '--jp-primary-glow': alpha(base.primary, dark ? 0.2 : 0.16),
    '--jp-focus': alpha(base.primary, dark ? 0.42 : 0.32),
    '--jp-brand-accent': base.accent,
    '--jp-secondary': base.secondary,
    '--jp-accent': base.accent,
    '--jp-gold': base.primary,
    '--jp-gold-light': base.accent,
    '--jp-gold-glow': alpha(base.primary, dark ? 0.18 : 0.14),
    '--jp-gold-gradient': `linear-gradient(135deg, ${base.primary} 0%, ${base.primaryHover} 100%)`,
    '--jp-gold-subtle': alpha(base.primary, dark ? 0.12 : 0.09),
    '--jp-gold-border': alpha(base.primary, dark ? 0.34 : 0.3),
    // Text
    '--jp-text': base.text,
    '--jp-text-emphasis': base.textEmphasis,
    '--jp-text-white': base.textEmphasis,
    '--jp-text-muted': base.textMuted,
    '--jp-text-subtle': base.textSubtle,
    '--jp-ink-100': base.textEmphasis,
    '--jp-ink-300': mix(base.text, base.textMuted, 0.4),
    '--jp-ink-500': base.textMuted,
    // Borders
    '--jp-border': base.border,
    '--jp-border-soft': mix(base.border, base.card, 0.45),
    '--jp-border-light': mix(base.border, base.textMuted, 0.28),
    // Shadows (tinted toward the palette ink in light mode)
    '--jp-shadow-sm': dark ? '0 1px 2px rgba(0, 0, 0, 0.35)' : `0 1px 2px ${alpha(shadowInk, 0.06)}, 0 1px 3px ${alpha(shadowInk, 0.04)}`,
    '--jp-shadow-md': dark ? '0 8px 24px rgba(0, 0, 0, 0.42)' : `0 6px 18px ${alpha(shadowInk, 0.09)}`,
    '--jp-shadow-control': dark ? '0 1px 2px rgba(0, 0, 0, 0.3)' : `0 1px 2px ${alpha(shadowInk, 0.06)}`,
    '--jp-shadow-surface': dark ? '0 10px 30px rgba(0, 0, 0, 0.45)' : `0 10px 28px ${alpha(shadowInk, 0.1)}`,
    // Semantic
    '--jp-success': semantic.success,
    '--jp-success-bg': alpha(semantic.success, dark ? 0.14 : 0.1),
    '--jp-success-border': alpha(semantic.success, 0.32),
    '--jp-warning': semantic.warning,
    '--jp-warning-bg': alpha(semantic.warning, dark ? 0.14 : 0.1),
    '--jp-warning-border': alpha(semantic.warning, 0.32),
    '--jp-danger': semantic.danger,
    '--jp-danger-bg': alpha(semantic.danger, dark ? 0.14 : 0.09),
    '--jp-danger-border': alpha(semantic.danger, 0.32),
    '--jp-info': semantic.info,
    '--jp-info-bg': alpha(semantic.info, dark ? 0.14 : 0.09),
    '--jp-info-border': alpha(semantic.info, 0.32),
    // Forms
    '--jp-input-bg': dark ? mix(base.surface, base.bg, 0.3) : base.surface,
    '--jp-input-border': dark ? mix(base.border, base.textSubtle, 0.25) : mix(base.border, base.textSubtle, 0.35),
    '--jp-input-text': base.textEmphasis,
    '--jp-input-placeholder': base.textSubtle,
    // Scrollbar
    '--jp-scrollbar-thumb': alpha(base.textMuted, dark ? 0.28 : 0.32),
    '--jp-scrollbar-hover': alpha(base.textMuted, dark ? 0.5 : 0.55),
  };
  chart.forEach((c, i) => {
    cssVars[`--jp-chart-${i + 1}`] = c;
  });

  return { mode, palette: palette.id, base, semantic, chart, cssVars };
}

/** Vuetify colour map for a palette/mode, so `color="primary"` etc. follow it. */
export function vuetifyColors(tokens: ThemeTokens): Record<string, string> {
  const { base, semantic } = tokens;
  return {
    background: base.bg,
    surface: base.card,
    'surface-bright': base.cardHover,
    'surface-variant': base.muted,
    'on-surface-variant': base.text,
    'on-background': base.text,
    'on-surface': base.text,
    primary: base.primary,
    'primary-darken-1': base.primaryHover,
    'on-primary': base.onPrimary,
    secondary: base.secondary,
    'secondary-darken-1': mix(base.secondary, '#000000', 0.15),
    'on-secondary': luminance(base.secondary) > 0.35 ? '#111111' : '#ffffff',
    accent: base.accent,
    success: semantic.success,
    warning: semantic.warning,
    error: semantic.danger,
    info: semantic.info,
    'on-success': tokens.mode === 'dark' ? '#06160e' : '#ffffff',
    'on-warning': tokens.mode === 'dark' ? '#1c1300' : '#ffffff',
    'on-error': tokens.mode === 'dark' ? '#1f0507' : '#ffffff',
    'on-info': tokens.mode === 'dark' ? '#03121c' : '#ffffff',
  };
}
