/**
 * Cross-branch and cross-tenant integrity — real MongoDB replica set, real HTTP.
 *
 * Covers the three remediated defects and the authorization audit:
 *   A. sales / returns / cancellations / collections are booked to the branch
 *      that owns the stock, never to the admin's own branch; cross-branch
 *      operations are admin-only and must name the branch explicitly
 *   B. purchases: detail, payment, return, refund and cancellation are
 *      tenant- AND branch-scoped (ID probing behaves like a missing record)
 *   C. legacy stock migration: openings in the owning branch, ambiguous
 *      ownership is never defaulted, mis-booked history is repaired by the
 *      operator procedure with exact quantities and cost
 * After every workflow the books are reconciled, including the per-branch
 * check inventory:{branch} == Σ stock movement cost of that branch.
 */
const { inspect } = require('../testSupport/tenantInspection');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'branch-integrity-tests-secret-with-more-than-thirty-two-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const Product = inspect(require('../models/Product'));
const Sale = inspect(require('../models/Sale'));
const Purchase = inspect(require('../models/Purchase'));
const StockMovement = inspect(require('../models/StockMovement'));
const LedgerEntry = inspect(require('../models/LedgerEntry'));
const { signToken } = require('../middleware/auth');
const { hashPassword } = require('../utils/passwords');
const { DEFAULT_BRANCH } = require('../config/tenancy');
const ledger = require('../services/finance/ledgerService');
const inventory = require('../services/finance/inventoryService');
const stockOwnership = require('../services/finance/stockOwnership');
const migrateFinancialData = require('../scripts/migrateFinancialData');
const { planFinancialMigration } = require('../scripts/migrationPlan');
const { run: resolveOwnership } = require('../scripts/resolveStockOwnership');
const { systemContext, runInTransaction } = require('../services/finance/core');
const {
  createHarness, mustOk, expectError, accountBalances, assertReconciled, uid,
} = require('../testSupport/financeHarness');

const A = 'Merkez';
const B = 'Bağdat Caddesi';
const harness = createHarness({ app, signToken, User, hashPassword });
const silent = { log() {}, error() {} };

const product = (api, body) => api.post('/api/products', { name: `Ürün ${uid()}`, ...body }).then((r) => mustOk(r, 'product'));
const customer = (api) => api.post('/api/customers', { name: `Müşteri ${uid()}` }).then((r) => mustOk(r, 'customer'));
const supplier = (api) => api.post('/api/suppliers', { name: `Tedarikçi ${uid()}` }).then((r) => mustOk(r, 'supplier'));
const stored = async (id) => Product.findById(id).lean();
const movementsOf = (businessId, productId) => StockMovement.find({ businessId, productId }).lean();
const id6 = () => 100000 + Math.floor(Math.random() * 800000);

