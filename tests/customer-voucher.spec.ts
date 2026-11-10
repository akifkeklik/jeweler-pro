import { describe, expect, it } from 'vitest';
import { buildVoucherPayload, emptyVoucher } from '@/services/customerVoucher';

describe('customer voucher payload', () => {
  it('collection: payment method and decimal-string amounts, no direction', () => {
    const r = buildVoucherPayload(7, { ...emptyVoucher(), amountTry: '1.500,50', amountGoldGrams: '2,5', description: 'Kapora' });
    expect(r).toEqual({ ok: true, payload: { customerId: 7, type: 'tahsilat', description: 'Kapora', paymentMethod: 'nakit', amountTry: '1500.50', amountGoldGrams: '2.5' } });
  });

  it('opening balance carries a direction instead of a payment method', () => {
    const r = buildVoucherPayload(7, { ...emptyVoucher(), type: 'devir', direction: 'alacak', amountTry: '100' });
    expect(r.ok && r.payload).toMatchObject({ type: 'devir', direction: 'alacak', amountTry: '100' });
    expect(r.ok && 'paymentMethod' in r.payload).toBe(false);
  });

  it('scrap buy-back sends weight, karat and optional deduction / manual price; never a gold amount', () => {
    const r = buildVoucherPayload(7, { ...emptyVoucher(), type: 'hurda_alimi', paymentMethod: 'cari', weightGrams: '12,345', karat: 14, deductionMilyem: '20', amountGoldGrams: '9' });
    expect(r).toEqual({ ok: true, payload: { customerId: 7, type: 'hurda_alimi', description: '', paymentMethod: 'cari', weightGrams: '12.345', karat: 14, deductionMilyem: '20' } });
  });

  it('refuses an empty voucher with the reason to show', () => {
    expect(buildVoucherPayload(7, emptyVoucher())).toEqual({ ok: false, reason: 'amount_required' });
    expect(buildVoucherPayload(7, { ...emptyVoucher(), type: 'hurda_alimi', amountTry: '500' })).toEqual({ ok: false, reason: 'scrap_weight_required' });
  });
});
