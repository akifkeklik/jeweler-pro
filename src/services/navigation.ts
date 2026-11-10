/**
 * The application menu: groups, items, the permission each item needs and
 * the page titles shown in the top bar. Filtering is pure so the menu can
 * follow the signed-in user's permissions and the sidebar search.
 */
import { normalizeSearch } from '@/i18n';

export interface NavItem {
  titleKey: string;
  icon: string;
  path: string;
  permission?: string;
  badgeKey?: string;
}
export interface NavGroup { key: string; items: NavItem[] }
export interface LocalizedNavGroup { key: string; label: string; items: Array<NavItem & { title: string }> }

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: 'operations',
    items: [
      { titleKey: 'nav.items.dashboard', icon: 'mdi-view-dashboard-outline', path: '/dashboard', permission: 'dashboard:read' },
      { titleKey: 'nav.items.prices', icon: 'mdi-chart-line', path: '/prices', badgeKey: 'nav.live', permission: 'prices:read' },
      { titleKey: 'nav.items.sales', icon: 'mdi-cart-outline', path: '/sales', permission: 'sales:read' },
      { titleKey: 'nav.items.products', icon: 'mdi-diamond-stone', path: '/products', permission: 'catalog:read' },
      { titleKey: 'nav.items.customers', icon: 'mdi-account-group-outline', path: '/customers', permission: 'customers:read' },
    ],
  },
  {
    key: 'analysis',
    items: [
      { titleKey: 'nav.items.reports', icon: 'mdi-finance', path: '/reports', permission: 'reports:read' },
      { titleKey: 'nav.items.finance', icon: 'mdi-bank-outline', path: '/finance', permission: 'purchases:read' },
      { titleKey: 'nav.items.transfers', icon: 'mdi-truck-fast-outline', path: '/transfers', permission: 'transfers:read' },
      { titleKey: 'nav.items.pos', icon: 'mdi-credit-card-check-outline', path: '/pos', permission: 'pos:read' },
      { titleKey: 'nav.items.calculator', icon: 'mdi-calculator-variant-outline', path: '/calculator' },
    ],
  },
];

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'nav.items.dashboard',
  '/prices': 'nav.items.prices',
  '/sales': 'nav.items.sales',
  '/products': 'nav.items.products',
  '/customers': 'nav.items.customers',
  '/reports': 'nav.items.reports',
  '/finance': 'nav.items.finance',
  '/transfers': 'nav.items.transfers',
  '/pos': 'nav.items.pos',
  '/calculator': 'nav.items.calculator',
  '/settings': 'nav.items.settings',
};

/** Translation key of the top-bar title for a route path. */
export function pageTitleKey(path: string): string {
  return PAGE_TITLES[path] || 'shell.workspace';
}

/** Items the user may open, translated; groups without items are dropped. */
export function visibleNavGroups(
  groups: readonly NavGroup[],
  permissions: readonly string[],
  translate: (key: string) => string,
): LocalizedNavGroup[] {
  return groups
    .map((group) => ({
      key: group.key,
      label: translate(`nav.groups.${group.key}`),
      items: group.items
        .filter((item) => !item.permission || permissions.includes(item.permission))
        .map((item) => ({ ...item, title: translate(item.titleKey) })),
    }))
    .filter((group) => group.items.length > 0);
}

/** Sidebar search: locale-aware, case-insensitive match on the item title. */
export function searchNavGroups(groups: LocalizedNavGroup[], search: string): LocalizedNavGroup[] {
  const query = normalizeSearch(search);
  if (!query) return groups;
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => normalizeSearch(item.title).includes(query)) }))
    .filter((group) => group.items.length > 0);
}

/** Whether a route path is the item's page or one of its sub-pages. */
export function isActivePath(current: string, path: string): boolean {
  return current === path || current.startsWith(`${path}/`);
}
