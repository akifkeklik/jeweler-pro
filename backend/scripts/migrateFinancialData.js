/**
 * Idempotent start-up migration of pre-ledger financial data.
 *
 * 1. Tenancy: legacy documents without businessId/branch are attributed to
 *    the original business and branch (same defaults as migrateAuthData).
 * 2. Indexes: global unique indexes that would leak across tenants
 *    (products.barcode_1, dailyclosings.date_1) are replaced by the
 *    tenant-scoped ones defined in the models.
 * 3. Inventory: each product's cost pool is set to stock × costPrice and an
 *    'opening_migration' stock movement records the existing stock, with the
 *    matching opening inventory journal entry when the cost is known — in
 *    the branch that OWNS the stock (services/finance/stockOwnership.js).
 *    Stock whose owning branch cannot be determined from the records is
 *    never defaulted: it is reported (products.ambiguous) and stays frozen
 *    until an operator resolves it (scripts/resolveStockOwnership.js).
 * 4. Customer accounts: exact integer balances are derived from the legacy
 *    balance fields and an 'opening_migration' journal entry documents them,
 *    so the receivable accounts equal the customer balances.
 *
 * Every step is keyed (externalKey / field presence) and safe to re-run;
 * nothing that already exists is changed. Historical sales and vouchers are
 * NOT re-posted (their accounting effect is contained in the opening
 * balances); see BUSINESS_RULES.md → "Migration".
 */
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Sale = require('../models/Sale');
const CashTransaction = require('../models/CashTransaction');
const DailyClosing = require('../models/DailyClosing');
const Category = require('../models/Category');
const Material = require('../models/Material');
const StockMovement = require('../models/StockMovement');
const LedgerEntry = require('../models/LedgerEntry');
const AccountBalance = require('../models/AccountBalance');
const MetalStock = require('../models/MetalStock');
const Supplier = require('../models/Supplier');
const Purchase = require('../models/Purchase');
const IdempotencyRecord = require('../models/IdempotencyRecord');
const StockTransfer = require('../models/StockTransfer');
const PosProvider = require('../models/PosProvider');
const PosTransaction = require('../models/PosTransaction');
const PosSettlement = require('../models/PosSettlement');
const { DEFAULT_BUSINESS_ID, DEFAULT_BRANCH } = require('../config/tenancy');
const { parseDecimal, toSafeInteger } = require('../domain/decimal');
const ledger = require('../services/finance/ledgerService');
const { systemContext, runInTransaction } = require('../services/finance/core');
const { findUniqueConflicts } = require('./migrationPlan');
const stockOwnership = require('../services/finance/stockOwnership');

const { ACCOUNTS, debit, credit } = ledger;
const missing = (field) => ({ $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }] });

async function dropIndexIfPresent(collection, name) {
  try {
    const indexes = await collection.indexes();
    if (indexes.some((i) => i.name === name)) {
      await collection.dropIndex(name);
      return true;
    }
  } catch (error) {
    if (error?.codeName !== 'NamespaceNotFound' && error?.code !== 26) throw error;
  }
  return false;
}

async function migrateTenancy(report) {
  for (const Model of [Product, Customer, Sale, CashTransaction, DailyClosing, Category, Material]) {
    const res = await Model.collection.updateMany(missing('businessId'), { $set: { businessId: DEFAULT_BUSINESS_ID } });
    report.tenancy[Model.modelName] = res.modifiedCount;
  }
  for (const Model of [Sale, CashTransaction, DailyClosing]) {
    const res = await Model.collection.updateMany(missing('branch'), { $set: { branch: DEFAULT_BRANCH } });
    report.branch[Model.modelName] = res.modifiedCount;
  }
}

async function migrateIndexes(report) {
  report.indexes.productsBarcode = await dropIndexIfPresent(Product.collection, 'barcode_1');
  report.indexes.dailyClosingsDate = await dropIndexIfPresent(DailyClosing.collection, 'date_1');
  // createIndexes (not init): the automatic build may have run before the
  // conflicting legacy indexes were dropped.
  for (const Model of [
    Product, Customer, Sale, CashTransaction, DailyClosing, Category, Material, StockMovement, LedgerEntry,
    AccountBalance, MetalStock, Supplier, Purchase, IdempotencyRecord,
    StockTransfer, PosProvider, PosTransaction, PosSettlement,
  ]) {
    await Model.createCollection().catch((error) => { if (error?.code !== 48) throw error; });
    await Model.createIndexes();
  }
}

