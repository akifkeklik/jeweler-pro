/**
 * PR #8 remediation regressions — real MongoDB replica set (transactions),
 * real HTTP. Figures are hand-computed in the comments.
 *
 *  1. Sales with several lines of the SAME product (stock + weighted cost)
 *  2. Several sales of one inventory item (sequential, after a purchase,
 *     concurrent)
 *  3. Manual XAU / XAG prices (each gram line priced with its own metal)
 *  4. POS settlement direction rules: refund-only and netted batches
 *  5. Configurable low-stock threshold of the critical-stock report
 */
const { inspect } = require('../testSupport/tenantInspection');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'pr8-remediation-secret-with-more-than-thirty-two-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';

const { parseSaleCommand } = require('../services/salesService');
const { parseLowStockThreshold } = require('../routes/reports');

describe('Sale command validation: manualPrices (pure)', () => {
  const base = { customerId: 1, lines: [{ productId: 1, quantity: 1 }] };
  it('keeps prices keyed by metal code; drops empty values', () => {
    assert.deepEqual(parseSaleCommand({ ...base, manualPrices: { XAU: '3000', XAG: '40.5' } }).manualPrices, { XAU: '3000', XAG: '40.5' });
    assert.deepEqual(parseSaleCommand({ ...base, manualPrices: { XAU: '', XAG: null } }).manualPrices, {});
    assert.deepEqual(parseSaleCommand(base).manualPrices, {});
    assert.deepEqual(parseSaleCommand({ ...base, manualPrices: null }).manualPrices, {});
  });
  it('rejects unknown metal keys and non-object shapes', () => {
    for (const [manualPrices, code] of [
      [{ XAX: '1' }, 'INVALID_METAL'],
      [{ xau: '1' }, 'INVALID_METAL'],
      [{ gold: '1' }, 'INVALID_METAL'],
      [['3000'], 'INVALID_MANUAL_PRICE'],
      ['3000', 'INVALID_MANUAL_PRICE'],
    ]) {
      assert.throws(() => parseSaleCommand({ ...base, manualPrices }), (e) => e.statusCode === 400 && e.code === code, JSON.stringify(manualPrices));
    }
  });
});

describe('Low-stock threshold parsing (pure)', () => {
  it('defaults to 5 and accepts whole numbers 1-1000', () => {
    assert.equal(parseLowStockThreshold(undefined), 5);
    assert.equal(parseLowStockThreshold(''), 5);
    assert.equal(parseLowStockThreshold('1'), 1);
    assert.equal(parseLowStockThreshold(' 12 '), 12);
    assert.equal(parseLowStockThreshold('1000'), 1000);
  });
  it('rejects zero, negatives, fractions, text, out of range and repeated params', () => {
    for (const raw of ['0', '-1', '1.5', '1e2', 'abc', '1001', '99999', ['3', '4'], '0x10']) {
      assert.throws(() => parseLowStockThreshold(raw), (e) => e.statusCode === 400 && e.code === 'INVALID_THRESHOLD', JSON.stringify(raw));
    }
  });
});

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const Product = inspect(require('../models/Product'));
const Sale = inspect(require('../models/Sale'));
const StockMovement = inspect(require('../models/StockMovement'));
const PosProvider = inspect(require('../models/PosProvider'));
const PosTransaction = inspect(require('../models/PosTransaction'));
const PosSettlement = inspect(require('../models/PosSettlement'));
const LedgerEntry = inspect(require('../models/LedgerEntry'));
const { signToken } = require('../middleware/auth');
const { hashPassword } = require('../utils/passwords');
const { createSalesService } = require('../services/salesService');
const {
  createHarness, mustOk, expectError, accountBalances, assertReconciled, uid,
} = require('../testSupport/financeHarness');

const A = 'Merkez';
const harness = createHarness({ app, signToken, User, hashPassword });

