/**
 * Browser-side session state.
 *
 * Security model
 * - The access token lives ONLY in memory (never localStorage/sessionStorage),
 *   so it is not persisted and not trivially harvestable from storage.
 * - Persistence ("Beni Hatırla") is provided by the HttpOnly refresh cookie set
 *   by the API; JavaScript can neither read nor write it.
 * - After a reload or in a new tab the session is restored by calling
 *   POST /api/auth/refresh, which rotates the refresh cookie.
 */
import axios, { AxiosError } from 'axios';
import { reactive, readonly } from 'vue';
import { localizeApiError } from '@/services/apiErrors';
import { t } from '@/i18n';
import { API_URL } from '@/config/env';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  branch: string;
  businessId: string;
  customPermissions: string[];
  permissions: string[];
}

export interface AuthResponse {
  token: string;
  expiresIn: number;
  user: SessionUser;
  session?: { id: string; persistent: boolean; expiresAt: string };
}

export interface AuthError {
  message: string;
  code: string;
  status?: number;
}

/**
 * Used only when VITE_API_URL (or the legacy VUE_APP_API_URL) is not configured. It must match the API's
 * own default (`PORT` unset → 5000 in backend/server.js) and the documented
 * value in .env.example; tests/pr8-remediation.spec.ts ("API base URL
 * fallback") enforces both.
 */
export const DEFAULT_API_BASE_URL = 'http://localhost:5000';

export function resolveApiBaseUrl(configured: string | undefined | null): string {
  const value = typeof configured === 'string' ? configured.trim() : '';
  return value || DEFAULT_API_BASE_URL;
}

export const API_BASE_URL = resolveApiBaseUrl(API_URL);

const state = reactive({
  accessToken: null as string | null,
  accessTokenExpiresAt: 0,
  user: null as SessionUser | null,
  persistent: false,
  sessionExpiresAt: null as string | null,
});

export const authState = readonly(state);

// Remove tokens written by earlier versions of the app.
try {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem('jeweler_token');
    sessionStorage.removeItem('jeweler_user');
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('jeweler_token');
    localStorage.removeItem('jeweler_user');
  }
} catch {
  // storage may be unavailable (private mode); nothing to clean up
}

const authHttp = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    // Required by the API's CSRF guard on cookie-authenticated endpoints.
    'X-Requested-With': 'XMLHttpRequest',
  },
});

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInFlight: Promise<AuthResponse> | null = null;
let restoreInFlight: Promise<boolean> | null = null;
let restoreAttempted = false;

export function toAuthError(error: unknown, fallback?: string): AuthError {
  const axiosError = error as AxiosError<{ error?: string; code?: string }>;
  if (axiosError?.response) {
    const status = axiosError.response.status;
    const code = axiosError.response.data?.code;
    const serverMessage = axiosError.response.data?.error;
    return {
      message: serverMessage || code
        ? localizeApiError({ status, code, serverMessage })
        : fallback || localizeApiError({ status }),
      code: axiosError.response.data?.code || (axiosError.response.status >= 500 ? 'SERVER_ERROR' : 'CLIENT_ERROR'),
      status: axiosError.response.status,
    };
  }
  if ((error as AuthError)?.message && (error as AuthError)?.code) return error as AuthError;
  return {
    message: t('errors.network'),
    code: 'NETWORK_ERROR',
  };
}

function scheduleProactiveRefresh(expiresInSeconds: number) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (typeof window === 'undefined' || !Number.isFinite(expiresInSeconds)) return;
  // Renew one minute before expiry (at least after 30s) to avoid 401 round-trips.
  const delayMs = Math.max(30, expiresInSeconds - 60) * 1000;
  refreshTimer = setTimeout(() => {
    refreshSession().catch(() => {
      /* the API interceptor handles the next 401 */
    });
  }, delayMs);
}

