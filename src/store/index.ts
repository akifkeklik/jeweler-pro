import { createStore } from 'vuex';
import { createListModule } from './modules/listModule';
import notificationModule from './modules/notification';
import settingsModule from './modules/settings';

/**
 * Root store. Server-owned lists are read models (createListModule); UI
 * preferences and toasts are client state.
 */
export default createStore({
  modules: {
    sales: createListModule('/api/sales'),
    customers: createListModule('/api/customers'),
    notifications: notificationModule,
    settings: settingsModule,
  },
});
