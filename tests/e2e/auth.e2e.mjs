/**
 * Browser E2E for login / Remember Me / logout / forgot+reset password /
 * permission-driven settings UI.
 *
 * Everything is real: production frontend build, Express API, MongoDB
 * (in-memory replica set), SMTP socket server and Chromium via Playwright.
 *
 *   node tests/e2e/auth.e2e.mjs              # builds the frontend first
 *   node tests/e2e/auth.e2e.mjs --skip-build # reuse the previous build
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const backendRoot = path.join(projectRoot, 'backend');
const requireBackend = createRequire(path.join(backendRoot, 'package.json'));

const API_PORT = 5199;
const WEB_PORT = 8099;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
const DIST = path.resolve(process.env.E2E_DIST || path.join(os.tmpdir(), 'jeweler-e2e-dist'));
const PASSWORD = 'E2E-Strong-Password-42';

// ---------------------------------------------------------------- build
if (!process.argv.includes('--skip-build') || !fs.existsSync(path.join(DIST, 'index.html'))) {
  console.log(`[e2e] Building frontend into ${DIST} …`);
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', DIST, '--emptyOutDir'], {
    cwd: projectRoot,
    env: { ...process.env, VITE_API_URL: `http://localhost:${API_PORT}` },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('Frontend build failed');
}

// ---------------------------------------------------------------- infra
const { MongoMemoryReplSet } = requireBackend('mongodb-memory-server');
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });

Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGO_URI: replSet.getUri('jeweler_e2e'),
  JWT_SECRET: 'e2e-secret-with-more-than-thirty-two-characters!!',
  CORS_ORIGIN: WEB_ORIGIN,
  APP_URL: WEB_ORIGIN,
  PASSWORD_RESET_COOLDOWN_SECONDS: '0',
});

const { startSmtpServer, extractResetToken } = requireBackend('./testSupport/smtpServer.js');
const smtp = await startSmtpServer();
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = String(smtp.port);
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

const mongoose = requireBackend('mongoose');
const app = requireBackend('./server.js');
const User = requireBackend('./models/User.js');
const emailService = requireBackend('./services/emailService.js');
const { hashPassword } = requireBackend('./utils/passwords.js');
const { resetAllRateLimiters } = requireBackend('./middleware/rateLimit.js');

await mongoose.connect(process.env.MONGO_URI);
const apiServer = await new Promise((resolve) => {
  const s = app.listen(API_PORT, '127.0.0.1', () => resolve(s));
});

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const webServer = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, WEB_ORIGIN).pathname);
  let file = path.join(DIST, urlPath);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html'); // SPA history fallback
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => webServer.listen(WEB_PORT, '127.0.0.1', resolve));

async function seedUser(role, extra = {}) {
  return User.create({
    email: `${role}.${Date.now()}.${Math.random().toString(16).slice(2, 6)}@e2e.test`,
    name: `E2E ${role}`,
    passwordHash: await hashPassword(PASSWORD),
    role,
    branch: 'Merkez',
    businessId: 'e2e_business',
    ...extra,
  });
}

// ---------------------------------------------------------------- helpers
const browser = await chromium.launch();
const results = [];

async function scenario(name, fn) {
  resetAllRateLimiters();
  smtp.clear();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`    [pageerror] ${error.message}`));
  const started = Date.now();
  try {
    await fn({ context, page });
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ✔ ${name} (${Date.now() - started}ms)`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  ✖ ${name}\n    ${error.stack || error}`);
    const shot = path.join(os.tmpdir(), `jeweler-e2e-${results.length}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    console.log(`    screenshot: ${shot}`);
  } finally {
    await context.close();
  }
}

async function login(page, email, { rememberMe = false, password = PASSWORD } = {}) {
  await page.goto(`${WEB_ORIGIN}/login`);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  if (rememberMe) await page.getByTestId('remember-me').check();
  await page.getByRole('button', { name: /Güvenli Oturum Aç/ }).click();
}

async function refreshCookie(context) {
  return (await context.cookies(`http://localhost:${API_PORT}/api/auth/refresh`)).find((c) => c.name === 'jeweler_refresh_token');
}

async function webStorageDump(page) {
  return page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
}

/** Simulates closing and reopening the browser: session cookies are dropped. */
async function reopenBrowser(context) {
  const persistent = (await context.cookies()).filter((c) => c.expires > 0);
  const reopened = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await reopened.addCookies(persistent);
  return reopened;
}

// ---------------------------------------------------------------- scenarios
console.log('\n[e2e] Running browser scenarios');

const admin = await seedUser('admin');
const staff = await seedUser('staff');

