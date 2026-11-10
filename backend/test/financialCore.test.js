/**
 * Financial core acceptance tests — real MongoDB replica set, real HTTP.
 *
 * Every monetary expectation is hand-computed in a comment (and the gram
 * prices were cross-checked with Python's decimal module), never taken from
 * the implementation. After each workflow the books are reconciled through
 * GET /api/ledger/reconciliation (journal balanced, projections == journal,
 * customer/supplier balances == their accounts, stock == movements).
 */
const { inspect } = require('../testSupport/tenantInspection');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'financial-core-secret-with-more-than-thirty-two-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const Product = inspect(require('../models/Product'));
const Customer = inspect(require('../models/Customer'));
const Sale = inspect(require('../models/Sale'));
const StockMovement = inspect(require('../models/StockMovement'));
const LedgerEntry = inspect(require('../models/LedgerEntry'));
const AccountBalance = inspect(require('../models/AccountBalance'));
const AuditLog = require('../models/AuditLog');
const { signToken } = require('../middleware/auth');
const { hashPassword } = require('../utils/passwords');
const { createSalesService } = require('../services/salesService');
const migrateFinancialData = require('../scripts/migrateFinancialData');
const { DEFAULT_BUSINESS_ID, DEFAULT_BRANCH } = require('../config/tenancy');

const PASSWORD = 'Financial-Core-Pass-2026';
const BRANCH = 'Merkez';
const uid = () => crypto.randomBytes(5).toString('hex');
let server;
let baseUrl;
let passwordHash;

function request(method, path, { body, token, headers = {} } = {}) {
  const url = new URL(path, baseUrl);
  const reqHeaders = { ...headers };
  if (token) reqHeaders.Authorization = `Bearer ${token}`;
  const payload = body === undefined ? null : JSON.stringify(body);
  if (payload) reqHeaders['Content-Type'] = 'application/json';
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: reqHeaders, agent: false }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function createUser({ role, businessId, branch = BRANCH, customPermissions = [] }) {
  return User.create({
    email: `${role}_${uid()}@financial.test`, name: `Test ${role}`, passwordHash, role, branch, businessId, customPermissions, active: true,
  });
}

/** A fresh tenant with an admin, a manager and a staff member. */
async function tenant({ branch = BRANCH } = {}) {
  const businessId = `biz_fin_${uid()}`;
  const [admin, manager, staff] = await Promise.all([
    createUser({ role: 'admin', businessId, branch }),
    createUser({ role: 'manager', businessId, branch }),
    createUser({ role: 'staff', businessId, branch }),
  ]);
  const t = (u) => signToken(u, 900);
  const as = (token) => ({
    get: (p) => request('GET', p, { token }),
    post: (p, body, headers) => request('POST', p, { token, body, headers }),
    put: (p, body) => request('PUT', p, { token, body }),
    del: (p) => request('DELETE', p, { token }),
  });
  return { businessId, branch, admin: as(t(admin)), manager: as(t(manager)), staff: as(t(staff)), users: { admin, manager, staff } };
}

