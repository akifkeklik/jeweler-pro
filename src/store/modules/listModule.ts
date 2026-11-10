import type { Module } from 'vuex';
import apiService from '@/services/api';

/**
 * Read-model store module for a server-owned list (sales, customers).
 *
 * The server is the only writer: screens create, change and delete records
 * through the API and then re-fetch, so the store never holds optimistic
 * client state. One factory keeps every list module identical and typed.
 */
export interface ListState<T> {
  items: T[];
  loading: boolean;
  error: string | null;
}

export function createListModule<T, RootState = unknown>(endpoint: string): Module<ListState<T>, RootState> {
  return {
    namespaced: true,
    state: (): ListState<T> => ({ items: [], loading: false, error: null }),
    getters: {
      count: (state): number => state.items.length,
    },
    mutations: {
      setItems(state, items: T[]) {
        state.items = items;
      },
      setLoading(state, loading: boolean) {
        state.loading = loading;
      },
      setError(state, error: string | null) {
        state.error = error;
      },
    },
    actions: {
      async fetch({ commit }): Promise<T[]> {
        commit('setLoading', true);
        commit('setError', null);
        try {
          const data = await apiService.get<T[]>(endpoint);
          const items = Array.isArray(data) ? data : [];
          commit('setItems', items);
          return items;
        } catch (error) {
          commit('setError', error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error));
          throw error;
        } finally {
          commit('setLoading', false);
        }
      },
    },
  };
}
