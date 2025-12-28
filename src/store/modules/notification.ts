interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration: number
}

const state = {
  notifications: [] as Notification[],
}

const getters = {
  allNotifications: (state) => state.notifications,
}

const mutations = {
  ADD_NOTIFICATION(state, notification: Notification) {
    state.notifications.push(notification)
    // Auto-remove after duration
    if (notification.duration > 0) {
      setTimeout(() => {
        state.notifications = state.notifications.filter(n => n.id !== notification.id)
      }, notification.duration)
    }
  },
  REMOVE_NOTIFICATION(state, id: string) {
    state.notifications = state.notifications.filter(n => n.id !== id)
  },
  CLEAR_NOTIFICATIONS(state) {
    state.notifications = []
  },
}

const actions = {
  showNotification({ commit }, payload: { type: 'success' | 'error' | 'warning' | 'info', message: string, duration?: number }) {
    const notification: Notification = {
      id: Date.now().toString(),
      type: payload.type,
      message: payload.message,
      duration: payload.duration ?? 4000,
    }
    commit('ADD_NOTIFICATION', notification)
    return notification.id
  },

  showSuccess({ dispatch }, message: string) {
    return dispatch('showNotification', { type: 'success', message })
  },

  showError({ dispatch }, message: string) {
    return dispatch('showNotification', { type: 'error', message, duration: 5000 })
  },

  showWarning({ dispatch }, message: string) {
    return dispatch('showNotification', { type: 'warning', message })
  },

  showInfo({ dispatch }, message: string) {
    return dispatch('showNotification', { type: 'info', message })
  },

  removeNotification({ commit }, id: string) {
    commit('REMOVE_NOTIFICATION', id)
  },
}

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions,
}
