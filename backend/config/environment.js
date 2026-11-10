/**
 * Canonical NODE_ENV handling — the ONLY place that interprets NODE_ENV.
 *
 * Every module must use these helpers instead of comparing
 * process.env.NODE_ENV directly: a raw comparison such as
 * `process.env.NODE_ENV === 'production'` silently treats " production" or
 * "Production" as *non*-production and disables production safeguards
 * (Secure cookies, generic error messages, no localhost reset links).
 *
 * Rules
 * - Whitespace and casing are normalised once, here: " Production " → "production".
 * - Unset / blank means "development" (historic default).
 * - Any other value is unsupported: validateRuntimeConfig() refuses to start,
 *   and until then every security decision fails closed (`strict` is true),
 *   i.e. an unsupported value behaves like production, never like development.
 */
const SUPPORTED_ENVIRONMENTS = Object.freeze(['development', 'test', 'production']);

function resolveEnvironment(env = process.env) {
  const raw = env?.NODE_ENV;
  const blank = raw === undefined || raw === null || String(raw).trim() === '';
  const normalized = blank ? 'development' : String(raw).trim().toLowerCase();
  const valid = SUPPORTED_ENVIRONMENTS.includes(normalized);
  const name = valid ? normalized : 'invalid';
  return Object.freeze({
    name,
    valid,
    production: name === 'production',
    development: name === 'development',
    test: name === 'test',
    // Fail-closed security profile: production *or* an unsupported value.
    strict: name === 'production' || !valid,
  });
}

const getEnvironmentName = (env) => resolveEnvironment(env).name;
const isProduction = (env) => resolveEnvironment(env).production;
const isDevelopment = (env) => resolveEnvironment(env).development;
/** True when production-grade safeguards must apply (production or unsupported NODE_ENV). */
const isStrictEnvironment = (env) => resolveEnvironment(env).strict;

/**
 * Rewrites process.env.NODE_ENV to its canonical spelling so that third-party
 * code (Express' finalhandler, libraries) sees the same value as our modules.
 * Unsupported values are left untouched — start-up refuses them anyway.
 */
function canonicalizeProcessEnvironment(env = process.env) {
  const resolved = resolveEnvironment(env);
  if (resolved.valid && env.NODE_ENV !== undefined && env.NODE_ENV !== resolved.name) {
    env.NODE_ENV = resolved.name;
  }
  return resolved;
}

module.exports = {
  SUPPORTED_ENVIRONMENTS,
  resolveEnvironment,
  getEnvironmentName,
  isProduction,
  isDevelopment,
  isStrictEnvironment,
  canonicalizeProcessEnvironment,
};
