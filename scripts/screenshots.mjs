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
const BRANCH = 'Kapalıçarşı';
const HAS = '3250.00'; // demo has-gold price per gram (manual price, no live feed needed)

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

await api('PUT', '/api/business-profile', {
  companyName: 'Demo Kuyumculuk Ltd. Şti.', authorizedPerson: 'Demo Yönetici', taxOffice: 'Fatih', taxNumber: '1234567890',
  phone: '0212 000 00 00', email: 'info@demo.test', address: 'Kapalıçarşı, Fatih / İstanbul', receiptFooter: 'Bizi tercih ettiğiniz için teşekkür ederiz.',
});
const product = (body) => api('POST', '/api/products', { branch: BRANCH, ...body });
const bilezik = await product({ name: '22 Ayar Burma Bilezik', pricingMode: 'gram', metal: 'XAU', karat: 22, weight: '10.000', laborType: 'milyem', laborValue: '35', costPrice: '30500.00', stock: 8, barcode: '8690000000011' });
const kolye = await product({ name: '14 Ayar Zincir Kolye', pricingMode: 'gram', metal: 'XAU', karat: 14, weight: '6.500', laborType: 'per_gram', laborValue: '250.00', costPrice: '12800.00', stock: 5, barcode: '8690000000028' });
const tektas = await product({ name: 'Pırlanta Tektaş Yüzük 0.30 ct', price: '42500.00', costPrice: '31000.00', stock: 3, barcode: '8690000000035' });
const kupe = await product({ name: 'Gümüş Damla Küpe', price: '1850.00', costPrice: '900.00', stock: 14, barcode: '8690000000042' });
const alyans = await product({ name: 'Klasik Alyans (çift)', price: '18900.00', costPrice: '14200.00', stock: 2, barcode: '8690000000059' });
await product({ name: 'Ata Lira Kolye Ucu', price: '24750.00', costPrice: '22100.00', stock: 1, barcode: '8690000000066' });

const customer = (name, phone) => api('POST', '/api/customers', { name, phone });
const ayse = await customer('Ayşe Yılmaz', '0532 111 22 33');
const mehmet = await customer('Mehmet Demir', '0533 444 55 66');
const zeynep = await customer('Zeynep Kaya', '0542 777 88 99');
const elif = await customer('Elif Şahin', '0555 123 45 67');
const provider = await api('POST', '/api/pos/providers', { code: 'DEMOBANK', name: 'Demo Bank POS', rules: [{ installments: 1, ratePercent: '1.80', valorDays: 1 }] });

const sale = (customerId, lines, payments) => api('POST', '/api/sales', { customerId, lines, payments, manualPrices: { XAU: HAS } });
const quoteTotal = async (customerId, lines) => (await api('POST', '/api/sales/quote', { customerId, lines, manualPrices: { XAU: HAS } })).total.toFixed(2);
for (const [c, lines, method] of [
  [ayse, [{ productId: bilezik._id, quantity: 1 }], 'nakit'],
  [mehmet, [{ productId: tektas._id, quantity: 1 }], 'kredi kartı'],
  [zeynep, [{ productId: kolye._id, quantity: 1 }, { productId: kupe._id, quantity: 2 }], 'havale'],
  [elif, [{ productId: alyans._id, quantity: 1 }], 'nakit'],
  [ayse, [{ productId: kupe._id, quantity: 1 }], 'kredi kartı'],
]) {
  const amount = await quoteTotal(c._id, lines);
  await sale(c._id, lines, [{ method, amount, ...(method === 'kredi kartı' ? { pos: { providerId: provider._id } } : {}) }]);
}
await sale(mehmet._id, [{ productId: bilezik._id, quantity: 1 }], []); // on account (open balance)

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
