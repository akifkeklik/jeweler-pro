<template>
  <v-app class="jeweler-app" @keydown="handleGlobalKeydown">
    <a v-if="showAppShell" href="#jp-main" class="jp-skip-link">{{ $t('shell.skipToContent') }}</a>

    <!--
      Sidebar. Three behaviours (Settings → Appearance):
        pinned    full width; toggling animates the drawer and content together
        hover     64px rail that overlays to full width after a short hover
                  intent — the content area never moves on hover
        collapsed 64px rail with tooltips
      Labels stay mounted and fade, so expanding never flickers or re-lays out.
    -->
    <v-navigation-drawer
      v-if="showAppShell"
      v-model="drawer"
      :permanent="!isMobile"
      :temporary="isMobile"
      :rail="railActive"
      :expand-on-hover="!isMobile && settings.sidebarMode === 'hover'"
      :open-delay="120"
      :close-delay="160"
      :rail-width="64"
      :width="248"
      :aria-label="$t('nav.title')"
      class="jeweler-sidebar"
      :class="{ 'is-collapsed': !expanded, 'is-expanded': expanded }"
      data-testid="sidebar"
      :data-expanded="expanded ? 'true' : 'false'"
      @update:rail="onRailHover"
    >
      <div
        class="brand-lockup"
        role="link"
        tabindex="0"
        :aria-label="$t('nav.items.dashboard')"
        @click="$router.push('/dashboard')"
        @keydown.enter="$router.push('/dashboard')"
      >
        <div class="brand-mark">
          <v-icon size="18">mdi-diamond-stone</v-icon>
        </div>
        <div class="brand-text-wrap jp-fade-label">
          <div class="brand-name">JEWELER <span>PRO</span></div>
          <div class="brand-caption">{{ $t('shell.caption') }}</div>
        </div>
      </div>

      <div class="sidebar-search jp-fade-label" :aria-hidden="!expanded">
        <v-icon size="15">mdi-magnify</v-icon>
        <input
          ref="navSearchInput"
          v-model.trim="navSearch"
          type="search"
          :tabindex="expanded ? 0 : -1"
          :placeholder="$t('nav.search')"
          :aria-label="$t('nav.search')"
        />
        <kbd v-if="!navSearch">/</kbd>
        <button v-else type="button" class="clear-search-btn" :aria-label="$t('common.clear')" @click="navSearch = ''">
          <v-icon size="12">mdi-close</v-icon>
        </button>
      </div>

      <nav class="nav-scroll-area">
        <div v-for="group in filteredNavGroups" :key="group.key" class="nav-group">
          <div class="nav-label">
            <span class="jp-fade-label">{{ group.label }}</span>
          </div>
          <div class="nav-list">
            <v-tooltip
              v-for="item in group.items"
              :key="item.path"
              :text="item.title"
              location="end"
              :disabled="expanded"
              :open-delay="300"
            >
              <template #activator="{ props: tip }">
                <router-link
                  v-bind="tip"
                  :to="item.path"
                  class="nav-link-btn"
                  :class="{ 'nav-link-active': isRouteActive(item.path) }"
                  :aria-current="isRouteActive(item.path) ? 'page' : undefined"
                  :aria-label="item.title"
                  @click="closeMobileDrawer"
                >
                  <span class="nav-icon-box"><v-icon size="18">{{ item.icon }}</v-icon></span>
                  <span class="nav-item-text jp-fade-label">{{ item.title }}</span>
                  <span v-if="item.badgeKey" class="nav-badge jp-fade-label">{{ $t(item.badgeKey) }}</span>
                </router-link>
              </template>
            </v-tooltip>
          </div>
        </div>
        <p v-if="navSearch && !filteredNavGroups.length" class="nav-empty jp-fade-label">{{ $t('nav.noResults') }}</p>
      </nav>

      <div class="sidebar-bottom">
        <v-tooltip :text="$t('nav.items.settings')" location="end" :disabled="expanded" :open-delay="300">
          <template #activator="{ props: tip }">
            <router-link
              v-bind="tip"
              to="/settings"
              class="nav-link-btn"
              :class="{ 'nav-link-active': isRouteActive('/settings') }"
              :aria-current="isRouteActive('/settings') ? 'page' : undefined"
              :aria-label="$t('nav.items.settings')"
              @click="closeMobileDrawer"
            >
              <span class="nav-icon-box"><v-icon size="18">mdi-cog-outline</v-icon></span>
              <span class="nav-item-text jp-fade-label">{{ $t('nav.items.settings') }}</span>
            </router-link>
          </template>
        </v-tooltip>

        <v-tooltip v-if="!isMobile" :text="sidebarToggleLabel + ' (Ctrl+B)'" location="end" :disabled="expanded" :open-delay="300">
          <template #activator="{ props: tip }">
            <button
              v-bind="tip"
              type="button"
              class="sidebar-collapse-toggle-btn"
              :aria-label="sidebarToggleLabel"
              :aria-expanded="settings.sidebarMode === 'pinned' ? 'true' : 'false'"
              data-testid="sidebar-toggle"
              @click="toggleSidebarMode"
            >
              <span class="nav-icon-box toggle-icon" :class="{ flipped: settings.sidebarMode !== 'pinned' }">
                <v-icon size="16">mdi-chevron-double-left</v-icon>
              </span>
              <span class="toggle-text jp-fade-label">{{ sidebarToggleLabel }}</span>
              <kbd class="toggle-kbd jp-fade-label">Ctrl+B</kbd>
            </button>
          </template>
        </v-tooltip>

        <div class="profile-row">
          <div class="profile-avatar" :title="userName">{{ userInitials }}</div>
          <div class="profile-copy jp-fade-label">
            <strong>{{ userName }}</strong>
            <span><span class="status-dot" aria-hidden="true"></span>{{ userRoleLabel }}</span>
          </div>
          <v-btn
            icon
            size="small"
            variant="text"
            class="profile-logout jp-fade-label"
            :tabindex="expanded ? 0 : -1"
            :title="$t('shell.logout')"
            :aria-label="$t('shell.logout')"
            @click="logout"
          >
            <v-icon size="16">mdi-logout</v-icon>
          </v-btn>
        </div>
      </div>
    </v-navigation-drawer>

    <v-app-bar v-if="showAppShell" flat height="52" class="jeweler-topbar">
      <v-btn
        icon
        size="small"
        variant="text"
        class="topbar-toggle-btn mr-1"
        :title="isMobile ? (drawer ? $t('nav.closeMenu') : $t('nav.openMenu')) : sidebarToggleLabel"
        :aria-label="isMobile ? (drawer ? $t('nav.closeMenu') : $t('nav.openMenu')) : sidebarToggleLabel"
        @click="toggleSidebarMode"
      >
        <v-icon size="20">{{ isMobile && drawer ? 'mdi-close' : 'mdi-menu' }}</v-icon>
      </v-btn>

      <div class="topbar-context">
        <div class="topbar-eyebrow">JEWELER PRO</div>
        <div class="topbar-title">{{ currentPageTitle }}</div>
      </div>

      <v-spacer></v-spacer>

      <div class="topbar-date d-none d-md-flex">
        <v-icon size="14" class="mr-1">mdi-calendar-blank-outline</v-icon>
        <span>{{ todayLabel }}</span>
      </div>

      <v-btn
        icon
        size="small"
        variant="text"
        class="topbar-icon"
        :title="isDark ? $t('shell.switchToLight') : $t('shell.switchToDark')"
        :aria-label="isDark ? $t('shell.switchToLight') : $t('shell.switchToDark')"
        data-testid="topbar-theme-toggle"
        @click="toggleDarkMode"
      >
        <v-icon size="18">{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>

      <v-btn
        icon
        size="small"
        variant="text"
        class="topbar-icon"
        :title="$t('nav.items.settings')"
        :aria-label="$t('nav.items.settings')"
        :class="{ 'topbar-icon-active': $route.path === '/settings' }"
        @click="$router.push('/settings')"
      >
        <v-icon size="18">mdi-cog-outline</v-icon>
      </v-btn>

      <v-btn
        v-if="can('sales:write')"
        class="topbar-create d-none d-sm-flex"
        size="small"
        @click="$router.push({ path: '/sales', query: { newSale: '1' } })"
      >
        <v-icon start size="16">mdi-plus</v-icon>
        {{ $t('shell.newSale') }}
      </v-btn>
    </v-app-bar>

    <v-main v-if="showAppShell" id="jp-main" class="jeweler-main" tabindex="-1">
      <v-container fluid class="page-container">
        <router-view v-slot="{ Component, route }">
          <transition name="jp-page" mode="out-in">
            <component :is="Component" :key="route.path" />
          </transition>
        </router-view>
      </v-container>
    </v-main>
    <v-main v-else class="login-main">
      <router-view />
    </v-main>

    <ToastHost />
    <ConfirmHost />
  </v-app>
</template>

<script>
import { useTheme } from 'vuetify';
import { authState, hasPermission, logout as authLogout } from '@/services/authSession';
import { applySettings } from '@/services/settings';
import { bindVuetifyTheme, themeState, watchSystemAppearance } from '@/theme';
import { date as formatDate, normalizeSearch } from '@/i18n';
import ToastHost from '@/components/ToastHost.vue';
import ConfirmHost from '@/components/ConfirmHost.vue';

const MOBILE_QUERY = '(max-width: 959px)';

const PAGE_TITLES = {
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

export default {
  name: 'App',
  components: { ToastHost, ConfirmHost },
  setup() {
    let vuetifyTheme = null;
    try {
      vuetifyTheme = useTheme();
    } catch {
      // outside a Vuetify context (unit tests)
    }
    return { vuetifyTheme };
  },
  data() {
    return {
      drawer: true,
      navSearch: '',
      isMobile: false,
      hovering: false,
      now: new Date(),
      navGroups: [
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
      ],
    };
  },
  computed: {
    settings() {
      return this.$store.state.settings;
    },
    showAppShell() {
      return !this.$route.meta?.public;
    },
    isDark() {
      return themeState.mode === 'dark';
    },
    railActive() {
      return !this.isMobile && this.settings.sidebarMode !== 'pinned';
    },
    expanded() {
      if (this.isMobile) return true;
      if (this.settings.sidebarMode === 'pinned') return true;
      return this.settings.sidebarMode === 'hover' && this.hovering;
    },
    sidebarToggleLabel() {
      return this.settings.sidebarMode === 'pinned' ? this.$t('nav.collapse') : this.$t('nav.expand');
    },
    localizedNavGroups() {
      // Depends on the reactive session, so the menu follows login/role changes.
      const permissions = authState.user?.permissions || [];
      return this.navGroups
        .map((group) => ({
          key: group.key,
          label: this.$t(`nav.groups.${group.key}`),
          items: group.items
            .filter((item) => !item.permission || permissions.includes(item.permission))
            .map((item) => ({ ...item, title: this.$t(item.titleKey) })),
        }))
        .filter((group) => group.items.length > 0);
    },
    filteredNavGroups() {
      const query = normalizeSearch(this.navSearch);
      if (!query) return this.localizedNavGroups;
      return this.localizedNavGroups
        .map((group) => ({ ...group, items: group.items.filter((item) => normalizeSearch(item.title).includes(query)) }))
        .filter((group) => group.items.length > 0);
    },
    user() {
      return authState.user || {};
    },
    userName() {
      return this.user.name || this.user.email || '';
    },
    userRoleLabel() {
      const role = this.user.role;
      return role ? this.$t(`roles.${role}`) : '';
    },
    userInitials() {
      return (
        this.userName
          .split(/[\s@._-]+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part.charAt(0).toLocaleUpperCase())
          .join('') || 'JP'
      );
    },
    currentPageTitle() {
      return this.$t(PAGE_TITLES[this.$route.path] || 'shell.workspace');
    },
    todayLabel() {
      // `$i18n` dependency keeps the label in the active language.
      void this.$i18n.language;
      return formatDate(this.now, 'full');
    },
  },
  mounted() {
    bindVuetifyTheme(this.vuetifyTheme);
    applySettings(this.settings);
    this.mobileQuery = window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;
    this.updateMobileState();
    this.mobileQuery?.addEventListener?.('change', this.updateMobileState);
    this.stopSystemWatch = watchSystemAppearance(() => applySettings(this.settings));
    // Keep the date label correct across midnight without a per-second timer.
    this.clock = setInterval(() => {
      this.now = new Date();
    }, 60000);
  },
  beforeUnmount() {
    this.mobileQuery?.removeEventListener?.('change', this.updateMobileState);
    if (this.stopSystemWatch) this.stopSystemWatch();
    clearInterval(this.clock);
  },
  methods: {
    can(permission) {
      return hasPermission(permission);
    },
    isRouteActive(path) {
      return this.$route.path === path || this.$route.path.startsWith(`${path}/`);
    },
    onRailHover(rail) {
      // Emitted by Vuetify's expand-on-hover after the open/close delay.
      this.hovering = !rail;
    },
    toggleDarkMode() {
      this.$store.dispatch('settings/setPreference', { key: 'themeMode', value: this.isDark ? 'light' : 'dark' });
    },
    toggleSidebarMode() {
      if (this.isMobile) {
        this.drawer = !this.drawer;
        return;
      }
      const next = this.settings.sidebarMode === 'pinned' ? 'collapsed' : 'pinned';
      this.hovering = false;
      this.$store.dispatch('settings/setPreference', { key: 'sidebarMode', value: next });
    },
    handleGlobalKeydown(e) {
      const target = e.target || {};
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        this.toggleSidebarMode();
      } else if (e.key === '/' && !typing && this.showAppShell) {
        e.preventDefault();
        if (this.isMobile) this.drawer = true;
        else if (this.settings.sidebarMode !== 'pinned') this.hovering = true;
        this.$nextTick(() => this.$refs.navSearchInput?.focus());
      } else if (e.key === 'Escape' && this.isMobile) {
        this.drawer = false;
      }
    },
    closeMobileDrawer() {
      if (this.isMobile) this.drawer = false;
    },
    updateMobileState() {
      const mobile = Boolean(this.mobileQuery?.matches);
      if (mobile !== this.isMobile) this.drawer = !mobile;
      this.isMobile = mobile;
      if (!mobile) this.drawer = true;
    },
    async logout() {
      await authLogout();
      this.$router.replace('/login');
    },
  },
};
</script>

<style scoped>
/* ==========================================================================
   SHELL — sidebar, topbar. Motion uses the shared tokens from
   design-system.css; only transform/opacity animate inside the drawer.
   ========================================================================== */

.jp-skip-link {
  position: fixed;
  inset-inline-start: 12px;
  top: -48px;
  z-index: 4000;
  padding: 8px 12px;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-primary);
  color: var(--jp-on-primary);
  font-weight: 700;
  font-size: 0.8rem;
  text-decoration: none;
  transition: top var(--jp-motion-fast) var(--jp-ease-standard);
}
.jp-skip-link:focus {
  top: 8px;
}

