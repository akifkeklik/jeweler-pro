import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosMock = vi.hoisted(() => {
  const requestUse = vi.fn();
  const responseUse = vi.fn();
  const authPost = vi.fn();
  return {
    requestUse,
    responseUse,
    authPost,
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    retry: vi.fn(),
  };
});

vi.mock('axios', () => ({
  default: {
    create: vi.fn((config: { timeout?: number }) => {
      // authSession.ts creates its own dedicated client (15s timeout, no
      // interceptors); api.ts creates the general client with interceptors.
      if (config?.timeout === 15000) {
        return { post: axiosMock.authPost };
      }
      const instance = Object.assign(axiosMock.retry, {
        get: axiosMock.get,
        post: axiosMock.post,
        put: axiosMock.put,
        delete: axiosMock.delete,
        interceptors: {
          request: { use: axiosMock.requestUse },
          response: { use: axiosMock.responseUse },
        },
      });
      return instance;
    }),
  },
}));

import apiService from '@/services/api';
import { getAccessToken, resetAuthSessionForTests, setSession } from '@/services/authSession';

const user = { id: '1', email: 'a@b.co', name: 'A', role: 'staff', branch: 'M', businessId: 'b', customPermissions: [], permissions: ['sales:read'] };

describe('API service', () => {
  beforeEach(() => {
    resetAuthSessionForTests();
    axiosMock.authPost.mockReset();
    axiosMock.retry.mockReset();
  });

  it('adds the in-memory access token to outgoing requests (not from web storage)', () => {
    sessionStorage.setItem('jeweler_token', 'stale-storage-token');
    setSession({ token: 'memory-token', expiresIn: 900, user });
    const requestInterceptor = axiosMock.requestUse.mock.calls[0][0];
    const config = requestInterceptor({ headers: {} });
    expect(config.headers.Authorization).toBe('Bearer memory-token');
  });

  it('does not send an Authorization header without a session', () => {
    const requestInterceptor = axiosMock.requestUse.mock.calls[0][0];
    const config = requestInterceptor({ headers: {} });
    expect(config.headers.Authorization).toBeUndefined();
  });

  it('returns response data from CRUD calls', async () => {
    axiosMock.get.mockResolvedValueOnce({ data: [{ id: 1 }] });
    await expect(apiService.get('/api/products')).resolves.toEqual([{ id: 1 }]);
  });

  it('on 401 refreshes via the HttpOnly cookie once and retries the request with the new token', async () => {
    setSession({ token: 'expired', expiresIn: 900, user });
    axiosMock.authPost.mockResolvedValueOnce({ data: { token: 'fresh', expiresIn: 900, user } });
    axiosMock.retry.mockResolvedValueOnce({ data: 'ok' });
    const onRejected = axiosMock.responseUse.mock.calls[0][1];
    const original = { url: '/api/products', headers: {} as Record<string, string> };

    await onRejected({ response: { status: 401, data: {} }, config: original });

    expect(axiosMock.authPost).toHaveBeenCalledWith('/api/auth/refresh', {});
    expect(axiosMock.retry).toHaveBeenCalledTimes(1);
    expect(original.headers.Authorization).toBe('Bearer fresh');
    expect(getAccessToken()).toBe('fresh');
  });

  it('when refresh fails the session is cleared and a SESSION_EXPIRED error is returned', async () => {
    setSession({ token: 'expired', expiresIn: 900, user });
    axiosMock.authPost.mockRejectedValueOnce({ response: { status: 401, data: { code: 'REFRESH_TOKEN_INVALID' } } });
    const onRejected = axiosMock.responseUse.mock.calls[0][1];

    await expect(onRejected({ response: { status: 401, data: {} }, config: { url: '/api/sales', headers: {} } }))
      .rejects.toMatchObject({ code: 'SESSION_EXPIRED', status: 401 });
    expect(getAccessToken()).toBeNull();
    expect(axiosMock.retry).not.toHaveBeenCalled();
  });
});
