import apiService from '@/services/api'

interface Customer {
  _id?: number
  name: string
  phone: string
  email: string
  address: string
  customerType: 'bireysel' | 'kurumsal'
}

const state = {
  customers: [] as Customer[],
  loading: false,
  error: null as string | null,
}

const getters = {
  allCustomers: (state) => state.customers,
  customerCount: (state) => state.customers.length,
  customersLoading: (state) => state.loading,
  customersError: (state) => state.error,
}

const mutations = {
  SET_CUSTOMERS(state, customers: Customer[]) {
    state.customers = customers
  },
  ADD_CUSTOMER(state, customer: Customer) {
    state.customers.push(customer)
  },
  UPDATE_CUSTOMER(state, updatedCustomer: Customer) {
    const index = state.customers.findIndex(c => c._id === updatedCustomer._id)
    if (index !== -1) {
      state.customers.splice(index, 1, updatedCustomer)
    }
  },
  DELETE_CUSTOMER(state, customerId: number) {
    state.customers = state.customers.filter(c => c._id !== customerId)
  },
  SET_LOADING(state, loading: boolean) {
    state.loading = loading
  },
  SET_ERROR(state, error: string | null) {
    state.error = error
  },
}

const actions = {
  async fetchCustomers({ commit }) {
    commit('SET_LOADING', true)
    commit('SET_ERROR', null)
    try {
      const data = await apiService.get('/customers')
      commit('SET_CUSTOMERS', data)
    } catch (error: any) {
      commit('SET_ERROR', error.message)
      throw error
    } finally {
      commit('SET_LOADING', false)
    }
  },

  async createCustomer({ commit }, customer: Customer) {
    try {
      const newCustomer = await apiService.post('/customers', customer)
      commit('ADD_CUSTOMER', newCustomer)
      return newCustomer
    } catch (error: any) {
      commit('SET_ERROR', error.message)
      throw error
    }
  },

  async updateCustomer({ commit }, customer: Customer) {
    try {
      const updated = await apiService.put(`/customers/${customer._id}`, customer)
      commit('UPDATE_CUSTOMER', updated)
      return updated
    } catch (error: any) {
      commit('SET_ERROR', error.message)
      throw error
    }
  },

  async deleteCustomer({ commit }, customerId: number) {
    try {
      await apiService.delete(`/customers/${customerId}`)
      commit('DELETE_CUSTOMER', customerId)
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