.jeweler-sidebar {
  background: var(--jp-surface) !important;
  border-inline-end: 1px solid var(--jp-border) !important;
  color: var(--jp-text-muted) !important;
  transition-duration: var(--jp-motion-sidebar) !important;
  transition-timing-function: var(--jp-ease-standard) !important;
  will-change: width;
}

.jeweler-sidebar.v-navigation-drawer--is-hovering {
  box-shadow: var(--jp-shadow-surface) !important;
}

:deep(.v-navigation-drawer__content) {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding: 0 8px 8px;
}

/* Labels: fade (and slide 4px) instead of being removed from the DOM. */
.jp-fade-label {
  transition: opacity var(--jp-motion-fast) var(--jp-ease-standard) 60ms, transform var(--jp-motion-fast) var(--jp-ease-standard) 60ms;
}
.is-collapsed .jp-fade-label {
  opacity: 0;
  transform: translateX(-4px);
  pointer-events: none;
  transition-delay: 0ms;
}
[dir='rtl'] .is-collapsed .jp-fade-label {
  transform: translateX(4px);
}

/* Brand */
.brand-lockup {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  min-height: 52px;
  padding: 0 7px;
  margin: 0 -8px;
  padding-inline: 15px;
  border-bottom: 1px solid var(--jp-border);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
}
.brand-lockup:focus-visible {
  outline: 2px solid var(--jp-primary);
  outline-offset: -2px;
}
.brand-mark {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-gold-gradient);
  color: var(--jp-on-primary);
  flex-shrink: 0;
}
.brand-text-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.brand-name {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.8px;
  color: var(--jp-text-emphasis);
  line-height: 1.1;
}
.brand-name span {
  color: var(--jp-primary);
}
.brand-caption {
  font-size: 9px;
  font-weight: 700;
  color: var(--jp-text-subtle);
  letter-spacing: 1px;
  margin-top: 2px;
  text-transform: uppercase;
}

