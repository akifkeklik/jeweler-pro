/**
 * Frontend helpers for financial screens.
 *
 * The server is the only place money is calculated (exact decimal engine).
 * The UI therefore:
 *  - sends amounts as decimal STRINGS exactly as typed (no float rounding),
 *  - shows totals returned by the server (POST /api/sales/quote etc.),
 *  - sends an Idempotency-Key with every financial command so a retried
 *    request (double click, timeout, network glitch) is applied only once.
 */
import { lookupNode, money, n, t, te, tOptional } from '@/i18n';

function labelKeys(namespace: string): string[] {
  const node = lookupNode('tr', namespace);
  return node && typeof node === 'object' ? Object.keys(node) : [];
}

/** Normalises a typed amount ("1.234,56" / "1234,56" / " 12.5 ") to "1234.56"-style text. */
export function normalizeDecimalInput(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value).trim().replace(/\s+/g, '');
  if (!text) return '';
  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  if (hasComma && hasDot) {
    // Turkish formatting: "." thousands, "," decimal.
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    text = text.replace(',', '.');
  }
  return text;
}

/** True when the text is a plain non-negative decimal with at most `scale` fraction digits. */
export function isValidAmount(value: unknown, scale = 2, { allowZero = false } = {}): boolean {
  const text = normalizeDecimalInput(value);
  if (!new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(text)) return false;
  return allowZero || /[1-9]/.test(text);
}

/**
 * Like isValidAmount but signed ("-12.50" allowed). Used where the sign is
 * meaningful, e.g. a POS settlement whose refunds exceed its captures (the
 * bank debits the account). Zero only with allowZero.
 */
export function isValidSignedAmount(value: unknown, scale = 2, { allowZero = false } = {}): boolean {
  const text = normalizeDecimalInput(value);
  const unsigned = text.startsWith('-') ? text.slice(1) : text;
  if (!unsigned || unsigned.startsWith('-')) return false;
  return isValidAmount(unsigned, scale, { allowZero });
}

/** Random key for the Idempotency-Key header (one per user action, reused on retry). */
export function newIdempotencyKey(prefix = 'ui'): string {
  const random = typeof crypto !== 'undefined' && typeof (crypto as Crypto).randomUUID === 'function'
    ? (crypto as Crypto).randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

/** Amount in Turkish lira, formatted for the active language. */
export function formatTry(value: unknown): string {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? money(number, 'TRY') : '—';
}

/** Weight in grams with three decimals and the localized gram abbreviation. */
export function formatGrams(value: unknown): string {
  const number = Number(value);
  if (value === null || value === '' || !Number.isFinite(number)) return '—';
  return `${n(number, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${t('units.gram')}`;
}

/**
 * Translated label maps keyed by the server's enum values. Reading a property
 * translates into the active language (and falls back to the raw value for an
 * unknown enum), so templates using `MAP[status]` stay reactive to language.
 */
export function translatedLabels(namespace: string): Record<string, string> {
  return new Proxy({} as Record<string, string>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      return tOptional(`${namespace}.${prop}`, prop);
    },
    has(_target, prop) {
      return typeof prop === 'string' && te(`${namespace}.${prop}`);
    },
    ownKeys() {
      return labelKeys(namespace);
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop !== 'string' || !labelKeys(namespace).includes(prop)) return undefined;
      return { enumerable: true, configurable: true, value: tOptional(`${namespace}.${prop}`, prop) };
    },
  });
}

export const PAYMENT_STATUS_LABELS = translatedLabels('status.payment');
export const SALE_STATUS_LABELS = translatedLabels('status.sale');

function purityOption(karat: number) {
  return {
    metal: 'XAU',
    karat,
    get label() {
      return t(`purity.k${karat}`);
    },
  };
}

export const PURITY_OPTIONS = [24, 22, 18, 14, 9, 8].map(purityOption);

/** Readable label for a stored purity (parts per 10 000). */
export function purityLabel(purity: unknown): string {
  const value = Number(purity);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const milyem = value / 10;
  const karat: Record<number, string> = { 9950: '24K', 9160: '22K', 7500: '18K', 5850: '14K', 3750: '9K', 3330: '8K', 9250: '925' };
  return karat[value] ? `${karat[value]} · ${milyem}‰` : `${milyem}‰`;
}

/** Message of an API error normalised by services/api.ts. */
export function errorMessage(error: unknown, fallback?: string): string {
  const e = error as { message?: string } | undefined;
  return (e && typeof e.message === 'string' && e.message) || fallback || t('errors.operationFailed');
}

export function errorCode(error: unknown): string | undefined {
  const e = error as { code?: string } | undefined;
  return e && typeof e.code === 'string' ? e.code : undefined;
}

/**
 * Owning branch named by a 409 CROSS_BRANCH_CONFIRMATION_REQUIRED (an admin
 * acting on another branch's stock). The server never infers that branch: the
 * UI must ask the admin and resend the document with an explicit `branch`.
 */
export function crossBranchTarget(error: unknown): string | undefined {
  if (errorCode(error) !== 'CROSS_BRANCH_CONFIRMATION_REQUIRED') return undefined;
  const branch = (error as { data?: { details?: { productBranch?: unknown } } } | undefined)?.data?.details?.productBranch;
  return typeof branch === 'string' && branch ? branch : undefined;
}
