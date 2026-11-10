import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL, clearSession, getAccessToken, refreshSession } from '@/services/authSession';
import { localizeApiError } from '@/services/apiErrors';
import { API_TIMEOUT_MS } from '@/config/env';
import { t } from '@/i18n';

// API instance
const apiInstance: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
  withCredentials: true, // the HttpOnly refresh cookie travels only to /api/auth
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
});

// The access token is read from memory on every request (never from storage).
apiInstance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const AUTH_ENDPOINTS = ['/api/auth/login', '/api/auth/refresh', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/logout'];

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (pathname.startsWith('/login') || pathname.startsWith('/reset-password')) return;
  const redirect = encodeURIComponent(pathname + search);
  window.location.assign(`/login?redirect=${redirect}&expired=1`);
}

// Response interceptor - transparent token renewal & error normalisation
apiInstance.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !AUTH_ENDPOINTS.some((endpoint) => originalRequest.url?.includes(endpoint))
    ) {
      originalRequest._retry = true;
      try {
        const refreshed = await refreshSession();
        originalRequest.headers.Authorization = `Bearer ${refreshed.token}`;
        return apiInstance(originalRequest);
      } catch {
        clearSession();
        redirectToLogin();
        return Promise.reject({
          message: t('errors.sessionExpired'),
          code: 'SESSION_EXPIRED',
          status: 401,
        });
      }
    }

    // Network error
    if (!error.response) {
      console.error('🔴 Network Error:', error.message);
      return Promise.reject({
        message: t('errors.network'),
        code: 'NETWORK_ERROR',
        original: error,
      });
    }

    // Server error (5xx)
    if (error.response.status >= 500) {
      console.error('🔴 Server Error:', error.response.status, error.response.data);
      const resData = error.response.data as Record<string, any>;
      return Promise.reject({
        message: localizeApiError({ status: error.response.status, code: resData?.code, serverMessage: resData?.error }),
        code: resData?.code || 'SERVER_ERROR',
        status: error.response.status,
      });
    }

    // Client error (4xx)
    if (error.response.status >= 400) {
      console.error('🟡 Client Error:', error.response.status, error.response.data);
      const responseData = error.response.data as Record<string, any>;
      return Promise.reject({
        message: localizeApiError({ status: error.response.status, code: responseData?.code, serverMessage: responseData?.error }),
        code: responseData?.code || 'CLIENT_ERROR',
        status: error.response.status,
        data: error.response.data,
      });
    }

    return Promise.reject(error);
  }
);

// API service functions
export const apiService = {
  async get<T = any>(endpoint: string, config?: any): Promise<T> {
    const response = await apiInstance.get<T>(endpoint, config);
    return response.data;
  },

  async post<T = any>(endpoint: string, data?: any, config?: any): Promise<T> {
    const response = await apiInstance.post<T>(endpoint, data, config);
    return response.data;
  },

  async put<T = any>(endpoint: string, data: any): Promise<T> {
    const response = await apiInstance.put<T>(endpoint, data);
    return response.data;
  },

  async patch<T = any>(endpoint: string, data?: any): Promise<T> {
    const response = await apiInstance.patch<T>(endpoint, data);
    return response.data;
  },

  async delete<T = any>(endpoint: string): Promise<T> {
    const response = await apiInstance.delete<T>(endpoint);
    return response.data;
  },
};

export default apiService;