/* Search */
.sidebar-search {
  height: 32px;
  margin: 8px 0;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--jp-text-muted);
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  font-size: 11px;
  flex-shrink: 0;
  min-width: 0;
  white-space: nowrap;
}
.sidebar-search input {
  min-width: 0;
  width: 100%;
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  color: var(--jp-text) !important;
  background: transparent !important;
  font-size: 12px;
  padding: 0 !important;
}
.sidebar-search kbd,
.toggle-kbd {
  margin-inline-start: auto;
  padding: 1px 4px;
  border: 1px solid var(--jp-border);
  border-radius: 3px;
  color: var(--jp-text-subtle);
  font-size: 9px;
  background: var(--jp-surface-card);
  font-family: 'JetBrains Mono', monospace;
}
.clear-search-btn {
  background: transparent;
  border: 0;
  color: var(--jp-text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
}

/* Navigation */
.nav-scroll-area {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  margin-bottom: 6px;
}
.is-collapsed .nav-scroll-area {
  scrollbar-width: none;
}
.nav-group {
  margin-bottom: 8px;
}
.nav-label {
  position: relative;
  height: 22px;
  padding: 4px 10px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--jp-text-subtle);
  white-space: nowrap;
  overflow: hidden;
}
/* In the rail the group heading becomes a hairline divider. */
.nav-label::after {
  content: '';
  position: absolute;
  inset-inline: 14px;
  top: 50%;
  height: 1px;
  background: var(--jp-border);
  opacity: 0;
  transition: opacity var(--jp-motion-fast) var(--jp-ease-standard);
}
.is-collapsed .nav-label::after {
  opacity: 1;
}
.nav-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-empty {
  padding: 8px 10px;
  font-size: 11px;
  color: var(--jp-text-subtle);
  white-space: nowrap;
}

