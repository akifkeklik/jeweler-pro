/**
 * Regenerates the README screenshots (docs/images/*.png) from the real stack:
 * production build, Express API, an in-memory MongoDB replica set and
 * Chromium, seeded with realistic demo data. No real customer data is used.
 *
 *   npm run screenshots
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { seedDemoData, DEMO_BRANCH, DEMO_HAS_PRICE } from './demoData.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const requireBackend = createRequire(path.join(projectRoot, 'backend', 'package.json'));

const API_PORT = 5198;
const WEB_PORT = 8098;
const WEB = `http://localhost:${WEB_PORT}`;
const DIST = path.join(os.tmpdir(), 'jeweler-screenshots-dist');
const OUT = path.join(projectRoot, 'docs', 'images');
const PASSWORD = 'Demo-Screenshot-Password-2026';
const BIZ = 'demo_kuyumcu';
const BRANCH = DEMO_BRANCH;
const HAS = DEMO_HAS_PRICE;

fs.mkdirSync(OUT, { recursive: true });
const build = spawnSync(process.execPath, [path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', DIST, '--emptyOutDir'], {
  cwd: projectRoot,
  env: { ...process.env, VITE_API_URL: `http://localhost:${API_PORT}` },
  stdio: 'inherit',
});
if (build.status !== 0) throw new Error('Frontend build failed');

const { MongoMemoryReplSet } = requireBackend('mongodb-memory-server');
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGO_URI: replSet.getUri('jeweler_screenshots'),
  JWT_SECRET: 'screenshot-secret-with-more-than-thirty-two-characters',
  CORS_ORIGIN: WEB,
  APP_URL: WEB,
  REQUEST_LOG: 'off',
});

const mongoose = requireBackend('mongoose');
const app = requireBackend('./server.js');
const User = requireBackend('./models/User.js');
const { signToken } = requireBackend('./middleware/auth.js');
const { hashPassword } = requireBackend('./utils/passwords.js');

await mongoose.connect(process.env.MONGO_URI);
const apiServer = await new Promise((resolve) => { const s = app.listen(API_PORT, '127.0.0.1', () => resolve(s)); });
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const webServer = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, WEB).pathname);
  let file = path.join(DIST, urlPath);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => webServer.listen(WEB_PORT, '127.0.0.1', resolve));

/* ------------------------------------------------------------ demo data */
const admin = await User.create({
  email: 'demo@jewelerpro.test', name: 'Demo Yönetici', passwordHash: await hashPassword(PASSWORD),
  role: 'admin', branch: BRANCH, businessId: BIZ, active: true,
});
const token = signToken(admin, 3600);
async function api(method, p, body) {
  const res = await fetch(`http://127.0.0.1:${API_PORT}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: WEB },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (res.status >= 400) throw new Error(`${method} ${p}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

await seedDemoData(api, { branch: BRANCH, hasPrice: HAS });

/* ------------------------------------------------------------ screenshots */
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
const page = await context.newPage();
await page.addInitScript(() => {
  if (!sessionStorage.getItem('seeded')) {
    localStorage.setItem('jeweler_settings', JSON.stringify({ language: 'tr', themeMode: 'dark', palette: 'obsidian', sidebarMode: 'pinned' }));
    sessionStorage.setItem('seeded', '1');
  }
});
const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600); };
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

await page.goto(`${WEB}/login`);
await settle();
await shot('login');
await page.locator('input[type="email"]').fill(admin.email);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.locator('button[type="submit"]').click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });

for (const route of ['dashboard', 'sales', 'products', 'customers', 'reports']) {
  await page.goto(`${WEB}/${route}`);
  await settle();
  await shot(route);
}
await page.goto(`${WEB}/settings`);
await settle();
await page.getByTestId('settings-tab-business').click();
await settle();
await shot('settings-business');

await browser.close();
webServer.close();
apiServer.close();
await mongoose.disconnect();
await replSet.stop();
console.log(`[screenshots] written to ${OUT}`);
process.exit(0);
