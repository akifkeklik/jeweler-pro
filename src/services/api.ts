import axios, { AxiosError, AxiosInstance } from 'axios';

// API instance oluştur
const apiInstance: AxiosInstance = axios.create({
  baseURL: process.env.VUE_APP_API_URL || 'http://localhost:5000',
  timeout: parseInt(process.env.VUE_APP_API_TIMEOUT || '30000'),
  headers: {
    'Content-Type': 'application/json',
  },
});

apiInstance.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('jeweler_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor - hata yönetimi
apiInstance.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401 && window.location.pathname !== '/login') {
      sessionStorage.removeItem('jeweler_token');
      sessionStorage.removeItem('jeweler_user');
      window.location.assign('/login');
    }
    // Network hatası
    if (!error.response) {
      console.error('🔴 Network Error:', error.message);
      return Promise.reject({
        message: 'Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.',
        code: 'NETWORK_ERROR',
        original: error,
      });
    }

    // Server hatası (5xx)
    if (error.response?.status >= 500) {
      console.error('🔴 Server Error:', error.response.status, error.response.data);
      return Promise.reject({
        message: 'Sunucuda bir hata oluştu. Lütfen daha sonra tekrar deneyin.',
        code: 'SERVER_ERROR',
        status: error.response.status,
      });
    }

    // Client hatası (4xx)
    if (error.response?.status >= 400) {
      console.error('🟡 Client Error:', error.response.status, error.response.data);
      const responseData = error.response.data as Record<string, any>;
      return Promise.reject({
        message: responseData?.error || 'İşlem başarısız oldu.',
        code: 'CLIENT_ERROR',
        status: error.response.status,
        data: error.response.data,
      });
    }

    return Promise.reject(error);
  }
);

// API servis fonksiyonları
export const apiService = {
  // GET
  async get<T = any>(endpoint: string): Promise<T> {
    const response = await apiInstance.get<T>(endpoint);
    return response.data;
  },

  // POST
  async post<T = any>(endpoint: string, data: any): Promise<T> {
    const response = await apiInstance.post<T>(endpoint, data);
    return response.data;
  },

  // PUT
  async put<T = any>(endpoint: string, data: any): Promise<T> {
    const response = await apiInstance.put<T>(endpoint, data);
    return response.data;
  },

  // DELETE
  async delete<T = any>(endpoint: string): Promise<T> {
    const response = await apiInstance.delete<T>(endpoint);
    return response.data;
  },
};

export default apiService;
