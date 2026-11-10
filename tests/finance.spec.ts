import { describe, expect, it } from 'vitest';
import {
  normalizeDecimalInput, isValidAmount, newIdempotencyKey, formatTry, formatGrams, purityLabel, errorMessage, errorCode, crossBranchTarget,
} from '@/services/finance';

describe('finance helpers', () => {
  it('normalises typed decimal amounts without float rounding', () => {
    expect(normalizeDecimalInput('1.234,56')).toBe('1234.56');
    expect(normalizeDecimalInput('1234,5')).toBe('1234.5');
    expect(normalizeDecimalInput(' 12.50 ')).toBe('12.50');
    expect(normalizeDecimalInput('1 000,00')).toBe('1000.00');
    expect(normalizeDecimalInput(0.1)).toBe('0.1');
    expect(normalizeDecimalInput(null)).toBe('');
  });

  it('validates amounts against the server precision rules', () => {
    expect(isValidAmount('10.50')).toBe(true);
    expect(isValidAmount('10,50')).toBe(true);
    expect(isValidAmount('10.505')).toBe(false);
    expect(isValidAmount('12.345', 3)).toBe(true);
    expect(isValidAmount('-1')).toBe(false);
    expect(isValidAmount('1e3')).toBe(false);
    expect(isValidAmount('0')).toBe(false);
    expect(isValidAmount('0', 2, { allowZero: true })).toBe(true);
    expect(isValidAmount('')).toBe(false);
  });

  it('creates unique, header-safe idempotency keys', () => {
    const a = newIdempotencyKey('sale');
    const b = newIdempotencyKey('sale');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^sale-[A-Za-z0-9_\-:.]{8,}$/);
    expect(a.length).toBeLessThanOrEqual(128);
  });

  it('formats money, grams and purity for display', () => {
    expect(formatTry(1234.5)).toContain('1.234,50');
    expect(formatTry('x')).toBe('—');
    expect(formatGrams(9.16)).toBe('9,160 gr');
    expect(purityLabel(9160)).toBe('22K · 916‰');
    expect(purityLabel(9999)).toBe('999.9‰');
    expect(purityLabel(null)).toBe('—');
  });

  it('extracts normalised API error details', () => {
    expect(errorMessage({ message: 'Yetersiz stok' })).toBe('Yetersiz stok');
    expect(errorMessage(undefined, 'X')).toBe('X');
    expect(errorCode({ code: 'CASH_DAY_CLOSED' })).toBe('CASH_DAY_CLOSED');
    expect(errorCode({})).toBeUndefined();
  });

  it('only offers an explicit cross-branch retry for the server confirmation error', () => {
    const err = { code: 'CROSS_BRANCH_CONFIRMATION_REQUIRED', data: { details: { productBranch: 'Bağdat Caddesi', yourBranch: 'Merkez' } } };
    expect(crossBranchTarget(err)).toBe('Bağdat Caddesi');
    expect(crossBranchTarget({ code: 'BRANCH_OWNERSHIP_MISMATCH', data: { details: { productBranch: 'X' } } })).toBeUndefined();
    expect(crossBranchTarget({ code: 'BRANCH_MISMATCH' })).toBeUndefined();
    expect(crossBranchTarget({ code: 'CROSS_BRANCH_CONFIRMATION_REQUIRED', data: { details: { productBranch: { $ne: '' } } } })).toBeUndefined();
    expect(crossBranchTarget(undefined)).toBeUndefined();
  });
});