/*
 * Icon position is identical in rail and full width (8px drawer padding +
 * 6px link padding + 28px box → icon centred on x = 28 of a 64px rail... and
 * stays put when expanding), so nothing jumps horizontally.
 */
.nav-link-btn {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 36px;
  padding-inline: 6px;
  border-radius: var(--jp-radius-sm);
  color: var(--jp-text-muted);
  text-decoration: none;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  transition: background-color var(--jp-motion-fast) var(--jp-ease-standard), color var(--jp-motion-fast) var(--jp-ease-standard);
  user-select: none;
}
.nav-link-btn:hover {
  background: var(--jp-surface-card-hover);
  color: var(--jp-text-emphasis);
}
.nav-link-btn:focus-visible {
  outline: 2px solid var(--jp-primary);
  outline-offset: -2px;
}
.nav-icon-box {
  width: 36px;
  height: 28px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: var(--jp-text-subtle);
  transition: color var(--jp-motion-fast) var(--jp-ease-standard);
}
.nav-link-btn:hover .nav-icon-box {
  color: var(--jp-text-emphasis);
}
.nav-link-active {
  background: var(--jp-gold-subtle) !important;
  color: var(--jp-text-emphasis) !important;
  font-weight: 650;
}
.nav-link-active::before {
  content: '';
  position: absolute;
  inset-inline-start: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 3px;
  background: var(--jp-primary);
}
.nav-link-active .nav-icon-box {
  color: var(--jp-primary) !important;
}
.nav-item-text {
  margin-inline-start: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.nav-badge {
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.4px;
  color: var(--jp-primary);
  background: var(--jp-gold-subtle);
  border: 1px solid var(--jp-gold-border);
  border-radius: 4px;
  padding: 1px 4px;
  text-transform: uppercase;
}

/* Bottom */
.sidebar-bottom {
  margin-top: auto;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--jp-border);
  padding-top: 8px;
}
.sidebar-collapse-toggle-btn {
  display: flex;
  align-items: center;
  height: 32px;
  padding-inline: 6px;
  background: transparent;
  border: 0;
  border-radius: var(--jp-radius-sm);
  color: var(--jp-text-muted);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  transition: background-color var(--jp-motion-fast) var(--jp-ease-standard), color var(--jp-motion-fast) var(--jp-ease-standard);
}
.sidebar-collapse-toggle-btn:hover {
  background: var(--jp-surface-card-hover);
  color: var(--jp-text-emphasis);
}
.sidebar-collapse-toggle-btn:focus-visible {
  outline: 2px solid var(--jp-primary);
  outline-offset: -2px;
}
.toggle-icon :deep(.v-icon) {
  transition: transform var(--jp-motion-sidebar) var(--jp-ease-standard);
}
.toggle-icon.flipped :deep(.v-icon) {
  transform: rotate(180deg);
}
[dir='rtl'] .toggle-icon :deep(.v-icon) {
  transform: rotate(180deg);
}
[dir='rtl'] .toggle-icon.flipped :deep(.v-icon) {
  transform: none;
}
.toggle-text {
  margin-inline-start: 6px;
  flex: 1;
  text-align: start;
}
.profile-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding-inline: 6px;
  white-space: nowrap;
  overflow: hidden;
}
.profile-avatar {
  width: 36px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: var(--jp-radius-sm);
  color: var(--jp-text-emphasis);
  background: var(--jp-surface-elevated);
  border: 1px solid var(--jp-border-light);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.profile-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  flex: 1;
}
.profile-copy strong {
  font-size: 11.5px;
  color: var(--jp-text-emphasis);
  overflow: hidden;
  text-overflow: ellipsis;
}
.profile-copy span {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: var(--jp-text-subtle);
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--jp-success);
  flex-shrink: 0;
}
.profile-logout {
  color: var(--jp-text-muted) !important;
}
.profile-logout:hover {
  color: var(--jp-danger) !important;
}

