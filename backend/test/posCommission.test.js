/**
 * POS / card commission accounting — unit (domain) and integration (real
 * MongoDB, HTTP) tests. Figures hand-computed in comments.
 */
const { inspect } = require('../testSupport/tenantInspection');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'pos-commission-secret-with-more-than-thirty-two-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';

const {
  parseRatePercent, formatRatePpm, computeCommission, refundCommissionShare,
} = require('../domain/commission');

describe('Commission domain (pure)', () => {
  it('parses percentages exactly and rounds once, HALF_UP', () => {
    assert.equal(parseRatePercent('1.79'), 17900n);
    assert.equal(parseRatePercent('1.875'), 18750n);
    assert.equal(formatRatePpm(18750n), '1.8750');
    assert.throws(() => parseRatePercent('1.23456'));
    assert.throws(() => parseRatePercent('-1'));
    assert.throws(() => parseRatePercent('100'));
    // 1000.00 × 1.79 % = 17.90 + 0.25 fee
    assert.deepEqual(computeCommission(100000n, { ratePpm: 17900n, fixedFeeMinor: 25n }), { commissionMinor: 1815n, netMinor: 98185n });
    // 0.33 × 1.5 % = 0.00495 → 0.00 ; 0.34 × 1.5 % = 0.0051 → 0.01
    assert.equal(computeCommission(33n, { ratePpm: 15000n }).commissionMinor, 0n);
    assert.equal(computeCommission(34n, { ratePpm: 15000n }).commissionMinor, 1n);
    // 333.33 × 1.875 % = 624.99375 kuruş → 625 (6.25)
    assert.equal(computeCommission(33333n, { ratePpm: 18750n }).commissionMinor, 625n);
    assert.throws(() => computeCommission(10n, { ratePpm: 0n, fixedFeeMinor: 11n }), /aşıyor/);
  });

  it('partial refunds reverse the commission cumulatively and exactly', () => {
    // commission 18.15 on 1000.00; refund 333.33 three times + 0.01
    const k = 1815n;
    const g = 100000n;
    const a = refundCommissionShare(k, g, 0n, 33333n);
    const b = refundCommissionShare(k, g, 33333n, 33333n);
    const c = refundCommissionShare(k, g, 66666n, 33334n);
    assert.equal(a + b + c, k, 'full refund reverses exactly the original commission');
    assert.throws(() => refundCommissionShare(k, g, 66666n, 33335n), /aşıyor/);
  });
});

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const PosProvider = inspect(require('../models/PosProvider'));
const PosTransaction = inspect(require('../models/PosTransaction'));
const PosSettlement = inspect(require('../models/PosSettlement'));
const { signToken } = require('../middleware/auth');
const { hashPassword } = require('../utils/passwords');
const {
  createHarness, mustOk, expectError, accountBalances, assertReconciled, uid,
} = require('../testSupport/financeHarness');

const A = 'Merkez';
const harness = createHarness({ app, signToken, User, hashPassword });

