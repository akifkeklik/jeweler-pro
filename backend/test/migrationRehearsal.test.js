/**
 * Migration rehearsal — the OPERATOR procedure (backend/OPERATIONS.md)
 * executed end-to-end with the real CLIs, against a dedicated database
 * seeded with sanitized, realistic legacy data:
 *
 *   explicit / ambiguous / malformed stock, duplicate barcodes (legacy index
 *   never built), float and corrupt customer balances, historical sales,
 *   vouchers and Z-reports, the legacy global indexes.
 *
 * Procedure verified:
 *   1. dry run (exit 2) reports everything and changes NOTHING (documents
 *      and indexes);
 *   2. --apply without --confirm-backup is refused;
 *   3. --apply with blocking duplicates is refused BEFORE any write;
 *   4. operator fixes the duplicate; an apply that is INTERRUPTED half-way
 *      leaves a recoverable state; re-running converges exactly (no double
 *      postings) and reconciles;
 *   5. a repeated apply is a no-op;
 *   6. stock ownership recovery: ambiguous stock stays frozen until an
 *      explicit resolution; repeated execution is a no-op;
 *   7. historical records are preserved; corrupt records are left for a
 *      human decision.
 * Opening balances are hand-computed in the comments.
 */
const { inspect } = require('../testSupport/tenantInspection');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mongoose = require('mongoose');

// This process only observes (and simulates the crash): it must not build
// indexes itself, so the fingerprint measures exactly what the CLIs do.
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const baseUri = process.env.MONGO_URI;
const root = path.join(__dirname, '..');
const DB = `jeweler_rehearsal_${crypto.randomBytes(4).toString('hex')}`;

/** Exit 3 = verification flags data for a human; EXACTLY the expected products may remain flagged. */
function onlyFlagged(result, productIds) {
  const flagged = result.json.reconciliation || result.json.verification;
  const all = flagged.flatMap((r) => r.discrepancies);
  assert.ok(all.length > 0, 'the flagged records must stay visible');
  assert.deepEqual([...new Set(all.map((d) => d.productId))].sort(), [...productIds].sort(), JSON.stringify(all));
}

function rehearsalUri() {
  const url = new URL(baseUri);
  url.pathname = `/${DB}`;
  return url.toString();
}

