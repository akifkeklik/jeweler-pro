<template>
  <div>
    <div class="pref-row">
      <div class="pref-label">
        <span class="setting-title">{{ $t('settings.appearance.mode') }}</span>
        <span v-if="settings.themeMode === 'system'" class="setting-hint">
          {{ $t('settings.appearance.systemHint', { mode: $t(`settings.appearance.${resolvedMode}`) }) }}
        </span>
      </div>
      <div class="segmented" role="radiogroup" :aria-label="$t('settings.appearance.mode')">
        <button
          v-for="item in modeOptions"
          :key="item.value"
          type="button"
          role="radio"
          class="segmented-btn"
          :class="{ selected: settings.themeMode === item.value }"
          :aria-checked="settings.themeMode === item.value ? 'true' : 'false'"
          :data-testid="`mode-${item.value}`"
          @click="setMode(item.value)"
        >
          <v-icon size="15">{{ item.icon }}</v-icon>
          <span>{{ $t(`settings.appearance.${item.value}`) }}</span>
        </button>
      </div>
    </div>

    <div class="pref-block">
      <div class="pref-label">
        <span class="setting-title">{{ $t('settings.appearance.palette') }}</span>
        <span class="setting-hint">{{ $t('settings.appearance.paletteHint') }}</span>
      </div>
      <div class="palette-grid" role="radiogroup" :aria-label="$t('settings.appearance.palette')">
        <button
          v-for="p in paletteCards"
          :key="p.id"
          type="button"
          role="radio"
          class="palette-card"
          :class="{ selected: settings.palette === p.id }"
          :aria-checked="settings.palette === p.id ? 'true' : 'false'"
          :aria-label="$t(`palettes.${p.id}.name`)"
          :data-testid="`palette-${p.id}`"
          @click="setPalette(p.id)"
        >
          <!-- Miniature of the real UI rendered from the palette's own tokens. -->
          <span class="palette-preview" :style="{ background: p.c.bg, borderColor: p.c.border }" aria-hidden="true">
            <span class="pv-sidebar" :style="{ background: p.c.surface, borderColor: p.c.border }">
              <span class="pv-dot" :style="{ background: p.c.primary }"></span>
              <span class="pv-line" :style="{ background: p.c.textSubtle }"></span>
              <span class="pv-line active" :style="{ background: p.c.primary }"></span>
              <span class="pv-line" :style="{ background: p.c.textSubtle }"></span>
            </span>
            <span class="pv-main">
              <span class="pv-card" :style="{ background: p.c.card, borderColor: p.c.border }">
                <span class="pv-text" :style="{ background: p.c.text }"></span>
                <span class="pv-text short" :style="{ background: p.c.textMuted }"></span>
                <span class="pv-bars">
                  <span :style="{ background: p.c.primary, height: '70%' }"></span>
                  <span :style="{ background: p.c.secondary, height: '45%' }"></span>
                  <span :style="{ background: p.c.accent, height: '90%' }"></span>
                </span>
              </span>
              <span class="pv-button" :style="{ background: p.c.primary }"></span>
            </span>
          </span>
          <span class="palette-meta">
            <strong>{{ $t(`palettes.${p.id}.name`) }}</strong>
            <small>{{ $t(`palettes.${p.id}.tagline`) }}</small>
          </span>
          <v-icon v-if="settings.palette === p.id" size="16" class="palette-check">mdi-check-circle</v-icon>
        </button>
      </div>
    </div>

    <div class="pref-block">
      <div class="pref-label">
        <span class="setting-title">{{ $t('settings.appearance.language') }}</span>
        <span class="setting-hint">{{ $t('settings.appearance.languageHint') }}</span>
      </div>
      <div class="language-grid" role="radiogroup" :aria-label="$t('settings.appearance.language')">
        <button
          v-for="option in languages"
          :key="option.value"
          type="button"
          role="radio"
          class="lang-btn"
          :lang="option.value"
          :class="{ selected: settings.language === option.value }"
          :aria-checked="settings.language === option.value ? 'true' : 'false'"
          :data-testid="`language-${option.value}`"
          @click="setLanguage(option.value)"
        >
          <span>{{ option.native }}</span>
          <v-icon v-if="settings.language === option.value" size="14" class="lang-check">mdi-check</v-icon>
        </button>
      </div>
    </div>

    <div class="pref-row motion-row">
      <div class="pref-label">
        <span id="motion-label" class="setting-title">{{ $t('settings.appearance.motion') }}</span>
        <span class="setting-hint">{{ $t('settings.appearance.motionDescription') }}</span>
        <span v-if="systemReducedMotion" class="setting-hint system-note">
          <v-icon size="12">mdi-information-outline</v-icon>
          {{ $t('settings.appearance.motionSystem') }}
        </span>
      </div>
      <button
        type="button"
        role="switch"
        class="jp-switch"
        :class="{ on: settings.reducedMotion }"
        :aria-checked="settings.reducedMotion ? 'true' : 'false'"
        aria-labelledby="motion-label"
        data-testid="reduced-motion-toggle"
        @click="setReducedMotion(!settings.reducedMotion)"
      >
        <span class="jp-switch-thumb"></span>
      </button>
    </div>

    <div class="settings-grid-2 pref-block">
      <div class="form-group">
        <label class="form-label" for="pref-density">{{ $t('settings.appearance.density') }}</label>
        <select id="pref-density" :value="settings.density" class="settings-select-full" @change="save('density', $event)">
          <option value="comfortable">{{ $t('settings.appearance.comfortable') }}</option>
          <option value="compact">{{ $t('settings.appearance.compact') }}</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="pref-sidebar">{{ $t('settings.appearance.sidebar') }}</label>
        <select id="pref-sidebar" :value="settings.sidebarMode" class="settings-select-full" data-testid="sidebar-mode" @change="save('sidebarMode', $event)">
          <option value="pinned">{{ $t('settings.appearance.sidebarPinned') }}</option>
          <option value="hover">{{ $t('settings.appearance.sidebarHover') }}</option>
          <option value="collapsed">{{ $t('settings.appearance.sidebarCollapsed') }}</option>
        </select>
        <small class="form-subtext">{{ $t('settings.appearance.sidebarHint') }}</small>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { languageOptions, t } from '@/i18n';