describe('PR #8 remediation (real MongoDB, HTTP)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  before(async () => {
    await mongoose.connect(uri);
    await Promise.all([User, Product, Sale, StockMovement, PosProvider, PosTransaction, PosSettlement, LedgerEntry].map((M) => M.init()));
    await harness.start();
  });
  after(async () => {
    await harness.stop();
    await mongoose.disconnect();
  });

  const productDoc = (id) => Product.findById(id).lean();
  const movementsOf = (saleId) => StockMovement.find({ 'reference.kind': 'Sale', 'reference.id': String(saleId) }).sort({ _id: 1 }).lean();

  async function shop(productFields) {
    const t = await harness.tenant({ branches: [A] });
    const staff = t.branch[A].staff;
    const manager = t.branch[A].manager;
    const product = await mustOk(await t.admin.post('/api/products', { name: `Ürün ${uid()}`, branch: A, ...productFields }), 'product');
    const customer = await mustOk(await staff.post('/api/customers', { name: `M ${uid()}` }), 'customer');
    return { t, staff, manager, product, customer };
  }

  // ===================================================================
  describe('1. one sale with several lines of the same product', () => {
    it('moves stock progressively and issues weighted-average cost per line', async () => {
      // stock 10 × 400.00 → pool 4000.00
      const { t, staff, product, customer } = await shop({ price: '1000.00', costPrice: '400.00', stock: 10 });
      const sale = await mustOk(await staff.post('/api/sales', {
        customerId: customer._id,
        lines: [
          { productId: product._id, quantity: 2 },
          { productId: product._id, quantity: 3, discount: { type: 'percent', value: '10' } },
        ],
        payments: [{ method: 'nakit', amount: '4700.00' }], // 2000.00 + 3 × 900.00
      }), 'duplicate-line sale');

      assert.equal(sale.lines.length, 2, 'lines are kept separately (own discount, own return)');
      assert.equal(sale.financial.total, 4700);
      const p = await productDoc(product._id);
      assert.equal(p.stock, 5);
      assert.equal(p.costPoolMinor, 200000, 'pool 4000.00 − 800.00 − 1200.00');

      const moves = await movementsOf(sale._id);
      assert.deepEqual(moves.map((m) => [m.quantity, m.costMinor, m.balanceAfter]), [[-2, -80000, 8], [-3, -120000, 5]]);
      const stored = await Sale.findById(sale._id).lean();
      assert.deepEqual(stored.lines.map((l) => l.costMinor), [80000, 120000]);

      const bal = await accountBalances(t.admin);
      assert.equal(bal('cogs'), 2000);
      assert.equal(bal(`inventory:${A}`), 2000, 'inventory account = remaining pool');
      await assertReconciled(t.admin, 'duplicate lines');
    });

    it('rounding: three single-unit lines of an uneven pool issue exactly the whole pool', async () => {
      // 3 × 333.33 = 999.99 → issue 333.33, 333.33 (666.66 × 1/2), 333.33 (last unit takes the rest)
      const { t, staff, product, customer } = await shop({ price: '500.00', costPrice: '333.33', stock: 3 });
      const sale = await mustOk(await staff.post('/api/sales', {
        customerId: customer._id, lines: [1, 2, 3].map(() => ({ productId: product._id, quantity: 1 })), payments: [],
      }), 'three lines');
      const moves = await movementsOf(sale._id);
      assert.equal(moves.reduce((s, m) => s - m.costMinor, 0), 99999, 'Σ issued cost = whole pool');
      const p = await productDoc(product._id);
      assert.equal(p.stock, 0);
      assert.equal(p.costPoolMinor, 0);
      await assertReconciled(t.admin, 'uneven pool');
    });

    it('insufficient stock across lines: one clear error with the total, nothing is written', async () => {
      const { t, staff, product, customer } = await shop({ price: '100.00', costPrice: '50.00', stock: 3 });
      const err = expectError(await staff.post('/api/sales', {
        customerId: customer._id, lines: [{ productId: product._id, quantity: 2 }, { productId: product._id, quantity: 2 }], payments: [],
      }), 409, 'INSUFFICIENT_STOCK');
      assert.equal(err.details.requested, 4);
      assert.equal(err.details.stock, 3);
      assert.equal((await productDoc(product._id)).stock, 3);
      assert.equal(await Sale.countDocuments({ businessId: t.businessId }), 0);
      assert.equal(await StockMovement.countDocuments({ businessId: t.businessId, movementType: 'sale' }), 0);
      // exactly the free stock across lines is fine
      await mustOk(await staff.post('/api/sales', {
        customerId: customer._id, lines: [{ productId: product._id, quantity: 1 }, { productId: product._id, quantity: 2 }], payments: [],
      }), '1 + 2 of 3');
      assert.equal((await productDoc(product._id)).stock, 0);
      await assertReconciled(t.admin, 'aggregate stock');
    });

    it('quote of a duplicate-line cart equals the stored sale', async () => {
      const { staff, product, customer } = await shop({ price: '250.00', costPrice: '100.00', stock: 4 });
      const cart = { customerId: customer._id, lines: [{ productId: product._id, quantity: 1 }, { productId: product._id, quantity: 2, discount: { type: 'amount', value: '50' } }], payments: [] };
      const quote = await mustOk(await staff.post('/api/sales/quote', cart), 'quote');
      const sale = await mustOk(await staff.post('/api/sales', cart), 'sale');
      assert.equal(quote.total, 700);
      assert.equal(sale.financial.total, quote.total);
      assert.deepEqual(sale.lines.map((l) => l.total), quote.lines.map((l) => l.total));
    });

    it('return of one duplicate line and cancellation restore stock and cost exactly', async () => {
      const { t, staff, manager, product, customer } = await shop({ price: '1000.00', costPrice: '400.00', stock: 6 });
      const s1 = await mustOk(await staff.post('/api/sales', {
        customerId: customer._id, lines: [{ productId: product._id, quantity: 1 }, { productId: product._id, quantity: 2 }], payments: [],
      }), 'sale 1');
      // return line 2 (2 units at the cost they left with: 800.00)
      await mustOk(await manager.post(`/api/sales/${s1._id}/returns`, { lines: [{ lineId: 2, quantity: 2 }], refundMethod: 'cari' }), 'return line 2');
      let p = await productDoc(product._id);
      assert.equal(p.stock, 5);
      assert.equal(p.costPoolMinor, 200000);

      const s2 = await mustOk(await staff.post('/api/sales', {
        customerId: customer._id, lines: [{ productId: product._id, quantity: 2 }, { productId: product._id, quantity: 2 }], payments: [],
      }), 'sale 2');
      p = await productDoc(product._id);
      assert.equal(p.stock, 1);
      await mustOk(await manager.del(`/api/sales/${s2._id}`), 'cancel sale 2');
      p = await productDoc(product._id);
      assert.equal(p.stock, 5);
      assert.equal(p.costPoolMinor, 200000, 'cancellation puts back exactly the issued cost');
      await assertReconciled(t.admin, 'return + cancel of duplicate lines');
    });
  });

  // ===================================================================
  describe('2. several sales of one inventory item', () => {
    it('sequential sales and a purchase in between keep the weighted average exact', async () => {
      const { t, staff, product, customer } = await shop({ price: '300.00', costPrice: '100.00', stock: 4 });
      const supplier = await mustOk(await t.branch[A].manager.post('/api/suppliers', { name: `T ${uid()}` }), 'supplier');
      // sale A: 1 + 1 → cost 200.00; pool 200.00 for 2 units
      await mustOk(await staff.post('/api/sales', { customerId: customer._id, lines: [{ productId: product._id, quantity: 1 }, { productId: product._id, quantity: 1 }], payments: [] }), 'sale A');
      // purchase 2 × 160.00 → pool 520.00 for 4 units (avg 130.00)
      await mustOk(await t.branch[A].manager.post('/api/purchases', { supplierId: supplier._id, lines: [{ productId: product._id, quantity: 2, unitCost: '160.00' }] }), 'purchase');
      // sale B: 1 + 2 → 130.00 (520 × 1/4) + 260.00 (390 × 2/3) = 390.00; pool 130.00 for 1 unit
      const b = await mustOk(await staff.post('/api/sales', { customerId: customer._id, lines: [{ productId: product._id, quantity: 1 }, { productId: product._id, quantity: 2 }], payments: [] }), 'sale B');
      const moves = await movementsOf(b._id);
      assert.deepEqual(moves.map((m) => m.costMinor), [-13000, -26000]);
      const p = await productDoc(product._id);
      assert.equal(p.stock, 1);
      assert.equal(p.costPoolMinor, 13000);
      assert.equal(p.costPrice, 130);
      const bal = await accountBalances(t.admin);
      assert.equal(bal('cogs'), 590);
      await assertReconciled(t.admin, 'sequential sales');
    });

    it('concurrent duplicate-line sales never oversell: stock and pool stay consistent', async () => {
      // 5 units; 6 concurrent carts of 1 + 1 → at most 2 can succeed
      const { t, staff, product, customer } = await shop({ price: '100.00', costPrice: '40.00', stock: 5 });
      const results = await Promise.all(Array.from({ length: 6 }, () => staff.post('/api/sales', {
        customerId: customer._id, lines: [{ productId: product._id, quantity: 1 }, { productId: product._id, quantity: 1 }], payments: [],
      })));
      const ok = results.filter((r) => r.status === 201).length;
      assert.equal(ok, 2, JSON.stringify(results.map((r) => [r.status, r.body?.code])));
      assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409 && ['INSUFFICIENT_STOCK', 'STOCK_CHANGED'].includes(r.body.code)));
      const p = await productDoc(product._id);
      assert.equal(p.stock, 1);
      assert.equal(p.costPoolMinor, 4000);
      const moved = await StockMovement.find({ businessId: t.businessId, productId: product._id, movementType: 'sale' }).lean();
      assert.equal(moved.reduce((s, m) => s + m.quantity, 0), -4);
      await assertReconciled(t.admin, 'concurrent duplicate-line sales');
    });
  });

  // ===================================================================
  describe('3. manual XAU / XAG prices', () => {
    // No live quote at all: only explicit manual prices can price a gram line.
    const noQuotes = { quoteSource: async () => ({ preferredQuotes: [] }) };

    async function metalShop() {
      const t = await harness.tenant({ branches: [A] });
      const gold = await mustOk(await t.admin.post('/api/products', {
        name: `22 Ayar ${uid()}`, pricingMode: 'gram', metal: 'XAU', karat: 22, weight: '10.000', stock: 5, branch: A,
      }), 'gold');
      const silver = await mustOk(await t.admin.post('/api/products', {
        name: `925 Gümüş ${uid()}`, pricingMode: 'gram', metal: 'XAG', milyem: 925, weight: '5.000', stock: 5, branch: A,
      }), 'silver');
      const customer = await mustOk(await t.branch[A].staff.post('/api/customers', { name: `M ${uid()}` }), 'customer');
      const ctx = { businessId: t.businessId, branch: A, userId: t.branch[A].users.staff._id, isAdmin: false, correlationId: `pr8-${uid()}` };
      return { t, gold, silver, customer, ctx, service: createSalesService(noQuotes) };
    }

    it('a silver line uses manualPrices.XAG', async () => {
      const { silver, customer, ctx, service } = await metalShop();
      // 5 g × 0.925 × 40.00 = 185.00
      const sale = await service.createSale({ customerId: customer._id, lines: [{ productId: silver._id, quantity: 1 }], manualPrices: { XAG: '40.00' } }, null, ctx);
      assert.equal(sale.lines[0].unitPriceMinor, 18500);
      assert.equal(sale.lines[0].price.priceType, 'manual');
      assert.equal(sale.lines[0].price.symbol, 'GUMUS_GRAM');
      assert.equal(sale.lines[0].metal, 'XAG');
    });

    it('a gold + silver cart prices each line with its own metal', async () => {
      const { t, gold, silver, customer, ctx, service } = await metalShop();
      // gold: 10 g × 0.916 × 3000.00 = 27480.00; silver: 2 × 185.00 = 370.00
      const sale = await service.createSale({
        customerId: customer._id,
        lines: [{ productId: gold._id, quantity: 1 }, { productId: silver._id, quantity: 2 }],
        manualPrices: { XAU: '3000.00', XAG: '40.00' },
      }, null, ctx);
      assert.deepEqual(sale.lines.map((l) => [l.metal, l.price.symbol, l.unitPriceMinor, l.totalMinor]), [
        ['XAU', 'HAS_ALTIN', 2748000, 2748000],
        ['XAG', 'GUMUS_GRAM', 18500, 37000],
      ]);
      assert.equal(sale.totalMinor, 2785000);
      const quote = await service.quoteSale({
        customerId: customer._id, lines: [{ productId: gold._id, quantity: 1 }, { productId: silver._id, quantity: 2 }], manualPrices: { XAU: '3000.00', XAG: '40.00' },
      }, ctx);
      assert.equal(quote.total, 27850);
      await assertReconciled(t.admin, 'mixed metals');
    });

    it('the old payload (silver price sent as XAU) is refused — the reason the client must key by metal', async () => {
      const { silver, customer, ctx, service } = await metalShop();
      await assert.rejects(
        service.createSale({ customerId: customer._id, lines: [{ productId: silver._id, quantity: 1 }], manualPrices: { XAU: '40.00' } }, null, ctx),
        (e) => e.statusCode === 409 && e.code === 'MARKET_PRICE_UNAVAILABLE' && e.details?.metal === 'XAG',
      );
      assert.equal((await productDoc(silver._id)).stock, 5);
    });

    it('a mixed cart with only one manual price fails for the other metal; nothing is written', async () => {
      const { t, gold, silver, customer, ctx, service } = await metalShop();
      await assert.rejects(
        service.createSale({
          customerId: customer._id, lines: [{ productId: gold._id, quantity: 1 }, { productId: silver._id, quantity: 1 }], manualPrices: { XAU: '3000.00' },
        }, null, ctx),
        (e) => e.code === 'MARKET_PRICE_UNAVAILABLE' && e.details?.metal === 'XAG',
      );
      assert.equal((await productDoc(gold._id)).stock, 5);
      assert.equal(await Sale.countDocuments({ businessId: t.businessId }), 0);
    });

    it('invalid manual prices are rejected over HTTP before any stock moves', async () => {
      const { t, silver, customer } = await metalShop();
      const staff = t.branch[A].staff;
      const line = [{ productId: silver._id, quantity: 1 }];
      expectError(await staff.post('/api/sales', { customerId: customer._id, lines: line, manualPrices: { XAX: '40' } }), 400, 'INVALID_METAL');
      expectError(await staff.post('/api/sales', { customerId: customer._id, lines: line, manualPrices: ['40'] }), 400, 'INVALID_MANUAL_PRICE');
      expectError(await staff.post('/api/sales', { customerId: customer._id, lines: line, manualPrices: { XAG: '-40' } }), 400);
      expectError(await staff.post('/api/sales', { customerId: customer._id, lines: line, manualPrices: { XAG: '0' } }), 400);
      expectError(await staff.post('/api/sales', { customerId: customer._id, lines: line, manualPrices: { XAG: 'kırk' } }), 400);
      expectError(await staff.post('/api/sales/quote', { customerId: customer._id, lines: line, manualPrices: { XAX: '40' } }), 400, 'INVALID_METAL');
      assert.equal((await productDoc(silver._id)).stock, 5);
      // HTTP happy path with an explicit XAG price
      const sale = await mustOk(await staff.post('/api/sales', { customerId: customer._id, lines: line, manualPrices: { XAG: '40.00' }, payments: [] }), 'xag http');
      assert.equal(sale.lines[0].unitPrice, 185);
    });
  });

  // ===================================================================
  describe('4. POS settlement direction: refund-only and netted batches', () => {
    async function posShop() {
      const t = await harness.tenant({ branches: [A] });
      const staff = t.branch[A].staff;
      const manager = t.branch[A].manager;
      // reversed policy, valör 0: 1000.00 × 2 % = 20.00 → net 980.00; a full card return → refund net −980.00
      const akbank = await mustOk(await t.admin.post('/api/pos/providers', {
        code: 'AKBANK', name: 'Akbank POS', refundCommissionPolicy: 'reversed', rules: [{ installments: 1, ratePercent: '2.00', valorDays: 0 }],
      }), 'provider');
      const product = await mustOk(await t.admin.post('/api/products', { name: `Ürün ${uid()}`, price: '1000.00', costPrice: '400.00', stock: 20, branch: A }), 'product');
      const customer = await mustOk(await staff.post('/api/customers', { name: `M ${uid()}` }), 'customer');
      const cardSale = async () => mustOk(await staff.post('/api/sales', {
        customerId: customer._id, lines: [{ productId: product._id, quantity: 1 }], payments: [{ method: 'kredi kartı', amount: '1000.00', pos: { providerId: akbank._id } }],
      }), 'card sale');
      const cardReturn = async (saleId) => mustOk(await manager.post(`/api/sales/${saleId}/returns`, { lines: [{ lineId: 1, quantity: 1 }], refundMethod: 'kredi kartı', reason: 'iade' }), 'card return');
      const txns = async () => mustOk(await t.admin.get('/api/pos/transactions'), 'txns');
      const settle = (body) => manager.post('/api/pos/settlements', { providerId: akbank._id, ...body });
      return { t, manager, akbank, cardSale, cardReturn, txns, settle };
    }

    it('refund-only batch: settled with the negative amount the bank debited; books balance', async () => {
      const { t, cardSale, cardReturn, txns, settle } = await posShop();
      const sale = await cardSale();
      const capture = (await txns()).find((x) => x.kind === 'payment');
      await mustOk(await settle({ depositedAmount: '980.00', allocations: [{ posTransactionId: capture._id }] }), 'settle capture');
      await cardReturn(sale._id);
      const refund = (await txns()).find((x) => x.kind === 'refund');
      assert.equal(refund.open, -980);
      let bal = await accountBalances(t.admin);
      assert.equal(bal(`bank:${A}:card`), -980, 'the bank will claw back the refund');
      assert.equal(bal(`bank:${A}:transfer`), 980);

      // invalid directions: positive, zero
      const pos = expectError(await settle({ depositedAmount: '980.00', allocations: [{ posTransactionId: refund._id }] }), 422, 'SETTLEMENT_DIRECTION_MISMATCH');
      assert.equal(pos.details.expected, -980);
      expectError(await settle({ depositedAmount: '0', allocations: [{ posTransactionId: refund._id }] }), 422, 'SETTLEMENT_DIRECTION_MISMATCH');
      // a refund is matched in full only
      expectError(await settle({ depositedAmount: '-500.00', allocations: [{ posTransactionId: refund._id, amount: '-500.00' }] }), 422, 'ALLOCATION_EXCEEDS_OPEN');
      // the bank debited 985.00: the 5.00 difference needs an explicit resolution
      const diff = expectError(await settle({ depositedAmount: '-985.00', allocations: [{ posTransactionId: refund._id }] }), 422, 'SETTLEMENT_DIFFERENCE_UNRESOLVED');
      assert.equal(diff.details.difference, -5);

      const s = await mustOk(await settle({ depositedAmount: '-980.00', bankReference: 'IADE-1', allocations: [{ posTransactionId: refund._id }] }), 'settle refund');
      assert.equal(s.expected, -980);
      assert.equal(s.deposited, -980);
      assert.equal(s.difference, 0);
      const settledRefund = (await txns()).find((x) => x.kind === 'refund');
      assert.equal(settledRefund.status, 'settled');
      assert.equal(settledRefund.open, 0);
      bal = await accountBalances(t.admin);
      assert.equal(bal(`bank:${A}:card`), 0, 'card receivable / payable closed');
      assert.equal(bal(`bank:${A}:transfer`), 0, '980 in, 980 out');
      const entry = await LedgerEntry.findById((await PosSettlement.findById(s._id).lean()).journalEntryId).lean();
      const line = (acc) => entry.lines.find((l) => l.account === acc);
      assert.deepEqual([line(`bank:${A}:card`).debit, line(`bank:${A}:transfer`).credit], [98000, 98000], 'Dr card / Cr transfer');
      expectError(await settle({ depositedAmount: '-980.00', allocations: [{ posTransactionId: refund._id }] }), 422, 'POS_TRANSACTION_NOT_OPEN', 'no double settlement');
      await assertReconciled(t.admin, 'refund-only settlement');

      // reversal reopens the refund and mirrors the entry
      await mustOk(await t.branch[A].manager.post(`/api/pos/settlements/${s._id}/reverse`, { reason: 'yanlış dekont' }), 'reverse');
      bal = await accountBalances(t.admin);
      assert.equal(bal(`bank:${A}:card`), -980);
      assert.equal((await txns()).find((x) => x.kind === 'refund').status, 'open');
      await assertReconciled(t.admin, 'refund-only reversed');
    });

    it('refund-only with a resolved difference books it to the difference account', async () => {
      const { t, cardSale, cardReturn, txns, settle } = await posShop();
      const sale = await cardSale();
      await cardReturn(sale._id);
      const all = await txns();
      // capture +980 and refund −980 still open; settle the refund alone, bank took 985.00
      const refund = all.find((x) => x.kind === 'refund');
      await mustOk(await settle({ depositedAmount: '-985.00', allocations: [{ posTransactionId: refund._id }], differenceResolution: 'settlement_difference' }), 'with difference');
      const bal = await accountBalances(t.admin);
      // card: +980 (capture) − 980 (refund) + 980 (settled refund) = 980; transfer −985; difference +5 (debit)
      assert.equal(bal(`bank:${A}:card`), 980);
      assert.equal(bal(`bank:${A}:transfer`), -985);
      assert.equal(bal('pos_settlement_difference'), 5);
      await assertReconciled(t.admin, 'refund-only with difference');
    });

    it('a signed deposit is bounded on BOTH sides by the money limit (10 billion TRY)', async () => {
      // Regression: the negative side had no lower bound (only max was set), so a
      // refund-only batch with a resolution could book an unbounded difference.
      const { t, cardSale, cardReturn, txns, settle } = await posShop();
      const sale = await cardSale();
      await cardReturn(sale._id);
      const refund = (await txns()).find((x) => x.kind === 'refund');
      const before = await LedgerEntry.countDocuments({ businessId: t.businessId });
      for (const depositedAmount of ['-10000000000.01', '-90071992547409.91', '10000000000.01']) {
        const res = await settle({ depositedAmount, allocations: [{ posTransactionId: refund._id }], differenceResolution: 'settlement_difference' });
        assert.equal(res.status, 400, `${depositedAmount} must be refused (got ${res.status})`);
      }
      // the limit itself is still a valid amount (refused only for the unresolved/wrong direction, not the range)
      expectError(await settle({ depositedAmount: '-10000000000.00', allocations: [{ posTransactionId: refund._id }] }), 422, 'SETTLEMENT_DIFFERENCE_UNRESOLVED');
      assert.equal(await LedgerEntry.countDocuments({ businessId: t.businessId }), before, 'nothing posted');
      assert.equal((await txns()).find((x) => x.kind === 'refund').status, 'open');
      await assertReconciled(t.admin, 'bounded deposit');
    });

    it('netted batch (captures = refunds): settled with 0, no journal entry, reversible', async () => {
      const { t, cardSale, cardReturn, txns, settle } = await posShop();
      const sale = await cardSale();
      await cardReturn(sale._id);
      const ids = (await txns()).map((x) => ({ posTransactionId: x._id }));
      assert.equal(ids.length, 2);
      expectError(await settle({ depositedAmount: '5.00', allocations: ids }), 422, 'SETTLEMENT_DIRECTION_MISMATCH');
      expectError(await settle({ depositedAmount: '-5.00', allocations: ids, differenceResolution: 'settlement_difference' }), 422, 'SETTLEMENT_DIRECTION_MISMATCH');
      const before = await LedgerEntry.countDocuments({ businessId: t.businessId });
      const s = await mustOk(await settle({ depositedAmount: '0', allocations: ids }), 'netted');
      assert.equal(s.expected, 0);
      assert.equal(s.deposited, 0);
      assert.equal(await LedgerEntry.countDocuments({ businessId: t.businessId }), before, 'no money moved → no entry');
      assert.equal((await PosSettlement.findById(s._id).lean()).journalEntryId, null);
      assert.ok((await txns()).every((x) => x.status === 'settled' && x.open === 0));
      const bal = await accountBalances(t.admin);
      assert.equal(bal(`bank:${A}:card`), 0);
      assert.equal(bal(`bank:${A}:transfer`), 0);
      await assertReconciled(t.admin, 'netted');

      await mustOk(await t.branch[A].manager.post(`/api/pos/settlements/${s._id}/reverse`, { reason: 'tekrar eşleştir' }), 'reverse netted');
      assert.ok((await txns()).every((x) => x.status === 'open'));
      assert.equal(await LedgerEntry.countDocuments({ businessId: t.businessId }), before, 'nothing to mirror');
      await assertReconciled(t.admin, 'netted reversed');
    });

    it('positive batches keep the historic rules; auto-matching picks up refund-only items too', async () => {
      const { t, cardSale, cardReturn, txns, settle } = await posShop();
      const s1 = await cardSale();
      const capture = (await txns())[0];
      expectError(await settle({ depositedAmount: '-980.00', allocations: [{ posTransactionId: capture._id }] }), 422, 'SETTLEMENT_DIRECTION_MISMATCH');
      expectError(await settle({ depositedAmount: '0', allocations: [{ posTransactionId: capture._id }] }), 422, 'SETTLEMENT_DIRECTION_MISMATCH');
      expectError(await settle({ depositedAmount: 'abc', allocations: [{ posTransactionId: capture._id }] }), 400);
      // auto mode (valör 0 → due today): capture only
      await mustOk(await settle({ depositedAmount: '980.00' }), 'auto capture');
      await cardReturn(s1._id);
      expectError(await settle({ depositedAmount: '980.00' }), 422, 'SETTLEMENT_DIRECTION_MISMATCH');
      await mustOk(await settle({ depositedAmount: '-980.00' }), 'auto refund-only');
      expectError(await settle({ depositedAmount: '-980.00' }), 422, 'NOTHING_TO_SETTLE');
      await assertReconciled(t.admin, 'auto matching');
    });
  });

  // ===================================================================
  describe('5. configurable low-stock threshold', () => {
    it('lists stock ≤ threshold of the own tenant only; default 5; invalid values refused', async () => {
      const t = await harness.tenant({ branches: [A] });
      const other = await harness.tenant({ branches: [A] });
      for (const stock of [0, 3, 5, 6, 12]) {
        await mustOk(await t.admin.post('/api/products', { name: `S${stock}`, price: '10.00', stock, branch: A }), `p${stock}`);
      }
      await mustOk(await other.admin.post('/api/products', { name: 'Foreign', price: '10.00', stock: 1, branch: A }), 'foreign');
      const names = async (q) => (await mustOk(await t.admin.get(`/api/reports/low-stock${q}`), q)).map((r) => r.isim);
      assert.deepEqual(await names(''), ['S0', 'S3', 'S5'], 'default 5 (unchanged contract)');
      assert.deepEqual(await names('?threshold=5'), ['S0', 'S3', 'S5']);
      assert.deepEqual(await names('?threshold=10'), ['S0', 'S3', 'S5', 'S6']);
      assert.deepEqual(await names('?threshold=1'), ['S0']);
      assert.deepEqual(await names('?threshold=1000'), ['S0', 'S3', 'S5', 'S6', 'S12']);
      for (const bad of ['0', '-3', '2.5', 'abc', '1001']) {
        expectError(await t.admin.get(`/api/reports/low-stock?threshold=${bad}`), 400, 'INVALID_THRESHOLD', bad);
      }
      expectError(await t.admin.get('/api/reports/low-stock?threshold=3&threshold=4'), 400, 'INVALID_THRESHOLD', 'repeated');
    });
  });
});
