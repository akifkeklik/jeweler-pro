import { describe, expect, it } from 'vitest';
import { isActivePath, NAV_GROUPS, pageTitleKey, searchNavGroups, visibleNavGroups } from '@/services/navigation';

const translate = (key: string) => ({
  'nav.items.dashboard': 'Ana sayfa',
  'nav.items.sales': 'Satışlar',
  'nav.items.calculator': 'Hesap makinesi',
}[key] || key);

describe('application menu', () => {
  it('shows only the items the user is allowed to open', () => {
    const groups = visibleNavGroups(NAV_GROUPS, ['sales:read'], translate);
    const paths = groups.flatMap((g) => g.items.map((i) => i.path));
    expect(paths).toEqual(['/sales', '/calculator']);
    expect(groups.map((g) => g.label)).toEqual(['nav.groups.operations', 'nav.groups.analysis']);
  });

  it('drops a group with no visible items', () => {
    const fake = [{ key: 'admin', items: [{ titleKey: 'x', icon: 'i', path: '/x', permission: 'admin:all' }] }];
    expect(visibleNavGroups(fake, [], translate)).toEqual([]);
  });

  it('searches titles case-insensitively in the active locale', () => {
    const groups = visibleNavGroups(NAV_GROUPS, ['sales:read', 'dashboard:read'], translate);
    expect(searchNavGroups(groups, 'SATIŞ').flatMap((g) => g.items.map((i) => i.path))).toEqual(['/sales']);
    expect(searchNavGroups(groups, '')).toBe(groups);
    expect(searchNavGroups(groups, 'zzz')).toEqual([]);
  });

  it('marks a page and its sub-pages active, not prefix look-alikes', () => {
    expect(isActivePath('/sales', '/sales')).toBe(true);
    expect(isActivePath('/sales/42', '/sales')).toBe(true);
    expect(isActivePath('/salesman', '/sales')).toBe(false);
  });

  it('titles the top bar from the route', () => {
    expect(pageTitleKey('/finance')).toBe('nav.items.finance');
    expect(pageTitleKey('/unknown')).toBe('shell.workspace');
  });
});
