/**
 * Pure date-range and period-comparison helpers shared by the Sales and
 * Reports pages. Kept framework-free so the business rules are unit tested.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Builds an inclusive local-time range from two `YYYY-MM-DD` values (as
 * produced by `<input type="date">`). The end date covers the whole selected
 * day (23:59:59.999), and reversed inputs are swapped. Returns `null` when
 * neither bound is set; a single bound gives an open-ended range.
 */
export function inclusiveDayRange(from?: string | null, to?: string | null): { start: Date | null; end: Date | null } | null {
  const a = ISO_DAY.test(String(from || '')) ? String(from) : '';
  const b = ISO_DAY.test(String(to || '')) ? String(to) : '';
  if (!a && !b) return null;
  // ISO day strings compare lexicographically in chronological order.
  const [first, second] = a && b ? [a, b].sort() : [a, b];
  return {
    start: first ? new Date(`${first}T00:00:00`) : null,
    end: second ? new Date(`${second}T23:59:59.999`) : null,
  };
}

/** True when `value` falls inside the inclusive range (no range → always true). */
export function isWithinDayRange(value: unknown, from?: string | null, to?: string | null): boolean {
  const range = inclusiveDayRange(from, to);
  if (!range) return true;
  const at = new Date(value as string);
  if (Number.isNaN(at.getTime())) return false;
  if (range.start && at < range.start) return false;
  if (range.end && at > range.end) return false;
  return true;
}

/**
 * Percent change of `current` against `previous`, rounded to an integer.
 * - previous 0 and current 0 → 0 (flat)
 * - previous 0 and current non-zero → null (no baseline; shown as a neutral
 *   "new period" indicator, never a fabricated +100%)
 * - missing/non-numeric input → null
 * A negative baseline (e.g. a loss month) uses its magnitude so that an
 * improvement is reported as a positive change.
 */
export function periodTrend(current: unknown, previous: unknown): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  const cur = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}
