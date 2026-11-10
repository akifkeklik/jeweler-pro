import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/services/api', () => ({ default: apiMock }));

import ResetPasswordPageComponent from '@/pages/ResetPasswordPage.vue';

const ResetPasswordPage = ResetPasswordPageComponent as any;

const TOKEN = 'a'.repeat(64);

function context(query: Record<string, string> = { token: TOKEN }) {
  const ctx: any = {
    ...ResetPasswordPage.data(),
    $route: { path: '/reset-password', query },
    $router: { replace: vi.fn(async () => undefined), push: vi.fn() },
  };
  for (const [name, fn] of Object.entries(ResetPasswordPage.methods)) ctx[name] = (fn as any).bind(ctx);
  return ctx;
}

describe('ResetPasswordPage', () => {
  beforeEach(() => apiMock.post.mockReset());

  it('removes the token from the URL immediately and validates it with the API', async () => {
    apiMock.post.mockResolvedValueOnce({ valid: true });
    const ctx = context();
    await ResetPasswordPage.mounted.call(ctx);

    expect(ctx.$router.replace).toHaveBeenCalledWith({ path: '/reset-password', query: {} });
    expect(apiMock.post).toHaveBeenCalledWith('/api/auth/reset-password/validate', { token: TOKEN });
    expect(ctx.status).toBe('ready');
    expect(ctx.token).toBe(TOKEN);
  });

  it('shows the invalid state without calling the API for malformed links', async () => {
    const ctx = context({ token: 'not-a-token' });
    await ResetPasswordPage.mounted.call(ctx);
    expect(ctx.status).toBe('invalid');
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('shows the invalid state for expired or used tokens', async () => {
    apiMock.post.mockRejectedValueOnce({ code: 'RESET_TOKEN_INVALID', status: 400 });
    const ctx = context();
    await ResetPasswordPage.mounted.call(ctx);
    expect(ctx.status).toBe('invalid');
    expect(ctx.error).toMatch(/kullanılmış ya da süresi dolmuş/);
  });

  it('rejects mismatched or short passwords client-side', async () => {
    const ctx = context();
    ctx.status = 'ready';
    ctx.token = TOKEN;
    ctx.newPassword = 'Long-enough-pass-1';
    ctx.confirmPassword = 'different-pass-123';
    await ctx.submitReset();
    expect(ctx.error).toMatch(/eşleşmiyor/);

    ctx.newPassword = 'short';
    ctx.confirmPassword = 'short';
    await ctx.submitReset();
    expect(ctx.error).toMatch(/en az 12/);
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('submits the new password, wipes secrets from memory and completes', async () => {
    vi.useFakeTimers();
    apiMock.post.mockResolvedValueOnce({ message: 'ok' });
    const ctx = context();
    ctx.status = 'ready';
    ctx.token = TOKEN;
    ctx.newPassword = 'Brand-New-Secret-2026';
    ctx.confirmPassword = 'Brand-New-Secret-2026';
    await ctx.submitReset();

    expect(apiMock.post).toHaveBeenCalledWith('/api/auth/reset-password', { token: TOKEN, newPassword: 'Brand-New-Secret-2026' });
    expect(ctx.status).toBe('completed');
    expect(ctx.token).toBe('');
    expect(ctx.newPassword).toBe('');
    vi.runAllTimers();
    expect(ctx.$router.push).toHaveBeenCalledWith({ path: '/login', query: { reset: 'success' } });
    vi.useRealTimers();
  });

  it('switches to the invalid state if the token was consumed meanwhile', async () => {
    apiMock.post.mockRejectedValueOnce({ code: 'RESET_TOKEN_INVALID', status: 400 });
    const ctx = context();
    ctx.status = 'ready';
    ctx.token = TOKEN;
    ctx.newPassword = 'Brand-New-Secret-2026';
    ctx.confirmPassword = 'Brand-New-Secret-2026';
    await ctx.submitReset();
    expect(ctx.status).toBe('invalid');
  });
});
