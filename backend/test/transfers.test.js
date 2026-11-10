/**
 * Inter-branch transfers — real MongoDB replica set, real HTTP.
 *
 * Expected figures are hand-computed in comments. After each workflow the
 * books are reconciled (journal, projections, stock == movements, goods in
 * transit == open transfers, reservations == approved transfers).
 */
const { inspect } = require('../testSupport/tenantInspection');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'transfer-tests-secret-with-more-than-thirty-two-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const Product = inspect(require('../models/Product'));
const StockMovement = inspect(require('../models/StockMovement'));
const StockTransfer = inspect(require('../models/StockTransfer'));
const MetalStock = inspect(require('../models/MetalStock'));
const { signToken } = require('../middleware/auth');
const { hashPassword } = require('../utils/passwords');
const {
  createHarness, mustOk, expectError, accountBalances, assertReconciled, uid,
} = require('../testSupport/financeHarness');

const A = 'Merkez';
const B = 'Nişantaşı';
const harness = createHarness({ app, signToken, User, hashPassword });

const product = (api, body) => api.post('/api/products', { name: `Ürün ${uid()}`, ...body }).then((r) => mustOk(r, 'product'));
const stock = async (id) => (await Product.findById(id).lean());

async function approvedTransfer(t, lines, { destination = B } = {}) {
  const draft = await mustOk(await t.branch[A].manager.post('/api/transfers', { destinationBranch: destination, lines }), 'create');
  await mustOk(await t.branch[A].manager2.post(`/api/transfers/${draft._id}/approve`, {}), 'approve');
  return draft;
}