/** Runs a CLI exactly as an operator would; returns { code, json, stderr }. */
function cli(script, args = []) {
  const res = spawnSync(process.execPath, [path.join('scripts', script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, MONGO_URI: rehearsalUri(), REQUEST_LOG: 'off' },
    timeout: 120000,
  });
  let json = null;
  // The result document starts at column 0 (log lines before it may contain JSON too).
  const start = res.stdout.search(/^\{/m);
  if (start >= 0) {
    try { json = JSON.parse(res.stdout.slice(start)); } catch { json = null; }
  }
  return { code: res.status, json, stdout: res.stdout, stderr: res.stderr };
}

const COLLECTIONS = ['products', 'customers', 'sales', 'cashtransactions', 'dailyclosings', 'ledgerentries', 'stockmovements', 'accountbalances'];

/** Fingerprint of all business documents AND their indexes. */
async function fingerprint() {
  const db = mongoose.connection.db;
  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
  const parts = [];
  for (const name of COLLECTIONS) {
    if (!existing.has(name)) { parts.push(`${name}:absent`); continue; }
    const docs = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
    const indexes = (await db.collection(name).indexes()).map((i) => i.name).sort();
    parts.push(`${name}:${JSON.stringify(docs)}:${indexes.join(',')}`);
  }
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

describe('Migration rehearsal with the operator CLIs (real MongoDB)', { skip: !baseUri && 'MONGO_URI not set — run `npm test`' }, () => {
  const { DEFAULT_BUSINESS_ID: BIZ, DEFAULT_BRANCH: MAIN } = require('../config/tenancy');
  const SECOND = 'Bağdat Caddesi';
  const ids = {
    explicit: 610001, second: 610002, ambiguous: 610003, negative: 610004, badCost: 610005, dupA: 610006, dupB: 610007,
    debtor: 71000001, creditor: 71000002, corrupt: 71000003, settled: 71000004,
    sale: 820001,
  };
  let ledger;
  let inventory;

  before(async () => {
    await mongoose.connect(rehearsalUri());
    ledger = require('../services/finance/ledgerService');
    inventory = require('../services/finance/inventoryService');
    const db = mongoose.connection.db;
    await db.dropDatabase();

    // ---- sanitized legacy dataset (raw inserts: pre-tenancy shapes) ----
    // Two active branches (a branch exists when it has an active user).
    await db.collection('users').insertMany([
      { email: 'kasa1@legacy.test', name: 'Kasa 1', role: 'admin', branch: MAIN, businessId: BIZ, active: true, passwordHash: 'x', tokenVersion: 0 },
      { email: 'kasa2@legacy.test', name: 'Kasa 2', role: 'staff', branch: SECOND, businessId: BIZ, active: true, passwordHash: 'x', tokenVersion: 0 },
    ]);
    await db.collection('products').insertMany([
      { _id: ids.explicit, name: 'Legacy 22 Ayar Yüzük', stock: 5, costPrice: 100.1, price: 250, branch: MAIN, barcode: 'LEG-0001' },
      { _id: ids.second, name: 'Legacy Kolye', stock: 2, costPrice: 50, price: 120, branch: SECOND, barcode: 'LEG-0002' },
      { _id: ids.ambiguous, name: 'Legacy ortak vitrin', stock: 3, costPrice: 10, price: 25 },
      { _id: ids.negative, name: 'Legacy hatalı stok', stock: -1, costPrice: 10, price: 25, branch: MAIN },
      { _id: ids.badCost, name: 'Legacy maliyetsiz', stock: 1, costPrice: 'bilinmiyor', price: 25, branch: MAIN },
      // Duplicate barcode: the legacy unique index was never built.
      { _id: ids.dupA, name: 'Legacy küpe A', stock: 1, costPrice: 20, price: 40, branch: MAIN, barcode: 'LEG-DUP' },
      { _id: ids.dupB, name: 'Legacy küpe B', stock: 1, costPrice: 20, price: 40, branch: MAIN, barcode: 'LEG-DUP' },
    ]);
    await db.collection('customers').insertMany([
      { _id: ids.debtor, name: 'Borçlu Müşteri', balanceTry: -1500.75, balanceGold: 0 },
      { _id: ids.creditor, name: 'Alacaklı Müşteri', balanceTry: 200, balanceGold: 2.5 },
      { _id: ids.corrupt, name: 'Bozuk Kayıt', balanceTry: 'NaN-legacy', balanceGold: 0 },
      { _id: ids.settled, name: 'Kapalı Hesap', balanceTry: 0, balanceGold: 0 },
    ]);
    await db.collection('sales').insertOne({ _id: ids.sale, customerId: ids.debtor, productId: ids.explicit, quantity: 1, totalPrice: 250, paymentMethod: 'nakit', date: new Date('2026-10-01T10:00:00Z') });
    await db.collection('cashtransactions').insertOne({ type: 'tahsilat', customerId: ids.debtor, amountTry: 100, paymentMethod: 'nakit', date: new Date('2026-10-02T10:00:00Z') });
    await db.collection('dailyclosings').insertOne({ date: '2026-10-01', closingCashCalculated: 1000, closingCashActual: 1000, isClosed: true });
    // The legacy GLOBAL unique index on closings (dropped by the migration).
    await db.collection('dailyclosings').createIndex({ date: 1 }, { unique: true, name: 'date_1' });
  });

  after(async () => {
    await mongoose.connection.db.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  });

  it('1–3: dry run reports everything and writes nothing; unsafe applies are refused before any write', async () => {
    const pristine = await fingerprint();

    const dry = cli('migrate.js');
    assert.equal(dry.code, 2, `dry run exit code: ${dry.stderr}`);
    const plan = dry.json.plan;
    assert.equal(plan.pending, true);
    assert.equal(plan.blocking, true);
    const issue = (type) => plan.issues.find((i) => i.type === type);
    assert.deepEqual(issue('product_duplicate_barcode').samples[0].productIds.sort(), [ids.dupA, ids.dupB]);
    assert.ok(issue('stock_ownership_ambiguous').samples.some((x) => x.productId === ids.ambiguous), 'ambiguous ownership reported');
    assert.ok(issue('product_invalid_stock').samples.some((x) => x.productId === ids.negative));
    assert.ok(issue('product_invalid_cost').samples.some((x) => x.productId === ids.badCost));
    assert.ok(issue('customer_invalid_balance'));
    // Openings planned per OWNING branch: 5 × 100.10 = 500.50 (+ dup küpe 2 × 20) in MAIN ; 2 × 50 = 100 in SECOND.
    assert.equal(plan.products.openingByBranch[SECOND].valueTry, 100);
    assert.equal(plan.customers.receivableTry, 1500.75);
    assert.equal(plan.customers.payableTry, 200);
    assert.equal(plan.customers.payableGoldGrams, 2.5);
    assert.equal(await fingerprint(), pristine, 'dry run changed neither documents nor indexes');

    const noBackup = cli('migrate.js', ['--apply']);
    assert.equal(noBackup.code, 1);
    assert.match(noBackup.stderr, /confirm-backup/);
    assert.equal(await fingerprint(), pristine, 'refused apply wrote nothing');

    const blocked = cli('migrate.js', ['--apply', '--confirm-backup']);
    assert.equal(blocked.code, 1, blocked.stdout);
    assert.match(blocked.stderr, /benzersiz anahtar çakışmaları|engellendi/);
    assert.equal(await fingerprint(), pristine, 'blocked apply wrote nothing (no tenancy rewrite, no index dropped)');

    // Out-of-order step: the ownership tool refuses (no false "nothing left" before the migration).
    const ownershipDry = cli('resolveStockOwnership.js');
    assert.equal(ownershipDry.code, 1, ownershipDry.stdout);
    assert.match(ownershipDry.stderr, /migrate\.js/);
    assert.equal(await fingerprint(), pristine, 'ownership dry run wrote nothing');
  });

  it('4–5: an interrupted apply is recoverable; re-running converges exactly and reconciles; a repeat is a no-op', async () => {
    // Operator decision for the duplicate (documented in the change log of the shop): re-label B.
    await mongoose.connection.db.collection('products').updateOne({ _id: ids.dupB }, { $set: { barcode: 'LEG-DUP-B' } });

    // Interrupt: the process dies while posting the SECOND customer opening.
    const migrateFinancialData = require('../scripts/migrateFinancialData');
    const LedgerEntry = inspect(require('../models/LedgerEntry'));
    const originalCreate = LedgerEntry.create;
    let customerOpenings = 0;
    LedgerEntry.create = async function crash(docs, options) {
      if (Array.isArray(docs) && docs[0]?.entryType === 'opening_migration' && docs[0]?.reference?.kind === 'Customer') {
        customerOpenings += 1;
        if (customerOpenings === 2) throw new Error('injected: process killed mid-migration');
      }
      return originalCreate.call(this, docs, options);
    };
    await assert.rejects(() => migrateFinancialData({ logger: { log() {} } }), /process killed/);
    LedgerEntry.create = originalCreate;
    assert.equal(await LedgerEntry.countDocuments({ entryType: 'opening_migration', 'reference.kind': 'Customer' }), 1, 'exactly the first customer opening committed');

    const midway = cli('migrate.js');
    assert.equal(midway.code, 2, 'dry run shows the remaining work after the interruption');
    assert.equal(midway.json.plan.blocking, false);

    const resumed = cli('migrate.js', ['--apply', '--confirm-backup']);
    // 3 = verification flags data for a human: the malformed record and the
    // still-unresolved ambiguous stock (frozen until step 6) — nothing else.
    assert.equal(resumed.code, 3, `${resumed.stderr}\n${JSON.stringify(resumed.json?.reconciliation)}`);
    onlyFlagged(resumed, [ids.negative, ids.ambiguous]);
    assert.equal(resumed.json.after.pending, false, 'nothing left to migrate');

    // Exactly one opening per party / product — no double postings after the crash.
    const openings = await LedgerEntry.find({ entryType: 'opening_migration', 'reference.kind': 'Customer' }).lean();
    assert.deepEqual(openings.map((e) => Number(e.reference.id)).sort(), [ids.debtor, ids.creditor].sort());
    assert.equal(await ledger.balanceOf(BIZ, `ar:${ids.debtor}`, 'TRY'), 150075n, 'debtor owes 1500.75');
    assert.equal(await ledger.balanceOf(BIZ, `ar:${ids.creditor}`, 'TRY'), -20000n);
    assert.equal(await ledger.balanceOf(BIZ, `ar:${ids.creditor}`, 'XAU'), -2500n, '2.5 g has owed to the customer');
    // 5 × 100.10 + 2 × 20 (küpe A+B) = 540.50 in MAIN ; 100.00 in SECOND ; malformed / unknown-cost stock not valued.
    assert.equal(await ledger.balanceOf(BIZ, `inventory:${MAIN}`, 'TRY'), 54050n);
    assert.equal(await ledger.balanceOf(BIZ, `inventory:${SECOND}`, 'TRY'), 10000n);

    const fingerprintAfter = await fingerprint();
    const repeat = cli('migrate.js', ['--apply', '--confirm-backup']);
    assert.equal(repeat.code, 3, repeat.stderr);
    onlyFlagged(repeat, [ids.negative, ids.ambiguous]);
    assert.equal(await fingerprint(), fingerprintAfter, 'a repeated apply changes nothing');
  });

  it('6: stock ownership recovery — frozen until an explicit decision, then exact and idempotent', async () => {
    const Product = inspect(require('../models/Product'));
    const dry = cli('resolveStockOwnership.js');
    assert.equal(dry.code, 2);
    const pending = dry.json.businesses.flatMap((b) => b.products.map((p) => p.productId));
    assert.ok(pending.includes(ids.ambiguous), 'ambiguous product needs an operator decision');

    // Applying WITHOUT a resolution never assigns ambiguous stock.
    const blind = cli('resolveStockOwnership.js', ['--apply', '--confirm-backup']);
    assert.notEqual(blind.code, 1, blind.stderr);
    assert.ok(!blind.json.applied.some((a) => a.productId === ids.ambiguous), 'not silently assigned');
    assert.equal((await Product.findById(ids.ambiguous).lean()).branch || '', '');

    const file = path.join(os.tmpdir(), `${DB}-resolutions.json`);
    fs.writeFileSync(file, JSON.stringify({ [BIZ]: { [ids.ambiguous]: SECOND } }));
    try {
      const resolved = cli('resolveStockOwnership.js', ['--apply', '--confirm-backup', `--resolutions=${file}`]);
      assert.notEqual(resolved.code, 1, resolved.stderr);
      assert.deepEqual(resolved.json.applied.filter((a) => a.productId === ids.ambiguous).map((a) => [a.owner, a.basis]), [[SECOND, 'explicit']]);
      onlyFlagged(resolved, [ids.negative]);
      const product = await Product.findById(ids.ambiguous).lean();
      assert.equal(product.branch, SECOND);
      assert.equal(product.stock, 3);
      assert.equal(product.costPoolMinor, 3000, 'cost preserved: 3 × 10.00');
      // 100.00 + 30.00
      assert.equal(await ledger.balanceOf(BIZ, `inventory:${SECOND}`, 'TRY'), 13000n);

      const snapshot = await fingerprint();
      const again = cli('resolveStockOwnership.js', ['--apply', '--confirm-backup', `--resolutions=${file}`]);
      assert.notEqual(again.code, 1, again.stderr);
      assert.equal(again.json.applied.length, 0);
      assert.equal(await fingerprint(), snapshot, 'repeated recovery changes nothing');
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it('7: history preserved, corrupt records left for a human, and the books reconcile', async () => {
    const db = mongoose.connection.db;
    const sale = await db.collection('sales').findOne({ _id: ids.sale });
    assert.equal(sale.totalPrice, 250, 'historical sale untouched');
    assert.equal(sale.businessId, BIZ, 'only tenancy attributed');
    assert.equal(await db.collection('cashtransactions').countDocuments({}), 1);
    assert.equal(await db.collection('ledgerentries').countDocuments({ 'reference.kind': 'Sale' }), 0, 'historical sales are not re-posted');
    const closing = await db.collection('dailyclosings').findOne({ date: '2026-10-01' });
    assert.equal(closing.closingCashActual, 1000);
    assert.equal(closing.businessId, BIZ);
    assert.equal((await db.collection('dailyclosings').indexes()).some((i) => i.name === 'date_1'), false, 'legacy global index replaced');
    assert.equal((await db.collection('customers').findOne({ _id: ids.corrupt })).balanceTry, 'NaN-legacy', 'corrupt balance never guessed');
    assert.equal((await db.collection('products').findOne({ _id: ids.negative })).stock, -1, 'invalid stock never posted');

    const books = await ledger.reconcile(BIZ);
    assert.equal(books.ok, true, JSON.stringify(books.discrepancies));
    const stock = await inventory.reconcile(BIZ);
    // Only the malformed legacy record remains flagged — visibly, for a human decision.
    const unexpected = stock.discrepancies.filter((d) => d.productId !== ids.negative);
    assert.deepEqual(unexpected, [], JSON.stringify(stock.discrepancies));
  });
});
