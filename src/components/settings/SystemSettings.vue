<template>
  <div>
    <div class="settings-grid-2">
      <div class="form-group">
        <label class="form-label" for="pref-lowstock">{{ $t('settings.system.lowStock') }}</label>
        <input id="pref-lowstock" :value="settings.lowStockThreshold" type="number" min="1" max="50" class="settings-input-full tabular" @change="saveNumber('lowStockThreshold', $event)" />
        <small class="form-subtext">{{ $t('settings.system.lowStockHint') }}</small>
      </div>
      <div class="form-group">
        <label class="form-label" for="pref-toast">{{ $t('settings.system.toastDuration') }}</label>
        <select id="pref-toast" :value="settings.toastDuration" class="settings-select-full" @change="saveNumber('toastDuration', $event)">
          <option v-for="ms in [3000, 4000, 5000, 6000]" :key="ms" :value="ms">{{ $t('units.seconds', { count: ms / 1000 }) }}</option>
        </select>
        <small class="form-subtext">{{ $t('settings.system.toastHint') }}</small>
      </div>
    </div>
    <div class="mt-3">
      <v-btn size="small" class="jp-secondary" data-testid="test-toast" @click="triggerTestToast">
        <v-icon start size="14">mdi-bell-outline</v-icon>{{ $t('settings.system.testToast') }}
      </v-btn>
    </div>

    <div class="system-health-card mt-4">
      <div class="card-head">
        <span class="setting-title">{{ $t('settings.system.health') }}</span>
        <v-btn size="x-small" variant="text" :loading="checking" @click="checkHealth">
          <v-icon start size="12">mdi-refresh</v-icon>{{ $t('common.refresh') }}
        </v-btn>
      </div>
      <div class="health-meta-grid">
        <div class="health-box">
          <span class="health-label">{{ $t('settings.system.api') }}</span>
          <span class="health-val" :class="health.reachable ? 'text-ok' : 'text-bad'">
            <span class="live-dot mr-1" :class="{ 'dot-bad': !health.reachable }"></span>
            {{ health.reachable === null ? $t('settings.system.unknown') : health.reachable ? $t('settings.system.online') : $t('settings.system.unreachable') }}
          </span>
        </div>
        <div class="health-box">
          <span class="health-label">{{ $t('settings.system.database') }}</span>
          <span class="health-val">{{ health.database === 'connected' ? $t('settings.system.connected') : health.database || $t('settings.system.unknown') }}</span>
        </div>
        <div class="health-box">
          <span class="health-label">{{ $t('settings.system.uptime') }}</span>
          <span class="health-val tabular">{{ uptimeLabel }}</span>
        </div>
      </div>
    </div>

    <div class="cache-cleanup-card mt-4">
      <span class="setting-title">{{ $t('settings.system.cache') }}</span>
      <p class="setting-hint mt-1 mb-2">{{ $t('settings.system.cacheHint') }}</p>
      <v-btn size="small" class="jp-secondary" @click="clearAppCache">
        <v-icon start size="14">mdi-broom</v-icon>{{ $t('settings.system.clearCache') }}
      </v-btn>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import apiService from '@/services/api';
import { t } from '@/i18n';
import type { SettingsState } from '@/services/settings';
import { eventValue, formatUptime, savePreference } from '@/services/settingsView';

interface Health { reachable: boolean | null; database: string; uptime: number | null }
interface HealthResponse { status?: string; database?: string; uptime?: number }

/** Stock and toast preferences, API/database health and the session cache. */
export default defineComponent({
  name: 'SystemSettings',
  data: () => ({
    checking: false,
    health: { reachable: null, database: '', uptime: null } as Health,
  }),
  computed: {
    settings(): SettingsState {
      return (this.$store.state as { settings: SettingsState }).settings;
    },
    uptimeLabel(): string {
      return formatUptime(this.health.uptime);
    },
  },
  mounted() {
    this.checkHealth();
  },
  methods: {
    saveNumber(key: 'lowStockThreshold' | 'toastDuration', event: Event) {
      savePreference(this.$store, key, Number(eventValue(event)));
    },
    triggerTestToast() {
      this.$store.dispatch('notifications/showSuccess', t('settings.toasts.test'));
    },
    async checkHealth() {
      this.checking = true;
      try {
        const res = await apiService.get<HealthResponse>('/health');
        this.health = {
          reachable: Boolean(res && res.status),
          database: res?.database || (res?.status === 'OK' ? 'connected' : ''),
          uptime: Number(res?.uptime),
        };
      } catch {
        // Report the real state instead of a reassuring placeholder.
        this.health = { reachable: false, database: '', uptime: null };
      } finally {
        this.checking = false;
      }
    },
    clearAppCache() {
      try {
        sessionStorage.clear();
        this.$store.dispatch('notifications/showSuccess', t('settings.toasts.cacheCleared'));
      } catch (err) {
        console.warn(err);
      }
    },
  },
});
</script>

<style scoped src="@/styles/settings-pane.css"></style>

<style scoped>
.health-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}
.health-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
}
.health-label {
  font-size: 11px;
  color: var(--jp-text-muted);
}
.health-val {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--jp-text-emphasis);
  display: flex;
  align-items: center;
}
.text-ok {
  color: var(--jp-success) !important;
}
.text-bad {
  color: var(--jp-danger) !important;
}
.dot-bad {
  background: var(--jp-danger) !important;
  box-shadow: none !important;
}
</style>
