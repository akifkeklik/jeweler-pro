import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadAllLocales } from '@/i18n';

const post = vi.fn();
const get = vi.fn();
vi.mock('@/services/api', () => ({ default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

const { default: DailyClosingPanel } = await import('@/components/reports/DailyClosingPanel.vue');
const methods = (DailyClosingPanel as any).methods;
const computed = (DailyClosingPanel as any).computed;

beforeAll(() => loadAllLocales());

function panel() {
  const ctx: any = {
    summary: { calculatedCash: 1000, closing: null },
    form: { closingCashActual: 1000, closingGoldActual: '', notes: '' },
    saving: false,
    $store: { dispatch: vi.fn() },
  };
  ctx.load = () => methods.load.call(ctx);
  ctx.tl = (v: unknown) => String(v);
  return ctx;
}

describe('daily closing panel', () => {
  it('shows the day as closed from the POST answer even if the refresh fails', async () => {
    const ctx = panel();
    post.mockResolvedValueOnce({ isClosed: true, closingCashActual: 1000 });
    get.mockRejectedValueOnce(new Error('network'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await methods.submit.call(ctx);
    expect(post).toHaveBeenCalledWith('/api/cash/daily-closing', { closingCashActual: '1000', notes: '' });
    expect(computed.dayClosed.call(ctx)).toBe(true);
    expect(ctx.$store.dispatch).toHaveBeenCalledWith('notifications/showSuccess', expect.any(String));
    expect(ctx.saving).toBe(false);
  });

  it('keeps the day open and reports the error when the closing is refused', async () => {
    const ctx = panel();
    post.mockRejectedValueOnce(new Error('Gün zaten kapalı'));
    await methods.submit.call(ctx);
    expect(computed.dayClosed.call(ctx)).toBe(false);
    expect(ctx.$store.dispatch).toHaveBeenCalledWith('notifications/showError', expect.stringContaining('Gün zaten kapalı'));
  });
});