function costMinorOf(product) {
  if (product.costPrice === null || product.costPrice === undefined || !Number.isFinite(Number(product.costPrice)) || Number(product.costPrice) < 0) return null;
  return parseDecimal(Number(product.costPrice), 2, { round: true }) * BigInt(product.stock || 0);
}

async function migrateProducts(report, logger) {
  const products = await Product.collection.find({}, { projection: { _id: 1, businessId: 1, name: 1, stock: 1, costPrice: 1, costPoolMinor: 1 } }).toArray();
  const knownByBusiness = new Map();
  const unresolved = [];
  for (const product of products) {
    if (!Number.isSafeInteger(product.stock ?? 0) || (product.stock ?? 0) < 0) continue; // invalid legacy stock: reported by the dry run
    const businessId = product.businessId || DEFAULT_BUSINESS_ID;
    const pool = product.costPoolMinor ?? costMinorOf(product);

    // The cost pool is a property of the product, independent of its branch:
    // set it even when ownership is still unresolved (cost is preserved).
    if ((product.costPoolMinor === null || product.costPoolMinor === undefined) && pool !== null) {
      await Product.updateOne({ _id: product._id, businessId, costPoolMinor: null }, { $set: { costPoolMinor: toSafeInteger(pool) } });
      report.products.costPools += 1;
    }

    if (!knownByBusiness.has(businessId)) knownByBusiness.set(businessId, await stockOwnership.knownBranches(businessId));
    const known = knownByBusiness.get(businessId);
    const applied = await stockOwnership.applyProduct(businessId, product._id, { mode: 'auto', known });
    if (applied) {
      if (applied.actions.includes('opening')) report.products.openingMovements += 1;
      if (applied.assignBranch) report.products.assigned += 1;
      report.products.byBranch[applied.owner] = (report.products.byBranch[applied.owner] || 0) + 1;
      continue;
    }
    // Not auto-applicable: report what still needs an operator (never defaulted).
    const fresh = await Product.collection.findOne({ _id: product._id }, { projection: { _id: 1, businessId: 1, name: 1, stock: 1, costPrice: 1, costPoolMinor: 1, branch: 1 } });
    const totals = (await stockOwnership.movementTotals(businessId, { productId: product._id })).get(product._id);
    const analysis = stockOwnership.analyzeProduct(fresh, totals, { known });
    if (analysis.status === 'ambiguous') report.products.ambiguous += 1;
    if (analysis.status === 'needs_reclass') report.products.misbooked += 1;
    if (['ambiguous', 'needs_reclass', 'conflict'].includes(analysis.status)) unresolved.push({ businessId, productId: product._id, status: analysis.status });
  }
  if (unresolved.length) {
    logger.log(`[migrate] UYARI: ${unresolved.length} ürünün stok sahipliği çözümlenmedi (stok donduruldu). `
      + `Kuru çalıştırma: node scripts/resolveStockOwnership.js — örnek: ${JSON.stringify(unresolved.slice(0, 10))}`);
  }
}

