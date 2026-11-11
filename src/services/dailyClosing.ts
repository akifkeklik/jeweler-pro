/**
 * Daily closing (Z report): the counted till against the system's expected
 * cash and fine gold. Differences here are for display only; the server
 * computes and posts the exact difference (cash_over_short / gold_over_short).
 */

export interface ClosingCount {
  closingCashActual: number | string | null;
  closingGoldActual: number | string | null;
  notes: string;
}

/** Whether a gold count was entered (an empty field means "not counted"). */
export function goldCounted(value: ClosingCount['closingGoldActual']): boolean {
  return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
}

/** Counted minus expected cash, in TRY, exact to the kuruş. */
export function cashDifference(actual: unknown, expected: unknown): number {
  const a = Math.round((Number(actual) || 0) * 100);
  const e = Math.round((Number(expected) || 0) * 100);
  return (a - e) / 100;
}

/** Counted minus expected fine gold, in grams, exact to the milligram; 0 when not counted. */
export function goldDifference(actual: ClosingCount['closingGoldActual'], expected: unknown): number {
  if (!goldCounted(actual)) return 0;
  const a = Math.round(Number(actual) * 1000);
  const e = Math.round((Number(expected) || 0) * 1000);
  return (a - e) / 1000;
}

/**
 * POST /api/cash/daily-closing body. Amounts go as exact decimal text; an
 * uncounted gold field is omitted so no gold difference is posted (sending 0
 * would write off the whole gold till).
 */
export function closingPayload(count: ClosingCount): { closingCashActual: string; closingGoldActual?: string; notes: string } {
  return {
    closingCashActual: String(count.closingCashActual ?? ''),
    ...(goldCounted(count.closingGoldActual) ? { closingGoldActual: String(count.closingGoldActual) } : {}),
    notes: count.notes,
  };
}
