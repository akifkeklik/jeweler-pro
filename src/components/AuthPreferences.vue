<template>
  <div class="auth-prefs">
    <label class="auth-lang">
      <v-icon size="15" aria-hidden="true">mdi-translate</v-icon>
      <span class="sr-only">{{ $t('settings.appearance.language') }}</span>
      <select :value="language" :aria-label="$t('settings.appearance.language')" data-testid="auth-language" @change="setLanguage($event.target.value)">
        <option v-for="o in languages" :key="o.value" :value="o.value" :lang="o.value">{{ o.native }}</option>
      </select>
    </label>
    <button
      type="button"
      class="auth-mode"
      :title="isDark ? $t('shell.switchToLight') : $t('shell.switchToDark')"
      :aria-label="isDark ? $t('shell.switchToLight') : $t('shell.switchToDark')"
      @click="toggleMode"
    >
      <v-icon size="16">{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
    </button>
  </div>
</template>

<script>
import { languageOptions } from '@/i18n';
import { themeState } from '@/theme';

/** Language and light/dark controls for signed-out screens (login, reset). */
export default {
  name: 'AuthPreferences',
  data: () => ({ languages: languageOptions }),
  computed: {
    language() {
      return this.$store.state.settings.language;
    },
    isDark() {
      return themeState.mode === 'dark';
    },
  },
  methods: {
    setLanguage(value) {
      this.$store.dispatch('settings/setPreference', { key: 'language', value });
    },
    toggleMode() {
      this.$store.dispatch('settings/setPreference', { key: 'themeMode', value: this.isDark ? 'light' : 'dark' });
    },
  },
};
</script>

<style scoped>
.auth-prefs {
  position: absolute;
  top: 16px;
  inset-inline-end: 16px;
  display: flex;
  gap: 6px;
  z-index: 2;
}
.auth-lang {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 4px 0 10px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-card);
  color: var(--jp-text-muted);
}
.auth-lang select {
  border: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
  padding: 0 4px !important;
  height: 28px;
  font-size: 12px;
  cursor: pointer;
}
.auth-mode {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-card);
  color: var(--jp-text-muted);
  cursor: pointer;
  transition: color var(--jp-motion-fast) var(--jp-ease-standard), border-color var(--jp-motion-fast) var(--jp-ease-standard);
}
.auth-mode:hover {
  color: var(--jp-text-emphasis);
  border-color: var(--jp-border-light);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
