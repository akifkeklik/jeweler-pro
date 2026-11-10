/**
 * Backend error localization.
 *
 *  1. Every stable error code the backend can send is translated in all eight
 *     languages, except a short list of deliberately generic codes that fall
 *     back to the localized HTTP-status message.
 *  2. Known codes render the catalog text in every language; Turkish keeps
 *     the server's detailed Turkish text.
 *  3. Unknown codes, malformed codes and raw server text fail safely: outside
 *     Turkish the server text never reaches the screen.
 *  4. Market-provider health states sent by the API are all translated.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGES, loadAllLocales, lookup, setI18nPreferences, t, type Language } from '@/i18n';
import { localizeApiError, statusMessageKey } from '@/services/apiErrors';

const BACKEND = path.resolve(__dirname, '../backend');
const SCANNED_DIRS = ['routes', 'middleware', 'services', 'utils', 'domain'];

/** Generic codes: the status-class message is the intended user-facing text. */
const STATUS_FALLBACK_CODES = new Set([
  'VALIDATION_ERROR', 'NOT_FOUND', 'CONFLICT', 'UNPROCESSABLE', 'DOMAIN_ERROR', 'ENDPOINT_NOT_FOUND', 'RATE_LIMITED',
]);
/** Codes that are handled internally and never shown (silent session retry, provider health). */
const NEVER_DISPLAYED_CODES = new Set(['REFRESH_TOKEN_ROTATED', 'MALFORMED_RESPONSE']);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