async function mustCreate(res, label) {
  assert.ok([200, 201].includes(res.status), `${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

const product = (api, body) => api.post('/api/products', body).then((r) => mustCreate(r, 'product'));
const customer = (api, body = {}) => api.post('/api/customers', { name: `Müşteri ${uid()}`, ...body }).then((r) => mustCreate(r, 'customer'));
const supplier = (api, body = {}) => api.post('/api/suppliers', { name: `Tedarikçi ${uid()}`, ...body }).then((r) => mustCreate(r, 'supplier'));

async function balances(api) {
  const res = await api.get('/api/ledger/accounts');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const map = new Map(res.body.map((a) => [`${a.account}|${a.unit}`, a.balance]));
  return (account, unit = 'TRY') => map.get(`${account}|${unit}`) ?? 0;
}

async function assertReconciled(api, label) {
  const res = await api.get('/api/ledger/reconciliation');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true, `${label}: ${JSON.stringify({ ledger: res.body.ledger.discrepancies, inventory: res.body.inventory.discrepancies })}`);
  assert.deepEqual(res.body.ledger.trialBalance.TRY ?? 0, 0);
  return res.body;
}

const stockOf = async (id) => (await Product.findById(id).lean()).stock;
const HAS = '6562.53';

describe('Financial core (real MongoDB, HTTP)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  before(async () => {
    await mongoose.connect(uri);
    await Promise.all([User, Product, Customer, Sale, StockMovement, LedgerEntry, AccountBalance, AuditLog].map((M) => M.init()));
    passwordHash = await hashPassword(PASSWORD);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await mongoose.disconnect();
  });

  // ===================================================================
  describe('Sales lifecycle', () => {
    it('multi-line gram + fixed sale: exact prices, discounts, split partial payment, stock, COGS, receivable, collection', async () => {
      const t = await tenant();
      const bilezik = await product(t.admin, {
        name: '22 Ayar Bilezik', pricingMode: 'gram', metal: 'XAU', karat: 22, weight: '10.000',
        laborType: 'milyem', laborValue: '35', costPrice: '55000.00', stock: 3,
      });
      const kolye = await product(t.admin, { name: 'Gümüş Kolye', price: '1500.00', costPrice: '900.00', stock: 5 });
      const c = await customer(t.admin);

      const res = await t.staff.post('/api/sales', {
        customerId: c._id,
        lines: [
          { productId: bilezik._id, quantity: 1 },
          { productId: kolye._id, quantity: 2, discount: { type: 'percent', value: '10' } },
        ],
        discount: { type: 'amount', value: '109.66' },
        payments: [{ method: 'nakit', amount: '20000.00' }, { method: 'kredi kartı', amount: '15000.00' }],
        manualPrices: { XAU: HAS },
      });
      const sale = await mustCreate(res, 'sale');
      // bilezik: 10 g × (0.916 + 0.035) × 6562.53 = 62409.66
      assert.equal(sale.lines[0].unitPrice, 62409.66);
      assert.equal(sale.lines[0].price.priceType, 'manual');
      assert.equal(sale.lines[0].price.pricePerGram, '6562.5300');
      assert.equal(sale.lines[0].fineGrams, 9.16);
      // kolye: 2 × 1500 = 3000 − 10 % = 2700
      assert.equal(sale.lines[1].gross, 3000);
      assert.equal(sale.lines[1].lineDiscount, 300);
      // 62409.66 + 2700 − 109.66 = 65000.00 ; gross 65409.66 ; discounts 300 + 109.66
      assert.equal(sale.financial.total, 65000);
      assert.equal(sale.financial.subtotal, 65409.66);
      assert.equal(sale.financial.discount, 409.66);
      assert.equal(sale.lines[0].saleDiscount + sale.lines[1].saleDiscount, 109.66, 'sale discount fully allocated');
      assert.equal(sale.financial.paid, 35000);
      assert.equal(sale.financial.balanceDue, 30000);
      assert.equal(sale.financial.paymentStatus, 'partial');
      assert.equal(sale.totalPrice, 65000, 'legacy field kept');

      assert.equal(await stockOf(bilezik._id), 2);
      assert.equal(await stockOf(kolye._id), 3);
      assert.equal((await Customer.findById(c._id).lean()).balanceTry, -30000, 'customer owes the open balance');

      const bal = await balances(t.admin);
      assert.equal(bal('revenue:sales'), -65000);
      assert.equal(bal(`ar:${c._id}`), 30000);
      assert.equal(bal(`cash:${BRANCH}`), 20000);
      assert.equal(bal(`bank:${BRANCH}:card`), 15000);
      // COGS: 1 × 55000 + 2 × 900 = 56800 ; inventory: 165000 + 4500 − 56800 = 112700
      assert.equal(bal('cogs'), 56800);
      assert.equal(bal(`inventory:${BRANCH}`), 112700);

      const pay = await t.staff.post(`/api/sales/${sale._id}/payments`, { method: 'havale', amount: '30000.00' });
      assert.equal(pay.status, 200, JSON.stringify(pay.body));
      assert.equal(pay.body.financial.paymentStatus, 'paid');
      assert.equal(pay.body.financial.balanceDue, 0);
      const over = await t.staff.post(`/api/sales/${sale._id}/payments`, { method: 'nakit', amount: '0.01' });
      assert.equal(over.status, 400);
      assert.equal(over.body.code, 'OVERPAYMENT');
      assert.equal((await Customer.findById(c._id).lean()).balanceTry, 0);

      const statement = await t.staff.get(`/api/cash/customer/${c._id}/ledger`);
      assert.equal(statement.status, 200);
      assert.equal(statement.body.balanceTry, 0);
      assert.equal(statement.body.entries.length, 3, 'sale, POS payment, transfer payment');
      assert.ok(await AuditLog.exists({ action: 'sale.created', resourceId: String(sale._id) }));
      await assertReconciled(t.admin, 'after sale + collection');
    });

    it('partial return with cash refund, then the rest to account credit; over-return rejected', async () => {
      const t = await tenant();
      const p = await product(t.admin, { name: 'Yüzük', price: '1000.00', costPrice: '600.00', stock: 3 });
      const c = await customer(t.admin);
      const sale = await mustCreate(await t.staff.post('/api/sales', {
        customerId: c._id, lines: [{ productId: p._id, quantity: 3 }], payments: [{ method: 'nakit', amount: '3000.00' }],
      }), 'sale');
      assert.equal(await stockOf(p._id), 0);

      const r1 = await t.manager.post(`/api/sales/${sale._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], refundMethod: 'nakit', reason: 'beden' });
      assert.equal(r1.status, 200, JSON.stringify(r1.body));
      assert.equal(r1.body.status, 'partially_returned');
      assert.equal(r1.body.financial.returned, 1000);
      assert.equal(r1.body.financial.paid, 2000);
      assert.equal(await stockOf(p._id), 1);

      const tooMany = await t.manager.post(`/api/sales/${sale._id}/returns`, { lines: [{ lineId: 1, quantity: 3 }], refundMethod: 'nakit' });
      assert.equal(tooMany.status, 409);
      assert.equal(tooMany.body.code, 'RETURN_EXCEEDS_SOLD');
      const staffReturn = await t.staff.post(`/api/sales/${sale._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }] });
      assert.equal(staffReturn.status, 403, 'returns require sales:cancel');

      const r2 = await t.manager.post(`/api/sales/${sale._id}/returns`, { lines: [{ lineId: 1, quantity: 2 }], refundMethod: 'cari' });
      assert.equal(r2.status, 200, JSON.stringify(r2.body));
      assert.equal(r2.body.status, 'returned');
      assert.equal(await stockOf(p._id), 3);
      // 2000 paid for goods now returned and kept on account → customer credit +2000
      assert.equal((await Customer.findById(c._id).lean()).balanceTry, 2000);

      const bal = await balances(t.admin);
      assert.equal(bal(`cash:${BRANCH}`), 2000, '3000 in − 1000 refunded');
      assert.equal(bal('revenue:returns'), 3000);
      assert.equal(bal('cogs'), 0, 'all cost returned to stock');
      assert.equal(bal(`inventory:${BRANCH}`), 1800, 'back to 3 × 600');
      const again = await t.manager.post(`/api/sales/${sale._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }] });
      assert.equal(again.status, 409);
      await assertReconciled(t.admin, 'after returns');
    });

    it('cancellation reverses the sale and refunds sale payments; account collections stay as credit', async () => {
      const t = await tenant();
      const p = await product(t.admin, { name: 'Küpe', price: '1000.00', costPrice: '400.00', stock: 2 });
      const c = await customer(t.admin);
      const sale = await mustCreate(await t.staff.post('/api/sales', {
        customerId: c._id, lines: [{ productId: p._id, quantity: 2 }], payments: [{ method: 'nakit', amount: '500.00' }],
      }), 'sale');
      assert.equal((await t.staff.post(`/api/sales/${sale._id}/payments`, { method: 'kredi kartı', amount: '300.00' })).status, 200);
      const collection = await t.staff.post('/api/cash/transactions', { type: 'tahsilat', customerId: c._id, amountTry: '200.00', paymentMethod: 'nakit' });
      assert.equal(collection.status, 201, JSON.stringify(collection.body));
      assert.deepEqual(collection.body.allocations, [{ saleId: sale._id, amountMinor: 20000 }], 'FIFO allocation to the open sale');
      assert.equal((await Sale.findById(sale._id).lean()).balanceDueMinor, 100000);

      const cancelled = await t.manager.del(`/api/sales/${sale._id}`);
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
      assert.equal(cancelled.body.data.status, 'cancelled');
      assert.equal(await stockOf(p._id), 2);
      assert.equal((await Customer.findById(c._id).lean()).balanceTry, 200, 'the on-account collection remains as credit');
      const bal = await balances(t.admin);
      assert.equal(bal(`cash:${BRANCH}`), 200, '500 refunded, 200 account collection kept');
      assert.equal(bal(`bank:${BRANCH}:card`), 0);
      assert.equal(bal('revenue:sales'), 0);
      assert.equal(bal('cogs'), 0);
      assert.equal((await t.manager.del(`/api/sales/${sale._id}`)).status, 409);
      await assertReconciled(t.admin, 'after cancellation');
    });

    it('journaled sales lock their financial facts; metadata stays editable', async () => {
      const t = await tenant();
      const p = await product(t.admin, { name: 'Halka', price: '100.00', stock: 1 });
      const c = await customer(t.admin);
      const sale = await mustCreate(await t.staff.post('/api/sales', { customerId: c._id, productId: p._id, quantity: 1, paymentMethod: 'nakit' }), 'legacy-shape sale');
      assert.equal(sale.financial.paymentStatus, 'paid', 'legacy request shape = paid in full');
      const locked = await t.staff.put(`/api/sales/${sale._id}`, { paymentMethod: 'havale' });
      assert.equal(locked.status, 409);
      assert.equal(locked.body.code, 'SALE_FINANCIALS_LOCKED');
      const notes = await t.staff.put(`/api/sales/${sale._id}`, { notes: 'Hediye paketi' });
      assert.equal(notes.status, 200);
    });

    it('credit limit is enforced on the open balance', async () => {
      const t = await tenant();
      const p = await product(t.admin, { name: 'Bileklik', price: '800.00', stock: 10 });
      const c = await customer(t.admin, { creditLimit: 1000 });
      const base = { customerId: c._id, payments: [] };
      const over = await t.staff.post('/api/sales', { ...base, lines: [{ productId: p._id, quantity: 2 }] });
      assert.equal(over.status, 409);
      assert.equal(over.body.code, 'CREDIT_LIMIT_EXCEEDED');
      assert.equal(await stockOf(p._id), 10, 'rejected sale leaves stock untouched');
      assert.equal((await t.staff.post('/api/sales', { ...base, lines: [{ productId: p._id, quantity: 1 }] })).status, 201);
      const second = await t.staff.post('/api/sales', { ...base, lines: [{ productId: p._id, quantity: 1 }] });
      assert.equal(second.status, 409, '800 + 800 > 1000');
    });

    it('rejects overpayment, invalid money formats and unknown payment methods', async () => {
      const t = await tenant();
      const p = await product(t.admin, { name: 'Zincir', price: '100.00', stock: 5 });
      const c = await customer(t.admin);
      const cases = [
        [{ payments: [{ method: 'nakit', amount: '100.01' }] }, 'OVERPAYMENT'],
        [{ payments: [{ method: 'nakit', amount: '10.005' }] }, null],
        [{ payments: [{ method: 'nakit', amount: '-1' }] }, null],
        [{ payments: [{ method: 'bitcoin', amount: '1' }] }, null],
        [{ discount: { type: 'amount', value: '100.01' } }, null],
      ];
      for (const [patch, code] of cases) {
        const res = await t.staff.post('/api/sales', { customerId: c._id, lines: [{ productId: p._id, quantity: 1 }], ...patch });
        assert.equal(res.status, 400, JSON.stringify(patch));
        if (code) assert.equal(res.body.code, code);
      }
      assert.equal(await stockOf(p._id), 5);
    });

    it('historical price integrity: later product/price changes never alter a recorded sale', async () => {
      const t = await tenant();
      const p = await product(t.admin, {
        name: '22 Ayar Burma', pricingMode: 'gram', metal: 'XAU', karat: 22, weight: '10.000', laborType: 'milyem', laborValue: '35', stock: 3,
      });
      const c = await customer(t.admin);
      const first = await mustCreate(await t.staff.post('/api/sales', {
        customerId: c._id, lines: [{ productId: p._id, quantity: 1 }], payments: [{ method: 'nakit', amount: '62409.66' }], manualPrices: { XAU: HAS },
      }), 'first');
      assert.equal(first.lines[0].unitPrice, 62409.66);

      assert.equal((await t.admin.put(`/api/products/${p._id}`, { karat: 18, weight: '12.000', laborValue: '50', stock: 2 })).status, 200);
      const second = await mustCreate(await t.staff.post('/api/sales', {
        customerId: c._id, lines: [{ productId: p._id, quantity: 1 }], manualPrices: { XAU: '7000.00' },
      }), 'second');
      // 12 g × (0.750 + 0.050) × 7000 = 67200.00
      assert.equal(second.lines[0].unitPrice, 67200);

      const stored = (await t.staff.get(`/api/sales/${first._id}`)).body;
      assert.equal(stored.lines[0].unitPrice, 62409.66);
      assert.equal(stored.lines[0].purity, 9160);
      assert.equal(stored.lines[0].weightGramsPerUnit, 10);
      assert.equal(stored.lines[0].laborValue, '35.0');
      assert.equal(stored.lines[0].price.pricePerGram, '6562.5300');
      const ret = await t.manager.post(`/api/sales/${first._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], refundMethod: 'nakit' });
      assert.equal(ret.status, 200);
      assert.equal(ret.body.financial.returned, 62409.66, 'refund uses the historical price');
      await assertReconciled(t.admin, 'historical integrity');
    });

    it('gram items are never priced from stale data: live quote required, otherwise explicit manual price', async () => {
      const t = await tenant();
      const p = await product(t.admin, { name: '14 Ayar Kolye', pricingMode: 'gram', metal: 'XAU', karat: 14, weight: '5.000', stock: 2 });
      const c = await customer(t.admin);
      const ctx = { businessId: t.businessId, branch: BRANCH, userId: t.users.staff._id, isAdmin: false, correlationId: 'stale-test' };
      const stale = { preferredQuotes: [{ symbol: 'HAS_ALTIN', buy: 6000, sell: 6001, priceType: 'cached', isStale: true, sourceTimestamp: new Date().toISOString() }] };
      const staleService = createSalesService({ quoteSource: async () => stale });
      await assert.rejects(
        staleService.createSale({ customerId: c._id, lines: [{ productId: p._id, quantity: 1 }] }, null, ctx),
        (error) => error.statusCode === 409 && error.code === 'MARKET_PRICE_UNAVAILABLE',
      );
      assert.equal(await stockOf(p._id), 2);

      const live = { preferredQuotes: [{ symbol: 'HAS_ALTIN', buy: 6561.74, sell: 6562.53, priceType: 'live', isStale: false, source: 'genelpara', sourceTimestamp: new Date().toISOString() }] };
      const sale = await createSalesService({ quoteSource: async () => live })
        .createSale({ customerId: c._id, lines: [{ productId: p._id, quantity: 1 }] }, null, ctx);
      // 5 g × 0.585 × 6562.53 (sell side) = 19195.40 (19195.40025)
      assert.equal(sale.lines[0].unitPriceMinor, 1919540);
      assert.equal(sale.lines[0].price.priceType, 'live');
      assert.equal(sale.lines[0].price.side, 'sell');
      assert.equal(sale.lines[0].price.source, 'genelpara');
    });
  });

  // ===================================================================
  describe('Concurrency, idempotency, rollback', () => {
    it('20 concurrent sales on 5 units: exactly 5 succeed, stock never negative, books reconcile', async () => {
      const t = await tenant();
      const p = await product(t.admin, { name: 'Son 5 adet', price: '250.00', costPrice: '100.00', stock: 5 });
      const c = await customer(t.admin);
      const results = await Promise.all(Array.from({ length: 20 }, () => t.staff.post('/api/sales', {
        customerId: c._id, lines: [{ productId: p._id, quantity: 1 }], payments: [{ method: 'nakit', amount: '250.00' }],
      })));
      const statuses = results.map((r) => r.status);
      assert.equal(statuses.filter((s) => s === 201).length, 5, JSON.stringify(statuses));
      assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.body.code === 'INSUFFICIENT_STOCK'));
      assert.equal(await stockOf(p._id), 0);
      assert.equal(await StockMovement.countDocuments({ businessId: t.businessId, productId: p._id, movementType: 'sale' }), 5);
      const bal = await balances(t.admin);
      assert.equal(bal(`cash:${BRANCH}`), 1250);
      assert.equal(bal('cogs'), 500);
      await assertReconciled(t.admin, 'concurrent sales');
    });

    it('concurrent payments can never exceed the open balance', async () => {
      const t = await tenant();
      const p = await product(t.admin, { name: 'Taksitli', price: '1000.00', stock: 1 });
      const c = await customer(t.admin);
      const sale = await mustCreate(await t.staff.post('/api/sales', { customerId: c._id, lines: [{ productId: p._id, quantity: 1 }], payments: [] }), 'sale');
      const results = await Promise.all(Array.from({ length: 6 }, () => t.staff.post(`/api/sales/${sale._id}/payments`, { method: 'nakit', amount: '300.00' })));
      const ok = results.filter((r) => r.status === 200).length;
      assert.equal(ok, 3, results.map((r) => r.status).join(','));
      const stored = await Sale.findById(sale._id).lean();
      assert.equal(stored.paidMinor, 90000);
      assert.equal(stored.balanceDueMinor, 10000);
      await assertReconciled(t.admin, 'concurrent payments');
    });

    it('idempotency: retries and parallel duplicates create exactly one sale; key reuse with another payload is rejected', async () => {
      const t = await tenant();
      const p = await product(t.admin, { name: 'Tek', price: '500.00', stock: 10 });
      const c = await customer(t.admin);
      const body = { customerId: c._id, lines: [{ productId: p._id, quantity: 1 }], payments: [{ method: 'nakit', amount: '500.00' }] };
      const key = `sale-${uid()}-key`;
      const first = await t.staff.post('/api/sales', body, { 'Idempotency-Key': key });
      const retry = await t.staff.post('/api/sales', body, { 'Idempotency-Key': key });
      assert.equal(first.status, 201);
      assert.equal(retry.status, 201);
      assert.equal(retry.headers['idempotent-replayed'], 'true');
      assert.equal(retry.body._id, first.body._id);
      assert.equal(await stockOf(p._id), 9);

      const parallelKey = `sale-${uid()}-parallel`;
      const parallel = await Promise.all(Array.from({ length: 6 }, () => t.staff.post('/api/sales', body, { 'Idempotency-Key': parallelKey })));
      assert.ok(parallel.every((r) => r.status === 201), parallel.map((r) => `${r.status}:${r.body?.code}`).join(','));
      assert.equal(new Set(parallel.map((r) => r.body._id)).size, 1, 'one sale for six parallel duplicates');
      assert.equal(await stockOf(p._id), 8);

      const reuse = await t.staff.post('/api/sales', { ...body, lines: [{ productId: p._id, quantity: 2 }] }, { 'Idempotency-Key': key });
      assert.equal(reuse.status, 422);
      assert.equal(reuse.body.code, 'IDEMPOTENCY_KEY_REUSED');
      assert.equal((await t.staff.post('/api/sales', body, { 'Idempotency-Key': 'short' })).status, 400);

      const open = await mustCreate(await t.staff.post('/api/sales', { ...body, payments: [] }), 'open sale');
      const payKey = `pay-${uid()}-key`;
      for (let i = 0; i < 3; i += 1) {
        assert.equal((await t.staff.post(`/api/sales/${open._id}/payments`, { method: 'nakit', amount: '100.00' }, { 'Idempotency-Key': payKey })).status, 200);
      }
      assert.equal((await Sale.findById(open._id).lean()).paidMinor, 10000, 'payment applied once');
      await assertReconciled(t.admin, 'idempotency');
    });

    it('a failure inside the transaction rolls back stock, sale, journal and customer balance', async () => {
      const t = await tenant();
      const p = await product(t.admin, { name: 'Geri alınacak', price: '700.00', costPrice: '300.00', stock: 2 });
      const c = await customer(t.admin);
      const before = { movements: await StockMovement.countDocuments({ businessId: t.businessId }), entries: await LedgerEntry.countDocuments({ businessId: t.businessId }) };
      const originalCreate = LedgerEntry.create;
      LedgerEntry.create = async function failOnPayment(docs, options) {
        if (Array.isArray(docs) && docs[0]?.entryType === 'sale_payment') throw new Error('injected journal failure');
        return originalCreate.call(this, docs, options);
      };
      let res;
      try {
        res = await t.staff.post('/api/sales', { customerId: c._id, lines: [{ productId: p._id, quantity: 1 }], payments: [{ method: 'nakit', amount: '700.00' }] });
      } finally {
        LedgerEntry.create = originalCreate;
      }
      assert.equal(res.status, 500);
      assert.equal(await stockOf(p._id), 2);
      assert.equal(await Sale.countDocuments({ businessId: t.businessId }), 0);
      assert.equal(await StockMovement.countDocuments({ businessId: t.businessId }), before.movements, 'no stock movement');
      assert.equal(await LedgerEntry.countDocuments({ businessId: t.businessId }), before.entries, 'sale entry rolled back as well');
      assert.equal((await Customer.findById(c._id).lean()).balanceTryMinor, 0);
      await assertReconciled(t.admin, 'after rollback');
    });
  });

  // ===================================================================
  describe('Purchases and suppliers', () => {
    it('purchase → stock & metal pool → supplier payable → payments (direct and FIFO voucher); cancellation rules', async () => {
      const t = await tenant();
      const s = await supplier(t.admin);
      const p = await product(t.admin, { name: 'Pırlanta Tektaş', price: '30000.00', stock: 0 });
      const purchase = await mustCreate(await t.manager.post('/api/purchases', {
        supplierId: s._id,
        invoiceNo: 'A-1001',
        lines: [
          { productId: p._id, quantity: 10, unitCost: '250.00' },
          { metal: 'XAU', karat: 22, weightGrams: '100.000', totalCost: '600000.00' },
        ],
        payments: [{ method: 'havale', amount: '100000.00' }],
      }), 'purchase');
      // 10 × 250 + 600000 = 602500 ; paid 100000 ; remaining 502500
      assert.equal(purchase.total, 602500);
      assert.equal(purchase.remaining, 502500);
      assert.equal(purchase.lines[1].fineGrams, 91.6);
      const stored = await Product.findById(p._id).lean();
      assert.equal(stored.stock, 10);
      assert.equal(stored.costPrice, 250);
      assert.equal(stored.costPoolMinor, 250000);
      const pools = await t.manager.get('/api/inventory/metal');
      assert.deepEqual(pools.body.map((x) => [x.purity, x.weightGrams, x.fineGrams, x.costTry]), [[9160, 100, 91.6, 600000]]);
      assert.equal((await t.manager.get(`/api/suppliers/${s._id}`)).body.balanceTry, 502500);

      assert.equal((await t.manager.post(`/api/purchases/${purchase._id}/payments`, { method: 'nakit', amount: '2500.00' })).status, 200);
      const voucher = await t.manager.post('/api/cash/transactions', { type: 'tediye', supplierId: s._id, amountTry: '500000.00', paymentMethod: 'havale' });
      assert.equal(voucher.status, 201, JSON.stringify(voucher.body));
      assert.deepEqual(voucher.body.allocations, [{ purchaseId: purchase._id, amountMinor: 50000000 }]);
      assert.equal((await t.manager.get(`/api/purchases/${purchase._id}`)).body.paymentStatus, 'paid');
      assert.equal((await t.manager.get(`/api/suppliers/${s._id}`)).body.balanceTry, 0);
      const statement = await t.manager.get(`/api/suppliers/${s._id}/statement`);
      assert.equal(statement.body.balanceTry, 0);
      assert.equal(statement.body.entries.length, 4);

      // Selling one unit consumes purchased stock → the purchase can no longer be cancelled.
      const c = await customer(t.admin);
      assert.equal((await t.staff.post('/api/sales', { customerId: c._id, lines: [{ productId: p._id, quantity: 1 }] })).status, 201);
      const blocked = await t.manager.del(`/api/purchases/${purchase._id}`);
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.code, 'PURCHASED_STOCK_CONSUMED');

      const second = await mustCreate(await t.manager.post('/api/purchases', { supplierId: s._id, lines: [{ productId: p._id, quantity: 2, unitCost: '250.00' }] }), 'second');
      const cancel = await t.manager.del(`/api/purchases/${second._id}`);
      assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
      assert.equal(await stockOf(p._id), 9);
      assert.equal((await t.manager.get(`/api/suppliers/${s._id}`)).body.balanceTry, 0, 'payable reversed');
      assert.equal((await t.staff.get('/api/purchases')).status, 403, 'staff has no purchases:read');
      await assertReconciled(t.admin, 'purchases');
    });
  });

  // ===================================================================
  describe('Cash, accounts and gold', () => {
    it('validates vouchers strictly and keeps customer TRY and gold balances exact', async () => {
      const t = await tenant();
      const c = await customer(t.admin);
      const bad = [
        { type: 'tahsilat', customerId: c._id, amountTry: '-500', amountGoldGrams: '1' },
        { type: 'tahsilat', customerId: c._id, amountTry: '10.005' },
        { type: 'tahsilat', amountTry: '10' },
        { type: 'tahsilat', customerId: c._id },
        { type: 'gider', customerId: c._id, amountTry: '10' },
        { type: 'havai', amountTry: '10' },
      ];
      for (const body of bad) {
        const res = await t.staff.post('/api/cash/transactions', body);
        assert.equal(res.status, 400, JSON.stringify(body));
      }
      // Customer opening balances need accounts:manage (staff: 403); a direction is still mandatory (400).
      const noDirection = { type: 'devir', customerId: c._id, amountTry: '10' };
      assert.equal((await t.manager.post('/api/cash/transactions', noDirection)).status, 400);
      assert.equal((await t.staff.post('/api/cash/transactions', noDirection)).status, 403);
      const tahsilat = await t.staff.post('/api/cash/transactions', { type: 'tahsilat', customerId: c._id, amountGoldGrams: '5.000', paymentMethod: 'altın' });
      assert.equal(tahsilat.status, 201, JSON.stringify(tahsilat.body));
      const overdraw = await t.staff.post('/api/cash/transactions', { type: 'tediye', customerId: c._id, amountGoldGrams: '6.000' });
      assert.equal(overdraw.status, 409);
      assert.equal(overdraw.body.code, 'INSUFFICIENT_GOLD_TILL');
      assert.equal((await t.staff.post('/api/cash/transactions', { type: 'tediye', customerId: c._id, amountGoldGrams: '2.000' })).status, 201);
      assert.equal((await t.manager.post('/api/cash/transactions', { type: 'devir', customerId: c._id, direction: 'borc', amountTry: '1500.00' })).status, 201);
      const stored = await Customer.findById(c._id).lean();
      assert.equal(stored.balanceGold, 3, '+5 −2 g has');
      assert.equal(stored.balanceGoldMg, 3000);
      assert.equal(stored.balanceTry, -1500);

      assert.equal((await t.staff.post('/api/cash/transactions', { type: 'devir', amountTry: '10000.00' })).status, 201);
      assert.equal((await t.staff.post('/api/cash/transactions', { type: 'gider', amountTry: '250.00', expenseCategory: 'Kira' })).status, 201);
      const bal = await balances(t.admin);
      assert.equal(bal(`cash:${BRANCH}`), 9750);
      assert.equal(bal('expense:kira'), 250);
      assert.equal(bal(`vault:${BRANCH}`, 'XAU'), 3, 'gold till holds 3 g has');
      await assertReconciled(t.admin, 'vouchers');
    });

    it('statements keep the exact balance even when the history is longer than the displayed window', async () => {
      const t = await tenant();
      const c = await customer(t.admin);
      for (const amount of ['100.00', '250.00', '40.50', '9.50']) {
        assert.equal((await t.manager.post('/api/cash/transactions', { type: 'devir', customerId: c._id, direction: 'borc', amountTry: amount })).status, 201);
      }
      const ledger = require('../services/finance/ledgerService');
      const full = await ledger.accountStatement(t.businessId, `ar:${c._id}`, { units: ['TRY'] });
      const windowed = await ledger.accountStatement(t.businessId, `ar:${c._id}`, { units: ['TRY'], limit: 2 });
      assert.equal(full.closing.TRY, 40000n, '100 + 250 + 40.50 + 9.50 = 400.00 owed');
      assert.equal(windowed.truncated, true);
      assert.equal(windowed.rows.length, 2);
      assert.equal(windowed.closing.TRY, 40000n, 'closing balance is not affected by the window');
      assert.equal(windowed.opening.TRY, 35000n, 'opening of the window = 100 + 250');
      assert.equal(windowed.rows[1].balances.TRY, 40000n);
      assert.equal((await t.staff.get(`/api/cash/customer/${c._id}/ledger`)).body.balanceTry, -400);
    });

    it('scrap gold buy-back: priced from purity, fire and buy price; credited to the account or paid in cash', async () => {
      const t = await tenant();
      const c = await customer(t.admin);
      const res = await t.staff.post('/api/cash/transactions', {
        type: 'hurda_alimi', customerId: c._id, paymentMethod: 'cari', weightGrams: '12.40', karat: 22, deductionMilyem: '10', manualPricePerGram: '6561.74',
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      // 12.40 × (0.916 − 0.010) × 6561.74 = 73717.21
      assert.equal(res.body.amountTry, 73717.21);
      assert.equal(res.body.fineMg, 11358);
      assert.equal((await Customer.findById(c._id).lean()).balanceTry, 73717.21, 'the business owes the customer');
      const walkIn = await t.staff.post('/api/cash/transactions', { type: 'hurda_alimi', amountTry: '5000.00', weightGrams: '2.000', milyem: '585' });
      assert.equal(walkIn.status, 201, JSON.stringify(walkIn.body));
      const pools = (await t.staff.get('/api/inventory/metal')).body;
      assert.deepEqual(pools.map((x) => [x.purity, x.fineGrams, x.costTry]).sort((a, b) => b[0] - a[0]), [[9160, 11.358, 73717.21], [5850, 1.17, 5000]]);
      const bal = await balances(t.admin);
      assert.equal(bal(`cash:${BRANCH}`), -5000);
      assert.equal(bal(`inventory:${BRANCH}`), 78717.21);
      await assertReconciled(t.admin, 'scrap');
    });

    it('Z-report: computed from the ledger, difference posted, day locked against cash postings (card still allowed)', async () => {
      const t = await tenant();
      const p = await product(t.admin, { name: 'Kasa ürünü', price: '500.00', stock: 5 });
      const c = await customer(t.admin);
      assert.equal((await t.staff.post('/api/cash/transactions', { type: 'devir', amountTry: '1000.00' })).status, 201);
      assert.equal((await t.staff.post('/api/sales', { customerId: c._id, productId: p._id, quantity: 1, paymentMethod: 'nakit' })).status, 201);
      const summary = (await t.staff.get('/api/cash/daily-summary')).body;
      assert.equal(summary.calculatedCash, 1500);
      assert.equal(summary.cashSalesTry, 500);
      assert.equal(summary.salesCount, 1);

      const staffClose = await t.staff.post('/api/cash/daily-closing', { closingCashActual: '1490.00' });
      assert.equal(staffClose.status, 403);
      const closing = await t.admin.post('/api/cash/daily-closing', { closingCashActual: '1490.00', notes: '10 TL eksik' });
      assert.equal(closing.status, 200, JSON.stringify(closing.body));
      assert.equal(closing.body.closingCashCalculated, 1500);
      assert.equal(closing.body.cashDifference, -10);
      const bal = await balances(t.admin);
      assert.equal(bal(`cash:${BRANCH}`), 1490, 'ledger cash equals the counted cash');
      assert.equal(bal('cash_over_short'), 10);

      const again = await t.admin.post('/api/cash/daily-closing', { closingCashActual: '1490.00' });
      assert.equal(again.status, 409);
      assert.equal(again.body.code, 'DAY_ALREADY_CLOSED');
      const lateCash = await t.staff.post('/api/cash/transactions', { type: 'devir', amountTry: '1.00' });
      assert.equal(lateCash.status, 409);
      assert.equal(lateCash.body.code, 'CASH_DAY_CLOSED');
      const lateSale = await t.staff.post('/api/sales', { customerId: c._id, productId: p._id, quantity: 1, paymentMethod: 'nakit' });
      assert.equal(lateSale.status, 409);
      assert.equal(await stockOf(p._id), 4, 'rejected cash sale rolled back');
      const cardSale = await t.staff.post('/api/sales', { customerId: c._id, productId: p._id, quantity: 1, paymentMethod: 'kredi kartı' });
      assert.equal(cardSale.status, 201, 'only the cash drawer is locked');
      assert.equal((await t.admin.post('/api/cash/daily-closing', {})).status, 400, 'counted cash is mandatory');
      await assertReconciled(t.admin, 'z-report');
    });

    it('closing racing a cash posting never lets the two disagree (10×)', async () => {
      for (let i = 0; i < 10; i += 1) {
        const t = await tenant();
        assert.equal((await t.staff.post('/api/cash/transactions', { type: 'devir', amountTry: '1000.00' })).status, 201);
        const [close, voucher] = await Promise.all([
          t.admin.post('/api/cash/daily-closing', { closingCashActual: '1000.00' }),
          t.staff.post('/api/cash/transactions', { type: 'devir', amountTry: '100.00' }),
        ]);
        assert.equal(close.status, 200, `iteration ${i}: ${JSON.stringify(close.body)}`);
        if (voucher.status === 201) {
          assert.equal(close.body.closingCashCalculated, 1100, `iteration ${i}: posting before closing is included`);
          assert.equal(close.body.cashDifference, -100);
        } else {
          assert.equal(voucher.status, 409, `iteration ${i}`);
          assert.equal(close.body.closingCashCalculated, 1000);
        }
        const bal = await balances(t.admin);
        assert.equal(bal(`cash:${BRANCH}`), 1000, `iteration ${i}: ledger cash == counted cash`);
      }
    });
  });

  // ===================================================================
  describe('Inventory engine and permissions', () => {
    it('stock and cost changes are traceable adjustments that require inventory:adjust', async () => {
      const t = await tenant();
      const p = await product(t.staff, { name: 'Sayım ürünü', price: '100.00', costPrice: '40.00', stock: 5 });
      const opening = await StockMovement.findOne({ businessId: t.businessId, productId: p._id }).lean();
      assert.equal(opening.movementType, 'opening');
      assert.equal(opening.costMinor, 20000);

      const staffStock = await t.staff.put(`/api/products/${p._id}`, { name: 'Sayım ürünü', stock: 9 });
      assert.equal(staffStock.status, 403);
      assert.equal((await t.staff.put(`/api/products/${p._id}`, { name: 'Yeni ad', stock: 5, costPrice: 40 })).status, 200, 'unchanged stock/cost needs no extra permission');

      assert.equal((await t.manager.put(`/api/products/${p._id}`, { stock: 7, adjustmentReason: 'Sayım fazlası' })).status, 200);
      assert.equal((await t.manager.put(`/api/products/${p._id}`, { costPrice: '50.00' })).status, 200);
      const stored = await Product.findById(p._id).lean();
      assert.equal(stored.stock, 7);
      assert.equal(stored.costPoolMinor, 35000, '7 × 50.00');
      const history = (await t.staff.get(`/api/products/${p._id}/movements`)).body;
      assert.deepEqual(history.map((m) => m.movementType).sort(), ['adjustment', 'opening', 'revaluation']);
      const bal = await balances(t.admin);
      // 200 opening + 80 adjustment (2 × 40) + 70 revaluation (350 − 280)
      assert.equal(bal(`inventory:${BRANCH}`), 350);
      const valuation = await t.manager.get('/api/inventory/valuation');
      assert.equal(valuation.status, 200);
      assert.equal(valuation.body.products.costValueTry, 350);
      assert.equal((await t.staff.get('/api/inventory/valuation')).status, 403);
      await assertReconciled(t.manager, 'inventory');
    });

    it('customer balances cannot be written through the customer API', async () => {
      const t = await tenant();
      const created = await customer(t.admin, { balanceTry: 99999, balanceTryMinor: 1, balanceGold: 5, businessId: 'someone_else' });
      const stored = await Customer.findById(created._id).lean();
      assert.equal(stored.balanceTry, 0);
      assert.equal(stored.balanceTryMinor, 0);
      assert.equal(stored.balanceGold, 0);
      assert.equal(stored.businessId, t.businessId);
      assert.equal((await t.admin.put(`/api/customers/${created._id}`, { balanceTry: 5000 })).status, 400);
    });

    it('reconciliation detects tampering with any projection', async () => {
      const t = await tenant();
      const p = await product(t.admin, { name: 'Kontrol', price: '100.00', costPrice: '10.00', stock: 3 });
      const c = await customer(t.admin);
      assert.equal((await t.staff.post('/api/sales', { customerId: c._id, lines: [{ productId: p._id, quantity: 1 }], payments: [] })).status, 201);
      await assertReconciled(t.admin, 'clean');
      await AccountBalance.updateOne({ _id: AccountBalance.idFor(t.businessId, `ar:${c._id}`, 'TRY') }, { $inc: { debit: 1 } });
      await Customer.updateOne({ _id: c._id }, { $inc: { balanceTryMinor: 5 } });
      await Product.updateOne({ _id: p._id }, { $inc: { stock: 1 } });
      const res = (await t.admin.get('/api/ledger/reconciliation')).body;
      assert.equal(res.ok, false);
      const checks = [...res.ledger.discrepancies, ...res.inventory.discrepancies].map((d) => d.check);
      assert.ok(checks.includes('account_projection'));
      assert.ok(checks.includes('customer_balance'));
      assert.ok(checks.includes('product_quantity'));
      assert.equal((await t.staff.get('/api/ledger/reconciliation')).status, 403);
    });
  });

  // ===================================================================
  describe('Multi-tenant and branch isolation', () => {
    it('another business can neither read nor modify any financial record', async () => {
      const a = await tenant();
      const b = await tenant();
      const pa = await product(a.admin, { name: 'A ürünü', price: '100.00', costPrice: '50.00', stock: 5 });
      const ca = await customer(a.admin);
      const sa = await supplier(a.admin);
      const cat = await mustCreate(await a.admin.post('/api/categories', { name: 'A kategori' }), 'category');
      const sale = await mustCreate(await a.staff.post('/api/sales', { customerId: ca._id, lines: [{ productId: pa._id, quantity: 1 }], payments: [] }), 'sale');
      const pur = await mustCreate(await a.admin.post('/api/purchases', { supplierId: sa._id, lines: [{ productId: pa._id, quantity: 1, unitCost: '50.00' }] }), 'purchase');
      assert.equal((await a.staff.post('/api/cash/transactions', { type: 'devir', amountTry: '100.00' })).status, 201);
      const cb = await customer(b.admin);

      for (const path of [`/api/products/${pa._id}`, `/api/customers/${ca._id}`, `/api/categories/${cat._id}`, `/api/sales/${sale._id}`, `/api/suppliers/${sa._id}`,
        `/api/purchases/${pur._id}`, `/api/cash/customer/${ca._id}/ledger`, `/api/suppliers/${sa._id}/statement`, `/api/products/${pa._id}/movements`]) {
        assert.equal((await b.admin.get(path)).status, 404, `GET ${path}`);
      }
      assert.equal((await b.admin.put(`/api/products/${pa._id}`, { name: 'hijack', stock: 0 })).status, 404);
      assert.equal((await b.admin.put(`/api/customers/${ca._id}`, { name: 'hijack' })).status, 404);
      assert.equal((await b.admin.del(`/api/products/${pa._id}`)).status, 404);
      assert.equal((await b.admin.del(`/api/sales/${sale._id}`)).status, 404);
      assert.equal((await b.admin.post(`/api/sales/${sale._id}/payments`, { method: 'nakit', amount: '1.00' })).status, 404);
      assert.equal((await b.admin.post(`/api/sales/${sale._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }] })).status, 404);
      assert.equal((await b.admin.del(`/api/purchases/${pur._id}`)).status, 404);
      assert.equal((await b.admin.post('/api/sales', { customerId: ca._id, lines: [{ productId: pa._id, quantity: 1 }] })).status, 404, 'foreign customer');
      assert.equal((await b.admin.post('/api/sales', { customerId: cb._id, lines: [{ productId: pa._id, quantity: 1 }] })).status, 404, 'foreign product');
      assert.equal((await b.admin.post('/api/cash/transactions', { type: 'tahsilat', customerId: ca._id, amountTry: '1.00' })).status, 404);
      assert.equal((await b.admin.post('/api/purchases', { supplierId: sa._id, lines: [{ productId: pa._id, quantity: 1, unitCost: '1.00' }] })).status, 404);

      for (const path of ['/api/products', '/api/customers', '/api/categories', '/api/sales', '/api/suppliers', '/api/purchases', '/api/cash/transactions', '/api/inventory/movements', '/api/ledger/accounts', '/api/ledger/entries', '/api/reports/daily']) {
        const res = await b.admin.get(path);
        assert.equal(res.status, 200, path);
        const leaked = JSON.stringify(res.body).includes(String(pa._id)) || JSON.stringify(res.body).includes(String(ca._id));
        assert.equal(leaked, false, `${path} leaks business A data`);
      }
      const dash = (await b.admin.get('/api/dashboard/summary')).body;
      assert.equal(dash.totalRevenue, 0);
      assert.equal((await b.admin.get('/api/cash/daily-summary')).body.calculatedCash, 0);
      // Business A is untouched.
      assert.equal(await stockOf(pa._id), 5, '5 − 1 sold + 1 purchased');
      assert.equal((await Product.findById(pa._id).lean()).name, 'A ürünü');
      await assertReconciled(a.admin, 'tenant A');
      await assertReconciled(b.admin, 'tenant B');
    });

    it('non-admin staff only see and change their own branch', async () => {
      const t = await tenant({ branch: 'Şube Bir' });
      const otherStaff = signToken(await createUser({ role: 'staff', businessId: t.businessId, branch: 'Şube İki' }), 900);
      const p = await product(t.admin, { name: 'Şube ürünü', price: '100.00', stock: 3, branch: 'Şube Bir' });
      const c = await customer(t.admin);
      const sale = await mustCreate(await t.staff.post('/api/sales', { customerId: c._id, lines: [{ productId: p._id, quantity: 1 }], payments: [] }), 'sale');
      assert.equal((await request('GET', `/api/sales/${sale._id}`, { token: otherStaff })).status, 404);
      const list = (await request('GET', '/api/sales', { token: otherStaff })).body;
      assert.equal(list.some((s) => s._id === sale._id), false);
      const sellOther = await request('POST', '/api/sales', { token: otherStaff, body: { customerId: c._id, lines: [{ productId: p._id, quantity: 1 }] } });
      assert.equal(sellOther.status, 403, 'branch-bound stock cannot be sold from another branch');
      assert.equal(sellOther.body.code, 'BRANCH_MISMATCH');
      assert.equal((await t.admin.get(`/api/sales/${sale._id}`)).status, 200, 'admins see every branch');
    });
  });

  // ===================================================================
  describe('Migration of legacy data', () => {
    it('attributes legacy documents to the default business and opens matching ledger/stock records — idempotently', async () => {
      const productId = 700000 + crypto.randomInt(99999);
      const customerId = 70000000 + crypto.randomInt(9999999);
      // A legacy product recorded in a NON-default branch: its opening stock
      // must be booked to that branch, never to the default one.
      const legacyBranch = `Eski Şube ${crypto.randomInt(99999)}`;
      await Product.collection.insertOne({ _id: productId, name: 'Eski ürün', price: 200, costPrice: 100.5, stock: 3, isArchived: false, branch: legacyBranch });
      await Customer.collection.insertOne({ _id: customerId, name: 'Eski müşteri', balanceTry: -250.5, balanceGold: 1.25, isArchived: false });
      const silent = { log() {} };

      await migrateFinancialData({ logger: silent });
      const p = await Product.findById(productId).lean();
      assert.equal(p.businessId, DEFAULT_BUSINESS_ID);
      assert.equal(p.costPoolMinor, 30150, '3 × 100.50');
      const movements = await StockMovement.find({ productId }).lean();
      assert.equal(movements.length, 1);
      assert.equal(movements[0].movementType, 'opening_migration');
      assert.equal(movements[0].branch, legacyBranch, 'opening movement in the product\'s own branch');
      const opening = await LedgerEntry.findOne({ externalKey: `inventory-opening:${productId}` }).lean();
      assert.deepEqual(opening.lines.map((l) => [l.account, l.debit, l.credit]).sort(), [['equity:opening', 0, 30150], [`inventory:${legacyBranch}`, 30150, 0]]);
      assert.equal(await LedgerEntry.countDocuments({ externalKey: `inventory-opening:${productId}`, 'lines.account': `inventory:${DEFAULT_BRANCH}` }), 0, 'nothing booked to the default branch');
      const c = await Customer.findById(customerId).lean();
      assert.equal(c.balanceTryMinor, -25050);
      assert.equal(c.balanceGoldMg, 1250);
      const entries = await LedgerEntry.find({ 'lines.account': `ar:${customerId}` }).lean();
      assert.equal(entries.length, 1);
      const ar = entries[0].lines.filter((l) => l.account === `ar:${customerId}`);
      assert.deepEqual(ar.map((l) => [l.unit, l.debit, l.credit]).sort(), [['TRY', 25050, 0], ['XAU', 0, 1250]]);

      await migrateFinancialData({ logger: silent });
      assert.equal(await StockMovement.countDocuments({ productId }), 1, 'no duplicate opening movement');
      assert.equal(await LedgerEntry.countDocuments({ 'lines.account': `ar:${customerId}` }), 1, 'no duplicate opening entry');
      assert.equal((await Customer.findById(customerId).lean()).balanceTryMinor, -25050);
    });
  });
});