await scenario('Login without "Beni Hatırla": HttpOnly session cookie, no token in web storage, survives reload, not a browser restart', async ({ context, page }) => {
  await login(page, staff.email);
  await page.waitForURL('**/dashboard');

  const cookie = await refreshCookie(context);
  assert.ok(cookie, 'refresh cookie set');
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Strict');
  assert.equal(cookie.expires, -1, 'browser-session cookie (no expiry)');
  assert.equal(await page.evaluate(() => document.cookie.includes('jeweler_refresh_token')), false, 'cookie invisible to JavaScript');
  assert.equal(/eyJ[\w-]+\.[\w-]+\.[\w-]+/.test(await webStorageDump(page)), false, 'no JWT in localStorage/sessionStorage');

  await page.reload();
  await page.waitForURL('**/dashboard');
  await page.locator('.profile-row').getByText('E2E staff').waitFor();

  const reopened = await reopenBrowser(context);
  const page2 = await reopened.newPage();
  await page2.goto(`${WEB_ORIGIN}/dashboard`);
  await page2.waitForURL('**/login?redirect=**');
  await reopened.close();
});

await scenario('Login with "Beni Hatırla": persistent 30-day cookie keeps the user signed in after a browser restart', async ({ context, page }) => {
  await login(page, staff.email, { rememberMe: true });
  await page.waitForURL('**/dashboard');
  const cookie = await refreshCookie(context);
  const days = (cookie.expires * 1000 - Date.now()) / 86_400_000;
  assert.ok(days > 29.9 && days <= 30, `expected ~30 days, got ${days}`);

  const reopened = await reopenBrowser(context);
  const page2 = await reopened.newPage();
  await page2.goto(`${WEB_ORIGIN}/sales`);
  await page2.waitForURL('**/sales');
  await page2.locator('.profile-row').getByText('E2E staff').waitFor();
  await reopened.close();
});

