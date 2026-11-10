/**
 * Central toast queue.
 *
 *  - Identical messages (same type + text) are coalesced: the existing toast
 *    is refreshed and its counter incremented instead of stacking a copy.
 *  - At most MAX_VISIBLE toasts are shown; the oldest is dismissed first.
 *  - Timers live outside reactive state and are always cleared on removal,
 *    so dismissing early never leaves a stray timeout behind.
 *  - Ordinary confirmations default to the user's toast duration (3–6 s);
 *    errors stay a little longer so they can be read.
 */
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
  count: number;
}

export interface NotifyPayload {
  type: ToastType;
  message: string;
  duration?: number;
}

export const MAX_VISIBLE = 3;
export const DEFAULT_DURATION = 4000;
export const ERROR_MIN_DURATION = 6000;

let sequence = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(id: string) {
  const handle = timers.get(id);
  if (handle) {
    clearTimeout(handle);
    timers.delete(id);
  }
}

interface State {
  notifications: Notification[];
}

const state = (): State => ({
  notifications: [],
});

const getters = {
  allNotifications: (s: State) => s.notifications,
};

const mutations = {
  ADD_NOTIFICATION(s: State, notification: Notification) {
    s.notifications.push(notification);
  },
  BUMP_NOTIFICATION(s: State, id: string) {
    const item = s.notifications.find((n) => n.id === id);
    if (item) item.count += 1;
  },
  REMOVE_NOTIFICATION(s: State, id: string) {
    clearTimer(id);
    s.notifications = s.notifications.filter((n) => n.id !== id);
  },
  CLEAR_NOTIFICATIONS(s: State) {
    for (const n of s.notifications) clearTimer(n.id);
    s.notifications = [];
  },
};

function schedule(commit: (type: string, payload?: unknown) => void, id: string, duration: number) {
  clearTimer(id);
  if (duration > 0) {
    timers.set(id, setTimeout(() => commit('REMOVE_NOTIFICATION', id), duration));
  }
}

function resolveDuration(rootState: any, type: ToastType, requested?: number): number {
  if (typeof requested === 'number') return requested;
  const preferred = Number(rootState?.settings?.toastDuration) || DEFAULT_DURATION;
  return type === 'error' ? Math.max(preferred, ERROR_MIN_DURATION) : preferred;
}

const actions = {
  showNotification({ commit, state: s, rootState }: any, payload: NotifyPayload) {
    const message = String(payload.message || '').trim();
    if (!message) return null;
    const duration = resolveDuration(rootState, payload.type, payload.duration);

    const existing = (s as State).notifications.find((n) => n.type === payload.type && n.message === message);
    if (existing) {
      commit('BUMP_NOTIFICATION', existing.id);
      schedule(commit, existing.id, duration);
      return existing.id;
    }

    sequence += 1;
    const notification: Notification = {
      id: `toast-${Date.now().toString(36)}-${sequence}`,
      type: payload.type,
      message,
      duration,
      count: 1,
    };
    commit('ADD_NOTIFICATION', notification);
    schedule(commit, notification.id, duration);

    const overflow = (s as State).notifications.length - MAX_VISIBLE;
    for (let i = 0; i < overflow; i += 1) {
      commit('REMOVE_NOTIFICATION', (s as State).notifications[0].id);
    }
    return notification.id;
  },

  showSuccess({ dispatch }: any, message: string) {
    return dispatch('showNotification', { type: 'success', message });
  },

  showError({ dispatch }: any, message: string) {
    return dispatch('showNotification', { type: 'error', message });
  },

  showWarning({ dispatch }: any, message: string) {
    return dispatch('showNotification', { type: 'warning', message });
  },

  showInfo({ dispatch }: any, message: string) {
    return dispatch('showNotification', { type: 'info', message });
  },

  /** Pause auto-dismiss while the pointer/focus is on a toast. */
  holdNotification(_ctx: any, id: string) {
    clearTimer(id);
  },

  releaseNotification({ commit, state: s }: any, id: string) {
    const item = (s as State).notifications.find((n) => n.id === id);
    if (item) schedule(commit, id, Math.min(item.duration, 2500));
  },

  removeNotification({ commit }: any, id: string) {
    commit('REMOVE_NOTIFICATION', id);
  },

  clearNotifications({ commit }: any) {
    commit('CLEAR_NOTIFICATIONS');
  },
};

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions,
};
