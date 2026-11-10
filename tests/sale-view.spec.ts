import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/services/api', () => ({ default: { get } }));
vi.mock('@/services/authSession', () => ({ hasPermission: (p: string) => p === 'sales:write' }));

import { canCollect, canReturn, installmentText, laborText, saleFinancial, saleStatusBadge, type SaleView } from '@/services/saleView';
import { defaultProviderId, installmentsOf, loadActivePosProviders } from '@/services/posProviders';
import { loadLocale, setI18nPreferences } from '@/i18n';

const journaled = (over: Partial<SaleView> = {}): SaleView => ({
  _id: 1, date: '2026-11-10', status: 'completed', lines: [],
  financial: { journaled: true, total: 100, paid: 40, returned: 0, balanceDue: 60, paymentStatus: 'partial' },
  ...over,
});

describe('sale view rules', () => {
  it('treats legacy sales (no financial view) as fully paid', () => {
    expect(saleFinancial({ _id: 2, date: '', totalPrice: 250 } as SaleView)).toEqual({ total: 250, paid: 250, balanceDue: 0, returned: 0, paymentStatus: 'paid' });
    expect(saleFinancial(null).total).toBe(0);
  });

  it('collect and return are only offered on journaled, open sales', () => {
    expect(canCollect(journaled())).toBe(true);
    expect(canCollect(journaled({ status: 'cancelled' }))).toBe(false);
    expect(canCollect({ ...journaled(), financial: { ...journaled().financial!, balanceDue: 0 } })).toBe(false);
    expect(canReturn(journaled())).toBe(true);
    expect(canReturn(journaled({ status: 'returned' }))).toBe(false);
    expect(canReturn({ _id: 3, date: '', status: 'completed' })).toBe(false);
  });

  it('badges: cancelled, returned, open balance, paid', () => {
    expect(saleStatusBadge(journaled({ status: 'cancelled' }))).toBe('jp-badge-danger');
    expect(saleStatusBadge(journaled({ status: 'partially_returned' }))).toBe('jp-badge-info');
    expect(saleStatusBadge(journaled())).toBe('jp-badge-warning');
    expect(saleStatusBadge({ _id: 4, date: '', totalPrice: 1 })).toBe('jp-badge-success');
  });

  it('labour text follows the active language (no hard-coded Turkish)', async () => {
    await loadLocale('en');
    setI18nPreferences({ language: 'en' });
    expect(laborText({ laborType: 'none' })).toBe('None');
    expect(laborText({ laborType: 'milyem', laborValue: '35' })).toBe('35‰');
    expect(laborText({ laborType: 'fixed', laborValue: '250' })).toBe('250 ₺');
    expect(installmentText(1)).not.toBe('');
    setI18nPreferences({ language: 'tr' });
    expect(laborText({ laborType: 'none' })).toBe('Yok');
  });
});

describe('POS provider options', () => {
  beforeEach(() => get.mockReset());

  it('loads active providers and tolerates failures', async () => {
    get.mockResolvedValueOnce([{ _id: 'a', name: 'Bank', installments: [1, 3] }]);
    expect(await loadActivePosProviders()).toHaveLength(1);
    get.mockRejectedValueOnce(new Error('down'));
    expect(await loadActivePosProviders()).toEqual([]);
    get.mockResolvedValueOnce(null);
    expect(await loadActivePosProviders()).toEqual([]);
  });

  it('defaults to the only provider and its installments', () => {
    const one = [{ _id: 'a', name: 'Bank', installments: [1, 3, 6] }];
    expect(defaultProviderId(one)).toBe('a');
    expect(installmentsOf(one, '')).toEqual([1, 3, 6]);
    const two = [...one, { _id: 'b', name: 'Other', installments: [] }];
    expect(defaultProviderId(two)).toBe('');
    expect(installmentsOf(two, 'b')).toEqual([1]);
    expect(installmentsOf(two, '')).toEqual([1]);
  });
});
