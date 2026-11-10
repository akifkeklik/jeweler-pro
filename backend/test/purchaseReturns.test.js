/**
 * Purchase returns (iade alışı), supplier price adjustments and supplier
 * refunds — real MongoDB replica set, real HTTP. Figures hand-computed.
 */
const { inspect } = require('../testSupport/tenantInspection');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'purchase-return-secret-with-more-than-thirty-two-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const Product = inspect(require('../models/Product'));
const Purchase = inspect(require('../models/Purchase'));
const StockMovement = inspect(require('../models/StockMovement'));
const MetalStock = inspect(require('../models/MetalStock'));
const { signToken } = require('../middleware/auth');
const { hashPassword } = require('../utils/passwords');
const {
  createHarness, mustOk, expectError, accountBalances, assertReconciled, uid,
} = require('../testSupport/financeHarness');

const A = 'Merkez';
const harness = createHarness({ app, signToken, User, hashPassword });

describe('Purchase returns (real MongoDB, HTTP)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  before(async () => {
    await mongoose.connect(uri);
    await Promise.all([User, Product, Purchase, StockMovement, MetalStock].map((M) => M.init()));
    await harness.start();
  });
  after(async () => {
    await harness.stop();
    await mongoose.disconnect();
  });

  async function setup() {
    const t = await harness.tenant({ branches: [A, 'Şube 2'] });
    const m = t.branch[A].manager;
    const supplier = await mustOk(await m.post('/api/suppliers', { name: `Tedarikçi ${uid()}` }), 'supplier');
    return { t, m, supplier };
  }

  it('partially consumed stock: return at original value, weighted-average removal, variance, price adjustment alternative, refund', async () => {
    const { t, m, supplier } = await setup();
    const p = await mustOk(await m.post('/api/products', { name: `Künye ${uid()}`, price: '200.00', costPrice: '100.00', stock: 0, branch: A }), 'product');
    // P1: 10 × 100.00 = 1000.00, paid in cash; P2: 10 × 130.00 = 1300.00, unpaid
    const p1 = await mustOk(await m.post('/api/purchases', {
      supplierId: supplier._id, lines: [{ productId: p._id, quantity: 10, unitCost: '100.00' }], payments: [{ method: 'nakit', amount: '1000.00' }],
    }), 'p1');
    await mustOk(await m.post('/api/purchases', { supplierId: supplier._id, lines: [{ productId: p._id, quantity: 10, unitCost: '130.00' }] }), 'p2');
    // pool 2300.00 / 20 units; sell 15 → COGS 2300 × 15/20 = 1725.00, pool 575.00 for 5 units
    const c = await mustOk(await t.branch[A].staff.post('/api/customers', { name: `M ${uid()}` }), 'customer');
    await mustOk(await t.branch[A].staff.post('/api/sales', { customerId: c._id, lines: [{ productId: p._id, quantity: 15 }], payments: [] }), 'sale');
    assert.equal((await Product.findById(p._id).lean()).costPoolMinor, 57500);

    expectError(await m.post(`/api/purchases/${p1._id}/returns`, { lines: [{ lineId: 1, quantity: 3 }] }), 400, 'REASON_REQUIRED');
    // Return 3 of P1: supplier credit 3 × 100 = 300.00; inventory out 575 × 3/5 = 345.00; variance −45.00
    const r1 = await mustOk(await m.post(`/api/purchases/${p1._id}/returns`, { lines: [{ lineId: 1, quantity: 3 }], reason: 'Kusurlu', creditNoteNo: 'IA-1' }, { 'Idempotency-Key': `ret-${uid()}` }), 'return 3');
    assert.equal(r1.returned, 300);
    assert.equal(r1.returns[0].amount, 300);
    assert.equal(r1.returns[0].cost, 345);
    assert.equal(r1.returns[0].variance, -45);
    assert.equal(r1.lines[0].returnedQuantity, 3);
    assert.equal(r1.returnStatus, 'partial');
    assert.equal(r1.supplierCredit, 300, 'paid 1000, net 700');
    assert.equal(r1.paymentStatus, 'overpaid');
    const after1 = await Product.findById(p._id).lean();
    assert.equal(after1.stock, 2);
    assert.equal(after1.costPoolMinor, 23000, '575 − 345 = 230.00 → average of the remaining units unchanged (115.00)');

    // 7 more of P1 are returnable on paper, but only 2 are physically here.
    const short = expectError(await m.post(`/api/purchases/${p1._id}/returns`, { lines: [{ lineId: 1, quantity: 3 }], reason: 'x' }), 409, 'INSUFFICIENT_STOCK_FOR_RETURN');
    assert.equal(short.details.available, 2);
    assert.equal(short.details.alternative, 'price_adjustment');
    expectError(await m.post(`/api/purchases/${p1._id}/returns`, { lines: [{ lineId: 1, quantity: 8 }], reason: 'x' }), 409, 'RETURN_EXCEEDS_PURCHASED');

    // Alternative for consumed goods: supplier price adjustment (credit note) 50.00
    const adj = await mustOk(await m.post(`/api/purchases/${p1._id}/returns`, { kind: 'price_adjustment', lines: [{ lineId: 1, amount: '50.00' }], reason: 'Fiyat farkı faturası' }), 'adjustment');
    assert.equal(adj.returned, 350);
    assert.equal(adj.lines[0].adjustedAmount, 50);
    assert.equal(adj.lines[0].remainingValue, 650);
    assert.equal(await StockMovement.countDocuments({ businessId: t.businessId, movementType: 'purchase_return' }), 1, 'adjustments do not move stock');
    expectError(await m.post(`/api/purchases/${p1._id}/returns`, { kind: 'price_adjustment', lines: [{ lineId: 1, amount: '650.01' }], reason: 'x' }), 409, 'ADJUSTMENT_EXCEEDS_LINE');

    // Supplier credit 350; refund more is refused, 200.00 cash accepted.
    expectError(await m.post(`/api/purchases/${p1._id}/refunds`, { method: 'nakit', amount: '350.01' }), 400, 'REFUND_EXCEEDS_CREDIT');
    const refunded = await mustOk(await m.post(`/api/purchases/${p1._id}/refunds`, { method: 'nakit', amount: '200.00' }), 'refund');
    assert.equal(refunded.refunded, 200);
    assert.equal(refunded.supplierCredit, 150);

    expectError(await m.del(`/api/purchases/${p1._id}`), 409, 'PURCHASE_HAS_RETURNS');

    // AP: −1000 −1300 +1000 (payment) +300 +50 (credits) −200 (refund) = −1150 → we owe 1150.00
    const bal = await accountBalances(t.admin);
    assert.equal(bal(`ap:${supplier._id}`), -1150);
    assert.equal((await mustOk(await m.get(`/api/suppliers/${supplier._id}`), 'supplier')).balanceTry, 1150);
    assert.equal(bal('purchase_return_variance'), 45);
    assert.equal(bal('purchase_price_adjustment'), -50);
    // cash: −1000 paid + 200 refunded
    assert.equal(bal(`cash:${A}`), -800);
    // inventory: 2300 − 1725 − 345 = 230
    assert.equal(bal(`inventory:${A}`), 230);
    await assertReconciled(t.admin, 'after partial return / adjustment / refund');
  });

  it('full return of an unconsumed purchase credits the line exactly; nothing remains to return', async () => {
    const { t, m, supplier } = await setup();
    const p = await mustOk(await m.post('/api/products', { name: `Yüzük ${uid()}`, price: '400.00', costPrice: '250.00', stock: 0, branch: A }), 'product');
    // 3 × 333.33 = 999.99
    const pur = await mustOk(await m.post('/api/purchases', { supplierId: supplier._id, lines: [{ productId: p._id, quantity: 3, unitCost: '333.33' }] }), 'purchase');
    const r1 = await mustOk(await m.post(`/api/purchases/${pur._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], reason: 'iade' }), 'return 1');
    assert.equal(r1.returns[0].amount, 333.33);
    const r2 = await mustOk(await m.post(`/api/purchases/${pur._id}/returns`, { lines: [{ lineId: 1 }], reason: 'kalan iade' }), 'return rest');
    assert.equal(r2.returned, 999.99, 'cumulative credit equals the line total exactly');
    assert.equal(r2.returnStatus, 'full');
    assert.equal(r2.remaining, 0);
    assert.equal(r2.returns[1].variance, 0, 'single cost layer: no variance');
    expectError(await m.post(`/api/purchases/${pur._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], reason: 'tekrar' }), 409, 'RETURN_EXCEEDS_PURCHASED');
    const prod = await Product.findById(p._id).lean();
    assert.equal(prod.stock, 0);
    assert.equal(prod.costPoolMinor, 0);
    assert.equal((await mustOk(await m.get(`/api/suppliers/${supplier._id}`), 'supplier')).balanceTry, 0);
    await assertReconciled(t.admin, 'after full return');
  });

  it('metal purchase return keeps purity and fine-gold content exact', async () => {
    const { t, m, supplier } = await setup();
    // 100.000 g 22 ayar (fine 91.600 g) for 500000.00
    const pur = await mustOk(await m.post('/api/purchases', { supplierId: supplier._id, lines: [{ metal: 'XAU', karat: 22, weightGrams: '100.000', totalCost: '500000.00' }] }), 'metal purchase');
    // return 30.000 g → fine 91.600 × 30/100 = 27.480 g; credit 150000.00; cost by fine 500000 × 27.48/91.6 = 150000.00
    const r = await mustOk(await m.post(`/api/purchases/${pur._id}/returns`, { lines: [{ lineId: 1, weightGrams: '30.000' }], reason: 'Ayar düşük' }), 'metal return');
    assert.equal(r.returns[0].lines[0].fineGrams, 27.48);
    assert.equal(r.returns[0].amount, 150000);
    assert.equal(r.returns[0].cost, 150000);
    const pool = await MetalStock.findById(MetalStock.idFor(t.businessId, A, 'XAU', 9160)).lean();
    assert.equal(pool.weightMg, 70000);
    assert.equal(pool.fineMg, 64120);
    assert.equal(pool.costPoolMinor, 35000000);
    expectError(await m.post(`/api/purchases/${pur._id}/returns`, { lines: [{ lineId: 1, weightGrams: '70.001' }], reason: 'x' }), 409, 'RETURN_EXCEEDS_PURCHASED');
    expectError(await m.post(`/api/purchases/${pur._id}/returns`, { lines: [{ lineId: 1, quantity: 2 }], reason: 'x' }), 400, 'INVALID_QUANTITY');
    await assertReconciled(t.admin, 'after metal return');
  });

  it('double returns: idempotent replays apply once; competing returns of the last units cannot both succeed', async () => {
    const { t, m, supplier } = await setup();
    const p = await mustOk(await m.post('/api/products', { name: `Bileklik ${uid()}`, price: '50.00', costPrice: '20.00', stock: 0, branch: A }), 'product');
    const pur = await mustOk(await m.post('/api/purchases', { supplierId: supplier._id, lines: [{ productId: p._id, quantity: 4, unitCost: '20.00' }] }), 'purchase');

    const key = `ret-${uid()}`;
    const replays = await Promise.all([1, 2, 3].map(() => m.post(`/api/purchases/${pur._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], reason: 'çift tık' }, { 'Idempotency-Key': key })));
    assert.ok(replays.every((r) => r.status === 200), JSON.stringify(replays.map((r) => [r.status, r.body?.code])));
    assert.equal((await Purchase.findById(pur._id).lean()).returns.length, 1, 'exactly one return recorded');

    // 3 left: two parallel returns of 2 units each → one wins.
    const race = await Promise.all([1, 2].map(() => m.post(`/api/purchases/${pur._id}/returns`, { lines: [{ lineId: 1, quantity: 2 }], reason: 'yarış' })));
    assert.equal(race.filter((r) => r.status === 200).length, 1, JSON.stringify(race.map((r) => [r.status, r.body?.code])));
    assert.equal(race.find((r) => r.status !== 200).body.code, 'RETURN_EXCEEDS_PURCHASED');
    assert.equal((await Product.findById(p._id).lean()).stock, 1);
    await assertReconciled(t.admin, 'after duplicate / racing returns');
  });

  it('reserved stock cannot be returned; isolation across businesses and branches', async () => {
    const { t, m, supplier } = await setup();
    const other = await harness.tenant({ branches: [A] });
    const p = await mustOk(await m.post('/api/products', { name: `Kolye ${uid()}`, price: '50.00', costPrice: '20.00', stock: 0, branch: A }), 'product');
    const pur = await mustOk(await m.post('/api/purchases', { supplierId: supplier._id, lines: [{ productId: p._id, quantity: 2, unitCost: '20.00' }] }), 'purchase');
    const tr = await mustOk(await m.post('/api/transfers', { destinationBranch: 'Şube 2', lines: [{ productId: p._id, quantity: 2 }] }), 'transfer');
    await mustOk(await t.branch[A].manager2.post(`/api/transfers/${tr._id}/approve`, {}), 'approve');
    expectError(await m.post(`/api/purchases/${pur._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], reason: 'x' }), 409, 'INSUFFICIENT_STOCK_FOR_RETURN', 'reserved for transfer');

    expectError(await other.admin.post(`/api/purchases/${pur._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], reason: 'x' }), 404, 'PURCHASE_NOT_FOUND', 'foreign business');
    expectError(await t.branch['Şube 2'].manager.post(`/api/purchases/${pur._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], reason: 'x' }), 404, 'PURCHASE_NOT_FOUND', 'other branch');
    expectError(await t.branch[A].staff.post(`/api/purchases/${pur._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], reason: 'x' }), 403, 'FORBIDDEN', 'staff');
    await assertReconciled(t.admin, 'isolation');
  });
});
