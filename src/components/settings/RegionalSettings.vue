<template>
  <div>
    <div class="settings-grid-2">
      <div class="form-group">
        <label class="form-label" for="pref-date">{{ $t('settings.regional.dateFormat') }}</label>
        <select id="pref-date" :value="settings.dateFormat" class="settings-select-full" @change="save('dateFormat', $event)">
          <option value="locale">{{ $t('settings.regional.locale') }}</option>
          <option value="iso">{{ $t('settings.regional.iso') }}</option>
          <option value="day-month-year">{{ $t('settings.regional.dayMonthYear') }}</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="pref-number">{{ $t('settings.regional.numberFormat') }}</label>
        <select id="pref-number" :value="settings.numberFormat" class="settings-select-full" @change="save('numberFormat', $event)">
          <option value="locale">{{ $t('settings.regional.locale') }}</option>
          <option value="western">{{ $t('settings.regional.western') }}</option>
        </select>
      </div>
    </div>
    <div class="format-preview-strip mt-3" data-testid="format-preview">
      <span class="preview-label">{{ $t('settings.regional.preview') }}</span>
      <span>{{ $t('settings.regional.previewDate') }}: <strong class="tabular">{{ $date(previewNow, 'long') }} · {{ $time(previewNow) }}</strong></span>
      <span>{{ $t('settings.regional.previewMoney') }}: <strong class="tabular">{{ $money(1234567.89) }}</strong></span>
      <span>{{ $t('settings.regional.previewWeight') }}: <strong class="tabular">{{ $weight(12.345, 3) }}</strong></span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import type { DateFormat, NumberFormat, SettingsState } from '@/services/settings';
import { eventValue, savePreference } from '@/services/settingsView';

/** Date and number formats with a live preview. */
export default defineComponent({
  name: 'RegionalSettings',
  data: () => ({ previewNow: new Date() }),
  computed: {
    settings(): SettingsState {
      return (this.$store.state as { settings: SettingsState }).settings;
    },
  },
  methods: {
    save(key: 'dateFormat' | 'numberFormat', event: Event) {
      const value = eventValue(event);
      if (key === 'dateFormat') savePreference(this.$store, key, value as DateFormat);
      else savePreference(this.$store, key, value as NumberFormat);
    },
  },
});
</script>

<style scoped src="@/styles/settings-pane.css"></style>

<style scoped>
.format-preview-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  padding: 10px 12px;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
  font-size: 12px;
  color: var(--jp-text-muted);
}
.format-preview-strip strong {
  color: var(--jp-text-emphasis);
}
.preview-label {
  font-weight: 700;
  color: var(--jp-primary);
  text-transform: uppercase;
  font-size: 10.5px;
  letter-spacing: 0.6px;
  align-self: center;
}
</style>
