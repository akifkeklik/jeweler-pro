import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ post: vi.fn(), createConfig: null as any }));

vi.mock('axios', () => ({
  default: {
    create: vi.fn((config: unknown) => {
      http.createConfig = config;
      return { post: http.post };
    }),
  },
}));

import {
  authState,
  getAccessToken,
  hasPermission,
  isAuthenticated,
  login,
  logout,
  refreshSession,
  resetAuthSessionForTests,
  restoreSession,
  safeRedirectPath,
} from '@/services/authSession';

const user = {
  id: 'u1',
  email: 'kasa@kuyumcu.test',
  name: 'Kasa',
  role: 'staff',
  branch: 'Merkez',
  businessId: 'b1',
  customPermissions: ['audit:read'],
  permissions: ['sales:read', 'audit:read'],
};
const authResponse = (token = 'access-1', persistent = false) => ({
  data: { token, expiresIn: 900, user, session: { id: 's1', persistent, expiresAt: '2030-01-01T00:00:00.000Z' } },
});

describe('authSession (in-memory tokens + HttpOnly refresh cookie)', () => {
  beforeEach(() => {
    resetAuthSessionForTests();
    http.post.mockReset();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('uses credentials and the CSRF header required by the API', () => {
    expect(http.createConfig.withCredentials).toBe(true);
    expect(http.createConfig.headers['X-Requested-With']).toBe('XMLHttpRequest');
  });

  it('keeps the access token only in memory — nothing is written to localStorage or sessionStorage', async () => {
    http.post.mockResolvedValueOnce(authResponse('secret-access', true));
    await login('kasa@kuyumcu.test', 'pw-123456789012', true);

    expect(http.post).toHaveBeenCalledWith('/api/auth/login', {
      email: 'kasa@kuyumcu.test',
      password: 'pw-123456789012',
      rememberMe: true,
    });
    expect(getAccessToken()).toBe('secret-access');
    expect(authState.persistent).toBe(true);
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-access');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret-access');
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it('exposes backend permissions for menu/button decisions', async () => {
    http.post.mockResolvedValueOnce(authResponse());
    await login('kasa@kuyumcu.test', 'pw-123456789012', false);
    expect(hasPermission('audit:read')).toBe(true);
    expect(hasPermission('users:write')).toBe(false);
  });

  it('normalises login errors from the API', async () => {
    http.post.mockRejectedValueOnce({ response: { status: 401, data: { error: 'E-posta veya şifre hatalı' } } });
    await expect(login('x@y.z', 'bad', false)).rejects.toMatchObject({ status: 401, message: 'E-posta veya şifre hatalı' });
    expect(isAuthenticated()).toBe(false);
  });

  it('single-flight refresh: concurrent callers share one request (rotating token presented once)', async () => {
    let resolve: (v: unknown) => void = () => {};
    http.post.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const a = refreshSession();
    const b = refreshSession();
    resolve(authResponse('access-2'));
    await Promise.all([a, b]);
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe('access-2');
  });

  it('retries once when another tab rotated the cookie (409 REFRESH_TOKEN_ROTATED)', async () => {
    http.post
      .mockRejectedValueOnce({ response: { status: 409, data: { code: 'REFRESH_TOKEN_ROTATED' } } })
      .mockResolvedValueOnce(authResponse('access-after-race'));
    await refreshSession();
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBe('access-after-race');
  });

  it('restores the session from the cookie once per page load; a failure is not retried on every navigation', async () => {
    http.post.mockRejectedValueOnce({ response: { status: 401, data: { code: 'REFRESH_TOKEN_MISSING' } } });
    expect(await restoreSession()).toBe(false);
    expect(await restoreSession()).toBe(false);
    expect(http.post).toHaveBeenCalledTimes(1);

    resetAuthSessionForTests();
    http.post.mockResolvedValueOnce(authResponse('restored'));
    expect(await restoreSession()).toBe(true);
    expect(getAccessToken()).toBe('restored');
  });

  it('logout calls the API with the bearer token and always clears local state', async () => {
    http.post.mockResolvedValueOnce(authResponse('access-x'));
    await login('kasa@kuyumcu.test', 'pw-123456789012', true);
    http.post.mockRejectedValueOnce(new Error('network down'));
    await logout();
    expect(http.post).toHaveBeenLastCalledWith('/api/auth/logout', {}, { headers: { Authorization: 'Bearer access-x' } });
    expect(isAuthenticated()).toBe(false);
    expect(authState.user).toBeNull();
  });

  it('accepts only in-app redirect targets', () => {
    expect(safeRedirectPath('/sales?x=1')).toBe('/sales?x=1');
    expect(safeRedirectPath('//evil.example')).toBe('/dashboard');
    expect(safeRedirectPath('https://evil.example')).toBe('/dashboard');
    expect(safeRedirectPath('/\\evil.example')).toBe('/dashboard');
    expect(safeRedirectPath('/login')).toBe('/dashboard');
    expect(safeRedirectPath(undefined)).toBe('/dashboard');
  });
});
