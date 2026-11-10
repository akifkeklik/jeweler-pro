import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      post: http.post,
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    })),
  },
}));

import router from '@/router/index.js';
import { resetAuthSessionForTests, setSession } from '@/services/authSession';

const staff = {
  id: '1', email: 's@x.co', name: 'S', role: 'staff', branch: 'M', businessId: 'b', customPermissions: [],
  permissions: ['dashboard:read', 'prices:read', 'catalog:read', 'customers:read', 'sales:read', 'reports:read'],
};

describe('router authentication & permission guard', () => {
  beforeEach(async () => {
    resetAuthSessionForTests();
    http.post.mockReset();
    http.post.mockRejectedValue({ response: { status: 401, data: { code: 'REFRESH_TOKEN_MISSING' } } });
    await router.push('/login');
    resetAuthSessionForTests();
  });

  it('redirects anonymous users to login after a failed silent restore', async () => {
    await router.push('/sales');
    expect(router.currentRoute.value.fullPath).toBe('/login?redirect=/sales');
    expect(http.post).toHaveBeenCalledWith('/api/auth/refresh', {});
  });

  it('restores a remembered session from the HttpOnly cookie on first navigation', async () => {
    http.post.mockResolvedValueOnce({ data: { token: 'restored', expiresIn: 900, user: staff } });
    await router.push('/sales');
    expect(router.currentRoute.value.path).toBe('/sales');
  });

  it('allows authenticated users into permitted routes', async () => {
    setSession({ token: 'test-token', expiresIn: 900, user: staff });
    await router.push('/sales');
    expect(router.currentRoute.value.path).toBe('/sales');
  });

  it('does not show login to authenticated users', async () => {
    setSession({ token: 'test-token', expiresIn: 900, user: staff });
    await router.push('/dashboard');
    await router.push('/login');
    expect(router.currentRoute.value.path).toBe('/dashboard');
  });

  it('blocks routes whose backend permission the user lacks', async () => {
    setSession({ token: 'test-token', expiresIn: 900, user: { ...staff, permissions: ['dashboard:read'] } });
    await router.push('/reports');
    expect(router.currentRoute.value.path).toBe('/dashboard');
  });

  it('keeps the reset-password page reachable for signed-in users', async () => {
    setSession({ token: 'test-token', expiresIn: 900, user: staff });
    await router.push('/reset-password');
    expect(router.currentRoute.value.path).toBe('/reset-password');
  });
});
