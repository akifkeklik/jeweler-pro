/**
 * System-wide acceptance — every module chained in ONE business with two
 * branches, over real HTTP against a real MongoDB replica set.
 *
 * The other suites prove each workflow in isolation (fresh tenant per test).
 * This suite proves that the workflows compose: the same customer, product
 * and branches flow through sale → collection → scrap buy-back → purchase →
 * return → transfer → card sale → settlement → refund → closing, and the
 * books are reconciled after EVERY step (journal balanced per unit, every
 * projection == journal, party balances == their accounts, stock ==
 * movements, transit == open transfers, POS sub-ledger == bank:card).
 *
 * It then attacks the boundaries from inside the business: another branch's
 * staff and managers against every financial resource, and lower roles
 * against financial controls (opening balances, credit limits, supplier
 * payments). All expected figures are hand-computed in the comments.
 */
const { inspect } = require('../testSupport/tenantInspection');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'system-acceptance-secret-with-more-than-thirty-two-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const Product = inspect(require('../models/Product'));
const Customer = inspect(require('../models/Customer'));
const LedgerEntry = inspect(require('../models/LedgerEntry'));
const { signToken } = require('../middleware/auth');
const { hashPassword } = require('../utils/passwords');
const {
  createHarness, mustOk, expectError, accountBalances, assertReconciled, uid,
} = require('../testSupport/financeHarness');

const A = 'Merkez';
const B = 'Nişantaşı';
const HAS = '6562.53';
const harness = createHarness({ app, signToken, User, hashPassword });
const key = (p) => ({ 'Idempotency-Key': `${p}-${uid()}` });
const stockOf = async (id) => (await Product.findById(id).lean()).stock;

/** Global reconciliation PLUS the XAU trial balance (gold must balance too). */
async function reconciled(api, label) {
  const body = await assertReconciled(api, label);
  assert.equal(body.ledger.trialBalance.XAU ?? 0, 0, `${label}: XAU trial balance`);
  return body;
}

