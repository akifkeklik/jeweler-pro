import apiService from '@/services/api'

interface Sale {
  _id?: string
  customerName: string
  productName: string
  quantity: number
  totalPrice: number
  paymentMethod: string
  date: string
}

const state = {
  sales: [] as Sale[],
  loading: false,
  error: null as string | null,
}

const getters = {
  allSales: (state) => state.sales,
  saleCount: (state) => state.sales.length,
  salesLoading: (state) => state.loading,
  salesError: (state) => state.error,
}

const mutations = {
  SET_SALES(state, sales: Sale[]) {
    state.sales = sales
  },
  ADD_SALE(state, sale: Sale) {
    state.sales.push(sale)
  },
  UPDATE_SALE(state, updatedSale: Sale) {
    const index = state.sales.findIndex(s => s._id === updatedSale._id)
    if (index !== -1) {
      state.sales.splice(index, 1, updatedSale)
    }
  },
  DELETE_SALE(state, saleId: string) {
    state.sales = state.sales.filter(s => s._id !== saleId)
  },
  SET_LOADING(state, loading: boolean) {
    state.loading = loading
  },
  SET_ERROR(state, error: string | null) {
    state.error = error
  },
}

const actions = {
  async fetchSales({ commit }) {
    commit('SET_LOADING', true)
    commit('SET_ERROR', null)
    try {
      const data = await apiService.get('/sales')
      commit('SET_SALES', data)
    } catch (error: any) {
      commit('SET_ERROR', error.message)
      throw error
    } finally {
      commit('SET_LOADING', false)
    }
  },

  async createSale({ commit }, sale: Sale) {
    try {
      const newSale = await apiService.post('/sales', sale)
      commit('ADD_SALE', newSale)
      return newSale
    } catch (error: any) {
      commit('SET_ERROR', error.message)
      throw error
    }
  },

  async updateSale({ commit }, sale: Sale) {
    try {
      const updated = await apiService.put(`/sales/${sale._id}`, sale)
      commit('UPDATE_SALE', updated)
      return updated
    } catch (error: any) {
      commit('SET_ERROR', error.message)
      throw error
    }
  },

  async deleteSale({ commit }, saleId: string) {
    try {
      await apiService.delete(`/sales/${saleId}`)
      commit('DELETE_SALE', saleId)
    } catch (error: any) {
      commit('SET_ERROR', error.message)
      throw error
    }
  },
}

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions,
}