await scenario('Logout revokes the session: cookie cleared, protected pages redirect to login, old cookie unusable', async ({ context, page }) => {
  await login(page, staff.email, { rememberMe: true });
  await page.waitForURL('**/dashboard');
  const before = await refreshCookie(context);

  await page.locator('.profile-logout').click();
  await page.waitForURL('**/login');
  assert.equal(await refreshCookie(context), undefined, 'cookie removed');

  await page.goto(`${WEB_ORIGIN}/dashboard`);
  await page.waitForURL('**/login?redirect=**');

  const replay = await fetch(`http://localhost:${API_PORT}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `jeweler_refresh_token=${before.value}`, 'X-Requested-With': 'XMLHttpRequest' },
  });
  assert.equal(replay.status, 401, 'revoked refresh token rejected');
});

await scenario('Forgot password → real e-mail → reset page (token stripped from URL) → new password works, link is single-use', async ({ page }) => {
  const user = await seedUser('staff');
  await page.goto(`${WEB_ORIGIN}/login`);
  await page.getByRole('button', { name: 'Şifremi Unuttum?' }).click();
  await page.locator('input[autocomplete="email"]').fill(user.email);
  await page.getByRole('button', { name: /Sıfırlama Bağlantısı Gönder/ }).click();
  await page.getByText(/kayıtlı ise/).waitFor();

  await emailService.flushPendingDeliveries();
  const message = await smtp.waitForMessage((m) => m.to.includes(user.email));
  const link = message.text.match(/https?:\/\/\S+reset-password\?token=[0-9a-f]{64}/)[0];
  assert.ok(extractResetToken(message));

  await page.goto(link);
  await page.getByTestId('reset-form').waitFor();
  assert.equal(page.url().includes('token='), false, 'token removed from the address bar');

  const newPassword = 'E2E-Reset-Password-2026';
  const fields = page.getByTestId('reset-form').locator('input[type="password"]');
  await fields.nth(0).fill(newPassword);
  await fields.nth(1).fill(newPassword);
  await page.getByRole('button', { name: /Şifremi Güncelle/ }).click();
  await page.getByTestId('reset-completed').waitFor();
  await page.waitForURL('**/login?reset=success');
  await page.getByText(/Şifreniz başarıyla sıfırlandı/).waitFor();

  await login(page, user.email, { password: PASSWORD });
  await page.getByText('E-posta veya şifre hatalı').waitFor();
  await login(page, user.email, { password: newPassword });
  await page.waitForURL('**/dashboard');

  const reuse = await page.context().newPage();
  await reuse.goto(link);
  await reuse.getByTestId('reset-invalid').waitFor();
});

await scenario('Forgot password with e-mail not configured shows an honest error (no fake success)', async ({ page }) => {
  const savedHost = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  emailService.resetCache();
  try {
    await page.goto(`${WEB_ORIGIN}/login`);
    await page.getByRole('button', { name: 'Şifremi Unuttum?' }).click();
    await page.locator('input[autocomplete="email"]').fill(staff.email);
    await page.getByRole('button', { name: /Sıfırlama Bağlantısı Gönder/ }).click();
    await page.getByText(/E-posta servisi yapılandırılmamış/).waitFor();
    assert.equal(await page.getByText(/kayıtlı ise/).count(), 0);
    assert.equal(smtp.messages.length, 0);
  } finally {
    process.env.SMTP_HOST = savedHost;
    emailService.resetCache();
  }
});

await scenario('Settings › Users: staff sees no user management; admin creates a user through the UI who can then sign in', async ({ page, context }) => {
  await login(page, staff.email);
  await page.waitForURL('**/dashboard');
  await page.goto(`${WEB_ORIGIN}/settings`);
  await page.getByText('Kullanıcı & Yetkiler').first().click();
  await page.getByTestId('my-permissions').getByText('Satış kayıtlarını görüntüleme').waitFor();
  assert.equal(await page.getByTestId('user-management').count(), 0, 'staff must not see user management');
  assert.equal(await page.getByTestId('permission-matrix').count(), 0);
  await context.clearCookies();

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const adminPage = await adminContext.newPage();
  try {
    await login(adminPage, admin.email);
    await adminPage.waitForURL('**/dashboard');
    await adminPage.goto(`${WEB_ORIGIN}/settings`);
    await adminPage.getByText('Kullanıcı & Yetkiler').first().click();
    await adminPage.getByTestId('permission-matrix').waitFor();
    await adminPage.getByTestId('add-user').click();

    const email = `ui.created.${Date.now()}@e2e.test`;
    const modal = adminPage.locator('.v-dialog').filter({ hasText: 'Yeni Kullanıcı Tanımla' });
    await modal.locator('input[type="text"]').first().fill('UI Personeli');
    await modal.locator('input[type="email"]').fill(email);
    await modal.locator('input[type="password"]').fill(PASSWORD);
    await modal.getByText('Denetim kayıtlarını inceleme').click();
    await modal.getByRole('button', { name: 'Kullanıcıyı Kaydet' }).click();
    await adminPage.getByTestId('user-management').getByText(email).waitFor();

    const created = await User.findOne({ email }).lean();
    assert.equal(created.role, 'staff');
    assert.deepEqual(created.customPermissions, ['audit:read']);
    assert.equal(created.businessId, 'e2e_business');

    const res = await fetch(`http://localhost:${API_PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    assert.ok((await res.json()).user.permissions.includes('audit:read'));
  } finally {
    await adminContext.close();
  }
});

// ---------------------------------------------------------------- financial core
const Product = requireBackend('./models/Product.js');
const Customer = requireBackend('./models/Customer.js');
const Sale = requireBackend('./models/Sale.js');
const Purchase = requireBackend('./models/Purchase.js');
const DailyClosing = requireBackend('./models/DailyClosing.js');