/* Topbar */
.jeweler-topbar {
  background: var(--jp-surface) !important;
  border-bottom: 1px solid var(--jp-border) !important;
  padding: 0 12px !important;
  color: var(--jp-text) !important;
  transition-duration: var(--jp-motion-sidebar) !important;
  transition-timing-function: var(--jp-ease-standard) !important;
}
.topbar-toggle-btn,
.topbar-icon {
  color: var(--jp-text-muted) !important;
}
.topbar-toggle-btn:hover,
.topbar-icon:hover {
  color: var(--jp-text-emphasis) !important;
}
.topbar-icon {
  margin: 0 2px;
}
.topbar-icon-active {
  color: var(--jp-primary) !important;
  background: var(--jp-gold-subtle) !important;
}
.topbar-context {
  display: flex;
  flex-direction: column;
  margin-inline-start: 2px;
  min-width: 0;
}
.topbar-eyebrow {
  color: var(--jp-primary);
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 1px;
}
.topbar-title {
  margin: 0;
  color: var(--jp-text-emphasis);
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  font-weight: 700;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.topbar-date {
  align-items: center;
  color: var(--jp-text-muted);
  font-size: 11.5px;
  font-weight: 500;
  margin-inline-end: 12px;
  white-space: nowrap;
}
.topbar-create {
  background: var(--jp-gold-gradient) !important;
  color: var(--jp-on-primary) !important;
  font-weight: 700 !important;
  font-size: 11.5px !important;
  letter-spacing: 0.2px !important;
  border-radius: var(--jp-radius-sm) !important;
  height: 32px !important;
  margin-inline-start: 8px;
  box-shadow: none !important;
  text-transform: none !important;
}
.topbar-create:hover {
  filter: brightness(1.06);
}

.jeweler-main {
  outline: none;
}
.jeweler-main {
  transition-duration: var(--jp-motion-sidebar) !important;
  transition-timing-function: var(--jp-ease-standard) !important;
}
</style>