export function setSession(data: AuthResponse) {
  state.accessToken = data.token;
  state.accessTokenExpiresAt = Date.now() + (Number(data.expiresIn) || 0) * 1000;
  state.user = data.user ? { ...data.user, permissions: [...(data.user.permissions || [])] } : null;
  state.persistent = Boolean(data.session?.persistent);
  state.sessionExpiresAt = data.session?.expiresAt || null;
  restoreAttempted = true;
  scheduleProactiveRefresh(Number(data.expiresIn));
}

export function clearSession() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  state.accessToken = null;
  state.accessTokenExpiresAt = 0;
  state.user = null;
  state.persistent = false;
  state.sessionExpiresAt = null;
}

export function getAccessToken(): string | null {
  return state.accessToken;
}

export function isAuthenticated(): boolean {
  return Boolean(state.accessToken && state.user);
}

export function getCurrentUser(): SessionUser | null {
  return state.user;
}

export function hasPermission(permission: string): boolean {
  return Boolean(state.user?.permissions?.includes(permission));
}

export function updateCurrentUser(user: Partial<SessionUser>) {
  if (state.user) state.user = { ...state.user, ...user };
}

export async function login(email: string, password: string, rememberMe: boolean): Promise<SessionUser> {
  try {
    const { data } = await authHttp.post<AuthResponse>('/api/auth/login', { email, password, rememberMe });
    setSession(data);
    return data.user;
  } catch (error) {
    throw toAuthError(error, t('errors.loginFailed'));
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function performRefresh(): Promise<AuthResponse> {
  try {
    const { data } = await authHttp.post<AuthResponse>('/api/auth/refresh', {});
    setSession(data);
    return data;
  } catch (error) {
    const normalized = toAuthError(error, t('errors.refreshFailed'));
    // Another tab rotated the shared refresh cookie a moment ago; the browser
    // already holds the new cookie, so a single retry succeeds.
    if (normalized.code === 'REFRESH_TOKEN_ROTATED') {
      await wait(250);
      try {
        const { data } = await authHttp.post<AuthResponse>('/api/auth/refresh', {});
        setSession(data);
        return data;
      } catch (retryError) {
        clearSession();
        throw toAuthError(retryError, t('errors.refreshFailed'));
      }
    }
    if (normalized.status === 401) clearSession();
    throw normalized;
  }
}

/**
 * Single-flight refresh: concurrent callers share one network request so the
 * rotating refresh token is never presented twice by this tab.
 */
export function refreshSession(): Promise<AuthResponse> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * Restores the session from the refresh cookie once per page load.
 */
export function restoreSession(): Promise<boolean> {
  if (isAuthenticated()) return Promise.resolve(true);
  if (restoreAttempted) return Promise.resolve(false);
  if (!restoreInFlight) {
    restoreInFlight = refreshSession()
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        restoreAttempted = true;
        restoreInFlight = null;
      });
  }
  return restoreInFlight;
}

function bearerHeaders() {
  return state.accessToken ? { Authorization: `Bearer ${state.accessToken}` } : {};
}

export async function logout(): Promise<void> {
  try {
    await authHttp.post('/api/auth/logout', {}, { headers: bearerHeaders() });
  } catch (error) {
    console.warn('Sunucu oturumu kapatılamadı:', toAuthError(error).message);
  } finally {
    clearSession();
  }
}

export async function logoutAllDevices(): Promise<void> {
  try {
    await authHttp.post('/api/auth/logout-all', {}, { headers: bearerHeaders() });
  } finally {
    clearSession();
  }
}

/**
 * Only same-origin, in-app paths are accepted as post-login redirects.
 */
export function safeRedirectPath(value: unknown, fallback = '/dashboard'): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (value.startsWith('/login') || value.startsWith('/reset-password')) return fallback;
  return value;
}

/** Test helper: forget that a restore was attempted. */
export function resetAuthSessionForTests() {
  clearSession();
  restoreAttempted = false;
  restoreInFlight = null;
  refreshInFlight = null;
}

export default {
  authState,
  login,
  logout,
  logoutAllDevices,
  refreshSession,
  restoreSession,
  setSession,
  clearSession,
  getAccessToken,
  getCurrentUser,
  isAuthenticated,
  hasPermission,
  updateCurrentUser,
  safeRedirectPath,
};
