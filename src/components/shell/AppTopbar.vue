<template>
  <v-app-bar flat height="52" class="jeweler-topbar">
    <v-btn
      icon
      size="small"
      variant="text"
      class="topbar-toggle-btn mr-1"
      :title="menuLabel"
      :aria-label="menuLabel"
      @click="$emit('toggle')"
    >
      <v-icon size="20">{{ isMobile && drawerOpen ? 'mdi-close' : 'mdi-menu' }}</v-icon>
    </v-btn>

    <div class="topbar-context">
      <div class="topbar-eyebrow">JEWELER PRO</div>
      <div class="topbar-title">{{ $t(titleKey) }}</div>
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
      v-if="$can('sales:write')"
      class="topbar-create d-none d-sm-flex"
      size="small"
      @click="$router.push({ path: '/sales', query: { newSale: '1' } })"
    >
      <v-icon start size="16">mdi-plus</v-icon>
      {{ $t('shell.newSale') }}
    </v-btn>
  </v-app-bar>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { date as formatDate } from '@/i18n';
import { themeState } from '@/theme';
import { pageTitleKey } from '@/services/navigation';

/** Top bar: menu toggle, page title, today's date, theme switch, settings and "new sale". */
export default defineComponent({
  name: 'AppTopbar',
  props: {
    isMobile: { type: Boolean, default: false },
    drawerOpen: { type: Boolean, default: true },
    toggleLabel: { type: String, default: '' },
  },
  emits: ['toggle'],
  data: () => ({ now: new Date(), clock: 0 as ReturnType<typeof setInterval> | 0 }),
  computed: {
    isDark(): boolean {
      return themeState.mode === 'dark';
    },
    menuLabel(): string {
      if (!this.isMobile) return this.toggleLabel;
      return this.drawerOpen ? this.$t('nav.closeMenu') : this.$t('nav.openMenu');
    },
    titleKey(): string {
      return pageTitleKey(this.$route.path);
    },
    todayLabel(): string {
      // `$i18n` dependency keeps the label in the active language.
      void this.$i18n.language;
      return formatDate(this.now, 'full');
    },
  },
  mounted() {
    // Keep the date label correct across midnight without a per-second timer.
    this.clock = setInterval(() => {
      this.now = new Date();
    }, 60000);
  },
  beforeUnmount() {
    clearInterval(this.clock);
  },
  methods: {
    toggleDarkMode() {
      this.$store.dispatch('settings/setPreference', { key: 'themeMode', value: this.isDark ? 'light' : 'dark' });
    },
  },
});
</script>

<style scoped>
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
</style>
