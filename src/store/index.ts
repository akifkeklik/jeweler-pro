import Vuex from 'vuex'
import customersModule from './modules/customers'
import notificationModule from './modules/notification'
import productsModule from './modules/products'
import salesModule from './modules/sales'
import settingsModule from './modules/settings'

export default new Vuex.Store({
  state: {
    appLoading: false,
  },
  getters: {
    isAppLoading: (state) => state.appLoading,
  },
  mutations: {
    setAppLoading(state, loading: boolean) {
      state.appLoading = loading;
    },
  },
  actions: {},
  modules: {
    sales: salesModule,
    products: productsModule,
    customers: customersModule,
    notifications: notificationModule,
    settings: settingsModule,
  }
})
