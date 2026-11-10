/**
 * Browser E2E for the operational workflows added in the ERP completion:
 *   1. inter-branch transfer: draft (branch A manager) → approval (second
 *      A manager) → dispatch → receipt (branch B staff), all through the UI
 *   2. POS: card sale with commission → bank settlement through the UI
 *   3. PR #8: refund-only (negative) and netted (zero) POS settlements, and a
 *      silver sale priced with the XAG manual price input, through the UI
 *   4. purchase return through the Finance page
 * Real stack: production frontend build, Express API, MongoDB in-memory
 * replica set, Chromium. Every result is verified in the database and the
 * books are reconciled at the end.
 *
 *   node tests/e2e/operations.e2e.mjs              # builds the frontend first
 *   node tests/e2e/operations.e2e.mjs --skip-build # reuse the previous build
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

const API_PORT = 5198;
const WEB_PORT = 8098;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
const DIST = path.resolve(process.env.E2E_DIST || path.join(os.tmpdir(), 'jeweler-e2e-ops-dist'));
const PASSWORD = 'E2E-Strong-Password-42';
const BIZ = 'e2e_ops_business';
const A = 'Merkez';
const B = 'Nişantaşı';

if (!process.argv.includes('--skip-build') || !fs.existsSync(path.join(DIST, 'index.html'))) {
  console.log(`[e2e] Building frontend into ${DIST} …`);
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', DIST, '--emptyOutDir'], {
    cwd: projectRoot,
    env: { ...process.env, VITE_API_URL: `http://localhost:${API_PORT}` },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('Frontend build failed');
}

const { MongoMemoryReplSet } = requireBackend('mongodb-memory-server');
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGO_URI: replSet.getUri('jeweler_e2e_ops'),
  JWT_SECRET: 'e2e-ops-secret-with-more-than-thirty-two-characters!!',
  CORS_ORIGIN: WEB_ORIGIN,
  APP_URL: WEB_ORIGIN,
  REQUEST_LOG: 'off',
});

const mongoose = requireBackend('mongoose');
const app = requireBackend('./server.js');
const User = requireBackend('./models/User.js');
const Product = requireBackend('./models/Product.js');
const StockTransfer = requireBackend('./models/StockTransfer.js');
const PosSettlement = requireBackend('./models/PosSettlement.js');
const Purchase = requireBackend('./models/Purchase.js');
const { signToken } = requireBackend('./middleware/auth.js');
const { hashPassword } = requireBackend('./utils/passwords.js');
const { resetAllRateLimiters } = requireBackend('./middleware/rateLimit.js');

await mongoose.connect(process.env.MONGO_URI);
const apiServer = await new Promise((resolve) => { const s = app.listen(API_PORT, '127.0.0.1', () => resolve(s)); });
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const webServer = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, WEB_ORIGIN).pathname);
  let file = path.join(DIST, urlPath);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => webServer.listen(WEB_PORT, '127.0.0.1', resolve));

const passwordHash = await hashPassword(PASSWORD);
let n = 0;
const seedUser = (role, branch) => User.create({
  email: `${role}.${(n += 1)}.${Date.now()}@ops.e2e`, name: `E2E ${role} ${n}`, passwordHash, role, branch, businessId: BIZ, active: true,
});

function api(user) {
  const token = signToken(user, 900);
  return async (method, p, body, headers = {}) => {
    const res = await fetch(`http://127.0.0.1:${API_PORT}${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

const browser = await chromium.launch();
const results = [];

async function asUser(user, fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`    [pageerror] ${error.message}`));
  try {
    await page.goto(`${WEB_ORIGIN}/login`);
    await page.locator('input[type="email"]').first().fill(user.email);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.getByRole('button', { name: /Güvenli Oturum Aç/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await fn(page);
  } catch (error) {
    const shot = path.join(os.tmpdir(), `jeweler-e2e-ops-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    console.log(`    screenshot: ${shot}`);
    throw error;
  } finally {
    await context.close();
  }
}

async function scenario(name, fn) {
  resetAllRateLimiters();
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name} (${Date.now() - started}ms)`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  ✖ ${name}\n    ${error.stack || error}`);
  }
}

console.log('\n[e2e] Running operational workflow scenarios');
const admin = await seedUser('admin', A);
const managerA1 = await seedUser('manager', A);
const managerA2 = await seedUser('manager', A);
const staffB = await seedUser('staff', B);
const adminApi = api(admin);

await scenario('Transfer: draft → approve (second manager) → dispatch → receive at destination', async () => {
  const created = await api(managerA1)('POST', '/api/products', { name: 'E2E Bileklik', price: '1000.00', costPrice: '600.00', stock: 5, branch: A });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const productId = created.body._id;

  await asUser(managerA1, async (page) => {
    await page.goto(`${WEB_ORIGIN}/transfers`);
    await page.getByRole('button', { name: /Yeni Transfer/ }).click();
    const dialog = page.locator('.v-dialog').last();
    await dialog.locator('select').nth(0).selectOption(B);
    await dialog.locator('select').nth(2).selectOption(String(productId));
    await dialog.locator('input[type="number"]').fill('2');
    await dialog.getByRole('button', { name: /Taslak Oluştur/ }).click();
    await page.getByText(/taslağı oluşturuldu/).waitFor();
  });
  const transfer = await StockTransfer.findOne({ businessId: BIZ }).lean();
  assert.equal(transfer.status, 'draft');

  await asUser(managerA2, async (page) => {
    await page.goto(`${WEB_ORIGIN}/transfers`);
    await page.getByText(`#${transfer._id}`).click();
    await page.getByRole('button', { name: /Onayla/ }).click();
    await page.getByText(/Onaylandı \(rezerve\)/).first().waitFor();
    await page.getByRole('button', { name: /Sevk Et/ }).click();
    await page.locator('.v-dialog .jp-badge', { hasText: 'Yolda' }).waitFor();
  });
  assert.equal((await Product.findById(productId).lean()).stock, 3);

  await asUser(staffB, async (page) => {
    await page.goto(`${WEB_ORIGIN}/transfers`);
    await page.getByText(`#${transfer._id}`).click();
    const dialog = page.locator('.v-dialog').last();
    await dialog.locator('input[placeholder="adet"]').fill('2');
    await dialog.getByRole('button', { name: /Teslim Al/ }).click();
    await dialog.locator('.jp-badge', { hasText: 'Tamamlandı' }).waitFor();
  });
  const done = await StockTransfer.findById(transfer._id).lean();
  assert.equal(done.status, 'received');
  assert.equal((await Product.findById(done.lines[0].destinationProductId).lean()).stock, 2);
});

await scenario('POS: card sale books commission; bank settlement through the UI clears the receivable', async () => {
  const provider = await adminApi('POST', '/api/pos/providers', { code: 'E2EBANK', name: 'E2E Bank', rules: [{ installments: 1, ratePercent: '2.00', valorDays: 0 }] });
  assert.equal(provider.status, 201, JSON.stringify(provider.body));
  const product = await adminApi('POST', '/api/products', { name: 'E2E Yüzük', price: '500.00', costPrice: '200.00', stock: 2, branch: A });
  const customer = await adminApi('POST', '/api/customers', { name: 'E2E Müşteri' });
  const sale = await api(managerA1)('POST', '/api/sales', {
    customerId: customer.body._id, lines: [{ productId: product.body._id, quantity: 1 }], payments: [{ method: 'kredi kartı', amount: '500.00', pos: { providerId: provider.body._id } }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));

  await asUser(managerA1, async (page) => {
    await page.goto(`${WEB_ORIGIN}/pos`);
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole('button', { name: /Hesap Kesimi \(1\)/ }).click();
    const dialog = page.locator('.v-dialog').last();
    assert.equal(await dialog.locator('input[inputmode="decimal"]').inputValue(), '490.00', 'net = 500 − 2 %');
    await dialog.getByRole('button', { name: /^Kaydet$/ }).click();
    await page.getByText(/Hesap kesimi kaydedildi/).waitFor();
  });
  const settlement = await PosSettlement.findOne({ businessId: BIZ }).lean();
  assert.equal(settlement.depositedMinor, 49000);
  const accounts = await adminApi('GET', '/api/ledger/accounts');
  const card = accounts.body.find((a) => a.account === `bank:${A}:card`);
  assert.equal(card.balance, 0);
});

// PR #8: refund-only batch. The sale above is settled; its card return leaves
// one open refund (retained commission policy → the bank claws back the full
// 500.00). The dialog must prefill the signed amount, explain it and save it.
await scenario('POS: refund-only batch is settled through the UI with the negative bank debit', async () => {
  const prior = await PosSettlement.findOne({ businessId: BIZ }).lean();
  assert.ok(prior, 'previous POS scenario settled the capture');
  const sales = await adminApi('GET', '/api/sales');
  const cardSale = sales.body.find((s) => s.lines?.some((l) => l.productName === 'E2E Yüzük'));
  const ret = await api(managerA1)('POST', `/api/sales/${cardSale._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], refundMethod: 'kredi kartı', reason: 'E2E iade' });
  assert.equal(ret.status, 200, JSON.stringify(ret.body)); // the return endpoint answers with the updated sale

  await asUser(managerA1, async (page) => {
    await page.goto(`${WEB_ORIGIN}/pos`);
    await page.locator('input[type="checkbox"]:not([disabled])').first().check();
    await page.getByRole('button', { name: /Hesap Kesimi \(1\)/ }).click();
    const dialog = page.locator('.v-dialog').last();
    assert.equal(await dialog.locator('input[inputmode="decimal"]').inputValue(), '-500.00', 'signed expected net prefilled');
    await dialog.getByText(/İadeler tahsilatları aşıyor/).waitFor();
    await dialog.getByRole('button', { name: /^Kaydet$/ }).click();
    await page.getByText(/Hesap kesimi kaydedildi/).waitFor();
  });
  const refundSettlement = await PosSettlement.findOne({ businessId: BIZ, depositedMinor: { $lt: 0 } }).lean();
  assert.equal(refundSettlement.depositedMinor, -50000);
  assert.equal(refundSettlement.expectedMinor, -50000);
  assert.ok(refundSettlement.journalEntryId, 'money moved → journal entry');
  const accounts = await adminApi('GET', '/api/ledger/accounts');
  assert.equal(accounts.body.find((a) => a.account === `bank:${A}:card`).balance, 0, 'card account closed');
});

// PR #8: netted batch. A capture and its full refund under the "reversed"
// commission policy net to exactly 0: the dialog prefills 0.00, explains it,
// lets the user save, and no journal entry is posted.
await scenario('POS: netted batch (capture = refund) is settled through the UI with 0', async () => {
  const provider = await adminApi('POST', '/api/pos/providers', {
    code: 'E2EREV', name: 'E2E Reversed', refundCommissionPolicy: 'reversed', rules: [{ installments: 1, ratePercent: '2.00', valorDays: 0 }],
  });
  assert.equal(provider.status, 201, JSON.stringify(provider.body));
  const product = await adminApi('POST', '/api/products', { name: 'E2E Küpe', price: '500.00', costPrice: '200.00', stock: 2, branch: A });
  const customer = await adminApi('POST', '/api/customers', { name: 'E2E Netleşen' });
  const sale = await api(managerA1)('POST', '/api/sales', {
    customerId: customer.body._id, lines: [{ productId: product.body._id, quantity: 1 }], payments: [{ method: 'kredi kartı', amount: '500.00', pos: { providerId: provider.body._id } }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const ret = await api(managerA1)('POST', `/api/sales/${sale.body._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], refundMethod: 'kredi kartı', reason: 'E2E iade' });
  assert.equal(ret.status, 200, JSON.stringify(ret.body)); // the return endpoint answers with the updated sale

  await asUser(managerA1, async (page) => {
    await page.goto(`${WEB_ORIGIN}/pos`);
    const boxes = page.locator('input[type="checkbox"]:not([disabled])');
    await boxes.first().waitFor();
    assert.equal(await boxes.count(), 2, 'capture + refund open');
    for (let i = 0; i < 2; i += 1) await boxes.nth(i).check();  
    await page.getByRole('button', { name: /Hesap Kesimi \(2\)/ }).click();
    const dialog = page.locator('.v-dialog').last();
    assert.equal(await dialog.locator('input[inputmode="decimal"]').inputValue(), '0.00');
    await dialog.getByText(/birbirini kapatıyor/).waitFor();
    const save = dialog.getByRole('button', { name: /^Kaydet$/ });
    assert.equal(await save.isEnabled(), true, 'zero is a valid amount for a netted batch');
    await save.click();
    await page.getByText(/Hesap kesimi kaydedildi/).waitFor();
  });
  const netted = await PosSettlement.findOne({ businessId: BIZ, providerId: provider.body._id }).lean();
  assert.equal(netted.expectedMinor, 0);
  assert.equal(netted.depositedMinor, 0);
  assert.equal(netted.journalEntryId, null, 'no money moved → no journal entry');
  assert.equal(netted.allocations.length, 2);
});

// PR #8: a silver-only cart shows the SILVER manual price input (not gold)
// and the sale is priced with manualPrices.XAG.
await scenario('Sales: silver line is priced with the XAG manual price entered in the UI', async () => {
  const silver = await adminApi('POST', '/api/products', {
    name: 'E2E Gümüş Bilezik', pricingMode: 'gram', metal: 'XAG', milyem: 925, weight: '5.000', stock: 3, branch: A,
  });
  assert.equal(silver.status, 201, JSON.stringify(silver.body));
  const customer = await adminApi('POST', '/api/customers', { name: 'E2E Gümüş Müşteri' });

  await asUser(managerA1, async (page) => {
    await page.goto(`${WEB_ORIGIN}/sales?newSale=1`);
    await page.locator('#sale-customer').selectOption(String(customer.body._id));
    await page.locator('[data-test="sale-product-0"]').selectOption(String(silver.body._id));
    await page.locator('#sale-manual-price-XAG').waitFor();
    assert.equal(await page.locator('#sale-manual-price-XAU').count(), 0, 'no gold input for a silver-only cart');
    await page.locator('#sale-manual-price-XAG').fill('40,00');
    // 5 g × 0.925 × 40.00 = 185.00, quoted by the server
    await page.locator('.cart-amount', { hasText: '185' }).first().waitFor();
    const submit = page.locator('[data-test="sale-submit"]');
    await page.waitForFunction(() => !document.querySelector('[data-test="sale-submit"]')?.disabled);
    await submit.click();
    await page.getByText(/Satış kaydedildi/).waitFor();
  });
  const sales = await adminApi('GET', '/api/sales');
  const stored = sales.body.find((s) => s.lines?.some((l) => l.productId === silver.body._id));
  assert.ok(stored, 'sale stored');
  const line = stored.lines.find((l) => l.productId === silver.body._id);
  assert.equal(line.price.priceType, 'manual');
  assert.equal(line.price.symbol, 'GUMUS_GRAM');
  assert.equal(line.unitPrice, 185);
});

await scenario('Purchase return through the Finance page', async () => {
  const supplier = await adminApi('POST', '/api/suppliers', { name: 'E2E Tedarikçi' });
  const product = await adminApi('POST', '/api/products', { name: 'E2E Kolye', price: '300.00', costPrice: '100.00', stock: 0, branch: A });
  const purchase = await api(managerA1)('POST', '/api/purchases', { supplierId: supplier.body._id, lines: [{ productId: product.body._id, quantity: 4, unitCost: '100.00' }] });
  assert.equal(purchase.status, 201, JSON.stringify(purchase.body));

  await asUser(managerA1, async (page) => {
    await page.goto(`${WEB_ORIGIN}/finance`);
    await page.getByRole('button', { name: /^Alışlar/ }).click();
    await page.locator('button[title="İade / fiyat farkı"]').first().click();
    const dialog = page.locator('.v-dialog').last();
    await dialog.locator('input[placeholder="adet"]').fill('1');
    await dialog.locator('input[maxlength="300"]').fill('Kusurlu ürün');
    await dialog.getByRole('button', { name: /^Kaydet$/ }).click();
    await page.getByText(/İade alış kaydedildi/).waitFor();
  });
  const stored = await Purchase.findById(purchase.body._id).lean();
  assert.equal(stored.returnedMinor, 10000);
  assert.equal((await Product.findById(product.body._id).lean()).stock, 3);
});

await scenario('Books reconcile after all UI workflows', async () => {
  const rec = await adminApi('GET', '/api/ledger/reconciliation');
  assert.equal(rec.body.ok, true, JSON.stringify({ l: rec.body.ledger.discrepancies, i: rec.body.inventory.discrepancies, t: rec.body.transfers.discrepancies, p: rec.body.pos.discrepancies }));
});

await browser.close();
await new Promise((r) => webServer.close(r));
await new Promise((r) => apiServer.close(r));
await mongoose.disconnect();
await replSet.stop();

const failed = results.filter((r) => !r.ok);
console.log(`\n[e2e] ${results.length - failed.length}/${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