describe('Inter-branch transfers (real MongoDB, HTTP)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  before(async () => {
    await mongoose.connect(uri);
    await Promise.all([User, Product, StockMovement, StockTransfer, MetalStock].map((M) => M.init()));
    await harness.start();
  });
  after(async () => {
    await harness.stop();
    await mongoose.disconnect();
  });

  it('full lifecycle: draft → approved (reserved) → in transit → partially received → shortfall written off; costs conserved', async () => {
    const t = await harness.tenant({ branches: [A, B] });
    const ma = t.branch[A].manager;
    // 10 rings at 600.00 → pool 6000.00
    const ring = await product(ma, { price: '1000.00', costPrice: '600.00', stock: 10, branch: A, barcode: `BC-${uid()}` });

    const draft = await mustOk(await ma.post('/api/transfers', { destinationBranch: B, lines: [{ productId: ring._id, quantity: 7 }] }), 'create');
    assert.equal(draft.status, 'draft');
    assert.equal((await stock(ring._id)).reservedStock || 0, 0, 'a draft reserves nothing');

    expectError(await ma.post(`/api/transfers/${draft._id}/approve`, {}), 403, 'SELF_APPROVAL_FORBIDDEN', 'own draft');
    expectError(await t.branch[B].manager.post(`/api/transfers/${draft._id}/approve`, {}), 403, 'BRANCH_MISMATCH', 'destination cannot approve');
    const approved = await mustOk(await t.branch[A].manager2.post(`/api/transfers/${draft._id}/approve`, {}), 'approve');
    assert.equal(approved.status, 'approved');
    assert.equal((await stock(ring._id)).reservedStock, 7);

    // Reserved units cannot be sold: only 3 are free.
    const customer = await mustOk(await t.branch[A].staff.post('/api/customers', { name: `Müşteri ${uid()}` }), 'customer');
    expectError(await t.branch[A].staff.post('/api/sales', { customerId: customer._id, lines: [{ productId: ring._id, quantity: 4 }], payments: [] }), 409, 'INSUFFICIENT_STOCK', 'sell reserved');
    await mustOk(await t.branch[A].staff.post('/api/sales', { customerId: customer._id, lines: [{ productId: ring._id, quantity: 3 }], payments: [] }), 'sell free units');
    // Non-sale outflows are guarded by the stock engine itself (sales also check
    // up front): a count adjustment cannot take a reserved unit either.
    expectError(await t.admin.put(`/api/products/${ring._id}`, { stock: 6, adjustmentReason: 'sayım' }), 409, 'INSUFFICIENT_STOCK', 'adjust reserved');
    assert.equal((await stock(ring._id)).stock, 7, 'nothing moved');

    expectError(await t.branch[B].staff.post(`/api/transfers/${draft._id}/receive`, { lines: [{ lineId: 1, quantity: 1 }] }), 409, 'INVALID_TRANSFER_STATE', 'receive before dispatch');

    const dispatched = await mustOk(await ma.post(`/api/transfers/${draft._id}/dispatch`, {}, { 'Idempotency-Key': `dispatch-${uid()}` }), 'dispatch');
    assert.equal(dispatched.status, 'in_transit');
    // 7 of 7 remaining units: pool 6000 − 3 × 600 (sold) = 4200 → all 4200 into transit
    assert.equal(dispatched.lines[0].dispatched.cost, 4200);
    const afterDispatch = await stock(ring._id);
    assert.equal(afterDispatch.stock, 0);
    assert.equal(afterDispatch.reservedStock, 0);
    let bal = await accountBalances(t.admin);
    assert.equal(bal('inventory_transit'), 4200);
    assert.equal(bal(`inventory:${A}`), 0, '6000 opening − 1800 COGS − 4200 transit');

    expectError(await ma.post(`/api/transfers/${draft._id}/dispatch`, {}), 409, 'INVALID_TRANSFER_STATE', 'duplicate dispatch');
    expectError(await ma.post(`/api/transfers/${draft._id}/cancel`, { reason: 'vazgeçtik' }), 409, 'TRANSFER_ALREADY_DISPATCHED');
    expectError(await t.branch[A].staff.post(`/api/transfers/${draft._id}/receive`, { lines: [{ lineId: 1, quantity: 1 }] }), 403, 'BRANCH_MISMATCH', 'source cannot receive');

    // Partial receipt: 4 of 7 → cost 4200 × 4/7 = 2400
    const partial = await mustOk(await t.branch[B].staff.post(`/api/transfers/${draft._id}/receive`, { lines: [{ lineId: 1, quantity: 4 }] }, { 'Idempotency-Key': `recv-${uid()}` }), 'receive 4');
    assert.equal(partial.status, 'partially_received');
    assert.equal(partial.lines[0].received.quantity, 4);
    assert.equal(partial.lines[0].received.cost, 2400);
    assert.equal(partial.lines[0].outstanding.quantity, 3);
    const copyId = partial.lines[0].destinationProductId;
    const copy = await stock(copyId);
    assert.equal(copy.branch, B);
    assert.equal(copy.stock, 4);
    assert.equal(copy.costPoolMinor, 240000);
    assert.equal(copy.transferOriginId, ring._id);
    assert.equal(copy.barcode, undefined, 'barcodes are unique per business and are not copied');
    expectError(await t.branch[B].staff.post(`/api/transfers/${draft._id}/receive`, { lines: [{ lineId: 1, quantity: 4 }] }), 409, 'EXCEEDS_OUTSTANDING', 'over-receipt');

    // 1 more received, 2 lost in transit (written off) → 4200 × 5/7 = 3000; remaining 1200
    await mustOk(await t.branch[B].staff.post(`/api/transfers/${draft._id}/receive`, { lines: [{ lineId: 1, quantity: 1 }] }), 'receive 1');
    expectError(await t.branch[B].staff.post(`/api/transfers/${draft._id}/resolve`, { resolution: 'write_off', reason: 'kayıp' }), 403, 'FORBIDDEN', 'staff cannot write off');
    expectError(await t.branch[B].manager.post(`/api/transfers/${draft._id}/resolve`, { resolution: 'write_off' }), 400, 'REASON_REQUIRED');
    const closed = await mustOk(await t.branch[B].manager.post(`/api/transfers/${draft._id}/resolve`, { resolution: 'write_off', reason: 'Kargoda kayıp, tutanak 12' }), 'write off');
    assert.equal(closed.status, 'received');
    assert.equal(closed.lines[0].writtenOff.quantity, 2);
    assert.equal(closed.lines[0].writtenOff.cost, 1200);
    assert.equal(closed.lines[0].outstanding.quantity, 0);

    bal = await accountBalances(t.admin);
    assert.equal(bal('inventory_transit'), 0, 'transit fully cleared');
    assert.equal(bal(`inventory:${B}`), 3000);
    assert.equal(bal('expense:transfer_loss'), 1200);
    assert.equal((await stock(copyId)).stock, 5);

    const detail = await mustOk(await t.admin.get(`/api/transfers/${draft._id}`), 'detail');
    assert.deepEqual(detail.events.map((e) => e.action), ['created', 'approved', 'dispatched', 'received', 'received', 'written_off']);
    assert.deepEqual(detail.journal.map((e) => e.entryType), ['transfer_dispatch', 'transfer_receipt', 'transfer_receipt', 'transfer_loss']);
    const movements = await StockMovement.find({ businessId: t.businessId, 'reference.kind': 'StockTransfer' }).lean();
    assert.deepEqual(movements.map((m) => m.movementType).sort(), ['transfer_in', 'transfer_in', 'transfer_out']);
    await assertReconciled(t.admin, 'after transfer lifecycle');
  });

  it('shortfall returned to source restores stock at its cost; a transfer back lands in the original product', async () => {
    const t = await harness.tenant({ branches: [A, B] });
    // 3 units at 100.00 → pool 300.00
    const item = await product(t.branch[A].manager, { price: '500.00', costPrice: '100.00', stock: 3, branch: A });
    const tr = await approvedTransfer(t, [{ productId: item._id, quantity: 3 }]);
    await mustOk(await t.branch[A].manager.post(`/api/transfers/${tr._id}/dispatch`, {}), 'dispatch');
    await mustOk(await t.branch[B].staff.post(`/api/transfers/${tr._id}/receive`, { lines: [{ lineId: 1, quantity: 2 }] }), 'receive 2');
    const back = await mustOk(await t.branch[A].manager.post(`/api/transfers/${tr._id}/resolve`, { resolution: 'return_to_source', reason: 'Yanlış ürün, geri gönderildi' }), 'return');
    assert.equal(back.status, 'received');
    assert.equal(back.lines[0].returned.quantity, 1);
    assert.equal(back.lines[0].returned.cost, 100);
    const source = await stock(item._id);
    assert.equal(source.stock, 1);
    assert.equal(source.costPoolMinor, 10000);

    // Transfer the 2 units at B back to A: they must land in the ORIGINAL product.
    const copyId = back.lines[0].destinationProductId;
    const draftBack = await mustOk(await t.branch[B].manager.post('/api/transfers', { destinationBranch: A, lines: [{ productId: copyId, quantity: 2 }] }), 'create back');
    await mustOk(await t.branch[B].manager2.post(`/api/transfers/${draftBack._id}/approve`, {}), 'approve back');
    await mustOk(await t.branch[B].manager.post(`/api/transfers/${draftBack._id}/dispatch`, {}), 'dispatch back');
    const recvBack = await mustOk(await t.branch[A].staff.post(`/api/transfers/${draftBack._id}/receive`, { lines: [{ lineId: 1 }] }), 'receive back');
    assert.equal(recvBack.lines[0].destinationProductId, item._id);
    assert.equal((await stock(item._id)).stock, 3);
    assert.equal((await stock(item._id)).costPoolMinor, 30000);
    const bal = await accountBalances(t.admin);
    assert.equal(bal(`inventory:${A}`), 300);
    assert.equal(bal(`inventory:${B}`), 0);
    await assertReconciled(t.admin, 'after return and transfer back');
  });

  it('metal pool transfer keeps purity, fine content and weighted-average cost', async () => {
    const t = await harness.tenant({ branches: [A, B] });
    const ma = t.branch[A].manager;
    const s = await mustOk(await ma.post('/api/suppliers', { name: `Tedarikçi ${uid()}` }), 'supplier');
    // 100.000 g of 22 ayar (916) for 500000.00 → fine 91.600 g
    await mustOk(await ma.post('/api/purchases', { supplierId: s._id, lines: [{ metal: 'XAU', karat: 22, weightGrams: '100.000', totalCost: '500000.00' }] }), 'purchase');
    const tr = await approvedTransfer(t, [{ metal: 'XAU', karat: 22, weightGrams: '40.000' }]);
    const pool = await MetalStock.findById(MetalStock.idFor(t.businessId, A, 'XAU', 9160)).lean();
    assert.equal(pool.reservedWeightMg, 40000);
    assert.equal(pool.reservedFineMg, 36640, '40 g × 0.916');

    const sent = await mustOk(await ma.post(`/api/transfers/${tr._id}/dispatch`, {}), 'dispatch');
    // cost by fine content: 500000.00 × 36.640 / 91.600 = 200000.00
    assert.equal(sent.lines[0].dispatched.cost, 200000);
    // receive 25.000 g first: fine 36.640 × 25/40 = 22.900, cost 200000 × 25/40 = 125000
    const r1 = await mustOk(await t.branch[B].staff.post(`/api/transfers/${tr._id}/receive`, { lines: [{ lineId: 1, weightGrams: '25.000' }] }), 'receive 25 g');
    assert.equal(r1.lines[0].received.fineGrams, 22.9);
    assert.equal(r1.lines[0].received.cost, 125000);
    await mustOk(await t.branch[B].staff.post(`/api/transfers/${tr._id}/receive`, { lines: [{ lineId: 1 }] }), 'receive rest');
    const destPool = await MetalStock.findById(MetalStock.idFor(t.businessId, B, 'XAU', 9160)).lean();
    assert.equal(destPool.weightMg, 40000);
    assert.equal(destPool.fineMg, 36640);
    assert.equal(destPool.costPoolMinor, 20000000);
    const srcPool = await MetalStock.findById(MetalStock.idFor(t.businessId, A, 'XAU', 9160)).lean();
    assert.equal(srcPool.weightMg, 60000);
    assert.equal(srcPool.costPoolMinor, 30000000);
    assert.equal(srcPool.reservedWeightMg, 0);
    await assertReconciled(t.admin, 'after metal transfer');
  });

  it('cancelling an approved transfer releases the reservation; rejected drafts change nothing', async () => {
    const t = await harness.tenant({ branches: [A, B] });
    const item = await product(t.branch[A].manager, { price: '10.00', costPrice: '5.00', stock: 4, branch: A });
    const tr = await approvedTransfer(t, [{ productId: item._id, quantity: 4 }]);
    assert.equal((await stock(item._id)).reservedStock, 4);
    expectError(await t.branch[A].manager.post(`/api/transfers/${tr._id}/cancel`, {}), 400, 'REASON_REQUIRED');
    const cancelled = await mustOk(await t.branch[A].manager.post(`/api/transfers/${tr._id}/cancel`, { reason: 'Talep geri çekildi' }), 'cancel');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await stock(item._id)).reservedStock, 0);
    assert.equal((await stock(item._id)).stock, 4);
    expectError(await t.branch[A].manager.post(`/api/transfers/${tr._id}/approve`, {}), 409, 'INVALID_TRANSFER_STATE', 'approve cancelled');

    const draft = await mustOk(await t.branch[A].manager.post('/api/transfers', { destinationBranch: B, lines: [{ productId: item._id, quantity: 1 }] }), 'draft');
    expectError(await t.branch[A].manager2.post(`/api/transfers/${draft._id}/reject`, {}), 400, 'REASON_REQUIRED');
    const rejected = await mustOk(await t.branch[A].manager2.post(`/api/transfers/${draft._id}/reject`, { reason: 'Gerek yok' }), 'reject');
    assert.equal(rejected.status, 'rejected');
    assert.equal(await StockMovement.countDocuments({ businessId: t.businessId, 'reference.kind': 'StockTransfer' }), 0);
    await assertReconciled(t.admin, 'after cancel / reject');
  });

  it('validation: unknown / same / foreign branches, shared products, wrong source, stock, incompatible targets, branch relabel', async () => {
    const t = await harness.tenant({ branches: [A, B] });
    const other = await harness.tenant({ branches: [A, 'Başka İşletme Şubesi'] });
    const ma = t.branch[A].manager;
    const item = await product(ma, { price: '10.00', costPrice: '5.00', stock: 2, branch: A });
    // A shared catalogue item (no branch) cannot hold stock any more: opening
    // stock claims the creator's branch. Only stock-less items stay shared.
    const claimed = await product(ma, { price: '10.00', costPrice: '5.00', stock: 2 });
    assert.equal(claimed.branch, A, 'opening stock without a branch belongs to the creator\'s branch');
    const shared = await product(ma, { price: '10.00', costPrice: '5.00', stock: 0 });
    assert.equal(shared.branch || '', '');
    const atB = await product(t.branch[B].manager, { price: '10.00', costPrice: '5.00', stock: 2, branch: B });
    const gram = await product(t.branch[B].manager, { pricingMode: 'gram', metal: 'XAU', karat: 22, weight: '5.000', costPrice: '1.00', stock: 0, branch: B });

    expectError(await ma.post('/api/transfers', { destinationBranch: 'Yok Şube', lines: [{ productId: item._id, quantity: 1 }] }), 400, 'UNKNOWN_BRANCH');
    expectError(await ma.post('/api/transfers', { destinationBranch: 'Başka İşletme Şubesi', lines: [{ productId: item._id, quantity: 1 }] }), 400, 'UNKNOWN_BRANCH', 'branch of another business');
    expectError(await ma.post('/api/transfers', { destinationBranch: A, lines: [{ productId: item._id, quantity: 1 }] }), 400, 'SAME_BRANCH');
    expectError(await ma.post('/api/transfers', { sourceBranch: B, destinationBranch: A, lines: [{ productId: atB._id, quantity: 1 }] }), 403, 'BRANCH_MISMATCH', 'non-admin foreign source');
    expectError(await ma.post('/api/transfers', { destinationBranch: B, lines: [{ productId: shared._id, quantity: 1 }] }), 422, 'TRANSFER_SOURCE_UNASSIGNED');
    expectError(await ma.post('/api/transfers', { destinationBranch: B, lines: [{ productId: atB._id, quantity: 1 }] }), 422, 'TRANSFER_SOURCE_MISMATCH');
    expectError(await ma.post('/api/transfers', { destinationBranch: B, lines: [{ productId: item._id, quantity: 3 }] }), 409, 'INSUFFICIENT_STOCK');
    expectError(await ma.post('/api/transfers', { destinationBranch: B, lines: [{ productId: item._id, quantity: 0 }] }), 400, 'INVALID_QUANTITY');
    expectError(await ma.post('/api/transfers', { destinationBranch: B, lines: [{ productId: item._id, quantity: 1 }, { productId: item._id, quantity: 1 }] }), 400, 'DUPLICATE_TRANSFER_LINE');
    expectError(await ma.post('/api/transfers', { destinationBranch: B, lines: [{ productId: item._id, quantity: 1, destinationProductId: gram._id }] }), 422, 'DESTINATION_PRODUCT_INCOMPATIBLE');
    expectError(await ma.post('/api/transfers', { destinationBranch: B, lines: [{ metal: 'XAU', karat: 22, weightGrams: '1.000' }] }), 409, 'INSUFFICIENT_METAL_STOCK');
    // A product of another business behaves like a missing one.
    const foreign = await product(other.branch[A].manager, { price: '10.00', costPrice: '5.00', stock: 5, branch: A });
    expectError(await ma.post('/api/transfers', { destinationBranch: B, lines: [{ productId: foreign._id, quantity: 1 }] }), 404, 'PRODUCT_NOT_FOUND');

    // Staff cannot create, approve, dispatch; staff of the destination can receive.
    expectError(await t.branch[A].staff.post('/api/transfers', { destinationBranch: B, lines: [{ productId: item._id, quantity: 1 }] }), 403, 'FORBIDDEN');

    // Relabelling the branch of a stocked product is refused (use a transfer).
    expectError(await t.admin.put(`/api/products/${item._id}`, { branch: B }), 409, 'PRODUCT_BRANCH_HAS_STOCK');
    expectError(await ma.put(`/api/products/${item._id}`, { reservedStock: 2, transferOriginId: 5 }), 400, undefined, 'protected fields are not writable');
  });

  it('isolation: other businesses and uninvolved branches cannot see or act on a transfer', async () => {
    const C = 'Bağdat Caddesi';
    const t = await harness.tenant({ branches: [A, B, C] });
    const other = await harness.tenant({ branches: [A, B] });
    const item = await product(t.branch[A].manager, { price: '10.00', costPrice: '5.00', stock: 2, branch: A });
    const tr = await approvedTransfer(t, [{ productId: item._id, quantity: 1 }]);

    expectError(await other.admin.get(`/api/transfers/${tr._id}`), 404, 'TRANSFER_NOT_FOUND', 'foreign admin');
    expectError(await other.branch[A].manager.post(`/api/transfers/${tr._id}/dispatch`, {}), 404, 'TRANSFER_NOT_FOUND', 'foreign manager');
    expectError(await t.branch[C].manager.get(`/api/transfers/${tr._id}`), 404, 'TRANSFER_NOT_FOUND', 'uninvolved branch');
    expectError(await t.branch[C].manager.post(`/api/transfers/${tr._id}/cancel`, { reason: 'x' }), 404, 'TRANSFER_NOT_FOUND');
    assert.equal((await t.branch[C].manager.get('/api/transfers')).body.length, 0);
    assert.equal((await t.branch[B].staff.get('/api/transfers?direction=incoming')).body.length, 1);
    const branches = await mustOk(await t.branch[A].staff.get('/api/transfers/branches'), 'branches');
    assert.deepEqual([...branches.branches].sort(), [A, B, C].sort());
    // admin of the business may act for any branch
    await mustOk(await t.admin.post(`/api/transfers/${tr._id}/dispatch`, {}), 'admin dispatch');
    await mustOk(await t.admin.post(`/api/transfers/${tr._id}/receive`, { lines: [{ lineId: 1 }] }), 'admin receive');
    await assertReconciled(t.admin, 'isolation');
  });

  it('concurrency: parallel dispatches execute once; parallel approvals cannot over-reserve; replayed receipts apply once', async () => {
    const t = await harness.tenant({ branches: [A, B] });
    const item = await product(t.branch[A].manager, { price: '10.00', costPrice: '5.00', stock: 5, branch: A });

    // Three drafts of 3 units each over 5 units: at most one can be approved.
    const drafts = [];
    for (let i = 0; i < 3; i += 1) {
      drafts.push(await mustOk(await t.branch[A].manager.post('/api/transfers', { destinationBranch: B, lines: [{ productId: item._id, quantity: 3 }] }), 'draft'));
    }
    const approvals = await Promise.all(drafts.map((d) => t.branch[A].manager2.post(`/api/transfers/${d._id}/approve`, {})));
    assert.equal(approvals.filter((r) => r.status === 200).length, 1, JSON.stringify(approvals.map((r) => [r.status, r.body?.code])));
    assert.ok(approvals.filter((r) => r.status !== 200).every((r) => r.body.code === 'INSUFFICIENT_STOCK'));
    assert.equal((await stock(item._id)).reservedStock, 3);
    const winner = drafts[approvals.findIndex((r) => r.status === 200)];

    const dispatches = await Promise.all([1, 2, 3, 4].map(() => t.branch[A].manager.post(`/api/transfers/${winner._id}/dispatch`, {})));
    assert.equal(dispatches.filter((r) => r.status === 200).length, 1, 'exactly one dispatch');
    assert.equal(await StockMovement.countDocuments({ businessId: t.businessId, movementType: 'transfer_out' }), 1);
    assert.equal((await stock(item._id)).stock, 2);

    const key = `recv-${uid()}`;
    const receipts = await Promise.all([1, 2, 3].map(() => t.branch[B].staff.post(`/api/transfers/${winner._id}/receive`, { lines: [{ lineId: 1, quantity: 1 }] }, { 'Idempotency-Key': key })));
    assert.ok(receipts.every((r) => r.status === 200), JSON.stringify(receipts.map((r) => [r.status, r.body?.code])));
    assert.equal(receipts.filter((r) => r.headers['idempotent-replayed'] === 'true').length, 2);
    const view = await mustOk(await t.admin.get(`/api/transfers/${winner._id}`), 'view');
    assert.equal(view.lines[0].received.quantity, 1, 'the receipt was applied exactly once');
    expectError(await t.branch[B].staff.post(`/api/transfers/${winner._id}/receive`, { lines: [{ lineId: 1, quantity: 2 }] }, { 'Idempotency-Key': key }), 422, 'IDEMPOTENCY_KEY_REUSED');
    await assertReconciled(t.admin, 'after concurrency');
  });

  it('a concurrent sale and dispatch never take the same unit twice', async () => {
    const t = await harness.tenant({ branches: [A, B] });
    const item = await product(t.branch[A].manager, { price: '10.00', costPrice: '5.00', stock: 2, branch: A });
    const tr = await approvedTransfer(t, [{ productId: item._id, quantity: 2 }]);
    const c = await mustOk(await t.branch[A].staff.post('/api/customers', { name: `M ${uid()}` }), 'customer');
    const [sale, dispatch] = await Promise.all([
      t.branch[A].staff.post('/api/sales', { customerId: c._id, lines: [{ productId: item._id, quantity: 1 }], payments: [] }),
      t.branch[A].manager.post(`/api/transfers/${tr._id}/dispatch`, {}),
    ]);
    assert.equal(sale.status, 409, 'every unit is reserved for the transfer');
    assert.equal(dispatch.status, 200);
    assert.equal((await stock(item._id)).stock, 0);
    await assertReconciled(t.admin, 'sale vs dispatch');
  });
});
