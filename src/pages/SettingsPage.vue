<template>
  <div class="jp-page-shell settings-page-shell">
    <div class="jp-page-header">
      <div class="page-heading-left">
        <div>
          <div class="jp-section-label">{{ $t('settings.eyebrow') }}</div>
          <h1 class="page-title">
            <v-icon size="20" class="title-icon">mdi-cog-outline</v-icon>
            {{ $t('settings.title') }}
          </h1>
        </div>
      </div>
      <div class="header-actions">
        <v-btn size="small" class="jp-secondary" :title="$t('settings.resetDefaultsHint')" data-testid="reset-preferences" @click="resetToDefaults">
          <v-icon start size="14">mdi-restore</v-icon>
          {{ $t('settings.resetDefaults') }}
        </v-btn>
      </div>
    </div>

    <div class="settings-workspace-layout">
      <nav class="settings-tabs-sidebar jp-card" role="tablist" :aria-label="$t('settings.title')">
        <button
          v-for="tab in visibleTabs"
          :key="tab.id"
          type="button"
          role="tab"
          class="tab-nav-item"
          :class="{ active: currentTab === tab.id }"
          :aria-selected="currentTab === tab.id ? 'true' : 'false'"
          :data-testid="`settings-tab-${tab.id}`"
          @click="currentTab = tab.id"
        >
          <v-icon size="16" class="tab-icon">{{ tab.icon }}</v-icon>
          <span class="tab-text">
            <strong>{{ $t(`settings.tabs.${tab.id}.title`) }}</strong>
            <small>{{ $t(`settings.tabs.${tab.id}.subtitle`) }}</small>
          </span>
        </button>
      </nav>

      <section class="settings-content-card jp-card" role="tabpanel">
        <div
          class="tab-pane"
          :class="{ 'tab-pane-wide': activeTab.wide }"
          :data-testid="`${currentTab}-panel`"
        >
          <header class="section-title-wrap">
            <h2 class="pane-title">{{ $t(`settings.${currentTab}.title`) }}</h2>
            <p class="pane-subtitle">{{ $t(`settings.${currentTab}.subtitle`) }}</p>
          </header>
          <BusinessProfileSettings v-if="currentTab === 'business'" :is-admin="isAdmin" />
          <component :is="activeTab.component" v-else />
        </div>
      </section>
    </div>
  </div>
</template>

<script>
import { authState } from '@/services/authSession';
import { confirmAction } from '@/services/confirm';
import { t } from '@/i18n';
import AppearanceSettings from '@/components/settings/AppearanceSettings.vue';
import RegionalSettings from '@/components/settings/RegionalSettings.vue';
import BusinessProfileSettings from '@/components/settings/BusinessProfileSettings.vue';
import UsersSettings from '@/components/settings/UsersSettings.vue';
import SecuritySettings from '@/components/settings/SecuritySettings.vue';
import MarketSettings from '@/components/settings/MarketSettings.vue';
import SystemSettings from '@/components/settings/SystemSettings.vue';

// Each tab is its own component and loads its data when opened.
const TABS = [
  { id: 'appearance', icon: 'mdi-palette-outline', component: AppearanceSettings },
  { id: 'regional', icon: 'mdi-earth', component: RegionalSettings },
  { id: 'business', icon: 'mdi-domain', component: BusinessProfileSettings },
  { id: 'users', icon: 'mdi-shield-account-outline', component: UsersSettings, wide: true },
  { id: 'security', icon: 'mdi-lock-outline', component: SecuritySettings, wide: true },
  { id: 'market', icon: 'mdi-chart-line', component: MarketSettings },
  { id: 'system', icon: 'mdi-bell-ring-outline', component: SystemSettings },
];

/** Settings shell: tab navigation, a shared pane header and the defaults reset. */
export default {
  name: 'SettingsPage',
  components: { BusinessProfileSettings },
  data() {
    return { currentTab: 'appearance' };
  },
  computed: {
    visibleTabs() {
      return TABS;
    },
    activeTab() {
      return TABS.find((tab) => tab.id === this.currentTab) || TABS[0];
    },
    isAdmin() {
      return authState.user?.role === 'admin';
    },
  },
  methods: {
    async resetToDefaults() {
      const ok = await confirmAction({ message: t('settings.resetConfirm'), confirmLabel: t('common.reset') });
      if (!ok) return;
      this.$store.dispatch('settings/reset');
      this.$store.dispatch('notifications/showSuccess', t('settings.toasts.reset'));
    },
  },
};
</script>

<style scoped>
.settings-page-shell {
  gap: 8px;
}
.title-icon {
  color: var(--jp-primary);
}
.settings-workspace-layout {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
  align-items: start;
}
@media (max-width: 959px) {
  .settings-workspace-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .settings-tabs-sidebar {
    flex-direction: row !important;
    overflow-x: auto;
    position: static !important;
  }
  .tab-nav-item {
    flex: 0 0 auto;
    width: auto !important;
  }
  .tab-text small {
    display: none;
  }
}

/* Tabs */
.settings-tabs-sidebar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px !important;
  position: sticky;
  top: 8px;
}
.tab-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: 0;
  border-radius: var(--jp-radius-sm);
  cursor: pointer;
  text-align: start;
  color: var(--jp-text-muted);
  transition: background-color var(--jp-motion-fast) var(--jp-ease-standard), color var(--jp-motion-fast) var(--jp-ease-standard);
}
.tab-nav-item:hover {
  background: var(--jp-surface-card-hover);
  color: var(--jp-text-emphasis);
}
.tab-nav-item:focus-visible {
  outline: 2px solid var(--jp-primary);
  outline-offset: -2px;
}
.tab-nav-item.active {
  background: var(--jp-gold-subtle);
  color: var(--jp-text-emphasis);
}
.tab-nav-item.active .tab-icon {
  color: var(--jp-primary) !important;
}
.tab-icon {
  color: var(--jp-text-subtle);
  flex-shrink: 0;
}
.tab-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.tab-text strong {
  font-size: 12px;
  font-weight: 650;
  line-height: 1.25;
}
.tab-text small {
  font-size: 10.5px;
  color: var(--jp-text-subtle);
  line-height: 1.25;
}

/* Content */
.settings-content-card {
  padding: 16px 20px !important;
  min-width: 0;
}
.tab-pane {
  max-width: 880px;
}
.tab-pane-wide {
  max-width: none;
}
.section-title-wrap {
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--jp-border);
}
.pane-title {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 800;
  color: var(--jp-text-emphasis);
  margin: 0 0 2px;
}
.pane-subtitle {
  font-size: 12px;
  color: var(--jp-text-muted);
  margin: 0;
}
</style>