describe('System acceptance — chained ERP workflows (real MongoDB, HTTP)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  /** Shared state: the scenarios are deliberately sequential. */
  const s = {};

  before(async () => {
    await mongoose.connect(uri);
    await Promise.all([User, Product, Customer, LedgerEntry].map((M) => M.init()));
    await harness.start();
    s.t = await harness.tenant({ branches: [A, B] });
    s.a = s.t.branch[A];
    s.b = s.t.branch[B];
    s.customer = await mustOk(await s.a.staff.post('/api/customers', { name: `Ortak Müşteri ${uid()}` }), 'customer');
    // cash:closing is admin-only by role; branch managers get it as a custom permission.
    s.closerA = (await s.t.user({ role: 'manager', branch: A, customPermissions: ['cash:closing'] })).api;
    s.closerB = (await s.t.user({ role: 'manager', branch: B, customPermissions: ['cash:closing'] })).api;
  });
  after(async () => {
    await harness.stop();
    await mongoose.disconnect();
  });

  it('A — retail sale: gram product, live-or-manual price, partial payment, collection, statement, stock, ledger', async () => {
    const { t, a, customer } = s;
    s.bilezik = await mustOk(await a.manager.post('/api/products', {
      name: '22 Ayar Bilezik', pricingMode: 'gram', metal: 'XAU', karat: 22, weight: '10.000',
      laborType: 'milyem', laborValue: '35', costPrice: '55000.00', stock: 3,
    }), 'gram product');
    assert.equal(s.bilezik.branch, A, 'a manager creates stock in their own branch');

    const sale = await mustOk(await a.staff.post('/api/sales', {
      customerId: customer._id, lines: [{ productId: s.bilezik._id, quantity: 1 }],
      payments: [{ method: 'nakit', amount: '20000.00' }], manualPrices: { XAU: HAS },
    }, key('sale-a')), 'sale');
    // 10 g × (0.916 + 0.035) × 6562.53 = 62409.66 ; paid 20000 → due 42409.66
    assert.equal(sale.financial.total, 62409.66);
    assert.equal(sale.financial.balanceDue, 42409.66);
    assert.equal(sale.branch, A);
    s.saleA = sale;
    await reconciled(t.admin, 'A: after sale');

    const paid = await mustOk(await a.staff.post(`/api/sales/${sale._id}/payments`, { method: 'havale', amount: '42409.66' }, key('pay-a')), 'collection');
    assert.equal(paid.financial.paymentStatus, 'paid');
    const statement = await mustOk(await a.staff.get(`/api/cash/customer/${customer._id}/ledger`), 'statement');
    assert.equal(statement.balanceTry, 0);
    assert.equal(statement.entries.length, 3, 'sale, cash part of the sale, later collection');
    assert.equal(await stockOf(s.bilezik._id), 2);

    const bal = await accountBalances(t.admin);
    assert.equal(bal('revenue:sales'), -62409.66);
    assert.equal(bal('cogs'), 55000);
    assert.equal(bal(`inventory:${A}`), 110000, '3 × 55000 − 55000');
    assert.equal(bal(`cash:${A}`), 20000);
    assert.equal(bal(`bank:${A}:transfer`), 42409.66);
    await reconciled(t.admin, 'A: after collection');
  });

  it('B — scrap gold buy-back: purity, fire deduction, fine gold, credited to account, then paid out in cash', async () => {
    const { t, a, customer } = s;
    await mustOk(await a.staff.post('/api/cash/transactions', { type: 'devir', amountTry: '100000.00' }, key('float')), 'drawer float');
    const scrap = await mustOk(await a.staff.post('/api/cash/transactions', {
      type: 'hurda_alimi', customerId: customer._id, paymentMethod: 'cari',
      weightGrams: '12.40', karat: 22, deductionMilyem: '10', manualPricePerGram: '6561.74',
    }, key('scrap')), 'scrap');
    // fine = 12.40 × 0.916 = 11.3584 g → 11358 mg ; amount = 12.40 × (0.916 − 0.010) × 6561.74 = 73717.21
    assert.equal(scrap.fineMg, 11358);
    assert.equal(scrap.amountTry, 73717.21);
    assert.equal((await Customer.findById(customer._id).lean()).balanceTry, 73717.21, 'the business owes the customer');
    await reconciled(t.admin, 'B: after scrap');

    await mustOk(await a.staff.post('/api/cash/transactions', { type: 'tediye', customerId: customer._id, amountTry: '73717.21', paymentMethod: 'nakit' }, key('payout')), 'payout');
    assert.equal((await Customer.findById(customer._id).lean()).balanceTry, 0);
    const pools = (await mustOk(await t.admin.get(`/api/inventory/metal?branch=${encodeURIComponent(A)}`), 'pools'));
    const pool = pools.find((p) => p.purity === 9160 && p.branch === A);
    assert.equal(pool.fineGrams, 11.358);
    assert.equal(pool.costTry, 73717.21);
    const bal = await accountBalances(t.admin);
    // 20000 + 100000 − 73717.21
    assert.equal(bal(`cash:${A}`), 46282.79);
    assert.equal(bal(`inventory:${A}`), 183717.21, '110000 + 73717.21');
    await reconciled(t.admin, 'B: after payout');
  });

  it('C — supplier purchasing: purchase, stock, payable, partial payment, goods return, supplier statement, valuation', async () => {
    const { t, a } = s;
    s.supplier = await mustOk(await a.manager.post('/api/suppliers', { name: `Toptancı ${uid()}` }), 'supplier');
    s.ring = await mustOk(await a.manager.post('/api/products', { name: `Gümüş Yüzük ${uid()}`, price: '1500.00', stock: 0 }), 'product');
    const purchase = await mustOk(await a.manager.post('/api/purchases', {
      supplierId: s.supplier._id, invoiceNo: `F-${uid()}`,
      lines: [{ productId: s.ring._id, quantity: 10, unitCost: '250.00' }],
      payments: [{ method: 'havale', amount: '1000.00' }],
    }, key('purchase')), 'purchase');
    // 10 × 250 = 2500 ; paid 1000 → payable 1500
    assert.equal(purchase.total, 2500);
    assert.equal(purchase.remaining, 1500);
    await mustOk(await a.manager.post(`/api/purchases/${purchase._id}/payments`, { method: 'nakit', amount: '500.00' }, key('ppay')), 'partial payment');
    await mustOk(await a.manager.post(`/api/purchases/${purchase._id}/returns`, { lines: [{ lineId: 1, quantity: 2 }], reason: 'Kusurlu taş', creditNoteNo: 'IA-7' }, key('pret')), 'return');
    s.purchase = purchase;

    // payable 1500 − 500 paid − 2 × 250 returned = 500
    const statement = await mustOk(await a.manager.get(`/api/suppliers/${s.supplier._id}/statement`), 'supplier statement');
    assert.equal(statement.balanceTry, 500);
    assert.equal((await mustOk(await a.manager.get(`/api/suppliers/${s.supplier._id}`), 'supplier')).balanceTry, 500);
    const ring = await Product.findById(s.ring._id).lean();
    assert.equal(ring.stock, 8);
    assert.equal(ring.costPoolMinor, 200000, '8 × 250.00 at weighted-average cost');

    const bal = await accountBalances(t.admin);
    assert.equal(bal(`cash:${A}`), 45782.79, '46282.79 − 500');
    assert.equal(bal(`inventory:${A}`), 185717.21, '183717.21 + 2500 − 500');
    assert.equal(bal(`ap:${s.supplier._id}`), -500);
    const valuation = await mustOk(await t.admin.get(`/api/inventory/valuation?branch=${encodeURIComponent(A)}`), 'valuation');
    assert.ok(valuation, 'valuation endpoint answers for the branch');
    await reconciled(t.admin, 'C: after purchasing');
  });

  it('D — multi-branch: allocate, approve (4-eyes), dispatch, partial receipt, discrepancy returned to source, both branches reconcile', async () => {
    const { t, a, b } = s;
    const draft = await mustOk(await a.manager.post('/api/transfers', { destinationBranch: B, lines: [{ productId: s.ring._id, quantity: 6 }] }), 'draft');
    expectError(await a.manager.post(`/api/transfers/${draft._id}/approve`, {}), 403, 'SELF_APPROVAL_FORBIDDEN');
    await mustOk(await a.manager2.post(`/api/transfers/${draft._id}/approve`, {}), 'approve');
    const dispatched = await mustOk(await a.manager.post(`/api/transfers/${draft._id}/dispatch`, {}, key('dispatch')), 'dispatch');
    assert.equal(dispatched.lines[0].dispatched.cost, 1500, '6 × 250');
    let bal = await accountBalances(t.admin);
    assert.equal(bal('inventory_transit'), 1500);
    await reconciled(t.admin, 'D: in transit');

    const partial = await mustOk(await b.staff.post(`/api/transfers/${draft._id}/receive`, { lines: [{ lineId: 1, quantity: 4 }] }, key('recv')), 'receive 4');
    assert.equal(partial.status, 'partially_received');
    s.ringB = partial.lines[0].destinationProductId;
    const back = await mustOk(await a.manager.post(`/api/transfers/${draft._id}/resolve`, { resolution: 'return_to_source', reason: 'Eksik sevk, geri alındı' }), 'resolve');
    assert.equal(back.status, 'received');

    assert.equal(await stockOf(s.ring._id), 4, '8 − 6 + 2 returned');
    const copy = await Product.findById(s.ringB).lean();
    assert.equal(copy.branch, B);
    assert.equal(copy.stock, 4);
    assert.equal(copy.costPoolMinor, 100000);
    bal = await accountBalances(t.admin);
    assert.equal(bal('inventory_transit'), 0);
    assert.equal(bal(`inventory:${B}`), 1000);
    assert.equal(bal(`inventory:${A}`), 184717.21, '185717.21 − 1000 now owned by B');

    // Each branch reconciles independently and sees only its own branch accounts.
    const ledgerB = await mustOk(await b.manager.get('/api/ledger/accounts'), 'B accounts');
    assert.ok(!ledgerB.some((x) => x.account.endsWith(`:${A}`) || x.account.includes(`:${A}:`)), 'branch B never sees branch A accounts');
    await reconciled(t.admin, 'D: after transfer');
  });

  it('E — POS: provider + installment commission, card sale, partial and final settlement, refund, accounting', async () => {
    const { t, b, customer } = s;
    s.provider = await mustOk(await t.admin.post('/api/pos/providers', {
      code: `GAR${uid().slice(0, 4).toUpperCase()}`, name: 'Garanti POS', refundCommissionPolicy: 'retained',
      rules: [{ installments: 1, ratePercent: '1.79', fixedFee: '0.25', valorDays: 0 }, { installments: 3, ratePercent: '3.50', valorDays: 30 }],
    }), 'provider');
    const sale = await mustOk(await b.staff.post('/api/sales', {
      customerId: customer._id, lines: [{ productId: s.ringB, quantity: 1 }],
      payments: [{ method: 'kredi kartı', amount: '1500.00', pos: { providerId: s.provider._id, installments: 1 } }],
    }, key('sale-b')), 'card sale in B');
    assert.equal(sale.branch, B);
    const [txn] = (await mustOk(await b.manager.get('/api/pos/transactions'), 'pos txns')).filter((x) => x.kind !== 'refund');
    // 1500 × 1.79 % = 26.85 + 0.25 = 27.10 ; net 1472.90
    assert.equal(txn.commission, 27.10);
    assert.equal(txn.net, 1472.90);
    s.posTxnB = txn;

    await mustOk(await b.manager.post('/api/pos/settlements', {
      providerId: s.provider._id, depositedAmount: '1000.00', allocations: [{ posTransactionId: txn._id, amount: '1000.00' }],
    }, key('settle1')), 'partial settlement');
    await reconciled(t.admin, 'E: after partial settlement');
    await mustOk(await b.manager.post('/api/pos/settlements', {
      providerId: s.provider._id, depositedAmount: '472.90', allocations: [{ posTransactionId: txn._id }],
    }, key('settle2')), 'final settlement');

    await mustOk(await b.manager.post(`/api/sales/${sale._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], refundMethod: 'kredi kartı', reason: 'Müşteri vazgeçti' }, key('ret-b')), 'card refund');
    const bal = await accountBalances(t.admin);
    assert.equal(bal(`bank:${B}:transfer`), 1472.90, 'settled to the bank account');
    assert.equal(bal(`bank:${B}:card`), -1500, 'the bank will claw back the refund');
    assert.equal(bal('expense:pos_commission'), 27.10, 'retained policy: commission stays');
    assert.equal(await stockOf(s.ringB), 4, 'returned unit back in B');
    assert.equal((await Customer.findById(customer._id).lean()).balanceTry, 0, 'refunded on the card, not to the account');
    await reconciled(t.admin, 'E: after refund');
  });

  it('H — branch boundary: another branch can neither read nor mutate any financial resource', async () => {
    const { t, a, b, customer } = s;
    // A card transaction in branch A to attack.
    const saleA2 = await mustOk(await a.staff.post('/api/sales', {
      customerId: customer._id, lines: [{ productId: s.ring._id, quantity: 1 }],
      payments: [{ method: 'kredi kartı', amount: '1000.00', pos: { providerId: s.provider._id } }, { method: 'nakit', amount: '200.00' }],
    }, key('sale-a2')), 'second A sale (part on account)');
    const posA = (await mustOk(await t.admin.get(`/api/pos/transactions?branch=${encodeURIComponent(A)}`), 'A txns')).find((x) => x.reference.id === String(saleA2._id));
    const before = await accountBalances(t.admin);

    for (const actor of [b.staff, b.manager]) {
      expectError(await actor.get(`/api/sales/${saleA2._id}`), 404, null, 'read A sale');
      expectError(await actor.post(`/api/sales/${saleA2._id}/payments`, { method: 'nakit', amount: '1.00' }), 404, null, 'pay A sale');
    }
    expectError(await b.manager.post(`/api/sales/${saleA2._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], refundMethod: 'nakit', reason: 'x' }), 404, null, 'return A sale');
    expectError(await b.manager.del(`/api/sales/${saleA2._id}`), 404, null, 'cancel A sale');
    expectError(await b.manager.put(`/api/sales/${saleA2._id}`, { notes: 'x' }), 404, null, 'edit A sale');
    expectError(await b.manager.get(`/api/purchases/${s.purchase._id}`), 404, null, 'read A purchase');
    expectError(await b.manager.post(`/api/purchases/${s.purchase._id}/payments`, { method: 'nakit', amount: '1.00' }), 404, null, 'pay A purchase');
    expectError(await b.manager.post(`/api/purchases/${s.purchase._id}/returns`, { lines: [{ lineId: 1, quantity: 1 }], reason: 'x' }), 404, null, 'return A purchase');
    expectError(await b.manager.del(`/api/purchases/${s.purchase._id}`), 404, null, 'cancel A purchase');
    // POS: A's card receivable cannot be settled from B, neither implicitly nor by naming A.
    expectError(await b.manager.post('/api/pos/settlements', { providerId: s.provider._id, depositedAmount: '1.00', allocations: [{ posTransactionId: posA._id, amount: '1.00' }] }), 422, 'POS_TRANSACTION_NOT_OPEN', 'settle A txn');
    expectError(await b.manager.post('/api/pos/settlements', { providerId: s.provider._id, depositedAmount: '1.00', branch: A, allocations: [{ posTransactionId: posA._id, amount: '1.00' }] }), 403, 'BRANCH_MISMATCH', 'settle as A');
    // Stock of A cannot be sold from B.
    const crossSale = await b.staff.post('/api/sales', { customerId: customer._id, lines: [{ productId: s.ring._id, quantity: 1 }], payments: [] });
    assert.ok([403, 404, 409].includes(crossSale.status), `B sells A stock: ${crossSale.status} ${JSON.stringify(crossSale.body)}`);
    // The gold till of B is its own: B cannot pay out gold it does not hold.
    expectError(await b.staff.post('/api/cash/transactions', { type: 'tediye', customerId: customer._id, amountGoldGrams: '0.001' }), 409, 'INSUFFICIENT_GOLD_TILL');
    // Closing: a non-admin naming another branch is refused, not silently redirected to their own drawer.
    expectError(await b.manager.post('/api/cash/daily-closing', { closingCashActual: '0.00' }), 403, 'FORBIDDEN', 'closing needs cash:closing');
    expectError(await s.closerB.post('/api/cash/daily-closing', { closingCashActual: '0.00', branch: A }), 403, 'BRANCH_MISMATCH', 'close A from B');
    assert.equal((await mustOk(await s.closerB.get('/api/cash/daily-summary'), 'B summary')).closing, null, 'B was not closed by mistake either');
    // The list endpoints ignore ?branch= for non-admins.
    const listed = await mustOk(await b.manager.get(`/api/sales?branch=${encodeURIComponent(A)}`), 'B sales list');
    assert.ok(listed.every((x) => x.branch === B), 'B lists only B sales');
    const vouchers = await mustOk(await b.staff.get(`/api/cash/transactions?branch=${encodeURIComponent(A)}`), 'B vouchers');
    assert.ok(vouchers.every((x) => x.branch === B));

    const afterAttack = await accountBalances(t.admin);
    for (const account of [`cash:${A}`, `bank:${A}:card`, `inventory:${A}`, `ar:${customer._id}`, `ap:${s.supplier._id}`]) {
      assert.equal(afterAttack(account), before(account), `${account} untouched by branch B`);
    }
    assert.equal(await stockOf(s.ring._id), 3, '4 − 1 sold by A; nothing taken by B');

    // Documented rule: customers are business-wide. A collection at branch B
    // settles the customer's receivable (also A's open sale) and the money
    // lands in B's drawer — never in A's.
    const due = saleA2.financial.balanceDue;
    assert.ok(due > 0);
    const collected = await mustOk(await b.staff.post('/api/cash/transactions', { type: 'tahsilat', customerId: customer._id, amountTry: String(due.toFixed(2)), paymentMethod: 'nakit' }, key('coll-b')), 'B collects');
    assert.deepEqual(collected.allocations.map((x) => x.saleId), [saleA2._id]);
    const bal = await accountBalances(t.admin);
    assert.equal(bal(`cash:${B}`), due);
    assert.equal(bal(`cash:${A}`), before(`cash:${A}`));
    await reconciled(t.admin, 'H: after boundary attack');
  });

  it('I — financial controls: lower roles cannot create opening balances, raise credit limits or pay suppliers', async () => {
    const { t, a, customer } = s;
    const before = await accountBalances(t.admin);
    // A cashier must not be able to conjure a liability to a customer out of equity (and then pay it out).
    expectError(await a.staff.post('/api/cash/transactions', { type: 'devir', customerId: customer._id, direction: 'alacak', amountTry: '50000.00' }), 403, 'FORBIDDEN', 'staff customer opening');
    expectError(await a.staff.post('/api/cash/transactions', { type: 'devir', supplierId: s.supplier._id, direction: 'borc', amountTry: '1.00' }), 403, 'FORBIDDEN', 'staff supplier opening');
    // Supplier payments require purchases:write on every path, not only /api/purchases/:id/payments.
    expectError(await a.staff.post('/api/cash/transactions', { type: 'tediye', supplierId: s.supplier._id, amountTry: '10.00', paymentMethod: 'nakit' }), 403, 'FORBIDDEN', 'staff supplier payment');
    // Credit limits are a control on staff sales: staff cannot change them.
    expectError(await a.staff.put(`/api/customers/${customer._id}`, { creditLimit: 1000000 }), 403, 'FORBIDDEN', 'staff credit limit');
    expectError(await a.staff.post('/api/customers', { name: `X ${uid()}`, creditLimit: 5000 }), 403, 'FORBIDDEN', 'staff credit limit on create');
    // Editing other fields (the UI sends the whole record back) still works.
    const stored = await mustOk(await a.staff.get(`/api/customers/${customer._id}`), 'customer');
    await mustOk(await a.staff.put(`/api/customers/${customer._id}`, { ...stored, phone: '05550000000' }), 'staff edits contact data');
    // The drawer float (cash devir) stays a cashier operation.
    await mustOk(await a.staff.post('/api/cash/transactions', { type: 'devir', amountTry: '0.01' }, key('float2')), 'staff drawer float');

    const after = await accountBalances(t.admin);
    assert.equal(after('equity:opening'), before('equity:opening') - 0.01);
    assert.equal(after(`ar:${customer._id}`), before(`ar:${customer._id}`));

    // Managers hold the control.
    await mustOk(await a.manager.put(`/api/customers/${customer._id}`, { creditLimit: 2500 }), 'manager credit limit');
    await mustOk(await a.manager.post('/api/cash/transactions', { type: 'devir', customerId: customer._id, direction: 'borc', amountTry: '10.00' }, key('open')), 'manager opening');
    // A customer with an open balance cannot be archived (the receivable would vanish from every list).
    expectError(await a.manager.del(`/api/customers/${customer._id}`), 403, 'FORBIDDEN', 'managers lack customers:delete');
    expectError(await t.admin.del(`/api/customers/${customer._id}`), 409, 'OPEN_BALANCE', 'archive with debt');
    expectError(await t.admin.del(`/api/suppliers/${s.supplier._id}`), 409, 'OPEN_BALANCE', 'archive supplier we owe');
    await reconciled(t.admin, 'I: controls');
  });

  it('F — daily closing per branch: expected cash and gold, counted, differences posted, day locked, concurrent posts rejected', async () => {
    const { t, a, b, customer } = s;
    // Gold into A's till: a gold collection of 2.000 g has.
    await mustOk(await a.staff.post('/api/cash/transactions', { type: 'tahsilat', customerId: customer._id, amountGoldGrams: '2.000' }, key('gold')), 'gold in');
    await mustOk(await a.staff.post('/api/cash/transactions', { type: 'gider', amountTry: '250.00', expenseCategory: 'Kırtasiye' }, key('exp')), 'expense');
    const summary = await mustOk(await a.manager.get('/api/cash/daily-summary'), 'summary A');
    const ledgerCash = (await accountBalances(t.admin))(`cash:${A}`);
    assert.equal(summary.calculatedCash, ledgerCash, 'expected cash == ledger');
    assert.equal(summary.calculatedGold, 2);

    // Counted: 10.00 TL short, 0.050 g has short.
    const counted = (summary.calculatedCash - 10).toFixed(2);
    const closing = await mustOk(await s.closerA.post('/api/cash/daily-closing', { closingCashActual: counted, closingGoldActual: '1.950' }), 'close A');
    assert.equal(closing.cashDifference, -10);
    assert.equal(closing.goldDifference, -0.05);
    let bal = await accountBalances(t.admin);
    assert.equal(bal(`cash:${A}`), Number(counted), 'ledger cash == counted cash');
    assert.equal(bal(`vault:${A}`, 'XAU'), 1.95, 'ledger gold till == counted gold');
    assert.equal(bal('gold_over_short', 'XAU'), 0.05);

    // Locked: concurrent cash AND gold postings after the close are all rejected; nothing is written.
    const entriesBefore = await LedgerEntry.countDocuments({ businessId: t.businessId });
    const late = await Promise.all([
      ...Array.from({ length: 4 }, () => a.staff.post('/api/cash/transactions', { type: 'gider', amountTry: '1.00' })),
      a.staff.post('/api/cash/transactions', { type: 'tahsilat', customerId: customer._id, amountGoldGrams: '0.100' }),
      s.closerA.post('/api/cash/daily-closing', { closingCashActual: counted }),
    ]);
    assert.deepEqual(late.map((r) => r.status), [409, 409, 409, 409, 409, 409], JSON.stringify(late.map((r) => r.body?.code)));
    assert.equal(await LedgerEntry.countDocuments({ businessId: t.businessId }), entriesBefore, 'no partial writes');

    // Branch B is independent: still open, closes on its own count.
    await mustOk(await b.staff.post('/api/cash/transactions', { type: 'gider', amountTry: '5.00' }, key('exp-b')), 'B still open');
    bal = await accountBalances(t.admin);
    const bCash = bal(`cash:${B}`);
    const [closeB, raceB] = await Promise.all([
      s.closerB.post('/api/cash/daily-closing', { closingCashActual: bCash.toFixed(2) }),
      b.staff.post('/api/cash/transactions', { type: 'gider', amountTry: '1.00' }),
    ]);
    if (closeB.status === 200) {
      // The voucher either landed before the close (then the close counted it as a difference) or was refused.
      assert.ok([201, 409].includes(raceB.status), JSON.stringify(raceB.body));
    } else {
      assert.equal(raceB.status, 201);
    }
    bal = await accountBalances(t.admin);
    const closingsB = await mustOk(await b.manager.get('/api/cash/daily-summary'), 'summary B');
    if (closingsB.closing) assert.equal(bal(`cash:${B}`), closingsB.closing.closingCashActual, 'B ledger cash == B counted cash');
    await reconciled(t.admin, 'F: after closings');
  });

  it('G — failure recovery: duplicates, key reuse, concurrent oversell and an injected mid-transaction failure leave no trace', async () => {
    const { t, b, customer } = s;
    const p = await mustOk(await b.manager.post('/api/products', { name: `Kolye ${uid()}`, price: '300.00', costPrice: '100.00', stock: 3 }), 'product B');
    const body = { customerId: customer._id, lines: [{ productId: p._id, quantity: 1 }], payments: [{ method: 'havale', amount: '300.00' }] };
    const k = key('dup');
    const dups = await Promise.all(Array.from({ length: 5 }, () => b.staff.post('/api/sales', body, k)));
    assert.ok(dups.every((r) => r.status === 201), JSON.stringify(dups.map((r) => r.status)));
    assert.equal(new Set(dups.map((r) => r.body._id)).size, 1, 'one sale for one key');
    expectError(await b.staff.post('/api/sales', { ...body, lines: [{ productId: p._id, quantity: 2 }] }, k), 422, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(await stockOf(p._id), 2);

    const race = await Promise.all(Array.from({ length: 6 }, () => b.staff.post('/api/sales', body)));
    assert.equal(race.filter((r) => r.status === 201).length, 2, 'only the 2 remaining units sell');
    assert.ok(race.filter((r) => r.status !== 201).every((r) => r.status === 409));
    assert.equal(await stockOf(p._id), 0);

    // Injected infrastructure failure in a CARD sale (sale + payment + POS
    // sub-ledger): the 2nd journal write fails after the 1st was written.
    const restock = await mustOk(await b.manager.post('/api/products', { name: `Küpe ${uid()}`, price: '100.00', costPrice: '40.00', stock: 1 }), 'product');
    const PosTransaction = inspect(require('../models/PosTransaction'));
    const Sale = inspect(require('../models/Sale'));
    const counts = async () => ({
      entries: await LedgerEntry.countDocuments({ businessId: t.businessId }),
      pos: await PosTransaction.countDocuments({ businessId: t.businessId }),
      sales: await Sale.countDocuments({ businessId: t.businessId }),
    });
    const beforeFailure = await counts();
    const balancesBefore = await accountBalances(t.admin);
    const originalCreate = LedgerEntry.create;
    let calls = 0;
    LedgerEntry.create = async function injected(docs, options) {
      calls += 1;
      if (calls === 2) throw new Error('injected: primary stepped down');
      return originalCreate.call(this, docs, options);
    };
    let failed;
    try {
      failed = await b.staff.post('/api/sales', {
        customerId: customer._id, lines: [{ productId: restock._id, quantity: 1 }],
        payments: [{ method: 'kredi kartı', amount: '100.00', pos: { providerId: s.provider._id } }],
      });
    } finally {
      LedgerEntry.create = originalCreate;
    }
    assert.ok(calls >= 2, `the injected failure must fire (journal writes: ${calls})`);
    assert.equal(failed.status, 500, JSON.stringify(failed.body));
    assert.deepEqual(await counts(), beforeFailure, 'no sale, journal entry or POS transaction survives');
    assert.equal(await stockOf(restock._id), 1, 'stock rolled back');
    const balancesAfter = await accountBalances(t.admin);
    for (const account of [`bank:${B}:card`, 'expense:pos_commission', 'revenue:sales', `inventory:${B}`]) {
      assert.equal(balancesAfter(account), balancesBefore(account), `${account} projection rolled back`);
    }
    // The same request succeeds once the infrastructure recovers.
    await mustOk(await b.staff.post('/api/sales', {
      customerId: customer._id, lines: [{ productId: restock._id, quantity: 1 }],
      payments: [{ method: 'kredi kartı', amount: '100.00', pos: { providerId: s.provider._id } }],
    }), 'retry after recovery');
    await reconciled(t.admin, 'G: after failure recovery');
  });
});