/** Codes attached to client-visible errors: `code: 'X'`, `.code = 'X'`, helper(…, 'X') and class defaults. */
function backendErrorCodes(): Set<string> {
  const codes = new Set<string>();
  const patterns = [
    /\bcode:\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
    // `.code = 'X'`, and `code = 'X'` defaults in parameter lists / destructuring.
    /\bcode\s*=\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
    /\b(?:badRequest|notFound|conflict|unprocessable|forbidden)\((?:`[^`]*`|'[^']*'|"[^"]*"),\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
    /\bhttpError\((?:`[^`]*`|'[^']*'|"[^"]*"),\s*\d+,\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
    /new (?:CommissionError|DecimalError)\((?:`[^`]*`|'[^']*'|"[^"]*"),\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
  ];
  const files = [path.join(BACKEND, 'server.js'), ...SCANNED_DIRS.flatMap((d) => walk(path.join(BACKEND, d)))];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) for (const match of source.matchAll(pattern)) codes.add(match[1]);
  }
  // Metal symbols in the market-data catalog use the same `code:` shape; they are not errors.
  for (const code of [...codes]) if (/^XA[UG](_\d+)?$/.test(code)) codes.delete(code);
  return codes;
}

beforeAll(async () => {
  await loadAllLocales();
});

describe('backend error codes', () => {
  const codes = backendErrorCodes();

  it('finds the backend codes (scanner sanity check)', () => {
    for (const expected of ['INSUFFICIENT_STOCK', 'INVALID_CREDENTIALS', 'SESSION_INVALID', 'WEAK_PASSWORD', 'INVALID_DECIMAL', 'COMMISSION_EXCEEDS_AMOUNT', 'SALE_FINANCIALS_LOCKED']) {
      expect(codes.has(expected), expected).toBe(true);
    }
    expect(codes.size).toBeGreaterThan(100);
  });

  it('translates every displayable backend code in all eight languages', () => {
    const missing: string[] = [];
    for (const code of codes) {
      if (STATUS_FALLBACK_CODES.has(code) || NEVER_DISPLAYED_CODES.has(code)) continue;
      for (const language of LANGUAGES) {
        const value = lookup(language, `errors.codes.${code}`);
        if (typeof value !== 'string' || !value.trim()) missing.push(`${code} [${language}]`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps the allow-lists honest (every listed code is still emitted)', () => {
    for (const code of [...STATUS_FALLBACK_CODES, ...NEVER_DISPLAYED_CODES]) expect(codes.has(code), code).toBe(true);
  });
});

describe('localizeApiError', () => {
  const nonTurkish = LANGUAGES.filter((l) => l !== 'tr');
  const serverMessage = 'Yetersiz serbest stok: Classic Band Ring (mevcut 2, istenen 3)';

  it.each(LANGUAGES as readonly Language[])('shows known codes in %s', (language) => {
    setI18nPreferences({ language });
    for (const code of ['INVALID_CREDENTIALS', 'INSUFFICIENT_STOCK', 'SESSION_INVALID', 'CREDIT_LIMIT_EXCEEDED', 'FORBIDDEN']) {
      const expected = lookup(language, `errors.codes.${code}`);
      expect(typeof expected).toBe('string');
      expect(localizeApiError({ status: 409, code })).toBe(expected);
    }
  });

  it('keeps the detailed Turkish server message in Turkish', () => {
    setI18nPreferences({ language: 'tr' });
    expect(localizeApiError({ status: 409, code: 'INSUFFICIENT_STOCK', serverMessage })).toBe(serverMessage);
    // Without server text, Turkish still gets the catalog message.
    expect(localizeApiError({ status: 409, code: 'INSUFFICIENT_STOCK' })).toBe(lookup('tr', 'errors.codes.INSUFFICIENT_STOCK'));
  });

  it.each(nonTurkish)('never leaks Turkish server text in %s', (language) => {
    setI18nPreferences({ language });
    expect(localizeApiError({ status: 409, code: 'INSUFFICIENT_STOCK', serverMessage })).toBe(lookup(language, 'errors.codes.INSUFFICIENT_STOCK'));
    expect(localizeApiError({ status: 401, code: 'INVALID_CREDENTIALS', serverMessage: 'E-posta veya şifre hatalı' })).toBe(lookup(language, 'errors.codes.INVALID_CREDENTIALS'));
  });

  it.each(nonTurkish)('fails safely for unknown or malformed codes in %s', (language) => {
    setI18nPreferences({ language });
    const cases: Array<[number | undefined, unknown]> = [
      [409, 'SOMETHING_NEW_FROM_A_FUTURE_BACKEND'],
      [400, 'errors.validation'],
      [400, '__proto__'],
      [400, 'constructor'],
      [400, ''],
      [400, 42],
      [500, 'INTERNAL'],
      [undefined, undefined],
    ];
    for (const [status, code] of cases) {
      const message = localizeApiError({ status, code: code as string, serverMessage: 'TypeError: Cannot read properties of undefined\n    at /app/server.js:1:1' });
      expect(message).toBe(t(statusMessageKey(status)));
      expect(message).not.toMatch(/TypeError|server\.js|at \//);
    }
  });

  it('does not show stack-trace-like text even in Turkish when the server sends none', () => {
    setI18nPreferences({ language: 'tr' });
    expect(localizeApiError({ status: 500, code: 'INTERNAL' })).toBe(t('errors.server'));
    expect(localizeApiError({ status: 500, serverMessage: '   ' })).toBe(t('errors.server'));
  });
});

/** String literals of `const NAME = [ ... ];` in a backend model (comments ignored). */
function backendArray(file: string, name: string): string[] {
  const source = fs.readFileSync(path.join(BACKEND, 'models', file), 'utf8');
  const body = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))?.[1];
  expect(body, `${name} in ${file}`).toBeTruthy();
  return [...body!.replace(/\/\/[^\n]*/g, '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('backend enum labels', () => {
  // Statement rows outside Turkish show the translated type; a missing label
  // would fall back to the backend's Turkish description.
  it.each([
    ['LedgerEntry.js', 'ENTRY_TYPES', 'ledger.entry'],
    ['StockMovement.js', 'MOVEMENT_TYPES', 'finance.movement'],
    ['StockTransfer.js', 'STATUSES', 'status.transfer'],
  ])('%s %s are all translated (%s)', (file, name, namespace) => {
    const values = backendArray(file, name);
    expect(values.length).toBeGreaterThan(3);
    const missing = values.flatMap((v) => LANGUAGES.filter((l) => typeof lookup(l, `${namespace}.${v}`) !== 'string').map((l) => `${v} [${l}]`));
    expect(missing).toEqual([]);
  });
});

describe('market provider health labels', () => {
  it('translates every status the market-data service reports', () => {
    const source = fs.readFileSync(path.join(BACKEND, 'services', 'marketDataService.js'), 'utf8');
    const statusLine = source.split('\n').find((line) => /^\s*status:\s*error\s*\?/.test(line));
    expect(statusLine, 'provider status expression').toBeTruthy();
    const statuses = [...statusLine!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(statuses)).toEqual(new Set(['ok', 'stale', 'unavailable']));
    for (const status of statuses) {
      for (const language of LANGUAGES) {
        expect(lookup(language, `market.providerStatus.${status}`), `${status} [${language}]`).toBeTruthy();
      }
    }
  });
});
