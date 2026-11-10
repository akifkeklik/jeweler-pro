import { describe, expect, it } from 'vitest';
import { cashDifference, closingPayload, goldCounted, goldDifference } from '@/services/dailyClosing';

describe('daily closing (Z report)', () => {
  it('computes the cash difference exactly to the kuruş', () => {
    expect(cashDifference(1000.1, 1000.2)).toBe(-0.1);
    expect(cashDifference('250', 200)).toBe(50);
    expect(cashDifference(null, 0)).toBe(0);
  });

  it('treats an empty gold field as "not counted", never as zero grams', () => {
    expect(goldCounted('')).toBe(false);
    expect(goldCounted(null)).toBe(false);
    expect(goldCounted(0)).toBe(true);
    expect(goldDifference('', 125.5)).toBe(0);
    expect(goldDifference(125.499, 125.5)).toBe(-0.001);
  });

  it('omits an uncounted gold field so no gold difference is posted', () => {
    expect(closingPayload({ closingCashActual: 1500.5, closingGoldActual: '', notes: 'ok' }))
      .toEqual({ closingCashActual: '1500.5', notes: 'ok' });
    expect(closingPayload({ closingCashActual: 0, closingGoldActual: 12.25, notes: '' }))
      .toEqual({ closingCashActual: '0', closingGoldActual: '12.25', notes: '' });
  });
});