import { PALETTES } from '@/theme/palettes';
import { themeState, resolveMode } from '@/theme';
import type { Density, Language, PaletteId, SettingsState, SidebarMode, ThemeMode } from '@/services/settings';
import { eventValue, savePreference } from '@/services/settingsView';

const MODE_TOAST: Record<ThemeMode, string> = { light: 'modeLight', dark: 'modeDark', system: 'modeSystem' };

/** Theme mode, palette, language, motion, density and sidebar; every change applies instantly. */
export default defineComponent({
  name: 'AppearanceSettings',
  data: () => ({
    languages: languageOptions,
    modeOptions: [
      { value: 'light', icon: 'mdi-white-balance-sunny' },
      { value: 'dark', icon: 'mdi-weather-night' },
      { value: 'system', icon: 'mdi-monitor' },
    ] as Array<{ value: ThemeMode; icon: string }>,
  }),
  computed: {
    settings(): SettingsState {
      return (this.$store.state as { settings: SettingsState }).settings;
    },
    resolvedMode(): 'light' | 'dark' {
      return themeState.mode || resolveMode(this.settings.themeMode);
    },
    systemReducedMotion(): boolean {
      return themeState.systemReducedMotion;
    },
    paletteCards() {
      const mode = this.resolvedMode;
      return PALETTES.map((p) => ({ id: p.id, c: p[mode] }));
    },
  },
  methods: {
    save(key: 'density' | 'sidebarMode', event: Event) {
      const value = eventValue(event);
      if (key === 'density') savePreference(this.$store, key, value as Density);
      else savePreference(this.$store, key, value as SidebarMode);
    },
    setMode(value: ThemeMode) {
      if (this.settings.themeMode === value) return;
      this.$store.dispatch('settings/setPreference', { key: 'themeMode', value });
      this.$store.dispatch('notifications/showSuccess', t(`settings.toasts.${MODE_TOAST[value]}`));
    },
    setPalette(id: PaletteId) {
      if (this.settings.palette === id) return;
      this.$store.dispatch('settings/setPreference', { key: 'palette', value: id });
      this.$store.dispatch('notifications/showSuccess', t('settings.toasts.palette', { name: t(`palettes.${id}.name`) }));
    },
    async setLanguage(language: Language) {
      if (this.settings.language === language) return;
      await this.$store.dispatch('settings/setPreference', { key: 'language', value: language });
      // Dispatched after the switch, so the confirmation is in the new language.
      this.$store.dispatch('notifications/showSuccess', t('settings.toasts.language'));
    },
    setReducedMotion(enabled: boolean) {
      this.$store.dispatch('settings/setPreference', { key: 'reducedMotion', value: enabled });
      this.$store.dispatch('notifications/showSuccess', t(enabled ? 'settings.toasts.motionOn' : 'settings.toasts.motionOff'));
    },
  },
});
</script>

