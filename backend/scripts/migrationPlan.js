/**
 * READ-ONLY dry run of the financial data migration (scripts/migrateFinancialData.js).
 *
 * Reports, without writing anything:
 *   - pending work: documents the migration would change, legacy indexes it
 *     would drop, opening movements / journal entries it would post (with
 *     the exact totals, so opening balances can be verified beforehand)
 *   - data-quality issues: legacy records that are incomplete or
 *     inconsistent and need a human decision (they are NOT auto-corrected)
 * `pending` is false once the migration has fully run (idempotency check).
 */
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Sale = require('../models/Sale');
const CashTransaction = require('../models/CashTransaction');
const DailyClosing = require('../models/DailyClosing');
const Category = require('../models/Category');
const Material = require('../models/Material');
const LedgerEntry = require('../models/LedgerEntry');
const { DEFAULT_BUSINESS_ID, DEFAULT_BRANCH } = require('../config/tenancy');
const { parseDecimal, toDisplayNumber } = require('../domain/decimal');
const stockOwnership = require('../services/finance/stockOwnership');

const missing = (field) => ({ $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }] });
const SAMPLE = 20;

async function indexExists(collection, name) {
  try {
    return (await collection.indexes()).some((i) => i.name === name);
  } catch (error) {
    if (error?.codeName === 'NamespaceNotFound' || error?.code === 26) return false;
    throw error;
  }
}

function exactMinor(value, scale) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return { ok: false };
  const minor = parseDecimal(n, scale, { allowNegative: true, round: true });
  const exact = Math.abs(Number(minor) / 10 ** scale - n) < 10 ** -(scale + 6);
  return { ok: true, minor, exact };
}

/**
 * Legacy duplicates that would violate the tenant-scoped unique indexes the
 * migration builds ({businessId, barcode}, {businessId, branch, date}).
 * Legacy databases normally cannot contain them (the old indexes were
 * global), but imported data or an index that was never built can. They are
 * BLOCKING: --apply refuses to start (before writing anything) until an
 * operator resolves them — never auto-deleted or renamed.
 */
