/**
 * Tenancy defaults.
 *
 * These values are used ONLY to attribute legacy single-tenant data (records
 * created before business/branch scoping existed) during the start-up
 * migration and by operator scripts. Request handling never falls back to
 * them: a user or document without a businessId is rejected (fail closed).
 *
 * Operators can set DEFAULT_BUSINESS_ID / DEFAULT_BRANCH before the first
 * migration; the historical values are kept as defaults so existing
 * databases keep their current attribution.
 */
const LEGACY_BUSINESS_ID = 'jeweler_main_01';
const LEGACY_BRANCH = 'Merkez Şube - Kapalıçarşı';

function readTenancyValue(name, fallback) {
  const raw = process.env[name];
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value || fallback;
}

const DEFAULT_BUSINESS_ID = readTenancyValue('DEFAULT_BUSINESS_ID', LEGACY_BUSINESS_ID);
const DEFAULT_BRANCH = readTenancyValue('DEFAULT_BRANCH', LEGACY_BRANCH);

module.exports = { DEFAULT_BUSINESS_ID, DEFAULT_BRANCH, LEGACY_BUSINESS_ID, LEGACY_BRANCH };