<style scoped src="@/styles/settings-pane.css"></style>

<style scoped>
.system-note {
  display: flex;
  gap: 4px;
  align-items: flex-start;
  margin-top: 4px;
  color: var(--jp-info);
}

/* Segmented control */
.segmented {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  border-radius: var(--jp-radius-control);
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
  flex-shrink: 0;
}
.segmented-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--jp-text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--jp-motion-fast) var(--jp-ease-standard), color var(--jp-motion-fast) var(--jp-ease-standard), box-shadow var(--jp-motion-fast) var(--jp-ease-standard);
}
.segmented-btn:hover {
  color: var(--jp-text-emphasis);
}
.segmented-btn.selected {
  background: var(--jp-surface-card);
  color: var(--jp-text-emphasis);
  box-shadow: var(--jp-shadow-control);
}
.segmented-btn.selected .v-icon {
  color: var(--jp-primary);
}
.segmented-btn:focus-visible,
.palette-card:focus-visible,
.lang-btn:focus-visible,
.jp-switch:focus-visible {
  outline: 2px solid var(--jp-primary);
  outline-offset: 2px;
}

/* Palette grid */
.palette-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.palette-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-md);
  background: var(--jp-surface-card);
  cursor: pointer;
  text-align: start;
  transition: border-color var(--jp-motion-fast) var(--jp-ease-standard), box-shadow var(--jp-motion-fast) var(--jp-ease-standard);
}
.palette-card:hover {
  border-color: var(--jp-border-light);
  box-shadow: var(--jp-shadow-sm);
}
.palette-card.selected {
  border-color: var(--jp-primary);
  box-shadow: 0 0 0 1px var(--jp-primary);
}
.palette-check {
  position: absolute;
  top: 12px;
  inset-inline-end: 12px;
  color: var(--jp-primary) !important;
  background: var(--jp-surface-card);
  border-radius: 50%;
}
.palette-preview {
  display: flex;
  height: 68px;
  border-radius: 6px;
  border: 1px solid;
  overflow: hidden;
}
.pv-sidebar {
  width: 26%;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 5px;
  border-inline-end: 1px solid;
}
.pv-dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
}
.pv-line {
  height: 3px;
  border-radius: 2px;
  opacity: 0.5;
}
.pv-line.active {
  opacity: 1;
}
.pv-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px;
}
.pv-card {
  flex: 1;
  border: 1px solid;
  border-radius: 4px;
  padding: 4px 5px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.pv-text {
  height: 3px;
  width: 60%;
  border-radius: 2px;
}
.pv-text.short {
  width: 38%;
}
.pv-bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 3px;
}
.pv-bars span {
  flex: 1;
  border-radius: 2px 2px 0 0;
}
.pv-button {
  height: 7px;
  width: 42%;
  border-radius: 3px;
  align-self: flex-end;
}
.palette-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0 2px 2px;
}
.palette-meta strong {
  font-size: 12px;
  color: var(--jp-text-emphasis);
}
.palette-meta small {
  font-size: 10.5px;
  color: var(--jp-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Languages */
.language-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 6px;
}
.lang-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-card);
  color: var(--jp-text);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--jp-motion-fast) var(--jp-ease-standard), background-color var(--jp-motion-fast) var(--jp-ease-standard);
}
.lang-btn:hover {
  border-color: var(--jp-border-light);
  background: var(--jp-surface-card-hover);
}
.lang-btn.selected {
  border-color: var(--jp-primary);
  background: var(--jp-gold-subtle);
  color: var(--jp-text-emphasis);
}
.lang-check {
  color: var(--jp-primary) !important;
}

/* Switch */
.jp-switch {
  position: relative;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 999px;
  border: 1px solid var(--jp-input-border);
  background: var(--jp-surface-muted);
  cursor: pointer;
  transition: background-color var(--jp-motion-fast) var(--jp-ease-standard), border-color var(--jp-motion-fast) var(--jp-ease-standard);
}
.jp-switch-thumb {
  position: absolute;
  top: 2px;
  inset-inline-start: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--jp-text-muted);
  transition: transform var(--jp-motion-fast) var(--jp-ease-standard), background-color var(--jp-motion-fast) var(--jp-ease-standard);
}
.jp-switch.on {
  background: var(--jp-primary);
  border-color: var(--jp-primary);
}
.jp-switch.on .jp-switch-thumb {
  transform: translateX(18px);
  background: var(--jp-on-primary);
}
[dir='rtl'] .jp-switch.on .jp-switch-thumb {
  transform: translateX(-18px);
}
</style>
