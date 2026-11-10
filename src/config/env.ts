/**
 * Single access point for build-time configuration. Vite exposes variables
 * with the VITE_ prefix; the historical VUE_APP_ names stay supported
 * (vite.config.ts `envPrefix`) so existing .env files keep working.
 */
const env = import.meta.env as ImportMetaEnv & Record<string, string | boolean | undefined>;

function read(name: string): string | undefined {
  const value = env[`VITE_${name}`] ?? env[`VUE_APP_${name}`];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export const API_URL = read('API_URL');
export const API_TIMEOUT_MS = Number.parseInt(read('API_TIMEOUT') || '30000', 10) || 30000;
export const IS_PRODUCTION = env.PROD === true;
export const IS_DEVELOPMENT = env.DEV === true;
