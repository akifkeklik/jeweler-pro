import Vue from 'vue'
import App from './App.vue'
import router from './router/index.js'
import store from './store/index'

import vuetify from './plugins/vuetify'
import 'vuetify/dist/vuetify.min.css'

Vue.config.productionTip = false

// Global error handler
Vue.config.errorHandler = (err, vm, info) => {
  console.error('Global error:', err, info)
  store.dispatch('notifications/showError', 'Bir hata oluştu. Lütfen daha sonra tekrar deneyin.')
}

new Vue({
    router,
    store,
    vuetify,
    render: h => h(App)
}).$mount('#app')
