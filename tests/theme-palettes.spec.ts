import { describe, expect, it } from 'vitest';
import {
  PALETTES,
  PALETTE_IDS,
  buildTokens,
  contrastRatio,
  hexToRgb,
  resolvePaletteId,
  vuetifyColors,
  type AppearanceMode,
} from '@/theme/palettes';

const MODES: AppearanceMode[] = ['light', 'dark'];

function hue(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return -1; // achromatic
  const d = max - min;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe('palette registry', () => {
  it('registers exactly the nine named palettes', () => {
    expect(PALETTE_IDS).toEqual(['obsidian', 'sapphire', 'emerald', 'amethyst', 'ruby', 'amber', 'arctic', 'rose', 'graphite']);
    expect(new Set(PALETTE_IDS).size).toBe(9);
  });

  it('defines both a light and a dark variant for every palette', () => {
    for (const p of PALETTES) {
      for (const mode of MODES) {
        const tokens = buildTokens(p.id, mode);
        expect(tokens.mode).toBe(mode);
        expect(tokens.cssVars['--jp-bg']).toMatch(/^#[0-9a-f]{6}$/i);
        expect(tokens.chart).toHaveLength(6);
      }
      // light and dark are genuinely different appearances
      expect(p.light.bg).not.toBe(p.dark.bg);
      expect(p.light.text).not.toBe(p.dark.text);
    }
  });

  it('gives every palette a distinct primary identity (not nine variants of one hue)', () => {
    for (const mode of MODES) {
      const primaries = PALETTES.map((p) => p[mode].primary.toLowerCase());
      expect(new Set(primaries).size).toBe(9);
      const backgrounds = PALETTES.map((p) => p[mode].bg.toLowerCase());
      expect(new Set(backgrounds).size).toBe(9);
    }
    const chromatic = PALETTES.filter((p) => p.id !== 'graphite').map((p) => hue(p.dark.primary));
    // the eight chromatic palettes must spread over the colour wheel
    const sorted = [...chromatic].sort((a, b) => a - b);
    const spread = sorted[sorted.length - 1] - sorted[0];
    expect(spread).toBeGreaterThan(250);
  });

  it('meets WCAG AA contrast for text, brand and semantic colours in every palette and mode', () => {
    const failures: string[] = [];
    const check = (label: string, fg: string, bg: string, min: number) => {
      const ratio = contrastRatio(fg, bg);
      if (ratio < min) failures.push(`${label}: ${ratio.toFixed(2)} < ${min}`);
    };
    for (const p of PALETTES) {
      for (const mode of MODES) {
        const t = buildTokens(p.id, mode);
        const b = t.base;
        const id = `${p.id}/${mode}`;
        for (const surface of ['bg', 'card', 'muted'] as const) {
          check(`${id} text on ${surface}`, b.text, b[surface], 4.5);
          check(`${id} textMuted on ${surface}`, b.textMuted, b[surface], 4.5);
        }
        check(`${id} textSubtle on card`, b.textSubtle, b.card, 3);
        check(`${id} primary on card`, b.primary, b.card, 4.5);
        check(`${id} primary on bg`, b.primary, b.bg, 4.5);
        check(`${id} onPrimary on primary`, b.onPrimary, b.primary, 4.5);
        check(`${id} onPrimary on primaryHover`, b.onPrimary, b.primaryHover, 4.5);
        for (const [name, color] of Object.entries(t.semantic)) {
          check(`${id} ${name} on card`, color, b.card, 4.5);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('maps legacy accent ids to the new palettes', () => {
    expect(resolvePaletteId('gold')).toBe('obsidian');
    expect(resolvePaletteId('indigo')).toBe('sapphire');
    expect(resolvePaletteId('plum')).toBe('amethyst');
    expect(resolvePaletteId('platinum')).toBe('arctic');
    expect(resolvePaletteId('slate')).toBe('graphite');
    expect(resolvePaletteId('bronze')).toBe('amber');
    expect(resolvePaletteId('nonsense')).toBe('obsidian');
    expect(resolvePaletteId('rose')).toBe('rose');
  });

  it('produces a complete Vuetify colour map from the same tokens', () => {
    const colors = vuetifyColors(buildTokens('emerald', 'light'));
    for (const key of ['background', 'surface', 'primary', 'on-primary', 'secondary', 'success', 'warning', 'error', 'info']) {
      expect(colors[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(colors.primary).toBe(PALETTES.find((p) => p.id === 'emerald')!.light.primary);
  });
});
