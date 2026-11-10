/**
 * Low-stock rule shared by every screen and by the API request for the
 * critical-stock report:
 *
 *   out  stock ≤ 0
 *   low  0 < stock ≤ threshold
 *   ok   stock > threshold
 *
 * "Critical" lists (dashboard, reports, product summary) contain out + low,
 * i.e. stock ≤ threshold — the same filter the backend applies to
 * GET /api/reports/low-stock?threshold=N.
 *
 * The threshold is the user's setting `lowStockThreshold`
 * (src/services/settings.ts, whole pieces 1-50).
 */
export type StockLevel = 'out' | 'low' | 'ok';

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const MIN_LOW_STOCK_THRESHOLD = 1;
export const MAX_LOW_STOCK_THRESHOLD = 50;

/**
 * A whole number in [1, 50]: fractions are truncated and out-of-range values
 * clamped (a typed 80 means "as high as allowed", not "reset to 5"); values
 * that are not numbers at all (or ≤ 0) fall back to the default.
 */
export function normalizeLowStockThreshold(value: unknown): number {
  if (value === null || value === undefined || typeof value === 'boolean') return DEFAULT_LOW_STOCK_THRESHOLD;
  const n = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(n) || n < MIN_LOW_STOCK_THRESHOLD) return DEFAULT_LOW_STOCK_THRESHOLD;
  return Math.min(Math.trunc(n), MAX_LOW_STOCK_THRESHOLD);
}

export function stockLevel(stock: unknown, threshold: unknown): StockLevel {
  const s = Number(stock) || 0;
  if (s <= 0) return 'out';
  return s <= normalizeLowStockThreshold(threshold) ? 'low' : 'ok';
}

/** Out of stock or at / below the threshold (critical lists). */
export function isCriticalStock(stock: unknown, threshold: unknown): boolean {
  return stockLevel(stock, threshold) !== 'ok';
}

/** Path of the critical-stock report for this threshold. */
export function lowStockReportPath(threshold: unknown): string {
  return `/api/reports/low-stock?threshold=${normalizeLowStockThreshold(threshold)}`;
}