async function apiAs(user) {
  const res = await fetch(`http://localhost:${API_PORT}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password: PASSWORD }),
  });
  const { token } = await res.json();
  return async (method, urlPath, body) => {
    const r = await fetch(`http://localhost:${API_PORT}${urlPath}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

const adminApi = await apiAs(admin);
const posProduct = (await adminApi('POST', '/api/products', { name: 'E2E Tektaş Yüzük', price: '2500.00', costPrice: '1500.00', stock: 4 })).body;
const posCustomer = (await adminApi('POST', '/api/customers', { name: 'E2E Cari Müşteri', phone: '05550000000' })).body;

await scenario('POS: sale with partial payment — server-priced, stock and customer account updated; balance collected from the sales list', async ({ page }) => {
  await login(page, staff.email);
  await page.waitForURL('**/dashboard');
  await page.goto(`${WEB_ORIGIN}/sales`);
  await page.getByRole('button', { name: /Yeni Satış Yap/ }).click();
  const dialog = page.locator('.v-dialog').filter({ hasText: 'Yeni Satış / POS' });
  await dialog.locator('[data-test="sale-customer"]').selectOption(String(posCustomer._id));
  await dialog.locator('[data-test="sale-product-0"]').selectOption(String(posProduct._id));
  await dialog.locator('.cart-row input[type="number"]').first().fill('2');
  await dialog.locator('.payment-row input').first().fill('1000,00');
  // Totals come from POST /api/sales/quote (2 × 2500 = 5000, 1000 paid, 4000 on account).
  await dialog.locator('.summary-line.total-line').getByText('5.000,00').waitFor();
  await dialog.locator('.summary-line').filter({ hasText: 'Cariye yazılacak' }).getByText('4.000,00').waitFor();
  await dialog.locator('[data-test="sale-submit"]').click();
  await dialog.waitFor({ state: 'hidden' });

  const sale = await Sale.findOne({ customerId: posCustomer._id }).lean();
  assert.equal(sale.totalMinor, 500000);
  assert.equal(sale.paidMinor, 100000);
  assert.equal(sale.balanceDueMinor, 400000);
  assert.equal((await Product.findById(posProduct._id).lean()).stock, 2);
  assert.equal((await Customer.findById(posCustomer._id).lean()).balanceTry, -4000);

  await page.locator('button[title="Tahsilat Al"]').first().click();
  const payDialog = page.locator('.v-dialog').filter({ hasText: 'Tahsilat — Fiş' });
  await payDialog.getByRole('button', { name: 'Tahsil Et' }).click();
  await payDialog.waitFor({ state: 'hidden' });
  const paid = await Sale.findById(sale._id).lean();
  assert.equal(paid.paymentStatus, 'paid');
  assert.equal((await Customer.findById(posCustomer._id).lean()).balanceTry, 0);
  const books = await adminApi('GET', '/api/ledger/reconciliation');
  assert.equal(books.body.ok, true, JSON.stringify(books.body?.ledger?.discrepancies));
});

await scenario('Finance: supplier and purchase through the UI update stock and payables; Z-report locks the cash day', async ({ page }) => {
  await login(page, admin.email);
  await page.waitForURL('**/dashboard');
  await page.goto(`${WEB_ORIGIN}/finance`);
  await page.getByRole('button', { name: /Tedarikçi Ekle/ }).click();
  const supplierDialog = page.locator('.v-dialog').filter({ hasText: 'Tedarikçi Ekle' });
  await supplierDialog.locator('input[type="text"]').first().fill('E2E Toptancı A.Ş.');
  await supplierDialog.getByRole('button', { name: 'Kaydet' }).click();
  await page.locator('.jp-enterprise-table').getByText('E2E Toptancı A.Ş.').waitFor();

  await page.locator('.finance-tab').filter({ hasText: 'Alışlar' }).click();
  await page.getByRole('button', { name: /Yeni Alış/ }).click();
  const purchaseDialog = page.locator('.v-dialog').filter({ hasText: 'Yeni Alış' });
  const row = purchaseDialog.locator('.purchase-row').first();
  await row.locator('select').nth(1).selectOption(String(posProduct._id));
  await row.locator('input[type="number"]').fill('3');
  await row.locator('input[inputmode="decimal"]').fill('1500,00');
  await purchaseDialog.getByRole('button', { name: 'Alışı Kaydet' }).click();
  await purchaseDialog.waitFor({ state: 'hidden' });
  await page.locator('.jp-enterprise-table').getByText('4.500,00').first().waitFor();

  const purchase = await Purchase.findOne({ businessId: 'e2e_business' }).lean();
  assert.equal(purchase.totalMinor, 450000);
  assert.equal((await Product.findById(posProduct._id).lean()).stock, 5, '2 left after the sale + 3 purchased');

  await page.goto(`${WEB_ORIGIN}/reports`);
  await page.getByRole('button', { name: /Günlük Kapanış/ }).click();
  const counted = page.locator('input[type="number"]').first();
  await counted.waitFor();
  await counted.fill('1000');
  await page.getByRole('button', { name: /Günlük Kapanışı Onayla/ }).click();
  await page.getByText('Günlük Kapanış Yapıldı (Kilitli)').waitFor();
  const closing = await DailyClosing.findOne({ businessId: 'e2e_business', isClosed: true }).lean();
  assert.ok(closing, 'Z-report stored');
  assert.equal(closing.closingCashActual, 1000);
  const late = await adminApi('POST', '/api/cash/transactions', { type: 'devir', amountTry: '1.00' });
  assert.equal(late.status, 409, 'no cash posting after the Z-report');
  assert.equal(late.body.code, 'CASH_DAY_CLOSED');
});

// ---------------------------------------------------------------- teardown
await browser.close();
await emailService.flushPendingDeliveries();
await new Promise((r) => webServer.close(r));
await new Promise((r) => apiServer.close(r));
await smtp.close();
await mongoose.disconnect();
await replSet.stop();

const failed = results.filter((r) => !r.ok);
console.log(`\n[e2e] ${results.length - failed.length}/${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
