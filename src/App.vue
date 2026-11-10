<template>
  <v-app class="jeweler-app" @keydown="handleGlobalKeydown">
    <a v-if="showAppShell" href="#jp-main" class="jp-skip-link">{{ $t('shell.skipToContent') }}</a>

    <AppSidebar
      v-if="showAppShell"
      ref="sidebar"
      v-model="drawer"
      :is-mobile="isMobile"
      :rail="railActive"
      :expanded="expanded"
      :sidebar-mode="settings.sidebarMode"
      :toggle-label="sidebarToggleLabel"
      @rail-hover="onRailHover"
      @toggle="toggleSidebarMode"
      @navigate="closeMobileDrawer"
      @logout="logout"
    />
    <AppTopbar
      v-if="showAppShell"
      :is-mobile="isMobile"
      :drawer-open="drawer"
      :toggle-label="sidebarToggleLabel"
      @toggle="toggleSidebarMode"
    />

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
import { logout as authLogout } from '@/services/authSession';
import { applySettings } from '@/services/settings';
import { bindVuetifyTheme, watchSystemAppearance } from '@/theme';
import ToastHost from '@/components/ToastHost.vue';
import ConfirmHost from '@/components/ConfirmHost.vue';
import AppSidebar from '@/components/shell/AppSidebar.vue';
import AppTopbar from '@/components/shell/AppTopbar.vue';

const MOBILE_QUERY = '(max-width: 959px)';

/**
 * Application shell: sidebar state (open, rail, hover-expanded), keyboard
 * shortcuts (Ctrl+B, "/", Escape), theme binding and the routed page.
 */
export default {
  name: 'App',
  components: { ToastHost, ConfirmHost, AppSidebar, AppTopbar },
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
      isMobile: false,
      hovering: false,
    };
  },
  computed: {
    settings() {
      return this.$store.state.settings;
    },
    showAppShell() {
      return !this.$route.meta?.public;
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
  },
  mounted() {
    bindVuetifyTheme(this.vuetifyTheme);
    applySettings(this.settings);
    this.mobileQuery = window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;
    this.updateMobileState();
    this.mobileQuery?.addEventListener?.('change', this.updateMobileState);
    this.stopSystemWatch = watchSystemAppearance(() => applySettings(this.settings));
  },
  beforeUnmount() {
    this.mobileQuery?.removeEventListener?.('change', this.updateMobileState);
    if (this.stopSystemWatch) this.stopSystemWatch();
  },
  methods: {
    onRailHover(rail) {
      // Emitted by Vuetify's expand-on-hover after the open/close delay.
      this.hovering = !rail;
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
        this.$nextTick(() => this.$refs.sidebar?.focusSearch());
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
/* Shell chrome lives in AppSidebar.vue and AppTopbar.vue; motion uses the shared tokens in design-system.css. */
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

.jeweler-main {
  outline: none;
  transition-duration: var(--jp-motion-sidebar) !important;
  transition-timing-function: var(--jp-ease-standard) !important;
}
</style>
