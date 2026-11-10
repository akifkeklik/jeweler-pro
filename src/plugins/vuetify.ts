import { createVuetify } from 'vuetify';
// Register only the components the templates use (tree-shaking): importing
// `vuetify/components` wholesale shipped every component's JS and CSS.
// When a template starts using another <v-*> component, add it here — an
// unregistered component renders as an unknown element (Vue warns in dev).
import {
  VAlert, VApp, VAppBar, VAppBarNavIcon, VBtn, VCard, VCardActions, VCardText, VCardTitle,
  VCol, VContainer, VDataTable, VDialog, VDivider, VIcon, VList, VListItem, VListItemTitle,
  VMain, VNavigationDrawer, VProgressCircular, VRow, VSlideYTransition, VSpacer, VTextField,
  VToolbarTitle, VTooltip,
} from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { ar, de, en, es, fr, ru, tr, zhHans } from 'vuetify/locale';
import { watch } from 'vue';
import { i18nState } from '@/i18n';
import { RTL_LANGUAGES, LANGUAGES } from '@/i18n/languages';
import { loadSettings } from '@/services/settings';
import { buildTokens, vuetifyColors } from '@/theme/palettes';
import { resolveMode } from '@/theme';

const components = {
  VAlert, VApp, VAppBar, VAppBarNavIcon, VBtn, VCard, VCardActions, VCardText, VCardTitle,
  VCol, VContainer, VDataTable, VDialog, VDivider, VIcon, VList, VListItem, VListItemTitle,
  VMain, VNavigationDrawer, VProgressCircular, VRow, VSlideYTransition, VSpacer, VTextField,
  VToolbarTitle, VTooltip,
};

// Both Vuetify themes are seeded from the stored palette so the very first
// paint already uses the right colours; src/theme/index.ts keeps them in sync
// afterwards (palette or mode changes never need a reload).
const settings = loadSettings();
const initialMode = resolveMode(settings.themeMode);

// Vuetify's own locale must follow the app language: its root element carries
// `v-locale--is-ltr|rtl` (CSS `direction`), which would otherwise force LTR
// inside <html dir="rtl">. Its bundled messages localize built-in strings
// (e.g. data-table texts) in the same eight languages.
const vuetifyMessages = { tr, en, de, fr, es, ru, ar, zh: zhHans };
const vuetifyRtl = Object.fromEntries(LANGUAGES.map((language) => [language, RTL_LANGUAGES.includes(language)]));

const vuetify = createVuetify({
  components,
  directives,
  locale: { locale: i18nState.language, fallback: 'en', messages: vuetifyMessages, rtl: vuetifyRtl },
  theme: {
    defaultTheme: initialMode,
    themes: {
      light: { dark: false, colors: vuetifyColors(buildTokens(settings.palette, 'light')) },
      dark: { dark: true, colors: vuetifyColors(buildTokens(settings.palette, 'dark')) },
    },
  },
  defaults: {
    VTooltip: { location: 'top', openDelay: 350 },
    VDialog: { scrollable: true },
  },
});

watch(() => i18nState.language, (language) => {
  vuetify.locale.current.value = language;
}, { immediate: true });

export default vuetify;
