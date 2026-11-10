/**
 * Business profile, KDV, MASAK identification and KVKK — real MongoDB, HTTP.
 *
 * Hand-computed figures (HAS = 6 562.53 TL/g):
 *   22 ayar bilezik, 10.000 g, milyem işçilik 35
 *     unit price  = 10 × (0.916 + 0.035) × 6562.53 = 62 409.66
 *     gold value  = 10 × 0.916 × 6562.53 = 60 112.7748 → 60 112.77
 *     margin      = 62 409.66 − 60 112.77 = 2 296.89
 *     KDV (20 %)  = 2 296.89 × 20/120 = 382.815 → 382.82 (HALF_UP)
 *   Gümüş kolye 1 500.00 (full class): KDV = 1500 × 20/120 = 250.00
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'business-compliance-secret-with-more-than-32-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const { hashPassword } = require('../utils/passwords');
const {
  createHarness, mustOk, expectError, accountBalances, assertReconciled, uid,
} = require('../testSupport/financeHarness');

const HAS = '6562.53';
const A = 'Merkez';

describe('business profile, KDV, MASAK and KVKK (real MongoDB, HTTP)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  const harness = createHarness({ app, signToken, User, hashPassword });

  before(async () => {
    await mongoose.connect(uri);
    await harness.start();
  });
  after(async () => {
    await harness.stop();
    await mongoose.disconnect();
  });

  it('profile: defaults, admin-only, validated and guarded', async () => {
    const t = await harness.tenant({ branches: [A] });
    const initial = await mustOk(await t.branch[A].staff.get('/api/business-profile'), 'get');
    assert.equal(initial.configured, false);
    assert.equal(initial.vat.enabled, false, 'VAT is off by default');
    assert.equal(initial.vat.standardRateBp, 2000);

    expectError(await t.branch[A].staff.put('/api/business-profile', { companyName: 'X' }), 403);
    expectError(await t.admin.put('/api/business-profile', { taxNumber: '123' }), 400, 'VALIDATION_FAILED');
    expectError(await t.admin.put('/api/business-profile', { unknownField: 1 }), 400, 'VALIDATION_FAILED');
    expectError(await t.admin.put('/api/business-profile', { vat: { enabled: true } }), 422, 'VAT_APPROVAL_REQUIRED');

    const saved = await mustOk(await t.admin.put('/api/business-profile', {
      companyName: 'Test Kuyumculuk Ltd.', taxOffice: 'Fatih', taxNumber: '1234567890', email: 'info@test.example',
    }), 'save');
    assert.equal(saved.configured, true);
    assert.equal(saved.companyName, 'Test Kuyumculuk Ltd.');
    // Other businesses are unaffected.
    const other = await harness.tenant({ branches: [A] });
    assert.equal((await mustOk(await other.admin.get('/api/business-profile'), 'other')).companyName, '');
  });

  it('KDV: gold jewellery taxed on the margin, other goods on the full price; ledger split and return reversal', async () => {
    const t = await harness.tenant({ branches: [A] });
    await mustOk(await t.admin.put('/api/business-profile', { vat: { enabled: true, approvedBy: 'SMMM Test Müşavir' } }), 'enable vat');

    const bilezik = await mustOk(await t.admin.post('/api/products', {
      name: `Bilezik ${uid()}`, pricingMode: 'gram', metal: 'XAU', karat: 22, weight: '10.000',
      laborType: 'milyem', laborValue: '35', costPrice: '55000.00', stock: 2, branch: A,
    }), 'bilezik');
    const kolye = await mustOk(await t.admin.post('/api/products', { name: `Gümüş Kolye ${uid()}`, price: '1500.00', costPrice: '900.00', stock: 2, branch: A }), 'kolye');
    const customer = await mustOk(await t.admin.post('/api/customers', { name: `Müşteri ${uid()}` }), 'customer');

    const sale = await mustOk(await t.branch[A].staff.post('/api/sales', {
      customerId: customer._id,
      lines: [{ productId: bilezik._id, quantity: 1 }, { productId: kolye._id, quantity: 1 }],
      manualPrices: { XAU: HAS },
    }), 'sale');

    const [gold, silver] = sale.lines;
    assert.equal(gold.total, 62409.66);
    assert.equal(gold.vat.vatClass, 'gold_margin');
    assert.equal(gold.vat.taxableGross, 2296.89);
    assert.equal(gold.vat.vat, 382.82);
    assert.equal(silver.vat.vatClass, 'full');
    assert.equal(silver.vat.vat, 250);
    assert.equal(sale.financial.vat, 632.82);

    let balance = await accountBalances(t.admin);
    assert.equal(balance('tax:vat_payable'), -632.82, 'KDV is a liability (credit)');
    assert.equal(balance('revenue:sales'), -63276.84, 'revenue is net of KDV: 62 409.66 + 1 500.00 − 632.82');
    await assertReconciled(t.admin, 'after VAT sale');

    await mustOk(await t.admin.post(`/api/sales/${sale._id}/returns`, { lines: [{ lineId: silver.lineId, quantity: 1 }], refundMethod: 'cari' }), 'return');
    balance = await accountBalances(t.admin);
    assert.equal(balance('tax:vat_payable'), -382.82, 'returned goods give back their KDV');
    await assertReconciled(t.admin, 'after VAT return');
  });

  it('VAT disabled: books and sales stay exactly as before', async () => {
    const t = await harness.tenant({ branches: [A] });
    const kolye = await mustOk(await t.admin.post('/api/products', { name: `Kolye ${uid()}`, price: '1500.00', stock: 1, branch: A }), 'kolye');
    const customer = await mustOk(await t.admin.post('/api/customers', { name: `Müşteri ${uid()}` }), 'customer');
    const sale = await mustOk(await t.branch[A].staff.post('/api/sales', { customerId: customer._id, lines: [{ productId: kolye._id, quantity: 1 }] }), 'sale');
    assert.equal(sale.financial.vat, null);
    assert.equal(sale.lines[0].vat, undefined);
    const balance = await accountBalances(t.admin);
    assert.equal(balance('tax:vat_payable'), 0);
    assert.equal(balance('revenue:sales'), -1500);
  });

  it('MASAK: at the threshold an identified customer is required; identity is masked in lists', async () => {
    const t = await harness.tenant({ branches: [A] });
    await mustOk(await t.admin.put('/api/business-profile', { compliance: { identificationThreshold: '1000.00' } }), 'threshold');
    const kolye = await mustOk(await t.admin.post('/api/products', { name: `Kolye ${uid()}`, price: '1500.00', stock: 3, branch: A }), 'kolye');
    const yuzuk = await mustOk(await t.admin.post('/api/products', { name: `Yüzük ${uid()}`, price: '500.00', stock: 3, branch: A }), 'yuzuk');
    const customer = await mustOk(await t.admin.post('/api/customers', { name: `Müşteri ${uid()}` }), 'customer');

    // Below the threshold: no identification needed.
    await mustOk(await t.branch[A].staff.post('/api/sales', { customerId: customer._id, lines: [{ productId: yuzuk._id, quantity: 1 }] }), 'small sale');
    // At/above: refused without identity.
    expectError(await t.branch[A].staff.post('/api/sales', { customerId: customer._id, lines: [{ productId: kolye._id, quantity: 1 }] }), 422, 'CUSTOMER_IDENTIFICATION_REQUIRED');

    expectError(await t.admin.put(`/api/customers/${customer._id}`, { identityType: 'tckn', identityNumber: '12345678901' }), 400, 'INVALID_IDENTITY_NUMBER');
    expectError(await t.admin.put(`/api/customers/${customer._id}`, { identityNumber: 'AB12345' }), 400, 'IDENTITY_TYPE_REQUIRED');
    await mustOk(await t.admin.put(`/api/customers/${customer._id}`, { identityType: 'tckn', identityNumber: '10000000146' }), 'identify');
    const sale = await mustOk(await t.branch[A].staff.post('/api/sales', { customerId: customer._id, lines: [{ productId: kolye._id, quantity: 1 }] }), 'big sale');
    assert.equal(sale.financial.identified, true);

    const list = await mustOk(await t.branch[A].staff.get('/api/customers'), 'list');
    const listed = list.find((c) => c._id === customer._id);
    assert.equal(listed.identityNumber, '10*******46');
  });

  it('KVKK: anonymisation removes personal data, keeps the record, and is refused with an open balance', async () => {
    const t = await harness.tenant({ branches: [A] });
    const customer = await mustOk(await t.admin.post('/api/customers', {
      name: 'Ayşe Yılmaz', phone: '05321112233', email: 'ayse@example.com', identityType: 'tckn', identityNumber: '10000000146', kvkkNoticeVersion: 'v1',
    }), 'customer');
    assert.ok(customer.kvkkNoticeAt, 'KVKK notice time is recorded by the server');
    expectError(await t.branch[A].staff.post(`/api/customers/${customer._id}/anonymize`, {}), 403);
    const res = await mustOk(await t.admin.post(`/api/customers/${customer._id}/anonymize`, {}), 'anonymize');
    assert.equal(res.data.name, `Anonim Müşteri #${customer._id}`);
    assert.equal(res.data.phone, null);
    assert.equal(res.data.identityNumber, null);
    // An anonymised customer is archived: it behaves like a missing record.
    expectError(await t.admin.post(`/api/customers/${customer._id}/anonymize`, {}), 404);

    const debtor = await mustOk(await t.admin.post('/api/customers', { name: `Borçlu ${uid()}` }), 'debtor');
    const ring = await mustOk(await t.admin.post('/api/products', { name: `Yüzük ${uid()}`, price: '500.00', stock: 1, branch: A }), 'ring');
    await mustOk(await t.branch[A].staff.post('/api/sales', { customerId: debtor._id, lines: [{ productId: ring._id, quantity: 1 }], payments: [] }), 'credit sale');
    expectError(await t.admin.post(`/api/customers/${debtor._id}/anonymize`, {}), 409, 'OPEN_BALANCE');
  });
});