describe('Branch integrity & cross-tenant isolation (real MongoDB, HTTP)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  before(async () => {
    await mongoose.connect(uri);
    await Promise.all([User, Product, Sale, Purchase, StockMovement, LedgerEntry].map((M) => M.init()));
    await harness.start();
  });
  after(async () => {
    await harness.stop();
    await mongoose.disconnect();
  });

  /* ------------------------------------------------------- A. sales */

  it('A: an admin cannot silently sell another branch\'s stock; the explicit cross-branch sale is booked entirely to the owning branch', async () => {
    const t = await harness.tenant({ branches: [A, B] }); // admin belongs to A
    const mb = t.branch[B].manager;
    // 5 rings at 100.00 in B → inventory:B 500.00
    const ring = await product(mb, { price: '250.00', costPrice: '100.00', stock: 5, branch: B });
    const atA = await product(t.branch[A].manager, { price: '50.00', costPrice: '20.00', stock: 2, branch: A });
    const c = await customer(t.admin);
    const movementsBefore = (await movementsOf(t.businessId, ring._id)).length;

    // Implicit: refused, nothing changes.
    expectError(await t.admin.post('/api/sales', { customerId: c._id, lines: [{ productId: ring._id, quantity: 1 }], paymentMethod: 'nakit' }), 409, 'CROSS_BRANCH_CONFIRMATION_REQUIRED', 'admin implicit');
    // Explicit but wrong / unknown branch.
    expectError(await t.admin.post('/api/sales', { customerId: c._id, branch: A, lines: [{ productId: ring._id, quantity: 1 }], payments: [] }), 409, 'BRANCH_OWNERSHIP_MISMATCH', 'admin wrong branch');
    expectError(await t.admin.post('/api/sales', { customerId: c._id, branch: 'Olmayan Şube', lines: [{ productId: ring._id, quantity: 1 }], payments: [] }), 400, 'UNKNOWN_BRANCH');
    expectError(await t.admin.post('/api/sales', { customerId: c._id, branch: { $ne: '' }, lines: [{ productId: ring._id, quantity: 1 }], payments: [] }), 422, 'INVALID_BRANCH', 'operator injection');
    // One document = one branch.
    expectError(await t.admin.post('/api/sales', { customerId: c._id, branch: B, lines: [{ productId: ring._id, quantity: 1 }, { productId: atA._id, quantity: 1 }], payments: [] }), 409, 'MIXED_BRANCH_DOCUMENT');
    // Non-admins: neither implicitly nor by naming the other branch.
    expectError(await t.branch[A].staff.post('/api/sales', { customerId: c._id, lines: [{ productId: ring._id, quantity: 1 }], payments: [] }), 403, 'BRANCH_MISMATCH', 'staff A sells B stock');
    expectError(await t.branch[A].staff.post('/api/sales', { customerId: c._id, branch: B, lines: [{ productId: ring._id, quantity: 1 }], payments: [] }), 403, 'BRANCH_MISMATCH', 'staff A names B');
    expectError(await t.branch[A].manager.post('/api/sales', { customerId: c._id, branch: B, lines: [{ productId: atA._id, quantity: 1 }], payments: [] }), 403, 'BRANCH_MISMATCH', 'manager A acts for B');
    assert.equal((await stored(ring._id)).stock, 5, 'refused attempts changed nothing');
    assert.equal((await movementsOf(t.businessId, ring._id)).length, movementsBefore);

    // Explicit cross-branch sale: 2 × 250.00 paid in cash.
    const sale = await mustOk(await t.admin.post('/api/sales', {
      customerId: c._id, branch: B, lines: [{ productId: ring._id, quantity: 2 }], paymentMethod: 'nakit',
    }), 'explicit cross-branch sale');
    const doc = await Sale.findById(sale._id).lean();
    assert.equal(doc.branch, B, 'the sale document belongs to the owning branch');
    const saleMovements = await StockMovement.find({ businessId: t.businessId, 'reference.kind': 'Sale', 'reference.id': String(sale._id) }).lean();
    assert.deepEqual(saleMovements.map((m) => [m.branch, m.quantity, m.costMinor]), [[B, -2, -20000]]);
    let bal = await accountBalances(t.admin);
    assert.equal(bal(`inventory:${B}`), 300, '500 − 200 COGS');
    assert.equal(bal(`inventory:${A}`), 40, 'A untouched (its own 2 × 20.00)');
    assert.equal(bal(`cash:${B}`), 500, 'money taken in the owning branch');
    assert.equal(bal(`cash:${A}`), 0);
    await assertReconciled(t.admin, 'after cross-branch sale');

    // A staff member of A cannot see, collect on, return or cancel it.
    expectError(await t.branch[A].staff.get(`/api/sales/${sale._id}`), 404, undefined, 'staff A reads B sale');
    expectError(await t.branch[A].manager.post(`/api/sales/${sale._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], refundMethod: 'nakit', reason: 'x' }), 404, undefined, 'manager A returns B sale');
    expectError(await t.branch[A].manager.del(`/api/sales/${sale._id}`), 404, undefined, 'manager A cancels B sale');
    expectError(await t.branch[A].staff.put(`/api/sales/${sale._id}`, { notes: 'değiştirildi' }), 404, undefined, 'staff A edits B sale');
    assert.notEqual((await Sale.findById(sale._id).lean()).notes, 'değiştirildi');
    await mustOk(await t.branch[B].staff.put(`/api/sales/${sale._id}`, { notes: 'B notu' }), 'owner branch edits its sale');

    // Admin return of 1 unit → back into B at its cost, refund from B's till.
    await mustOk(await t.admin.post(`/api/sales/${sale._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], refundMethod: 'nakit', reason: 'beğenmedi' }), 'admin return');
    const afterReturn = await stored(ring._id);
    assert.equal(afterReturn.stock, 4);
    assert.equal(afterReturn.branch, B);
    bal = await accountBalances(t.admin);
    assert.equal(bal(`inventory:${B}`), 400);
    assert.equal(bal(`inventory:${A}`), 40);
    assert.equal(bal(`cash:${B}`), 250);
    await assertReconciled(t.admin, 'after cross-branch return');

    // Credit sale in B, collected by the admin → B's till.
    const credit = await mustOk(await t.admin.post('/api/sales', { customerId: c._id, branch: B, lines: [{ productId: ring._id, quantity: 1 }], payments: [] }), 'credit sale');
    await mustOk(await t.admin.post(`/api/sales/${credit._id}/payments`, { method: 'nakit', amount: '250.00' }), 'collection');
    expectError(await t.branch[A].staff.post(`/api/sales/${credit._id}/payments`, { method: 'nakit', amount: '1.00' }), 404, undefined, 'staff A collects on B sale');
    bal = await accountBalances(t.admin);
    assert.equal(bal(`cash:${B}`), 500);
    assert.equal(bal(`cash:${A}`), 0);

    // Admin cancellation → stock back to B (not A), reversal in B.
    await mustOk(await t.admin.del(`/api/sales/${credit._id}`), 'cancel');
    const cancelMoves = await StockMovement.find({ businessId: t.businessId, movementType: 'sale_cancel', 'reference.id': String(credit._id) }).lean();
    assert.deepEqual(cancelMoves.map((m) => [m.branch, m.quantity]), [[B, 1]]);
    bal = await accountBalances(t.admin);
    assert.equal(bal(`inventory:${B}`), 400);
    assert.equal(bal(`inventory:${A}`), 40);
    assert.equal((await stored(ring._id)).stock, 4);
    await assertReconciled(t.admin, 'after cross-branch cancel');

    // The branch staff still sells their own stock as before (no branch needed).
    await mustOk(await t.branch[B].staff.post('/api/sales', { customerId: c._id, lines: [{ productId: ring._id, quantity: 1 }], payments: [] }), 'own-branch sale');
    await assertReconciled(t.admin, 'final');
  });

  it('A: the inventory engine itself refuses a movement booked to a non-owning branch; concurrent claims of a shared item resolve to one owner', async () => {
    const t = await harness.tenant({ branches: [A, B] });
    const atB = await product(t.branch[B].manager, { price: '10.00', costPrice: '4.00', stock: 3, branch: B });
    const ctxA = Object.freeze({ ...systemContext({ businessId: t.businessId, branch: A }), isAdmin: true });
    await assert.rejects(runInTransaction(async (session) => {
      const p = await inventory.loadProduct(session, ctxA, atB._id);
      await inventory.moveProduct(session, ctxA, { product: p, quantity: -1, movementType: 'sale', reference: { kind: 'Test', id: 'x' } });
    }), (e) => e.code === 'BRANCH_OWNERSHIP_MISMATCH');
    await assert.rejects(runInTransaction(async (session) => {
      const p = await inventory.loadProduct(session, ctxA, atB._id);
      await inventory.revalueProduct(session, ctxA, { product: p, unitCostMinor: 1n, reference: { kind: 'Test', id: 'x' } });
    }), (e) => e.code === 'BRANCH_OWNERSHIP_MISMATCH');
    assert.equal((await stored(atB._id)).stock, 3);

    // Two branches race to put the first stock into a shared, stock-less item.
    const shared = await product(t.admin, { price: '10.00', costPrice: '4.00', stock: 0 });
    assert.equal(shared.branch || '', '');
    const s = await supplier(t.admin);
    const results = await Promise.all([A, B].map((branch) => t.branch[branch].manager.post('/api/purchases', {
      supplierId: s._id, lines: [{ productId: shared._id, quantity: 2, unitCost: '4.00' }],
    })));
    const ok = results.filter((r) => r.status === 201);
    assert.ok(ok.length >= 1, JSON.stringify(results.map((r) => [r.status, r.body?.code])));
    const owner = (await stored(shared._id)).branch;
    assert.ok([A, B].includes(owner));
    const moves = await movementsOf(t.businessId, shared._id);
    assert.ok(moves.every((m) => m.branch === owner), 'all stock booked to the single owner');
    assert.equal((await stored(shared._id)).stock, 2 * ok.length);
    for (const r of results.filter((x) => x.status !== 201)) assert.ok(['BRANCH_MISMATCH', 'STOCK_CHANGED', 'BRANCH_OWNERSHIP_MISMATCH'].includes(r.body?.code), JSON.stringify(r.body));
    await assertReconciled(t.admin, 'claim race');
  });

  /* ---------------------------------------------------- B. purchases */

  it('B: purchases are tenant- and branch-scoped on every endpoint; goods land in the owning branch', async () => {
    const t = await harness.tenant({ branches: [A, B] });
    const other = await harness.tenant({ branches: [A] });
    const mb = t.branch[B].manager;
    const s = await supplier(mb);
    const item = await product(mb, { price: '30.00', costPrice: '10.00', stock: 0, branch: B });
    const p = await mustOk(await mb.post('/api/purchases', {
      supplierId: s._id, lines: [{ productId: item._id, quantity: 5, unitCost: '10.00' }],
      businessId: other.businessId, branch: B, // client tenancy is never trusted
    }), 'purchase B');
    const doc = await Purchase.findById(p._id).lean();
    assert.equal(doc.businessId, t.businessId);
    assert.equal(doc.branch, B);
    const snapshot = JSON.stringify(doc);

    // Another branch's manager (same business) and another business's admin: ID probing = 404 everywhere.
    for (const [label, api] of [['manager A', t.branch[A].manager], ['foreign admin', other.admin]]) {
      expectError(await api.get(`/api/purchases/${p._id}`), 404, 'PURCHASE_NOT_FOUND', `${label} GET`);
      expectError(await api.post(`/api/purchases/${p._id}/payments`, { method: 'nakit', amount: '1.00' }), 404, 'PURCHASE_NOT_FOUND', `${label} pay`);
      expectError(await api.post(`/api/purchases/${p._id}/returns`, { reason: 'x', lines: [{ lineId: 1, quantity: 1 }] }), 404, 'PURCHASE_NOT_FOUND', `${label} return`);
      expectError(await api.post(`/api/purchases/${p._id}/refunds`, { method: 'nakit', amount: '1.00' }), 404, 'PURCHASE_NOT_FOUND', `${label} refund`);
      expectError(await api.del(`/api/purchases/${p._id}`), 404, 'PURCHASE_NOT_FOUND', `${label} cancel`);
      const list = await api.get('/api/purchases');
      assert.equal(list.status, 200);
      assert.ok(!list.body.some((x) => x._id === p._id), `${label} list leaks the purchase`);
    }
    // ?branch= is ignored for non-admins.
    const probe = await mustOk(await t.branch[A].manager.get(`/api/purchases?branch=${encodeURIComponent(B)}`), 'branch query');
    assert.ok(!probe.some((x) => x._id === p._id));
    assert.equal(JSON.stringify(await Purchase.findById(p._id).lean()), snapshot, 'refused requests changed nothing');
    assert.equal((await stored(item._id)).stock, 5);

    // Purchasing another branch's product.
    expectError(await t.branch[A].manager.post('/api/purchases', { supplierId: s._id, lines: [{ productId: item._id, quantity: 1, unitCost: '10.00' }] }), 403, 'BRANCH_MISMATCH', 'manager A buys into B');
    expectError(await t.branch[A].manager.post('/api/purchases', { supplierId: s._id, branch: B, lines: [{ productId: item._id, quantity: 1, unitCost: '10.00' }] }), 403, 'BRANCH_MISMATCH', 'manager A names B');
    expectError(await t.admin.post('/api/purchases', { supplierId: s._id, lines: [{ productId: item._id, quantity: 1, unitCost: '10.00' }] }), 409, 'CROSS_BRANCH_CONFIRMATION_REQUIRED', 'admin implicit');
    const adminPurchase = await mustOk(await t.admin.post('/api/purchases', {
      supplierId: s._id, branch: B, lines: [{ productId: item._id, quantity: 2, unitCost: '13.00' }, { metal: 'XAU', karat: 22, weightGrams: '1.000', totalCost: '100.00' }],
    }), 'admin explicit purchase for B');
    assert.equal((await Purchase.findById(adminPurchase._id).lean()).branch, B);
    const purchaseMoves = await StockMovement.find({ businessId: t.businessId, 'reference.kind': 'Purchase', 'reference.id': String(adminPurchase._id) }).lean();
    assert.ok(purchaseMoves.every((m) => m.branch === B), JSON.stringify(purchaseMoves.map((m) => m.branch)));

    // The admin pays B's purchases from B's accounts (consistent with its returns / refunds).
    await mustOk(await t.admin.post(`/api/purchases/${p._id}/payments`, { method: 'nakit', amount: '50.00' }), 'admin pays');
    const bal = await accountBalances(t.admin);
    assert.equal(bal(`inventory:${B}`), 50 + 26 + 100);
    assert.equal(bal(`inventory:${A}`), 0);
    assert.equal(bal(`cash:${B}`), -50);
    assert.equal(bal(`cash:${A}`), 0);
    // The owner branch can still read and cancel its own purchase.
    await mustOk(await mb.get(`/api/purchases/${adminPurchase._id}`), 'manager B reads');
    await mustOk(await mb.del(`/api/purchases/${adminPurchase._id}`), 'manager B cancels');
    await assertReconciled(t.admin, 'purchases');
  });

  /* ------------------------------------------- catalogue / ledger / closing */

  it('catalogue, ledger, valuation and day closing do not trust client branch fields and do not leak other branches', async () => {
    const t = await harness.tenant({ branches: [A, B] });
    const ma = t.branch[A].manager;
    expectError(await ma.post('/api/products', { name: `X ${uid()}`, price: '1.00', costPrice: '1.00', stock: 3, branch: B }), 403, 'BRANCH_MISMATCH', 'manager creates stock in B');
    expectError(await t.admin.post('/api/products', { name: `X ${uid()}`, price: '1.00', stock: 1, costPrice: '1.00', branch: 'Uydurma Şube' }), 400, 'UNKNOWN_BRANCH');
    const claimed = await product(ma, { price: '1.00', costPrice: '2.00', stock: 3 });
    assert.equal(claimed.branch, A, 'opening stock without a branch belongs to the creator\'s branch');
    const atB = await product(t.branch[B].manager, { price: '1.00', costPrice: '7.00', stock: 4, branch: B });
    expectError(await ma.put(`/api/products/${atB._id}`, { stock: 0 }), 403, 'BRANCH_MISMATCH', 'adjust B stock');
    const empty = await product(ma, { price: '1.00', stock: 0, branch: A });
    expectError(await ma.put(`/api/products/${empty._id}`, { branch: B }), 403, 'BRANCH_MISMATCH', 'give product to B');
    await mustOk(await ma.put(`/api/products/${claimed._id}`, { reservedStock: 3, name: `Yeni ad ${uid()}` }), 'reservedStock in body is ignored');
    assert.equal((await stored(claimed._id)).reservedStock || 0, 0);

    // Product movement history: own branch only.
    const history = await ma.get(`/api/products/${atB._id}/movements`);
    assert.equal(history.status, 200);
    assert.equal(history.body.length, 0, 'manager A must not see B\'s movements');
    assert.equal((await t.admin.get(`/api/products/${atB._id}/movements`)).body.length, 1);

    // Archive: a staff member granted catalog:delete cannot archive another branch's product.
    const deleter = await t.user({ role: 'staff', branch: A, customPermissions: ['catalog:delete'] });
    expectError(await deleter.api.del(`/api/products/${atB._id}`), 404, undefined, 'archive B product');
    assert.notEqual((await stored(atB._id)).isArchived, true);

    // Ledger: B's tills and stock accounts / entries are not visible to A's manager.
    const accounts = (await ma.get('/api/ledger/accounts')).body.map((a) => a.account);
    assert.ok(accounts.includes(`inventory:${A}`));
    assert.ok(!accounts.some((a) => a.includes(B)), JSON.stringify(accounts));
    const entries = (await ma.get('/api/ledger/entries?limit=500')).body;
    assert.ok(entries.length > 0 && entries.every((e) => e.branch === A));
    assert.ok((await t.admin.get('/api/ledger/accounts')).body.some((a) => a.account === `inventory:${B}`));

    // Valuation: per branch for non-admins; admins whole business or ?branch=.
    assert.equal((await ma.get('/api/inventory/valuation')).body.products.costValueTry, 6, 'A only: 3 × 2.00');
    assert.equal((await ma.get(`/api/inventory/valuation?branch=${encodeURIComponent(B)}`)).body.products.costValueTry, 6, 'branch query ignored for non-admins');
    assert.equal((await t.admin.get('/api/inventory/valuation')).body.products.costValueTry, 34);
    assert.equal((await t.admin.get(`/api/inventory/valuation?branch=${encodeURIComponent(B)}`)).body.products.costValueTry, 28);

    // Day closing: an admin's branch must exist (no closing / cash difference for a typo).
    expectError(await t.admin.post('/api/cash/daily-closing', { branch: 'Kapalı Şube', closingCashActual: '10.00' }), 400, 'UNKNOWN_BRANCH');
    await assertReconciled(t.admin, 'catalogue');
  });

  /* --------------------------------------------- C. legacy stock migration */

  it('C: legacy stock is opened in its owning branch; ambiguous stock is never defaulted and stays frozen until explicitly resolved', async () => {
    const t = await harness.tenant({ branches: [A, B] });
    const biz = t.businessId;
    const own = id6();
    const ambiguous = id6();
    // Pre-ledger records: no movements, float cost.
    await Product.collection.insertMany([
      { _id: own, businessId: biz, name: 'Eski B ürünü', stock: 4, costPrice: 12.5, price: 30, branch: B },
      { _id: ambiguous, businessId: biz, name: 'Eski ortak ürün', stock: 3, costPrice: 10, price: 25, branch: '' },
    ]);
    const movementsBefore = await StockMovement.countDocuments({ businessId: biz });
    const plan = await planFinancialMigration({ businessId: biz });
    assert.equal(await StockMovement.countDocuments({ businessId: biz }), movementsBefore, 'dry run writes nothing');
    assert.deepEqual(Object.keys(plan.products.openingByBranch), [B], 'only the resolvable product is planned — in ITS branch');
    assert.equal(plan.products.openingByBranch[B].valueTry, 50);
    assert.equal(plan.products.ownership.ambiguous, 1);
    assert.ok(plan.issues.some((i) => i.type === 'stock_ownership_ambiguous' && i.samples.some((x) => x.productId === ambiguous)));

    const report = await migrateFinancialData({ logger: silent });
    assert.ok(report.products.ambiguous >= 1);
    const ownMoves = await movementsOf(biz, own);
    assert.deepEqual(ownMoves.map((m) => [m.branch, m.movementType, m.quantity, m.costMinor]), [[B, 'opening_migration', 4, 5000]]);
    assert.equal(await StockMovement.countDocuments({ businessId: biz, productId: ambiguous }), 0, 'ambiguous stock is not opened anywhere');
    assert.equal(await ledger.balanceOf(biz, `inventory:${B}`, 'TRY'), 5000n);
    assert.equal(await ledger.balanceOf(biz, `inventory:${DEFAULT_BRANCH}`, 'TRY'), 0n);
    assert.equal(await ledger.balanceOf(biz, `inventory:${A}`, 'TRY'), 0n);

    // Frozen: neither branch can sell or relabel it; reconciliation flags it.
    const c = await customer(t.branch[A].staff);
    expectError(await t.branch[A].staff.post('/api/sales', { customerId: c._id, lines: [{ productId: ambiguous, quantity: 1 }], payments: [] }), 409, 'STOCK_OWNERSHIP_UNRESOLVED');
    expectError(await t.admin.put(`/api/products/${ambiguous}`, { branch: A }), 409, 'STOCK_OWNERSHIP_UNRESOLVED');
    assert.equal((await stored(ambiguous)).stock, 3);
    const flagged = await inventory.reconcile(biz);
    assert.ok(flagged.discrepancies.some((d) => d.check === 'unresolved_ownership' && d.productId === ambiguous));

    // Operator: dry run shows evidence; an invalid resolution is rejected; a valid one is applied exactly.
    const dry = await resolveOwnership({ business: biz, resolutions: { [biz]: { [ambiguous]: 'Yok Şube' } } });
    assert.equal(dry.mode, 'dry-run');
    assert.deepEqual(dry.businesses[0].invalidResolutions.map((r) => r.productId), [ambiguous]);
    const applied = await resolveOwnership({ apply: true, business: biz, resolutions: { [biz]: { [ambiguous]: A } } });
    assert.deepEqual(applied.applied.map((x) => [x.productId, x.owner, x.basis]), [[ambiguous, A, 'explicit']]);
    assert.ok(applied.verification.every((v) => v.ok), JSON.stringify(applied.verification));
    const resolved = await stored(ambiguous);
    assert.equal(resolved.branch, A);
    assert.equal(resolved.stock, 3, 'quantity preserved');
    assert.equal(resolved.costPoolMinor, 3000, 'cost preserved (3 × 10.00)');
    assert.equal(await ledger.balanceOf(biz, `inventory:${A}`, 'TRY'), 3000n);
    // Re-running is a no-op.
    const entries = await LedgerEntry.countDocuments({ businessId: biz });
    const again = await resolveOwnership({ apply: true, business: biz, resolutions: { [biz]: { [ambiguous]: A } } });
    assert.equal(again.applied.length, 0);
    assert.equal(await LedgerEntry.countDocuments({ businessId: biz }), entries);
    // Now sellable by its owner only.
    expectError(await t.branch[B].staff.post('/api/sales', { customerId: c._id, lines: [{ productId: ambiguous, quantity: 1 }], payments: [] }), 403, 'BRANCH_MISMATCH');
    await mustOk(await t.branch[A].staff.post('/api/sales', { customerId: c._id, lines: [{ productId: ambiguous, quantity: 1 }], payments: [] }), 'sale after resolution');
    await assertReconciled(t.admin, 'after resolution');
  });

  it('C: a single-branch business resolves to its real branch (not the default); mis-booked history is detected and repaired exactly', async () => {
    // Single branch named something other than the default.
    const solo = await harness.tenant({ branches: ['Tek Şube'] });
    const legacy = id6();
    await Product.collection.insertOne({ _id: legacy, businessId: solo.businessId, name: 'Tek şube eski', stock: 2, costPrice: 40, price: 80, branch: '' });
    await migrateFinancialData({ logger: silent });
    const soloProduct = await stored(legacy);
    assert.equal(soloProduct.branch, 'Tek Şube');
    assert.deepEqual((await movementsOf(solo.businessId, legacy)).map((m) => m.branch), ['Tek Şube']);
    assert.equal(await ledger.balanceOf(solo.businessId, `inventory:${DEFAULT_BRANCH}`, 'TRY'), 0n);

    // What the earlier migration did: a B product opened in the DEFAULT branch.
    const t = await harness.tenant({ branches: [A, B] });
    const biz = t.businessId;
    const misbooked = id6();
    await Product.collection.insertOne({ _id: misbooked, businessId: biz, name: 'Yanlış şubede açılmış', stock: 4, costPrice: 50, costPoolMinor: 20000, price: 90, branch: B });
    await ledger.prepareAccounts(biz, [{ account: `inventory:${DEFAULT_BRANCH}`, unit: 'TRY' }, { account: 'equity:opening', unit: 'TRY' }]);
    await runInTransaction(async (session) => {
      await StockMovement.create([{
        businessId: biz, branch: DEFAULT_BRANCH, itemType: 'product', productId: misbooked, movementType: 'opening_migration',
        quantity: 4, costMinor: 20000, balanceAfter: 4, reference: { kind: 'Product', id: String(misbooked) }, externalKey: `opening:${misbooked}`,
      }], { session });
      await ledger.postEntry(session, systemContext({ businessId: biz }), {
        entryType: 'opening_migration', externalKey: `inventory-opening:${misbooked}`, branch: DEFAULT_BRANCH,
        lines: [ledger.debit(`inventory:${DEFAULT_BRANCH}`, 'TRY', 20000n), ledger.credit('equity:opening', 'TRY', 20000n)],
      });
    });
    // The branch then sold one unit (booked correctly to B by the current code).
    const c = await customer(t.branch[B].staff);
    await mustOk(await t.branch[B].staff.post('/api/sales', { customerId: c._id, lines: [{ productId: misbooked, quantity: 1 }], payments: [] }), 'sale');

    const broken = await inventory.reconcile(biz);
    const checks = broken.discrepancies.map((d) => d.check);
    assert.ok(checks.includes('foreign_branch_stock'), JSON.stringify(broken.discrepancies));

    // Start-up never re-books existing postings on its own.
    const entriesBefore = await LedgerEntry.countDocuments({ businessId: biz });
    await migrateFinancialData({ logger: silent });
    assert.equal(await LedgerEntry.countDocuments({ businessId: biz }), entriesBefore);
    const plan = await stockOwnership.planStockOwnership({ businessId: biz });
    const row = plan.businesses[0].products.find((p) => p.productId === misbooked);
    assert.equal(row.status, 'needs_reclass');
    assert.deepEqual(row.foreign.map((f) => [f.branch, f.quantity, f.costMinor]), [[DEFAULT_BRANCH, 4, 20000]]);

    const repaired = await resolveOwnership({ apply: true, business: biz });
    assert.ok(repaired.verification.every((v) => v.ok), JSON.stringify(repaired.verification));
    // 4 × 50.00 opening, 1 sold at 50.00 → 150.00 in B; nothing left in the default branch.
    assert.equal(await ledger.balanceOf(biz, `inventory:${B}`, 'TRY'), 15000n);
    assert.equal(await ledger.balanceOf(biz, `inventory:${DEFAULT_BRANCH}`, 'TRY'), 0n);
    const p = await stored(misbooked);
    assert.equal(p.stock, 3);
    assert.equal(p.costPoolMinor, 15000);
    assert.equal(await LedgerEntry.countDocuments({ businessId: biz, entryType: 'inventory_ownership_reclass' }), 1);
    const again = await resolveOwnership({ apply: true, business: biz });
    assert.equal(again.applied.length, 0, 'idempotent');
    await assertReconciled(t.admin, 'after repair');
  });
});
