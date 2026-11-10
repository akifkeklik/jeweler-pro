/**
 * Turkish identity numbers.
 *
 * - T.C. Kimlik No (TCKN): 11 digits, first digit not 0, two check digits
 *   (official algorithm).
 * - Vergi Kimlik No (VKN): 10 digits. Only the FORMAT is checked: without
 *   an authoritative test vector in this repository, a checksum rule could
 *   wrongly reject valid numbers at the till.
 */
function isValidTckn(value) {
  const s = String(value ?? '');
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const d = [...s].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const d10 = ((odd * 7 - even) % 10 + 10) % 10;
  if (d10 !== d[9]) return false;
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d11 === d[10];
}

function isValidVknFormat(value) {
  return /^\d{10}$/.test(String(value ?? ''));
}

/** Tax number of a business: VKN (company) or TCKN (sole proprietor). */
function isValidTaxNumber(value) {
  return isValidVknFormat(value) || isValidTckn(value);
}

/** Masks a national id for display and logs: 12*******90. */
function maskNationalId(value) {
  const s = String(value ?? '');
  if (s.length < 5) return s ? '*'.repeat(s.length) : '';
  return `${s.slice(0, 2)}${'*'.repeat(s.length - 4)}${s.slice(-2)}`;
}

const IDENTITY_TYPES = Object.freeze(['tckn', 'passport', 'foreign_id']);

/** Identity document number by document type (TCKN checksum; others: 5–20 alphanumerics). */
function isValidIdentityNumber(type, value) {
  if (type === 'tckn') return isValidTckn(value);
  if (type === 'passport' || type === 'foreign_id') return /^[A-Z0-9]{5,20}$/i.test(String(value ?? ''));
  return false;
}

module.exports = { isValidTckn, isValidVknFormat, isValidTaxNumber, maskNationalId, isValidIdentityNumber, IDENTITY_TYPES };
