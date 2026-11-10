import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import App from '@/App.vue';
import SettingsPage from '@/pages/SettingsPage.vue';
import { loadAllLocales, setI18nPreferences, t } from '@/i18n';

beforeAll(() => loadAllLocales());
import { confirmState, settleConfirm } from '@/services/confirm';

vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/services/marketPriceService', () => ({ default: { loadPrices: vi.fn(), getState: () => ({}) } }));

const computed = (App as any).computed;
const methods = (App as any).methods;

function shell(sidebarMode: string, extra: Record<string, unknown> = {}) {
  const dispatch = vi.fn();
  return {
    settings: { sidebarMode },
    isMobile: false,
    hovering: false,
    drawer: true,
    $store: { dispatch },
    $t: (k: string) => k,
    ...extra,
  } as any;
}

describe('sidebar behaviour', () => {
  it('pinned mode is always expanded and reserves full width (no rail)', () => {
    const ctx = shell('pinned');
    expect(computed.railActive.call(ctx)).toBe(false);
    expect(computed.expanded.call(ctx)).toBe(true);
  });

  it('hover mode keeps a rail (content never shifts) and expands only on hover intent', () => {
    const ctx = shell('hover');
    expect(computed.railActive.call(ctx)).toBe(true);
    expect(computed.expanded.call(ctx)).toBe(false);
    methods.onRailHover.call(ctx, false); // Vuetify emits rail=false after the open delay
    expect(ctx.hovering).toBe(true);
    expect(computed.expanded.call(ctx)).toBe(true);
    methods.onRailHover.call(ctx, true);
    expect(computed.expanded.call(ctx)).toBe(false);
  });

  it('collapsed mode never expands on hover', () => {
    const ctx = shell('collapsed', { hovering: true });
    expect(computed.railActive.call(ctx)).toBe(true);
    expect(computed.expanded.call(ctx)).toBe(false);
  });

  it('the toggle persists pinned ↔ collapsed and Ctrl+B triggers it', () => {
    const ctx = shell('pinned');
    ctx.toggleSidebarMode = () => methods.toggleSidebarMode.call(ctx);
    methods.toggleSidebarMode.call(ctx);
    expect(ctx.$store.dispatch).toHaveBeenCalledWith('settings/setPreference', { key: 'sidebarMode', value: 'collapsed' });

    const ctx2 = shell('collapsed');
    ctx2.toggleSidebarMode = vi.fn();
    const event = { ctrlKey: true, key: 'b', preventDefault: vi.fn(), target: { tagName: 'DIV' } };
    methods.handleGlobalKeydown.call(ctx2, event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(ctx2.toggleSidebarMode).toHaveBeenCalled();
  });

  it('on small screens the drawer becomes a temporary overlay that opens and closes', () => {
    const ctx = shell('pinned', { isMobile: false, mobileQuery: { matches: true } });
    methods.updateMobileState.call(ctx);
    expect(ctx.isMobile).toBe(true);
    expect(ctx.drawer).toBe(false);
    expect(computed.railActive.call(ctx)).toBe(false);
    methods.toggleSidebarMode.call(ctx);
    expect(ctx.drawer).toBe(true);
    expect(ctx.$store.dispatch).not.toHaveBeenCalled();
    methods.closeMobileDrawer.call(ctx);
    expect(ctx.drawer).toBe(false);
  });

  it('uses the shared motion tokens and a valid reduced-motion rule', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../src/styles/design-system.css'), 'utf8');
    const app = fs.readFileSync(path.resolve(__dirname, '../src/App.vue'), 'utf8');
    expect(css).toMatch(/--jp-motion-sidebar:\s*240ms/);
    expect(css).toMatch(/html\.jp-reduced-motion\s*\{[^}]*--jp-motion-sidebar:\s*0ms/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{/);
    // The broken selector-list + at-rule combination must not come back.
    expect(css).not.toMatch(/\*,\s*@media/);
    expect(app).toMatch(/transition-duration: var\(--jp-motion-sidebar\)/);
    // Sidebar labels fade with opacity/transform rather than being removed.
    expect(app).toMatch(/\.is-collapsed \.jp-fade-label\s*\{[^}]*opacity: 0/);
  });
});

describe('settings preferences apply instantly with compact feedback', () => {
  const sm = (SettingsPage as any).methods;

  function page(settings: Record<string, unknown>) {
    const dispatched: Array<[string, unknown]> = [];
    const store = {
      dispatch: vi.fn((type: string, payload: any) => {
        dispatched.push([type, payload]);
        if (type === 'settings/setPreference') {
          settings[payload.key] = payload.value;
          if (payload.key === 'language') setI18nPreferences({ language: payload.value });
        }
      }),
    };
    return { ctx: { settings, $store: store } as any, dispatched };
  }

  beforeEach(() => setI18nPreferences({ language: 'tr' }));

  it('changes the palette and confirms with a small toast', () => {
    const { ctx, dispatched } = page({ palette: 'obsidian' });
    sm.setPalette.call(ctx, 'emerald');
    expect(dispatched[0]).toEqual(['settings/setPreference', { key: 'palette', value: 'emerald' }]);
    expect(dispatched[1]).toEqual(['notifications/showSuccess', 'Tema güncellendi: Zümrüt']);
    // selecting the active palette again does nothing
    sm.setPalette.call(ctx, 'emerald');
    expect(dispatched).toHaveLength(2);
  });

  it('confirms a language change in the newly selected language', async () => {
    const { ctx, dispatched } = page({ language: 'tr' });
    await sm.setLanguage.call(ctx, 'de');
    expect(dispatched[1]).toEqual(['notifications/showSuccess', 'Sprache geändert']);
  });

  it('toggles reduced motion with a matching message', () => {
    const { ctx, dispatched } = page({ reducedMotion: false });
    sm.setReducedMotion.call(ctx, true);
    expect(dispatched[0]).toEqual(['settings/setPreference', { key: 'reducedMotion', value: true }]);
    expect(dispatched[1][1]).toBe(t('settings.toasts.motionOn'));
  });

  it('changes appearance mode without a dialog', () => {
    const { ctx, dispatched } = page({ themeMode: 'dark' });
    sm.setMode.call(ctx, 'system');
    expect(dispatched.map((d) => d[0])).toEqual(['settings/setPreference', 'notifications/showSuccess']);
    expect(confirmState.open).toBe(false);
  });

  it('asks before restoring defaults (it touches several preferences)', async () => {
    const { ctx, dispatched } = page({});
    const pending = sm.resetToDefaults.call(ctx);
    expect(confirmState.open).toBe(true);
    settleConfirm(true);
    await pending;
    expect(dispatched.map((d) => d[0])).toEqual(['settings/reset', 'notifications/showSuccess']);
  });
});
