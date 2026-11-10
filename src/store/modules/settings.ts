import {
  applySettings,
  defaultSettings,
  loadSettings,
  normalizeSettings,
  persistSettings,
  type SettingsState,
} from '@/services/settings';
import { loadLocale } from '@/i18n';
import { isLanguage } from '@/i18n/languages';

type Key = keyof SettingsState;

const settingsModule = {
  namespaced: true,
  state: () => loadSettings(),
  getters: {
    all: (state: SettingsState) => state,
  },
  mutations: {
    setPreference(state: SettingsState, { key, value }: { key: Key; value: SettingsState[Key] }) {
      if (state[key] === value) return;
      // Re-validate through the normaliser so invalid values never persist.
      const next = normalizeSettings({ ...state, [key]: value });
      (state as any)[key] = next[key];
      persistSettings(state);
      applySettings(state);
    },
    replace(state: SettingsState, next: Partial<SettingsState>) {
      Object.assign(state, normalizeSettings({ ...defaultSettings, ...next }));
      persistSettings(state);
      applySettings(state);
    },
  },
  actions: {
    /** Language switches wait for the catalog so text never mixes languages. */
    async setPreference({ commit }: any, payload: { key: Key; value: unknown }) {
      if (payload.key === 'language' && isLanguage(payload.value)) await loadLocale(payload.value);
      commit('setPreference', payload);
    },
    /** Restores default preferences (the business profile lives on the server). */
    reset({ commit }: any) {
      commit('replace', { ...defaultSettings });
    },
  },
};

export default settingsModule;
