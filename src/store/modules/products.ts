import apiService from '@/services/api'

interface Product {
  _id?: number
  name: string
  weight: number
  unit: string
  price: number
  currency: string
  barcode: string
  description: string
  categoryId: number
  materialId: number
  stock: number
}

const state = {
  products: [] as Product[],
  loading: false,
  error: null as string | null,
}

const getters = {
  allProducts: (state) => state.products,
  productCount: (state) => state.products.length,
  productsLoading: (state) => state.loading,
  productsError: (state) => state.error,
  lowStockProducts: (state) => state.products.filter(p => p.stock <= 5),
}

const mutations = {
  SET_PRODUCTS(state, products: Product[]) {
    state.products = products
  },
  ADD_PRODUCT(state, product: Product) {
    state.products.push(product)
  },
  UPDATE_PRODUCT(state, updatedProduct: Product) {
    const index = state.products.findIndex(p => p._id === updatedProduct._id)
    if (index !== -1) {
      state.products.splice(index, 1, updatedProduct)
    }
  },
  DELETE_PRODUCT(state, productId: number) {
    state.products = state.products.filter(p => p._id !== productId)
  },
  SET_LOADING(state, loading: boolean) {
    state.loading = loading
  },
  SET_ERROR(state, error: string | null) {
    state.error = error
  },
}

const actions = {
  async fetchProducts({ commit }) {
    commit('SET_LOADING', true)
    commit('SET_ERROR', null)
    try {
      const data = await apiService.get('/products')
      commit('SET_PRODUCTS', data)
    } catch (error: any) {
      commit('SET_ERROR', error.message)
      throw error
    } finally {
      commit('SET_LOADING', false)
    }
  },

  async createProduct({ commit }, product: Product) {
    try {
      const newProduct = await apiService.post('/products', product)
      commit('ADD_PRODUCT', newProduct)
      return newProduct
    } catch (error: any) {
      commit('SET_ERROR', error.message)
      throw error
    }
  },

  async updateProduct({ commit }, product: Product) {
    try {
      const updated = await apiService.put(`/products/${product._id}`, product)
      commit('UPDATE_PRODUCT', updated)
      return updated
    } catch (error: any) {
      commit('SET_ERROR', error.message)
      throw error
    }
  },

  async deleteProduct({ commit }, productId: number) {
    try {
      await apiService.delete(`/products/${productId}`)
      commit('DELETE_PRODUCT', productId)
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
