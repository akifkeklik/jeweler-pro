import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/services/api', () => ({ default: { get, put }, apiService: { get, put } }));

import { loadSettings } from '@/services/settings';
import {
  clearBusinessProfileCache, emptyProfile, fetchBusinessProfile, saveBusinessProfile, toUpdatePayload,
} from '@/services/businessProfile';

describe('business profile (server-side, no longer in localStorage)', () => {
  beforeEach(() => {
    localStorage.clear();
    get.mockReset();
    put.mockReset();
    clearBusinessProfileCache();
  });

  it('local settings no longer carry business identity, even if an old browser stored it', () => {
    localStorage.setItem('jeweler_settings', JSON.stringify({ businessInfo: { companyName: 'Eski Tarayıcı Verisi' } }));
    expect((loadSettings() as unknown as Record<string, unknown>).businessInfo).toBeUndefined();
  });

  it('ships no fake company data as defaults', () => {
    const empty = emptyProfile();
    expect(empty.companyName).toBe('');
    expect(empty.taxNumber).toBe('');
    expect(empty.vat.enabled).toBe(false);
  });

  it('loads from the API and caches until forced', async () => {
    get.mockResolvedValue({ companyName: 'Sunucu A.Ş.', taxNumber: '1234567890' });
    expect((await fetchBusinessProfile()).companyName).toBe('Sunucu A.Ş.');
    await fetchBusinessProfile();
    expect(get).toHaveBeenCalledTimes(1);
    await fetchBusinessProfile({ force: true });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith('/api/business-profile');
  });

  it('sends only editable fields with a decimal-string threshold', async () => {
    const profile = { ...emptyProfile(), companyName: '  Test  ', configured: true, updatedAt: 'x' };
    profile.compliance.identificationThreshold = 185000 as unknown as number;
    profile.vat.standardRateBp = 2000;
    const payload = toUpdatePayload(profile);
    expect(payload.companyName).toBe('Test');
    expect(payload).not.toHaveProperty('configured');
    expect(payload).not.toHaveProperty('updatedAt');
    expect(payload.compliance.identificationThreshold).toBe('185000.00');

    put.mockResolvedValue({ ...emptyProfile(), companyName: 'Test' });
    const saved = await saveBusinessProfile(profile);
    expect(put).toHaveBeenCalledWith('/api/business-profile', payload);
    expect(saved.companyName).toBe('Test');
  });

  it('an empty threshold disables the identification check', () => {
    const payload = toUpdatePayload({ ...emptyProfile(), compliance: { identificationThreshold: null, kvkkNoticeVersion: '' } });
    expect(payload.compliance.identificationThreshold).toBeNull();
  });
});
