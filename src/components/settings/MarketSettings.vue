<template>
  <div>
    <div class="card-head">
      <span class="setting-title">{{ $t('settings.market.providers') }}</span>
      <v-btn size="x-small" variant="text" :loading="loading" @click="refresh">
        <v-icon size="12" class="mr-1">mdi-refresh</v-icon>{{ $t('common.refresh') }}
      </v-btn>
    </div>
    <div class="providers-grid">
      <div v-for="p in providers" :key="p.id" class="provider-box">
        <div class="provider-header">
          <span class="status-indicator-dot" :class="p.status === 'ok' ? 'ok' : p.status === 'stale' ? 'warn' : 'err'"></span>
          <strong>{{ p.name }}</strong>
          <span class="jp-badge ml-auto" :class="p.status === 'ok' ? 'jp-badge-success' : p.status === 'stale' ? 'jp-badge-warning' : 'jp-badge-neutral'">
            {{ p.status === 'ok' ? $t('settings.market.quotes', { count: p.quoteCount }) : p.status === 'stale' ? $t('common.stale') : $t('settings.market.notConfigured') }}
          </span>
        </div>
        <p class="setting-hint mt-1 mb-0">{{ providerDescription(p.id) }}</p>
      </div>
      <p v-if="!providers.length && !loading" class="setting-hint">{{ $t('common.noData') }}</p>
    </div>
    <div class="settings-grid-2 mt-4">
      <div class="form-group">
        <label class="form-label" for="pref-refresh">{{ $t('settings.market.autoRefresh') }}</label>
        <select id="pref-refresh" :value="settings.marketAutoRefresh" class="settings-select-full" @change="saveRefresh">
          <option :value="15">{{ $t('settings.market.every', { count: 15 }) }}</option>
          <option :value="30">{{ $t('settings.market.every', { count: 30 }) }} ({{ $t('settings.market.recommended') }})</option>
          <option :value="60">{{ $t('settings.market.every', { count: 60 }) }}</option>
          <option :value="0">{{ $t('settings.market.manual') }}</option>
        </select>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { t, tOptional } from '@/i18n';
import marketPriceService, { type ProviderStatus } from '@/services/marketPriceService';
import type { SettingsState } from '@/services/settings';
import { eventValue, savePreference } from '@/services/settingsView';

/** Market data providers and their status, plus the auto-refresh interval. */
export default defineComponent({
  name: 'MarketSettings',
  data: () => ({ loading: false, providers: [] as ProviderStatus[] }),
  computed: {
    settings(): SettingsState {
      return (this.$store.state as { settings: SettingsState }).settings;
    },
  },
  mounted() {
    this.refresh();
  },
  methods: {
    providerDescription(id: string) {
      return tOptional(`settings.market.descriptions.${id}`, t('settings.market.descriptions.generic'));
    },
    saveRefresh(event: Event) {
      savePreference(this.$store, 'marketAutoRefresh', Number(eventValue(event)));
    },
    async refresh() {
      this.loading = true;
      try {
        const state = await marketPriceService.loadPrices(false);
        this.providers = state.providers || [];
      } catch {
        this.providers = marketPriceService.getState().providers || [];
      } finally {
        this.loading = false;
      }
    },
  },
});
</script>

<style scoped src="@/styles/settings-pane.css"></style>

<style scoped>
.providers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px;
}
.provider-box {
  padding: 10px 12px;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
}
.provider-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--jp-text-emphasis);
}
.status-indicator-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-indicator-dot.ok {
  background: var(--jp-success);
}
.status-indicator-dot.warn {
  background: var(--jp-warning);
}
.status-indicator-dot.err {
  background: var(--jp-text-subtle);
}
</style>
