/**
 * Turns an API failure into a message in the active language.
 *
 * The backend writes its messages in Turkish and attaches a stable
 * machine-readable `code` to every known failure. To avoid mixed-language
 * screens while keeping the most precise text available:
 *   1. Turkish: the server's detailed text (it may name the product, quantity
 *      or amount involved), else the code's translation;
 *   2. other languages: the code's translation (errors.codes.<CODE>);
 *   3. otherwise a localized message for the HTTP status class. Unknown codes
 *      and unexpected payloads never surface raw server text outside Turkish.
 */
import { i18nState, t, te } from '@/i18n';

export interface ApiErrorInput {
  status?: number;
  code?: string;
  serverMessage?: string;
}

export function statusMessageKey(status?: number): string {
  if (!status) return 'errors.network';
  if (status === 400 || status === 422) return 'errors.validation';
  if (status === 401) return 'errors.unauthorized';
  if (status === 403) return 'errors.forbidden';
  if (status === 404) return 'errors.notFound';
  if (status === 409) return 'errors.conflict';
  if (status === 429) return 'errors.rateLimited';
  if (status >= 500) return 'errors.server';
  return 'errors.operationFailed';
}

/** Error codes are upper-snake identifiers; anything else is not looked up. */
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export function localizeApiError({ status, code, serverMessage }: ApiErrorInput): string {
  if (typeof serverMessage === 'string' && serverMessage.trim() && i18nState.language === 'tr') return serverMessage;
  if (typeof code === 'string' && CODE_PATTERN.test(code) && te(`errors.codes.${code}`)) return t(`errors.codes.${code}`);
  return t(statusMessageKey(status));
}
