import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  safeRedirectPath: (value: unknown, fallback = '/dashboard') =>
    typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : fallback,
  authState: { user: null, accessToken: null, persistent: false, sessionExpiresAt: null },
  hasPermission: vi.fn(() => true),
}));
const apiMock = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('@/services/authSession', () => authMock);
vi.mock('@/services/api', () => ({ default: apiMock }));
vi.mock('@/plugins/vuetify', () => ({
  default: { theme: { global: { name: { value: 'dark' }, change: vi.fn() } } },
}));

import LoginPage from '@/pages/LoginPage.vue';
import App from '@/App.vue';

function loginContext(overrides = {}) {
  return {
    email: 'user@example.com',
    password: 'valid-password-123',
    rememberMe: false,
    loading: false,
    error: '',
    successNotice: '',
    $route: { query: {} },
    $router: { replace: vi.fn() },
    ...overrides,
  };
}

describe('authentication UI flows', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    authMock.login.mockReset();
    authMock.logout.mockReset();
    apiMock.post.mockReset();
  });

  it('logs in through the session service, forwards Beni Hatırla and never persists tokens in web storage', async () => {
    authMock.login.mockResolvedValueOnce({ id: '1', email: 'user@example.com', role: 'staff', permissions: [] });
    const context = loginContext({ rememberMe: true });

    await LoginPage.methods!.login.call(context);

    expect(authMock.login).toHaveBeenCalledWith('user@example.com', 'valid-password-123', true);
    expect(context.$router.replace).toHaveBeenCalledWith('/dashboard');
    expect(context.password).toBe('');
    expect(Object.keys({ ...sessionStorage })).toEqual([]);
    expect(Object.keys({ ...localStorage })).toEqual([]);
  });

  it('only follows same-origin redirects after login (no open redirect)', async () => {
    authMock.login.mockResolvedValue({});
    const safe = loginContext({ $route: { query: { redirect: '/reports' } } });
    await LoginPage.methods!.login.call(safe);
    expect(safe.$router.replace).toHaveBeenCalledWith('/reports');

    const evil = loginContext({ $route: { query: { redirect: '//evil.example/phish' } } });
    await LoginPage.methods!.login.call(evil);
    expect(evil.$router.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('shows the server error and a dedicated message when rate limited', async () => {
    authMock.login.mockRejectedValueOnce({ message: 'E-posta veya şifre hatalı', status: 401 });
    const context = loginContext();
    await LoginPage.methods!.login.call(context);
    expect(context.error).toBe('E-posta veya şifre hatalı');

    authMock.login.mockRejectedValueOnce({ message: 'x', status: 429 });
    await LoginPage.methods!.login.call(context);
    expect(context.error).toMatch(/15 dakika/);
  });

  it('reports unconfigured / unreachable e-mail honestly instead of a fake success', async () => {
    const context = { forgotEmail: 'a@b.co', forgotLoading: false, forgotError: '', forgotSuccess: '' };

    apiMock.post.mockRejectedValueOnce({ code: 'SMTP_UNCONFIGURED', status: 503 });
    await LoginPage.methods!.requestPasswordReset.call(context);
    expect(context.forgotSuccess).toBe('');
    expect(context.forgotError).toMatch(/yapılandırılmamış/);

    apiMock.post.mockRejectedValueOnce({ code: 'SMTP_UNAVAILABLE', status: 503 });
    await LoginPage.methods!.requestPasswordReset.call(context);
    expect(context.forgotSuccess).toBe('');
    expect(context.forgotError).toMatch(/ulaşılamıyor/);

    apiMock.post.mockResolvedValueOnce({ message: 'Eğer e-posta adresi sistemimizde kayıtlı ise …' });
    await LoginPage.methods!.requestPasswordReset.call(context);
    expect(apiMock.post).toHaveBeenLastCalledWith('/api/auth/forgot-password', { email: 'a@b.co' });
    expect(context.forgotSuccess).toMatch(/kayıtlı ise/);
  });

  it('revokes the server session through the session service before routing to login', async () => {
    const order: string[] = [];
    authMock.logout.mockImplementationOnce(async () => { order.push('server-logout'); });
    const replace = vi.fn(() => order.push('navigate'));

    await App.methods!.logout.call({ $router: { replace } });

    expect(authMock.logout).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/login');
    expect(order).toEqual(['server-logout', 'navigate']);
  });
});
