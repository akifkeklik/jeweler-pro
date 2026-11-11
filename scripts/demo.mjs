/**
 * One-command live demo: an in-memory MongoDB replica set, the Express API
 * and the Vite dev server, seeded with realistic demo data. Nothing is
 * written to a real database; every start is a fresh shop.
 *
 *   npm run demo        → http://localhost:8080
 *
 * In GitHub Codespaces (.devcontainer) it runs on attach and uses the
 * forwarded https URL. The browser only talks to the Vite origin; the dev
 * server proxies /api and /health to the API, so cookies and CSRF checks see
 * a single origin, locally and in Codespaces alike.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { seedDemoData, DEMO_BRANCH } from './demoData.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const requireBackend = createRequire(path.join(projectRoot, 'backend', 'package.json'));

const API_PORT = Number(process.env.DEMO_API_PORT || 5000);
const WEB_PORT = 8080;
const EMAIL = 'demo@jewelerpro.test';
const PASSWORD = 'Demo-Jeweler-Pro-2026';

// The browser-facing origin: the Codespaces forwarded URL, or localhost.
const codespaceOrigin = process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
  ? `https://${process.env.CODESPACE_NAME}-${WEB_PORT}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
  : null;
const WEB_ORIGIN = codespaceOrigin || `http://localhost:${WEB_PORT}`;

console.log('[demo] Starting an in-memory MongoDB replica set (first run downloads mongod)…');
const { MongoMemoryReplSet } = requireBackend('mongodb-memory-server');
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });

Object.assign(process.env, {
  NODE_ENV: 'development',
  MONGO_URI: replSet.getUri('jeweler_demo'),
  JWT_SECRET: 'demo-only-secret-not-for-production-use-0123456789',
  CORS_ORIGIN: [WEB_ORIGIN, `http://localhost:${WEB_PORT}`].join(','),
  APP_URL: WEB_ORIGIN,
  TRUST_PROXY: 'loopback',
  REQUEST_LOG: 'off',
});

const mongoose = requireBackend('mongoose');
const app = requireBackend('./server.js');
const User = requireBackend('./models/User.js');
const { signToken } = requireBackend('./middleware/auth.js');
const { hashPassword } = requireBackend('./utils/passwords.js');

await mongoose.connect(process.env.MONGO_URI);
const apiServer = await new Promise((resolve) => { const s = app.listen(API_PORT, '127.0.0.1', () => resolve(s)); });

console.log('[demo] Seeding demo data…');
const admin = await User.create({
  email: EMAIL, name: 'Demo Yönetici', passwordHash: await hashPassword(PASSWORD),
  role: 'admin', branch: DEMO_BRANCH, businessId: 'demo_kuyumcu', active: true,
});
const token = signToken(admin, 600);
async function api(method, p, body) {
  const res = await fetch(`http://127.0.0.1:${API_PORT}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (res.status >= 400) throw new Error(`${method} ${p}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}
await seedDemoData(api);

const vite = spawn(process.execPath, [path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(WEB_PORT), '--strictPort'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, VITE_API_URL: WEB_ORIGIN, DEV_API_PROXY: `http://127.0.0.1:${API_PORT}` },
});

console.log(`
[demo] Jeweler Pro is running: ${WEB_ORIGIN}
[demo]   e-mail:   ${EMAIL}
[demo]   password: ${PASSWORD}
[demo] Demo data lives in memory and is gone when you stop (Ctrl+C).
`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  vite.kill();
  apiServer.close();
  await mongoose.disconnect().catch(() => {});
  await replSet.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
vite.on('exit', stop);
