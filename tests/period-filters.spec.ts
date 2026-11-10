import { describe, expect, it } from 'vitest';
import { inclusiveDayRange, isWithinDayRange, periodTrend } from '@/services/periodFilters';
import { normalizeSearch } from '@/i18n';

describe('inclusive sales date range (upstream fix 106ee09)', () => {
  it('includes sales made late on the selected end date', () => {
    expect(isWithinDayRange('2026-11-05T21:30:00', '2026-11-01', '2026-11-05')).toBe(true);
    expect(isWithinDayRange(new Date(2026, 10, 5, 23, 59, 59, 999).toISOString(), '2026-11-01', '2026-11-05')).toBe(true);
  });

  it('includes sales at the very start of the start date', () => {
    expect(isWithinDayRange(new Date(2026, 10, 1, 0, 0, 0).toISOString(), '2026-11-01', '2026-11-05')).toBe(true);
  });

  it('excludes sales outside the range', () => {
    expect(isWithinDayRange(new Date(2026, 10, 6, 0, 0, 0).toISOString(), '2026-11-01', '2026-11-05')).toBe(false);
    expect(isWithinDayRange(new Date(2026, 9, 31, 23, 59, 59).toISOString(), '2026-11-01', '2026-11-05')).toBe(false);
  });

  it('accepts reversed bounds', () => {
    const range = inclusiveDayRange('2026-11-05', '2026-11-01');
    expect(range?.start?.getDate()).toBe(1);
    expect(range?.end?.getDate()).toBe(5);
    expect(isWithinDayRange('2026-11-03T12:00:00', '2026-11-05', '2026-11-01')).toBe(true);
  });

  it('treats a single-day range as the whole day', () => {
    expect(isWithinDayRange('2026-11-05T00:00:00', '2026-11-05', '2026-11-05')).toBe(true);
    expect(isWithinDayRange('2026-11-05T23:00:00', '2026-11-05', '2026-11-05')).toBe(true);
  });

  it('supports open-ended ranges and no range', () => {
    expect(inclusiveDayRange('', '')).toBeNull();
    expect(isWithinDayRange('2020-01-01', '', '')).toBe(true);
    expect(isWithinDayRange('2026-12-31T23:00:00', '2026-11-01', '')).toBe(true);
    expect(isWithinDayRange('2026-10-01', '2026-11-01', null)).toBe(false);
    expect(isWithinDayRange('2026-11-05T22:00:00', null, '2026-11-05')).toBe(true);
  });

  it('rejects unparsable sale dates when a range is active', () => {
    expect(isWithinDayRange('not-a-date', '2026-11-01', '2026-11-05')).toBe(false);
    expect(isWithinDayRange(undefined, '2026-11-01', '2026-11-05')).toBe(false);
  });
});

describe('period trend (upstream fixes ce78634 / cbc0452)', () => {
  it('never fabricates +100% from a zero baseline', () => {
    expect(periodTrend(500, 0)).toBeNull();
  });

  it('reports flat when both periods are zero', () => {
    expect(periodTrend(0, 0)).toBe(0);
  });

  it('computes rounded percent change', () => {
    expect(periodTrend(150, 100)).toBe(50);
    expect(periodTrend(50, 100)).toBe(-50);
    expect(periodTrend(1, 3)).toBe(-67);
  });

  it('uses the magnitude of a negative baseline', () => {
    expect(periodTrend(50, -100)).toBe(150);
    expect(periodTrend(-200, -100)).toBe(-100);
  });

  it('returns null for missing data (e.g. unknown cost → unknown profit)', () => {
    expect(periodTrend(null, 100)).toBeNull();
    expect(periodTrend(100, undefined)).toBeNull();
    expect(periodTrend('abc', 100)).toBeNull();
  });
});

describe('cleared search input (upstream fix 26fedaa)', () => {
  it('normalizes null/undefined search to an empty query', () => {
    expect(normalizeSearch(null)).toBe('');
    expect(normalizeSearch(undefined)).toBe('');
    expect(normalizeSearch(null).trim()).toBe('');
  });
});
