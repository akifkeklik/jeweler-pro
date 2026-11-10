import { createApp, type Component } from 'vue'
import App from './App.vue'
import router from './router/index.js'
import store from './store/index'

import vuetify from './plugins/vuetify'
import { hasPermission } from './services/authSession'
import { applySettings } from './services/settings'
import { i18nPlugin, loadLocale, t } from './i18n'
import '@fontsource/roboto/300.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import './styles/design-system.css'

const initialSettings = (store.state as unknown as { settings: Parameters<typeof applySettings>[0] }).settings
// Apply theme, palette and motion immediately (no flash of the default look).
applySettings(initialSettings)

const app = createApp(App as Component)

app.config.errorHandler = (err, _instance, info) => {
  console.error('Global error:', err, info)
  store.dispatch('notifications/showError', t('errors.unexpected'))
}

// `$can('catalog:delete')` mirrors backend permissions for buttons/actions.
// The backend remains the enforcement point; this only hides what would 403.
app.config.globalProperties.$can = hasPermission

app.use(i18nPlugin)
app.use(router)
app.use(store)
app.use(vuetify)

// The stored language's catalog is loaded before mounting, so a refresh never
// shows Turkish fallback text first. A failed chunk load still mounts (Turkish).
loadLocale(initialSettings.language)
  .catch((error) => console.error('Locale could not be loaded:', error))
  .finally(() => {
    applySettings(initialSettings)
    app.mount('#app')
  })