async function migrateCustomers(report) {
  // Raw read: a corrupt legacy value must not abort the whole migration in a cast.
  const customers = await Customer.collection.find({}, { projection: { _id: 1, businessId: 1, name: 1, balanceTry: 1, balanceGold: 1, balanceTryMinor: 1, balanceGoldMg: 1 } }).toArray();
  for (const customer of customers) {
    const businessId = customer.businessId || DEFAULT_BUSINESS_ID;
    let tryMinor = customer.balanceTryMinor;
    let goldMg = customer.balanceGoldMg;
    const hasJournal = await LedgerEntry.exists({ businessId, 'lines.account': ACCOUNTS.receivable(customer._id) });

    if (!hasJournal && (!Number.isFinite(Number(customer.balanceTry || 0)) || !Number.isFinite(Number(customer.balanceGold || 0)))) {
      // Corrupt legacy value: never guess a balance. Reported (dry run:
      // customer_invalid_balance) and left for a human decision.
      report.customers.invalid += 1;
      continue;
    }
    if (!hasJournal) {
      // Before the ledger existed, the float balance fields were authoritative.
      tryMinor = toSafeInteger(parseDecimal(Number(customer.balanceTry || 0), 2, { allowNegative: true, round: true }));
      goldMg = toSafeInteger(parseDecimal(Number(customer.balanceGold || 0), 3, { allowNegative: true, round: true }));
      if (tryMinor !== customer.balanceTryMinor || goldMg !== customer.balanceGoldMg) {
        await Customer.updateOne({ _id: customer._id, businessId }, { $set: { balanceTryMinor: tryMinor, balanceGoldMg: goldMg } });
        report.customers.balances += 1;
      }
    }
    if (hasJournal || (tryMinor === 0 && goldMg === 0)) continue;

    const ctx = systemContext({ businessId, branch: DEFAULT_BRANCH, correlationId: 'migration' });
    const account = ACCOUNTS.receivable(customer._id);
    const lines = [];
    for (const [unit, value] of [['TRY', BigInt(tryMinor)], ['XAU', BigInt(goldMg)]]) {
      if (value === 0n) continue;
      // Credit-positive customer balance: negative = the customer owes us (AR debit).
      if (value < 0n) lines.push(debit(account, unit, -value, { customerId: customer._id }), credit(ACCOUNTS.openingEquity, unit, -value));
      else lines.push(debit(ACCOUNTS.openingEquity, unit, value), credit(account, unit, value, { customerId: customer._id }));
    }
    await ledger.prepareAccounts(businessId, ledger.accountsOf(lines));
    await runInTransaction((session) => ledger.postEntry(session, ctx, {
      entryType: 'opening_migration',
      reference: { kind: 'Customer', id: String(customer._id) },
      description: `Devreden cari bakiye (aktarım): ${customer.name}`,
      externalKey: `ar-opening:${customer._id}`,
      lines,
      branch: DEFAULT_BRANCH,
      projectParties: false,
    })).catch((error) => {
      if (error?.code !== 11000) throw error;
    });
    report.customers.openingEntries += 1;
  }
}

async function migrateFinancialData({ logger = console } = {}) {
  if (mongoose.connection.readyState !== 1) throw new Error('migrateFinancialData requires a MongoDB connection');
  const report = {
    tenancy: {},
    branch: {},
    indexes: {},
    products: { costPools: 0, openingMovements: 0, assigned: 0, ambiguous: 0, misbooked: 0, byBranch: {} },
    customers: { balances: 0, openingEntries: 0, invalid: 0 },
  };
  // Pre-flight, BEFORE any write: duplicates would make the unique index
  // build fail half-way (tenancy already rewritten, legacy index dropped).
  const conflicts = await findUniqueConflicts();
  if (conflicts.productBarcodes.length || conflicts.dailyClosings.length) {
    const error = new Error(`Aktarım engellendi: benzersiz anahtar çakışmaları var (yinelenen barkod: ${conflicts.productBarcodes.length}, yinelenen gün sonu: ${conflicts.dailyClosings.length}). `
      + `Hiçbir veri değiştirilmedi. Ayrıntı: node scripts/migrate.js (kuru çalıştırma) → product_duplicate_barcode / daily_closing_duplicate. ${JSON.stringify(conflicts).slice(0, 2000)}`);
    error.name = 'MigrationBlockedError';
    error.conflicts = conflicts;
    throw error;
  }
  await migrateTenancy(report);
  await migrateIndexes(report);
  await migrateProducts(report, logger);
  await migrateCustomers(report);
  const changed = Object.values(report.tenancy).some(Boolean) || Object.values(report.branch).some(Boolean)
    || report.indexes.productsBarcode || report.indexes.dailyClosingsDate
    || report.products.costPools || report.products.openingMovements || report.products.assigned
    || report.customers.balances || report.customers.openingEntries;
  if (changed) logger.log(`[migrate] Finansal veriler aktarıldı: ${JSON.stringify(report)}`);
  return report;
}

module.exports = migrateFinancialData;