async function findUniqueConflicts({ businessId } = {}) {
  const biz = { $ifNull: ['$businessId', DEFAULT_BUSINESS_ID] };
  const match = businessId ? [{ $match: { $expr: { $eq: [biz, businessId] } } }] : [];
  const barcodes = await Product.collection.aggregate([
    ...match,
    { $match: { barcode: { $type: 'string' } } },
    { $group: { _id: { businessId: biz, barcode: '$barcode' }, count: { $sum: 1 }, productIds: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: SAMPLE },
  ]).toArray();
  const closings = await DailyClosing.collection.aggregate([
    ...match,
    { $group: { _id: { businessId: biz, branch: { $ifNull: ['$branch', DEFAULT_BRANCH] }, date: '$date' }, count: { $sum: 1 }, closingIds: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: SAMPLE },
  ]).toArray();
  return {
    productBarcodes: barcodes.map((d) => ({ ...d._id, count: d.count, productIds: d.productIds })),
    dailyClosings: closings.map((d) => ({ ...d._id, count: d.count, closingIds: d.closingIds.map(String) })),
  };
}

async function planFinancialMigration({ businessId } = {}) {
  const scope = businessId ? { businessId } : {};
  const plan = {
    generatedAt: new Date().toISOString(),
    scope: businessId || 'all businesses',
    tenancy: {},
    branch: {},
    indexes: {},
    products: {
      costPoolsToSet: 0, openingMovements: 0, openingInventoryValueTry: 0, openingUnits: 0, unknownCostOpenings: 0,
      // Openings per OWNING branch (never all into the default branch).
      openingByBranch: {},
      ownership: { assignments: 0, ambiguous: 0, misbooked: 0, conflicts: 0 },
    },
    customers: { balancesToConvert: 0, openingEntries: 0, receivableTry: 0, payableTry: 0, receivableGoldGrams: 0, payableGoldGrams: 0 },
    issues: [],
    pending: false,
  };
  const issue = (type, detail) => {
    const bucket = plan.issues.find((i) => i.type === type);
    if (bucket) {
      bucket.count += 1;
      if (bucket.samples.length < SAMPLE) bucket.samples.push(detail);
    } else {
      plan.issues.push({ type, count: 1, samples: [detail] });
    }
  };

  if (!businessId) {
    for (const Model of [Product, Customer, Sale, CashTransaction, DailyClosing, Category, Material]) {
      plan.tenancy[Model.modelName] = await Model.collection.countDocuments(missing('businessId'));
    }
    for (const Model of [Sale, CashTransaction, DailyClosing]) {
      plan.branch[Model.modelName] = await Model.collection.countDocuments(missing('branch'));
    }
    plan.indexes.dropProductsBarcode = await indexExists(Product.collection, 'barcode_1');
    plan.indexes.dropDailyClosingsDate = await indexExists(DailyClosing.collection, 'date_1');
  }

  let openingValue = 0n;
  const products = await Product.collection.find(scope, { projection: { _id: 1, businessId: 1, name: 1, stock: 1, costPrice: 1, costPoolMinor: 1, pricingMode: 1, metal: 1, purity: 1, weight: 1, branch: 1 } }).toArray();
  const ownershipContext = new Map();
  const contextFor = async (biz) => {
    if (!ownershipContext.has(biz)) {
      ownershipContext.set(biz, { known: await stockOwnership.knownBranches(biz), totals: await stockOwnership.movementTotals(biz) });
    }
    return ownershipContext.get(biz);
  };
  for (const p of products) {
    const biz = p.businessId || DEFAULT_BUSINESS_ID;
    const stock = p.stock ?? 0;
    if (!Number.isSafeInteger(stock) || stock < 0) {
      issue('product_invalid_stock', { productId: p._id, name: p.name, stock });
      continue;
    }
    const cost = p.costPrice === null || p.costPrice === undefined ? null : Number(p.costPrice);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) issue('product_invalid_cost', { productId: p._id, name: p.name, costPrice: p.costPrice });
    if (cost !== null && Number.isFinite(cost) && !exactMinor(cost, 2).exact) issue('product_cost_rounded', { productId: p._id, costPrice: cost });
    if (p.pricingMode === 'gram' && (!p.metal || !p.purity || !(Number(p.weight) > 0))) {
      issue('product_gram_incomplete', { productId: p._id, name: p.name });
    }
    const pool = p.costPoolMinor ?? (cost !== null && Number.isFinite(cost) && cost >= 0 ? parseDecimal(cost, 2, { round: true }) * BigInt(stock) : null);
    if ((p.costPoolMinor === null || p.costPoolMinor === undefined) && pool !== null) plan.products.costPoolsToSet += 1;
    const { known, totals } = await contextFor(biz);
    const ownership = stockOwnership.analyzeProduct(p, totals.get(p._id), { known });
    const hasMovement = totals.has(p._id);
    if (ownership.status === 'ambiguous') {
      plan.products.ownership.ambiguous += 1;
      issue('stock_ownership_ambiguous', { productId: p._id, name: p.name, stock, evidence: ownership.evidence });
    } else if (ownership.status === 'needs_reclass') {
      plan.products.ownership.misbooked += 1;
      issue('stock_branch_misbooked', { productId: p._id, name: p.name, owner: ownership.owner, foreign: ownership.foreign });
    } else if (ownership.status === 'conflict') {
      plan.products.ownership.conflicts += 1;
      issue('stock_ownership_conflict', { productId: p._id, name: p.name, branch: ownership.branch });
    }
    if (ownership.assignBranch && stockOwnership.autoApplicable(ownership)) plan.products.ownership.assignments += 1;
    if (!hasMovement && stock > 0 && stockOwnership.autoApplicable(ownership)) {
      plan.products.openingMovements += 1;
      plan.products.openingUnits += stock;
      const bucket = plan.products.openingByBranch[ownership.owner] || { products: 0, units: 0, valueMinor: 0n, basis: {} };
      bucket.products += 1;
      bucket.units += stock;
      bucket.basis[ownership.basis] = (bucket.basis[ownership.basis] || 0) + 1;
      if (pool === null) {
        plan.products.unknownCostOpenings += 1;
        issue('product_stock_unknown_cost', { productId: p._id, name: p.name, stock });
      } else {
        openingValue += pool;
        bucket.valueMinor += pool;
      }
      plan.products.openingByBranch[ownership.owner] = bucket;
    }
  }
  for (const bucket of Object.values(plan.products.openingByBranch)) {
    bucket.valueTry = toDisplayNumber(bucket.valueMinor, 2);
    delete bucket.valueMinor;
  }
  plan.products.openingInventoryValueTry = toDisplayNumber(openingValue, 2);

  const sums = { rTry: 0n, pTry: 0n, rGold: 0n, pGold: 0n };
  const customers = await Customer.collection.find(scope, { projection: { _id: 1, businessId: 1, name: 1, balanceTry: 1, balanceGold: 1, balanceTryMinor: 1, balanceGoldMg: 1 } }).toArray();
  for (const c of customers) {
    const biz = c.businessId || DEFAULT_BUSINESS_ID;
    const hasJournal = await LedgerEntry.exists({ businessId: biz, 'lines.account': `ar:${c._id}` });
    if (hasJournal) continue;
    const t = exactMinor(c.balanceTry, 2);
    const g = exactMinor(c.balanceGold, 3);
    if (!t.ok || !g.ok) {
      issue('customer_invalid_balance', { customerId: c._id, balanceTry: c.balanceTry, balanceGold: c.balanceGold });
      continue;
    }
    if (!t.exact || !g.exact) issue('customer_balance_rounded', { customerId: c._id, balanceTry: c.balanceTry, balanceGold: c.balanceGold });
    if (Number(t.minor) !== c.balanceTryMinor || Number(g.minor) !== c.balanceGoldMg) plan.customers.balancesToConvert += 1;
    if (t.minor !== 0n || g.minor !== 0n) {
      plan.customers.openingEntries += 1;
      if (t.minor < 0n) sums.rTry -= t.minor; else sums.pTry += t.minor;
      if (g.minor < 0n) sums.rGold -= g.minor; else sums.pGold += g.minor;
    }
  }
  plan.customers.receivableTry = toDisplayNumber(sums.rTry, 2);
  plan.customers.payableTry = toDisplayNumber(sums.pTry, 2);
  plan.customers.receivableGoldGrams = toDisplayNumber(sums.rGold, 3);
  plan.customers.payableGoldGrams = toDisplayNumber(sums.pGold, 3);

  // Referential integrity of legacy sales (reported, never changed).
  const customerIds = new Set(customers.map((c) => c._id));
  const productIds = new Set(products.map((p) => p._id));
  const sales = await Sale.collection.find(scope, { projection: { _id: 1, customerId: 1, productId: 1, lines: 1 } }).toArray();
  for (const s of sales) {
    if (s.customerId !== undefined && !customerIds.has(s.customerId)) issue('sale_missing_customer', { saleId: s._id, customerId: s.customerId });
    const ids = s.lines?.length ? s.lines.map((l) => l.productId) : [s.productId];
    for (const id of ids) if (id !== undefined && !productIds.has(id)) issue('sale_missing_product', { saleId: s._id, productId: id });
  }

  const conflicts = await findUniqueConflicts({ businessId });
  for (const d of conflicts.productBarcodes) issue('product_duplicate_barcode', { ...d, blocking: true });
  for (const d of conflicts.dailyClosings) issue('daily_closing_duplicate', { ...d, blocking: true });
  plan.blocking = conflicts.productBarcodes.length + conflicts.dailyClosings.length > 0;

  plan.pending = Object.values(plan.tenancy).some(Boolean) || Object.values(plan.branch).some(Boolean)
    || Boolean(plan.indexes.dropProductsBarcode) || Boolean(plan.indexes.dropDailyClosingsDate)
    || plan.products.costPoolsToSet > 0 || plan.products.openingMovements > 0 || plan.products.ownership.assignments > 0
    || plan.customers.balancesToConvert > 0 || plan.customers.openingEntries > 0;
  return plan;
}

module.exports = { planFinancialMigration, findUniqueConflicts };
