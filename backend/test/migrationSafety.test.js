/**
 * Migration safety: dry run writes nothing, detects inconsistent legacy
 * records, apply is idempotent and the result reconciles; production
 * start-up never migrates implicitly. Uses sanitized legacy-shaped
 * documents inserted raw (as the pre-ledger version stored them).
 */
const { inspect } = require('../testSupport/tenantInspection');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'migration-safety-secret-with-more-than-thirty-two-chars';
process.env.NODE_ENV = 'test';

const uri = process.env.MONGO_URI;
const { runStartupMigration } = require('../server');
const Product = inspect(require('../models/Product'));
const Customer = inspect(require('../models/Customer'));
const StockMovement = inspect(require('../models/StockMovement'));
const LedgerEntry = inspect(require('../models/LedgerEntry'));
const migrateFinancialData = require('../scripts/migrateFinancialData');
const { planFinancialMigration } = require('../scripts/migrationPlan');
const ledger = require('../services/finance/ledgerService');
const inventory = require('../services/finance/inventoryService');

const uid = () => crypto.randomBytes(4).toString('hex');
const id6 = () => 100000 + crypto.randomInt(800000);

describe('Migration safety (real MongoDB)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  before(async () => {
    await mongoose.connect(uri);
    await migrateFinancialData({ logger: { log() {} } }); // settle data left by other suites
  });
  after(async () => { await mongoose.disconnect(); });

  it('dry run reports exact opening balances and issues without writing; apply is idempotent and reconciles', async () => {
    const biz = `biz_mig_${uid()}`;
    const bad = `biz_mig_bad_${uid()}`;
    const ring = id6();
    const chain = id6();
    // legacy: float prices, no cost pools, no movements, float customer balances
    await Product.collection.insertMany([
      { _id: ring, businessId: biz, name: 'Legacy Yüzük', stock: 4, costPrice: 1250.5, price: 2000 },
      { _id: chain, businessId: biz, name: 'Legacy Zincir', stock: 2, costPrice: null, price: 900 },
    ]);
    const debtor = id6();
    const creditor = id6();
    await Customer.collection.insertMany([
      { _id: debtor, businessId: biz, name: 'Borçlu', balanceTry: -150.25, balanceGold: 0 },
      { _id: creditor, businessId: biz, name: 'Alacaklı', balanceTry: 80, balanceGold: 1.5 },
    ]);
    // inconsistent records in another business
    await Product.collection.insertOne({ _id: id6(), businessId: bad, name: 'Negatif', stock: -2, costPrice: 10 });
    await Customer.collection.insertOne({ _id: id6(), businessId: bad, name: 'Bozuk', balanceTry: 'abc' });
    await mongoose.connection.collection('sales').insertOne({ _id: id6(), businessId: bad, customerId: 999999999, productId: 999999998, totalPrice: 10 });

    const movementsBefore = await StockMovement.countDocuments({ businessId: biz });
    const plan = await planFinancialMigration({ businessId: biz });
    assert.equal(plan.pending, true);
    // 4 × 1250.50 = 5002.00 opening inventory (zincir: unknown cost, units counted but not valued)
    assert.equal(plan.products.openingInventoryValueTry, 5002);
    assert.equal(plan.products.openingMovements, 2);
    assert.equal(plan.products.unknownCostOpenings, 1);
    assert.equal(plan.customers.receivableTry, 150.25);
    assert.equal(plan.customers.payableTry, 80);
    assert.equal(plan.customers.payableGoldGrams, 1.5);
    assert.ok(plan.issues.some((i) => i.type === 'product_stock_unknown_cost'));
    assert.equal(await StockMovement.countDocuments({ businessId: biz }), movementsBefore, 'dry run writes nothing');
    assert.equal((await Product.findById(ring).lean()).costPoolMinor, undefined);

    const badPlan = await planFinancialMigration({ businessId: bad });
    const types = badPlan.issues.map((i) => i.type).sort();
    assert.deepEqual(types, ['customer_invalid_balance', 'product_invalid_stock', 'sale_missing_customer', 'sale_missing_product']);

    await migrateFinancialData({ logger: { log() {} } });
    const after1 = await planFinancialMigration({ businessId: biz });
    assert.equal(after1.pending, false, 'nothing left to migrate');
    const entriesAfterFirst = await LedgerEntry.countDocuments({ businessId: biz });
    await migrateFinancialData({ logger: { log() {} } });
    assert.equal(await LedgerEntry.countDocuments({ businessId: biz }), entriesAfterFirst, 'second run changes nothing (idempotent)');

    assert.equal(await ledger.balanceOf(biz, 'inventory:Merkez Şube - Kapalıçarşı', 'TRY'), 500200n);
    assert.equal(await ledger.balanceOf(biz, `ar:${debtor}`, 'TRY'), 15025n);
    assert.equal(await ledger.balanceOf(biz, `ar:${creditor}`, 'XAU'), -1500n);
    const books = await ledger.reconcile(biz);
    const stock = await inventory.reconcile(biz);
    assert.equal(books.ok, true, JSON.stringify(books.discrepancies));
    assert.equal(stock.ok, true, JSON.stringify(stock.discrepancies));
    // The inconsistent business is NOT silently "fixed": reconciliation flags it.
    const badStock = await inventory.reconcile(bad);
    assert.equal(badStock.ok, false);
    assert.equal(badStock.discrepancies[0].check, 'missing_opening', 'negative legacy stock is never posted, and stays visible');
    assert.equal((await Product.collection.findOne({ businessId: bad })).stock, -2, 'invalid record left untouched for a human decision');
  });

  it('production start-up refuses to migrate implicitly; explicit opt-in applies', async () => {
    const biz = `biz_mig_prod_${uid()}`;
    const pid = id6();
    await Product.collection.insertOne({ _id: pid, businessId: biz, name: 'Bekleyen', stock: 1, costPrice: 5 });
    const silent = { error() {}, log() {} };
    await assert.rejects(runStartupMigration({ production: true }, {}, silent), (e) => e.name === 'MigrationPendingError');
    assert.equal(await StockMovement.countDocuments({ businessId: biz }), 0, 'nothing written');
    const applied = await runStartupMigration({ production: true }, { MIGRATION_AUTO_APPLY: 'true' }, silent);
    assert.equal(applied.applied, true);
    assert.equal(await StockMovement.countDocuments({ businessId: biz, productId: pid }), 1);
    const clean = await runStartupMigration({ production: true }, {}, silent);
    assert.equal(clean.applied, false, 'nothing pending → normal start');
  });
});