describe('POS commission accounting (real MongoDB, HTTP)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  before(async () => {
    await mongoose.connect(uri);
    await Promise.all([User, PosProvider, PosTransaction, PosSettlement].map((M) => M.init()));
    await harness.start();
  });
  after(async () => {
    await harness.stop();
    await mongoose.disconnect();
  });

  async function setup() {
    const t = await harness.tenant({ branches: [A] });
    const staff = t.branch[A].staff;
    const manager = t.branch[A].manager;
    const garanti = await mustOk(await t.admin.post('/api/pos/providers', {
      code: 'GARANTI', name: 'Garanti POS', refundCommissionPolicy: 'retained',
      rules: [{ installments: 1, ratePercent: '1.79', fixedFee: '0.25', valorDays: 1 }, { installments: 3, ratePercent: '3.50', fixedFee: '0', valorDays: 30 }],
    }), 'provider');
    const akbank = await mustOk(await t.admin.post('/api/pos/providers', {
      code: 'AKBANK', name: 'Akbank POS', refundCommissionPolicy: 'reversed', rules: [{ installments: 1, ratePercent: '2.00', valorDays: 0 }],
    }), 'provider 2');
    const product = await mustOk(await t.admin.post('/api/products', { name: `Ürün ${uid()}`, price: '1000.00', costPrice: '400.00', stock: 50, branch: A }), 'product');
    const customer = await mustOk(await staff.post('/api/customers', { name: `M ${uid()}` }), 'customer');
    const cardSale = (amountQty, pos, extra = {}) => staff.post('/api/sales', {
      customerId: customer._id, lines: [{ productId: product._id, quantity: amountQty }], payments: [{ method: 'kredi kartı', amount: `${amountQty * 1000}.00`, pos }], ...extra,
    });
    return { t, staff, manager, garanti, akbank, product, customer, cardSale };
  }

  it('without any POS provider: legacy behaviour (gross receivable) with an unconfigured sub-ledger item; difference resolved at settlement', async () => {
    const t = await harness.tenant({ branches: [A] });
    const p = await mustOk(await t.admin.post('/api/products', { name: `Ürün ${uid()}`, price: '1000.00', costPrice: '400.00', stock: 2, branch: A }), 'product');
    const c = await mustOk(await t.branch[A].staff.post('/api/customers', { name: `M ${uid()}` }), 'customer');
    await mustOk(await t.branch[A].staff.post('/api/sales', { customerId: c._id, productId: p._id, quantity: 1, paymentMethod: 'kredi kartı' }), 'legacy card sale');
    const [txn] = await mustOk(await t.admin.get('/api/pos/transactions'), 'txns');
    assert.equal(txn.commissionConfigured, false);
    assert.equal(txn.net, 1000);
    let bal = await accountBalances(t.admin);
    assert.equal(bal(`bank:${A}:card`), 1000);
    // The bank actually paid 975.00: the 25.00 commission is recognised at settlement.
    await mustOk(await t.branch[A].manager.post('/api/pos/settlements', {
      depositedAmount: '975.00', allocations: [{ posTransactionId: txn._id }], differenceResolution: 'commission',
    }), 'settle unconfigured');
    bal = await accountBalances(t.admin);
    assert.equal(bal(`bank:${A}:card`), 0);
    assert.equal(bal('expense:pos_commission'), 25);
    await assertReconciled(t.admin, 'unconfigured POS');
  });

  it('capture snapshots the rule, books commission, keeps history when rates change', async () => {
    const { t, garanti, cardSale } = await setup();
    // 1000.00 at 1.79 % + 0.25 → commission 18.15, net 981.85
    const sale = await mustOk(await cardSale(1, { providerId: garanti._id, installments: 1, authCode: 'A1B2C3' }), 'card sale');
    const [txn] = (await mustOk(await t.admin.get('/api/pos/transactions'), 'list'));
    assert.equal(txn.gross, 1000);
    assert.equal(txn.commission, 18.15);
    assert.equal(txn.net, 981.85);
    assert.equal(txn.status, 'open', 'a successful POS capture is NOT a settlement');
    assert.equal(txn.ratePercent, '1.7900');
    assert.equal(txn.reference.id, String(sale._id));
    let bal = await accountBalances(t.admin);
    assert.equal(bal(`bank:${A}:card`), 981.85, 'card account = net receivable from the bank');
    assert.equal(bal('expense:pos_commission'), 18.15);

    // Rate change → version 2; the recorded transaction keeps 1.79 %.
    const updated = await mustOk(await t.admin.put(`/api/pos/providers/${garanti._id}`, {
      rules: [{ installments: 1, ratePercent: '2.10', fixedFee: '0.25', valorDays: 1 }, { installments: 3, ratePercent: '3.50', valorDays: 30 }],
    }), 'update');
    assert.equal(updated.version, 2);
    assert.equal(updated.history[0].rules[0].ratePercent, '1.7900');
    const again = await mustOk(await t.admin.get('/api/pos/transactions'), 'list 2');
    assert.equal(again[0].commission, 18.15, 'historical commission never recalculated');
    // 3 installments: 2000.00 × 3.5 % = 70.00, settles in 30 days
    await mustOk(await cardSale(2, { providerId: garanti._id, installments: 3 }), 'installment sale');
    const inst = (await mustOk(await t.admin.get('/api/pos/transactions'), 'list 3')).find((x) => x.installments === 3);
    assert.equal(inst.commission, 70);
    assert.ok(new Date(inst.expectedSettlementDate).getTime() - Date.now() > 29 * 86400000);
    bal = await accountBalances(t.admin);
    assert.equal(bal(`bank:${A}:card`), 981.85 + 1930);
    await assertReconciled(t.admin, 'after captures');
  });

  it('validation: provider required when several are active, unconfigured installments, card data rejected, permissions, tenancy', async () => {
    const { t, garanti, cardSale } = await setup();
    const other = await harness.tenant({ branches: [A] });
    expectError(await cardSale(1, undefined), 400, 'POS_PROVIDER_REQUIRED');
    expectError(await cardSale(1, { providerId: garanti._id, installments: 6 }), 422, 'POS_INSTALLMENT_NOT_CONFIGURED');
    expectError(await cardSale(1, { providerId: garanti._id, authCode: '4111 1111 1111 1111' }), 400, 'CARD_DATA_REJECTED');
    const foreign = await mustOk(await other.admin.post('/api/pos/providers', { code: 'XX', name: 'X', rules: [{ installments: 1, ratePercent: '1' }] }), 'foreign provider');
    expectError(await cardSale(1, { providerId: foreign._id }), 422, 'POS_PROVIDER_NOT_FOUND', 'provider of another business');
    expectError(await t.branch[A].manager.post('/api/pos/providers', { code: 'YY', name: 'Y', rules: [{ installments: 1, ratePercent: '1' }] }), 403, 'FORBIDDEN');
    expectError(await t.branch[A].staff.post('/api/pos/settlements', { providerId: garanti._id, depositedAmount: '1.00' }), 403, 'FORBIDDEN');
    expectError(await t.admin.post('/api/pos/providers', { code: 'GARANTI', name: 'dup', rules: [{ installments: 1, ratePercent: '1' }] }), 409, 'DUPLICATE');
    assert.equal((await mustOk(await other.admin.get('/api/pos/providers'), 'list')).length, 1);
    assert.equal(await PosTransaction.countDocuments({ businessId: t.businessId }), 0, 'failed sales leave nothing behind');
    const q = await mustOk(await t.branch[A].staff.post('/api/pos/quote', { providerId: garanti._id, installments: 3, amount: '2000.00' }), 'quote');
    assert.equal(q.commission, 70);
    assert.equal(q.net, 1930);
  });

  it('settlement: exact match, unresolved difference refused, resolved difference booked, reversal reopens, partial settlement', async () => {
    const { t, manager, garanti, cardSale } = await setup();
    await mustOk(await cardSale(1, { providerId: garanti._id }), 'sale 1');   // net 981.85
    await mustOk(await cardSale(2, { providerId: garanti._id, installments: 3 }), 'sale 2'); // net 1930.00
    const txns = await mustOk(await t.admin.get('/api/pos/transactions'), 'txns');
    const t1 = txns.find((x) => x.installments === 1);
    const t2 = txns.find((x) => x.installments === 3);

    // Auto-matching today finds nothing due yet (valor 1 and 30 days).
    expectError(await manager.post('/api/pos/settlements', { providerId: garanti._id, depositedAmount: '981.85' }), 422, 'NOTHING_TO_SETTLE');
    const s1 = await mustOk(await manager.post('/api/pos/settlements', {
      providerId: garanti._id, depositedAmount: '981.85', bankReference: 'HK-1', allocations: [{ posTransactionId: t1._id }],
    }, { 'Idempotency-Key': `set-${uid()}` }), 'settle exact');
    assert.equal(s1.difference, 0);

    // Bank paid 1900.00 instead of 1930.00
    const unresolved = expectError(await manager.post('/api/pos/settlements', {
      providerId: garanti._id, depositedAmount: '1900.00', allocations: [{ posTransactionId: t2._id }],
    }), 422, 'SETTLEMENT_DIFFERENCE_UNRESOLVED');
    assert.equal(unresolved.details.difference, -30);
    const s2 = await mustOk(await manager.post('/api/pos/settlements', {
      providerId: garanti._id, depositedAmount: '1900.00', allocations: [{ posTransactionId: t2._id }], differenceResolution: 'commission',
    }), 'settle with difference');
    let bal = await accountBalances(t.admin);
    assert.equal(bal(`bank:${A}:card`), 0, 'receivable cleared');
    assert.equal(bal(`bank:${A}:transfer`), 2881.85);
    assert.equal(bal('expense:pos_commission'), 18.15 + 70 + 30);
    expectError(await manager.post('/api/pos/settlements', { providerId: garanti._id, depositedAmount: '1.00', allocations: [{ posTransactionId: t2._id }] }), 422, 'POS_TRANSACTION_NOT_OPEN', 'double settlement');

    // Wrong match → reverse; the item reopens and can be settled partially.
    expectError(await manager.post(`/api/pos/settlements/${s2._id}/reverse`, {}), 400, 'REASON_REQUIRED');
    await mustOk(await manager.post(`/api/pos/settlements/${s2._id}/reverse`, { reason: 'Yanlış dekont' }), 'reverse');
    expectError(await manager.post(`/api/pos/settlements/${s2._id}/reverse`, { reason: 'tekrar' }), 409, 'ALREADY_REVERSED');
    bal = await accountBalances(t.admin);
    assert.equal(bal(`bank:${A}:card`), 1930);
    await mustOk(await manager.post('/api/pos/settlements', {
      providerId: garanti._id, depositedAmount: '1000.00', allocations: [{ posTransactionId: t2._id, amount: '1000.00' }],
    }), 'partial settlement');
    const reopened = (await mustOk(await t.admin.get('/api/pos/transactions'), 'txns')).find((x) => x._id === t2._id);
    assert.equal(reopened.status, 'partially_settled');
    assert.equal(reopened.open, 930);
    expectError(await manager.post('/api/pos/settlements', {
      providerId: garanti._id, depositedAmount: '930.01', allocations: [{ posTransactionId: t2._id, amount: '930.01' }],
    }), 422, 'ALLOCATION_EXCEEDS_OPEN');
    const summary = await mustOk(await t.admin.get('/api/pos/summary'), 'summary');
    assert.equal(summary.find((r) => r.providerCode === 'GARANTI').open, 930);
    await assertReconciled(t.admin, 'after settlements');
  });

  it('refunds: retained vs reversed commission policy; cancellation of a card sale', async () => {
    const { t, staff, manager, garanti, akbank, cardSale } = await setup();
    // AKBANK (reversed): 1000.00 × 2 % = 20.00; full return by card reverses 20.00 → refund net −980.00
    const s1 = await mustOk(await cardSale(1, { providerId: akbank._id }), 'akbank sale');
    await mustOk(await manager.post(`/api/sales/${s1._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], refundMethod: 'kredi kartı', reason: 'iade' }), 'return');
    const refund = (await mustOk(await t.admin.get('/api/pos/transactions'), 'txns')).find((x) => x.kind === 'refund');
    assert.equal(refund.gross, -1000);
    assert.equal(refund.commission, -20);
    assert.equal(refund.net, -980);
    let bal = await accountBalances(t.admin);
    assert.equal(bal('expense:pos_commission'), 0, 'reversed policy: commission refunded by the bank');
    assert.equal(bal(`bank:${A}:card`), 0, '980 receivable − 980 deducted');

    // GARANTI (retained): cancel the sale → refund −1000, commission 18.15 stays an expense
    const s2 = await mustOk(await cardSale(1, { providerId: garanti._id }), 'garanti sale');
    await mustOk(await manager.del(`/api/sales/${s2._id}`), 'cancel');
    const refunds = (await mustOk(await t.admin.get('/api/pos/transactions'), 'txns')).filter((x) => x.kind === 'refund' && x.providerCode === 'GARANTI');
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].net, -1000);
    bal = await accountBalances(t.admin);
    assert.equal(bal('expense:pos_commission'), 18.15);
    assert.equal(bal(`bank:${A}:card`), -18.15, 'the bank will deduct the retained commission from the next payout');
    void staff;
    await assertReconciled(t.admin, 'after refunds');
  });

  it('card tahsilat is a POS capture; competing settlements of the same item cannot both succeed', async () => {
    const { t, manager, customer, akbank } = await setup();
    // only AKBANK active at the branch after deactivating GARANTI → default provider
    const providers = await mustOk(await t.admin.get('/api/pos/providers'), 'providers');
    await mustOk(await t.admin.put(`/api/pos/providers/${providers.find((p) => p.code === 'GARANTI')._id}`, { active: false }), 'deactivate');
    const v = await t.branch[A].staff.post('/api/cash/transactions', { type: 'tahsilat', customerId: customer._id, amountTry: '500.00', paymentMethod: 'kredi kartı' });
    assert.equal(v.status, 201, JSON.stringify(v.body));
    const txn = (await mustOk(await t.admin.get('/api/pos/transactions'), 'txns'))[0];
    assert.equal(txn.providerCode, 'AKBANK');
    assert.equal(txn.source, 'tahsilat');
    assert.equal(txn.net, 490);
    const race = await Promise.all([1, 2, 3].map(() => manager.post('/api/pos/settlements', {
      providerId: akbank._id, depositedAmount: '490.00', allocations: [{ posTransactionId: txn._id }],
    })));
    assert.equal(race.filter((r) => r.status === 201).length, 1, JSON.stringify(race.map((r) => [r.status, r.body?.code])));
    assert.equal(await PosSettlement.countDocuments({ businessId: t.businessId }), 1);
    await assertReconciled(t.admin, 'after tahsilat and race');
  });
});
